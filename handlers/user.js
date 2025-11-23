import { getMovieByCode, getSeriesByCode, getSeriesEpisodes, getAllMovies, isAdmin } from '../database.js';
import { serialHandler } from './serial.js';
import { sendMedia, escapeHTML } from '../utils.js';

function createSerialButtons(code, episodes, page = 0) {
    const EPISODES_PER_PAGE = 10;
    const buttons = [];
    const startIndex = page * EPISODES_PER_PAGE;
    const endIndex = Math.min(startIndex + EPISODES_PER_PAGE, episodes.length);

    let episodeRow = [];
    for (let i = startIndex; i < endIndex; i++) {
        const episodeNumber = i + 1;
        episodeRow.push({ text: `${episodeNumber}-qism`, callback_data: `sendEp:${code}:${i}` });
        if (episodeRow.length === 5) {
            buttons.push(episodeRow);
            episodeRow = [];
        }
    }
    if (episodeRow.length > 0) buttons.push(episodeRow);

    const paginationRow = [];
    const totalPages = Math.ceil(episodes.length / EPISODES_PER_PAGE);

    if (page > 0) {
        paginationRow.push({ text: '« Oldingi 10', callback_data: `pageEp:${code}:${page - 1}` });
    }

    if (totalPages > 1) {
        paginationRow.push({ text: `${page + 1}/${totalPages}`, callback_data: `ignore` });
    }

    if (page < totalPages - 1) {
        paginationRow.push({ text: 'Keyingi »', callback_data: `pageEp:${code}:${page + 1}` });
    }

    if (paginationRow.length > 0) {
        buttons.push(paginationRow);
    }

    return buttons;
}


export function userHandler(bot) {
    serialHandler(bot);

    bot.on('text', async (ctx) => {
        const userId = Number(ctx.from?.id);
        const text = ctx.message?.text?.trim?.();

        if (!text || isAdmin(userId) || text.startsWith('/')) {
            return;
        }

        if (!/^\d+$/.test(text)) {
            return ctx.reply(escapeHTML('Iltimos, raqamli kod yuboring!'), { parse_mode: 'HTML' });
        }

        const code = Number(text);

        const movie = getMovieByCode(code);
        if (movie) {
            await sendMedia(ctx, movie);
            return;
        }

        const series = getSeriesByCode(code);
        if (series) {
            const episodes = getSeriesEpisodes(code);

            const title = escapeHTML(series.title);
            const year = escapeHTML(String(series.year));
            const genre = escapeHTML(series.genre || 'Yoʻq');
            const desc = escapeHTML(series.desc || 'Tavsif yoʻq');

            if (!episodes || episodes.length === 0) {
                return ctx.reply(`📺 <b>${title}</b> uchun hali epizod mavjud emas.`, { parse_mode: 'HTML' });
            }

            const buttons = createSerialButtons(code, episodes, 0);

            const message = `
📺 <b>${title}</b> (${year})

<b>🎦 Janr:</b> ${genre}
<b>📄 Tavsif:</b> <i>${desc}</i>

<b>Seriyalar soni:</b> ${episodes.length}

<b>Iltimos, qismni tanlang:</b>
`;

            return ctx.reply(message, {
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'HTML'
            });
        }

        return ctx.reply(escapeHTML('Afsuski bunday kod mavjud emas!'), { parse_mode: 'HTML' });
    });

    bot.on('callback_query', async (ctx, next) => {
        const data = ctx.callbackQuery?.data;

        if (data === 'check_subscription') {
            await ctx.answerCbQuery('Obuna tekshirilmoqda...');
            await ctx.deleteMessage().catch(() => {});

            return ctx.reply(escapeHTML('✅ Obuna holati yangilandi. Iltimos, kod kiritishni davom ettiring.'), { parse_mode: 'HTML' });
        }

        return next();
    });
}