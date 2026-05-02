import { getMovieByCode, getSeriesByCode, getSeriesEpisodes } from '../database.js';
import { sendMedia, escapeHTML } from '../utils.js';
import { sendSeriesEpisodeMessage } from './serial.js';

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

            if (!episodes || episodes.length === 0) {
                await ctx.reply(`📺 <b>${title}</b> uchun hali epizod qo‘shilmagan.\n\nIltimos, birozdan keyin qayta tekshirib ko‘ring.`, { parse_mode: 'HTML' });
                return true;
            }

            await sendSeriesEpisodeMessage(ctx, code, series, episodes, 0);
            return true;
        }

        await ctx.reply(
            escapeHTML('😕 Bunday kod topilmadi. Kodni qayta tekshirib ko‘ring yoki /start dagi qidiruv tugmasi orqali nom bo‘yicha izlab ko‘ring.'),
            { parse_mode: 'HTML' }
        );
        return false;
    } catch (error) {
        console.error(`Foydalanuvchi kodi ${text} ni qayta ishlashda xato:`, error);
        await ctx.reply(
            escapeHTML('⚠️ Kechirasiz, hozircha so‘rovni bajarishda muammo yuz berdi. Iltimos, birozdan keyin qayta urinib ko‘ring.'),
            { parse_mode: 'HTML' }
        );
        return false;
    }
}
