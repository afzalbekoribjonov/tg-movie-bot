export function escapeHTML(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

export async function sendMedia(ctx, item) {
    // Ma'lumotlarni escape qilish
    const title = escapeHTML(item.title);
    const year = escapeHTML(String(item.year));
    const genre = escapeHTML(item.genre || 'Yoʻq');
    const desc = escapeHTML(item.desc || 'Tavsif yoʻq');

    const caption = `
🎬 <b>${title}</b> (${year})

<b>🎦 Janr:</b> ${genre}
<b>📄 Tavsif:</b> <i>${desc}</i>
`;

    if (!item.link) {
        return ctx.reply(`<b>${title}</b> uchun media (link/ID) topilmadi.\n${caption}`, { parse_mode: 'HTML' });
    }

    try {
        await ctx.replyWithVideo(
            item.link,
            {
                caption: caption,
                parse_mode: 'HTML',
            }
        );
    } catch (error) {
        console.error(`Media yuborishda xato ${item.code}:`, error.message);

        const errorMessageText = `⚠️ Video yuborishda xatolik yuz berdi.
<b>Xato:</b> <pre>${escapeHTML(error.message)}</pre>

${caption}
<b>Link:</b> <code>${escapeHTML(item.link)}</code>
`;

        return ctx.reply(errorMessageText, { parse_mode: 'HTML' });
    }
}