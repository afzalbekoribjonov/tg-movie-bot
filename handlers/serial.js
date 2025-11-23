import { getSeriesByCode, getSeriesEpisodes } from '../database.js';
import { escapeHTML } from '../utils.js'; // HTML escape

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
        paginationRow.push({ text: 'Keyingi 10 »', callback_data: `pageEp:${code}:${page + 1}` });
    }

    if (paginationRow.length > 0) {
        buttons.push(paginationRow);
    }

    return buttons;
}


export function serialHandler(bot) {

    bot.on('callback_query', async (ctx, next) => {
        const data = ctx.callbackQuery?.data;

        if (!data || data === 'ignore' || (!data.startsWith('pageEp:') && !data.startsWith('sendEp:'))) {
            return next();
        }

        const parts = data.split(':');
        const type = parts[0];
        const code = parseInt(parts[1]);
        const value = parseInt(parts[2]);

        await ctx.answerCbQuery().catch(console.error);

        // getSeriesByCode() chaqiruvi oldiga AWAIТ qo'shildi
        const series = await getSeriesByCode(code);
        if (!series) return;

        // getSeriesEpisodes() chaqiruvi oldiga AWAIТ qo'shildi
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
                await ctx.replyWithVideo(
                    episode.link,
                    {
                        caption: caption,
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: allButtons }
                    }
                );
            } catch (error) {
                console.error(`Serial video yuborishda xato ${code}:${episodeIndex + 1}:`, error.message);

                const errorMessageText = `⚠️ Serial video yuborishda xatolik yuz berdi.
<b>Xato:</b> <pre>${escapeHTML(error.message)}</pre>

${caption}
<b>Link:</b> <code>${escapeHTML(episode.link)}</code>
`;
                return ctx.reply(errorMessageText, { parse_mode: 'HTML' });
            }
        }
    });
}