import { Telegraf } from 'telegraf';
import { initDB, addUser, getRandomMovie, checkUserExists, isAdmin, getPremiumSettings } from './database.js';
import { userHandler } from './handlers/user.js';
import { adminHandler } from './handlers/admin.js';
import { getCachedChannels } from './channel_cache.js';
import { sendPremiumMessage } from './handlers/premium.js';
import config from './config.js';
import { sendMedia, escapeHTML } from './utils.js';
import { persistentSession } from './persistent_session.js';
import http from 'http';

const bot = new Telegraf(config.BOT_TOKEN);

bot.use(persistentSession());

bot.use((ctx, next) => {
    if (!ctx.session || typeof ctx.session !== 'object') {
        ctx.session = {};
    }
    return next();
});

bot.action('ignore', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
});

bot.use(async (ctx, next) => {
    if (ctx.updateType === 'callback_query') return next();
    if (!ctx.from || isAdmin(ctx.from.id)) {
        return next();
    }

    if (ctx.message) {
        const channels = await getCachedChannels();

        if (channels.length > 0) {
            const userId = ctx.from.id;
            const membershipChecks = await Promise.all(
                channels.map(async (channel) => {
                    if (!channel.channel_id) {
                        return null;
                    }

                    try {
                        const member = await ctx.telegram.getChatMember(channel.channel_id, userId);
                        const isJoined = !['left', 'kicked'].includes(member.status);

                        return isJoined ? null : channel;
                    } catch (err) {
                        console.error(`Obuna tekshiruvida xato ${channel.channel_id}:`, err.message);
                        return channel;
                    }
                })
            );

            const notJoined = membershipChecks.filter(Boolean);

            if (notJoined.length > 0) {
                const text = 'Iltimos, botdan foydalanish uchun quyidagi kanallarga obuna bo‘ling:';
                const buttons = notJoined.map(c => [{ text: c.name, url: c.link }]);

                return ctx.reply(text, { reply_markup: { inline_keyboard: buttons } });
            }
        }
    }

    return next();
});

bot.command('random', async (ctx) => {
    const movie = await getRandomMovie();

    if (!movie) {
        return ctx.reply(escapeHTML('Hozircha kino mavjud emas.'), { parse_mode: 'HTML' });
    }

    await sendMedia(ctx, movie);
});

bot.command('premium', async (ctx) => {
    const premiumSettings = await getPremiumSettings();

    if (!premiumSettings.enabled) {
        return ctx.reply(escapeHTML('Hozircha premium rejim mavjud emas.'), { parse_mode: 'HTML' });
    }

    await sendPremiumMessage(ctx);
});

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || 'Foydalanuvchi';

    const userAlreadyExists = await checkUserExists(userId);

    await addUser(userId, username, firstName);

    let welcomeMessage;

    if (!userAlreadyExists) {
        welcomeMessage = `
Assalomu alaykum, <b>${escapeHTML(firstName)}</b>!
Xush kelibsiz, Iltimos, kino kodini kiriting!
`;
    } else {
        welcomeMessage = `
<b>${escapeHTML(firstName)}</b>, iltimos kino kodini kiriting!
`;
    }

    return ctx.reply(welcomeMessage, { parse_mode: 'HTML' });
});


adminHandler(bot);

userHandler(bot);

async function startBot() {
    const PORT = process.env.PORT || 3000;

    // 1. Birinchi: Renderning port scan talabini qondirish uchun HTTP serverni ishga tushirish
    // Bu asosiy jarayonni ochiq ushlab turadi va Render portni tezda topishini ta'minlaydi.
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot service is active and listening for pings.');
    });

    server.listen(PORT, () => {
        console.log(`🤖 Render Web Service uchun port ${PORT} ni tinglayapti!`);
    });

    // 2. Ikkinchi: Ma'lumotlar bazasiga ulanishni kutish
    await initDB();
    console.log('MongoDB ulanishi muvaffaqiyatli yakunlandi.');

    // 3. Uchinchi: Telegram bilan aloqa: Long Pollingni ishga tushirish
    // Bu fon rejimida Telegram xabarlarini qabul qiladi.
    bot.launch({
        polling: {
            timeout: 30,
            limit: 100
        }
    });
    console.log('Telegram Long Polling faol va ishlamoqda.');
}

startBot();

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    console.log('Bot SIGINT orqali to‘xtatildi.');
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    console.log('Bot SIGTERM orqali to‘xtatildi.');
});
