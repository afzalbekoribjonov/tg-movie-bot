import { getSeriesByCode, getSeriesEpisodes } from '../database.js';
import { escapeHTML, sendStoredMedia } from '../utils.js';
import { createSerialButtons, EPISODES_PER_PAGE } from './serial_buttons.js';
import { sendPremiumMessage } from './premium.js';
import { appendKeyboardRow, getShareButtonRow } from './share.js';

function truncateText(text, maxLength = 260) {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return 'Tavsif yoʻq';
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength).trim()}…`;
}

function buildSeriesEpisodeCaption(series, episodeNumber, totalEpisodes) {
    const title = escapeHTML(series.title);
    const year = escapeHTML(String(series.year || 'Noma’lum'));
    const genre = escapeHTML(series.genre || 'Yoʻq');
    const desc = escapeHTML(truncateText(series.desc));

    return `📺 <b>${title}</b>

🎞️ <b>${episodeNumber}-qism</b> • <b>${episodeNumber}/${totalEpisodes}</b>
🗓 <b>Yili:</b> ${year}
🎭 <b>Janri:</b> ${genre}
📚 <b>Jami qismlar:</b> ${totalEpisodes}
📄 <b>Tavsif:</b> <i>${desc}</i>

👇 <i>Keyingi qismni tanlash uchun tugmalardan foydalaning.</i>`;
}

function buildSeriesEpisodeKeyboard(code, episodes, episodeIndex = 0) {
    const page = Math.floor(Math.max(Number(episodeIndex) || 0, 0) / EPISODES_PER_PAGE);

    return appendKeyboardRow(
        createSerialButtons(code, episodes, page),
        getShareButtonRow('series', code)
    );
}

async function sendSeriesEpisodeMessage(ctx, code, series, episodes, episodeIndex) {
    const title = escapeHTML(series.title);
    const episode = episodes[episodeIndex];

    if (!episode || (!episode.file_id && !episode.link)) {
        await ctx.reply(`<b>${title}</b> serialining ${episodeIndex + 1}-qismi uchun video, rasm yoki fayl topilmadi.`, { parse_mode: 'HTML' });
        return false;
    }

    const caption = buildSeriesEpisodeCaption(series, episodeIndex + 1, episodes.length);
    const allButtons = buildSeriesEpisodeKeyboard(code, episodes, episodeIndex);

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

        await ctx.reply(errorMessageText, { parse_mode: 'HTML' });
        return false;
    }

    try {
        await sendPremiumMessage(ctx, code);
    } catch (premiumError) {
        console.error(`Premium xabar yuborishda xato ${code}:${episodeIndex + 1}:`, premiumError.message);
    }

    return true;
}

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

            if (type === 'pageEp') {
                const page = value;
                const buttons = buildSeriesEpisodeKeyboard(code, episodes, page * EPISODES_PER_PAGE);

                try {
                    await ctx.editMessageReplyMarkup({ inline_keyboard: buttons });
                } catch (err) {
                    console.error('Sahifalash tugmalarini yangilashda xato:', err.message);
                }
                return;
            }

            if (type === 'sendEp') {
                const episodeIndex = value;
                const previousButtons = buildSeriesEpisodeKeyboard(code, episodes, episodeIndex);
                let markupCleared = false;

                try {
                    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
                    markupCleared = true;
                } catch (editError) {
                    console.error('Avvalgi serial tugmalarini vaqtincha olib tashlashda xato:', editError.message);
                }

                const sent = await sendSeriesEpisodeMessage(ctx, code, series, episodes, episodeIndex);
                if (!sent && markupCleared) {
                    try {
                        await ctx.editMessageReplyMarkup({ inline_keyboard: previousButtons });
                    } catch (restoreError) {
                        console.error('Serial tugmalarini qayta tiklashda xato:', restoreError.message);
                    }
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

export { sendSeriesEpisodeMessage };
