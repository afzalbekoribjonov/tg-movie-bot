import { getSeriesByCode, getSeriesEpisodes } from '../database.js';
import { escapeHTML, sendMediaWithFallback } from '../utils.js'; // HTML escape
import { createSerialButtons } from './serial_buttons.js';
import { sendPremiumMessage } from './premium.js';


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
                        await ctx.editMessageText('Epizodlar topilmadi.', { parse_mode: 'HTML' }).catch(console.error);
                    }
                } catch (err) { /* pass */ }
                return;
            }

            const title = escapeHTML(series.title);
            const year = escapeHTML(String(series.year));
            const genre = escapeHTML(series.genre || 'Yoʻq');
            const desc = escapeHTML(series.desc || 'Tavsif yoʻq');

            if (type === 'pageEp') {
                const page = value;
                const buttons = createSerialButtons(code, episodes, page);

                const message = `
📺 <b>${title}</b> (${year})

<b>🎦 Janr:</b> ${genre}
<b>📄 Tavsif:</b> <i>${desc}</i>

<b>Bo'limlar soni:</b> ${episodes.length}

<b>Iltimos, epizodni tanlang:</b>
`;
                const messageObj = ctx.callbackQuery.message;

                if (messageObj.text) {
                    try {
                        await ctx.editMessageText(message, {
                            reply_markup: { inline_keyboard: buttons },
                            parse_mode: 'HTML'
                        });
                    } catch (err) {
                        console.error('Sahifalash (Text) xabarini tahrirlashda xato:', err.message);
                    }
                } else if (messageObj.caption) {
                    try {
                        await ctx.editMessageCaption(message, {
                            reply_markup: { inline_keyboard: buttons },
                            parse_mode: 'HTML'
                        });
                    } catch (err) {
                        console.error('Sahifalash (Caption) xabarini tahrirlashda xato:', err.message);
                    }
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


                if (!episode || !episode.link) {
                    return ctx.reply(`<b>${title}</b> serialining ${episodeIndex + 1}-qismi uchun media topilmadi.`, { parse_mode: 'HTML' });
                }

                const caption = `
📺 <b>${title}</b> (${year})
<b>🎞️ ${episodeIndex + 1}-qism</b>

<b>🎦 Janr:</b> ${genre}
<b>📄 Tavsif:</b> <i>${desc}</i>
`;

                const allButtons = createSerialButtons(code, episodes, 0);

                try {
                    await sendMediaWithFallback(ctx, episode.link, caption, {
                        reply_markup: { inline_keyboard: allButtons }
                    });
                } catch (mediaError) {
                    console.error(`Serial media yuborishda xato ${code}:${episodeIndex + 1}:`, mediaError.message);

                    const errorMessageText = `⚠️ Serial media yuborishda xatolik yuz berdi.
<b>Xato:</b> <pre>${escapeHTML(mediaError.message)}</pre>

${caption}
<b>Link:</b> <code>${escapeHTML(episode.link)}</code>
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
