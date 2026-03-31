import { getMovieByCode, getSeriesByCode, getSeriesEpisodes } from '../database.js';
import { sendMedia, escapeHTML } from '../utils.js';
import { createSerialButtons } from './serial_buttons.js';

export async function handleNumericCodeLookup(ctx, rawCode) {
    const text = String(rawCode || '').trim();
    const code = Number(text);

    try {
        const movie = await getMovieByCode(code);
        if (movie) {
            await sendMedia(ctx, movie);
            return true;
        }

        const series = await getSeriesByCode(code);
        if (series) {
            const episodes = await getSeriesEpisodes(code);

            const title = escapeHTML(series.title);
            const year = escapeHTML(String(series.year));
            const genre = escapeHTML(series.genre || 'Yoʻq');
            const desc = escapeHTML(series.desc || 'Tavsif yoʻq');

            if (!episodes || episodes.length === 0) {
                await ctx.reply(`📺 <b>${title}</b> uchun hali epizod mavjud emas.`, { parse_mode: 'HTML' });
                return true;
            }

            const buttons = createSerialButtons(code, episodes, 0);
            const message = `
📺 <b>${title}</b> (${year})

<b>🎦 Janr:</b> ${genre}
<b>📄 Tavsif:</b> <i>${desc}</i>

<b>Seriyalar soni:</b> ${episodes.length}

<b>Iltimos, qismni tanlang:</b>
`;

            await ctx.reply(message, {
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'HTML'
            });
            return true;
        }

        await ctx.reply(escapeHTML('Afsuski bunday kod mavjud emas!'), { parse_mode: 'HTML' });
        return false;
    } catch (error) {
        console.error(`Foydalanuvchi kodi ${text} ni qayta ishlashda xato:`, error);
        await ctx.reply(
            escapeHTML('Kechirasiz, hozircha so‘rovni bajarishda muammo yuz berdi. Iltimos, birozdan keyin qayta urinib ko‘ring.'),
            { parse_mode: 'HTML' }
        );
        return false;
    }
}
