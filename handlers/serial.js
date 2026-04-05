import { getSeriesByCode, getSeriesEpisodes } from '../database.js';
import { escapeHTML, sendStoredMedia, buildItemCaption } from '../utils.js';
import { createSerialButtons } from './serial_buttons.js';
import { sendPremiumMessage } from './premium.js';
import { appendKeyboardRow, getShareButtonRow } from './share.js';

export function serialHandler(bot) {

    bot.on('callback_query', async (ctx, next) => {
        const data = ctx.callbackQuery?.data;

        if (!data || data === 'ignore' || (!data.startsWith('pageEp:') && !data.startsWith('sendEp:'))) {
            return next();
        }

        try {
            const parts = data.split(':');
            const type = parts[0];
            const code = parseInt(parts[1]);
            const value = parseInt(parts[2]);

            await ctx.answerCbQuery().catch(console.error);

            const series = await getSeriesByCode(code);
            if (!series) return;

            const episodes = await getSeriesEpisodes(code);
            if (!episodes || episodes.length === 0) {
                try {
                    if (ctx.callbackQuery.message.text) {
                        await ctx.editMessageText('Qismlar topilmadi.', { parse_mode: 'HTML' }).catch(console.error);
                    }
                } catch (err) { }
                return;
            }

            const title = escapeHTML(series.title);
            const year = escapeHTML(String(series.year));
            const genre = escapeHTML(series.genre || 'Yoʻq');
            const desc = escapeHTML(series.desc || 'Tavsif yoʻq');

            if (type === 'pageEp') {
                const page = value;
                const buttons = appendKeyboardRow(
                    createSerialButtons(code, episodes, page),
                    getShareButtonRow('series', code)
                );

                try {
                    await ctx.editMessageReplyMarkup({ inline_keyboard: buttons });
                } catch (err) {
                    console.error('Sahifalash tugmalarini yangilashda xato:', err.message);
                }
                return;
            }

            if (type === 'sendEp') {
                const episodeIndex = value;
                const episode = episodes[episodeIndex];

                try {
                    await ctx.deleteMessage();
                } catch (e) {
                }

                if (!episode || (!episode.file_id && !episode.link)) {
                    return ctx.reply(`<b>${title}</b> serialining ${episodeIndex + 1}-qismi uchun video, rasm yoki fayl topilmadi.`, { parse_mode: 'HTML' });
                }

                const caption = `${buildItemCaption(series, '📺')}
<b>🎞️ ${episodeIndex + 1}-qism</b>
`;

                const allButtons = appendKeyboardRow(
                    createSerialButtons(code, episodes, 0),
                    getShareButtonRow('series', code)
                );

                try {
                    await sendStoredMedia(ctx, episode, caption, {
                        reply_markup: { inline_keyboard: allButtons }
                    });
                } catch (mediaError) {
                    console.error(`Serial media yuborishda xato ${code}:${episodeIndex + 1}:`, mediaError.message);

                    const sourceText = episode.file_id
                        ? `<b>Saqlangan fayl:</b> <code>${escapeHTML(episode.file_id)}</code>`
                        : `<b>Link:</b> <code>${escapeHTML(episode.link)}</code>`;

                    const errorMessageText = `⚠️ Serial qismini yuborishda muammo bo‘ldi.
<b>Xato:</b> <pre>${escapeHTML(mediaError.message)}</pre>

${caption}
${sourceText}
`;

                    return ctx.reply(errorMessageText, { parse_mode: 'HTML' });
                }

                try {
                    await sendPremiumMessage(ctx, code);
                } catch (premiumError) {
                    console.error(`Premium xabar yuborishda xato ${code}:${episodeIndex + 1}:`, premiumError.message);
                }
            }
        } catch (error) {
            console.error(`Serial callbackni qayta ishlashda xato ${data}:`, error);

            return ctx.reply(
                escapeHTML('Kechirasiz, serial bo‘limlarini yuklashda muammo yuz berdi. Iltimos, birozdan keyin qayta urinib ko‘ring.'),
                { parse_mode: 'HTML' }
            );
        }
    });
}
