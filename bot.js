import { Telegraf, session } from 'telegraf';
import { initDB, getChannels, addUser, getAllMovies, checkUserExists } from './database.js';
import { userHandler } from './handlers/user.js';
import { adminHandler } from './handlers/admin.js';
import config from './config.js';
import { sendMedia, escapeHTML } from './utils.js';
import http from 'http'; // ✅ Yangi qator: HTTP server yaratish uchun

const bot = new Telegraf(config.BOT_TOKEN);

bot.use(session());

bot.use((ctx, next) => {
    if (!ctx.session || typeof ctx.session !== 'object') {
        ctx.session = {};
    }
    return next();
});

bot.use(async (ctx, next) => {

    if (ctx.updateType === 'callback_query') return next();
    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        return next();
    }

    if (ctx.message && ctx.from) {
        const channels = await getChannels();

        if (channels.length > 0) {
            let allJoined = true;
            const notJoined = [];
            const userId = ctx.from.id;

            for (const channel of channels) {
                if (!channel.channel_id) continue;

                try {
                    const member = await ctx.telegram.getChatMember(channel.channel_id, userId);

                    if (['left', 'kicked'].includes(member.status)) {
                        allJoined = false;
                        notJoined.push(channel);
                    }
                } catch (err) {
                    console.error(`Obuna tekshiruvida xato ${channel.channel_id}:`, err.message);
                    notJoined.push(channel);
                    allJoined = false;
                }
            }

            if (!allJoined) {
                const text = 'Iltimos, botdan foydalanish uchun quyidagi kanallarga obuna bo‘ling:';
                const buttons = notJoined.map(c => [{ text: c.name, url: c.link }]);

                return ctx.reply(text, { reply_markup: { inline_keyboard: buttons } });
            }
        }
    }

    return next();
});

bot.command('random', async (ctx) => {
    const movies = await getAllMovies();

    if (!movies.length) {
        return ctx.reply(escapeHTML('Hozircha kino mavjud emas.'), { parse_mode: 'HTML' });
    }

    const movie = movies[Math.floor(Math.random() * movies.length)];

    await sendMedia(ctx, movie);
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

// --- YENGI START BOT FUNKSIYASI ---
async function startBot() {
    await initDB(); // MongoDB ga ulanishni kutish

    const PORT = process.env.PORT || 3000;

    // ✅ Render'ni 'portni tinglayapti' deb ishontirish uchun Long Polling ishlayotgan bo'lsa ham
    // minimal HTTP serverni ishga tushiramiz.

    // Oddiy HTTP server yaratish
    http.createServer((req, res) => {
        // Bu joyga so'rov kelsa (masalan, UptimeRobot pingi), muvaffaqiyatli javob qaytaramiz
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Bot is running (Long Polling) and server is active for Render monitoring.');
    }).listen(PORT, () => {
        console.log(`🤖 Bot muvaffaqiyatli ishga tushdi va port ${PORT} ni tinglayapti (RENDER Web Service uchun)! 🎉`);
    });

    // Asosiy bot logikasi - Telegram API bilan doimiy aloqa
    // Bu, HTTP serverdan mustaqil ravishda ishlaydi.
    bot.launch({
        polling: {
            timeout: 30,
            limit: 100
        }
    }).then(() => console.log('Telegram Long Polling faol!'));
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