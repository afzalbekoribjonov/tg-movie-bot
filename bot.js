import { Telegraf, session } from 'telegraf';
import { initDB, getChannels, addUser, getAllMovies, checkUserExists } from './database.js';
import { userHandler } from './handlers/user.js';
import { adminHandler } from './handlers/admin.js';
import config from './config.js';
import { sendMedia, escapeHTML } from './utils.js';

initDB();

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
        const channels = getChannels();

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
    const movies = getAllMovies();

    if (!movies.length) {
        return ctx.reply(escapeHTML('Hozircha kino mavjud emas.'), { parse_mode: 'HTML' });
    }

    const movie = movies[Math.floor(Math.random() * movies.length)];

    await sendMedia(ctx, movie);
});


bot.start((ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || 'Foydalanuvchi';

    const userAlreadyExists = checkUserExists(userId);

    addUser(userId, username, firstName);

    let welcomeMessage;

    if (!userAlreadyExists) {
        welcomeMessage = `
Assalomu alaykum, <b>${escapeHTML(firstName)}</b>!
Xush kelibsiz, Iltimos, kino kodini kiriting!
`;
    } else {
        // Takroriy kirish
        welcomeMessage = `
<b>${escapeHTML(firstName)}</b>, iltimos kino kodini kiriting!
`;
    }

    return ctx.reply(welcomeMessage, { parse_mode: 'HTML' });
});


adminHandler(bot);

userHandler(bot);

bot.launch().then(() => console.log('Bot muvaffaqiyatli ishga tushdi! 🎉'));

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    console.log('Bot SIGINT orqali to‘xtatildi.');
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    console.log('Bot SIGTERM orqali to‘xtatildi.');
});