import { getMovieByCode, getSeriesByCode } from '../database.js';
import { escapeHTML } from '../utils.js';

export async function sendEditDeleteMenu(ctx, code, type) {
    let item;
    let titleKey;
    let buttons = [];

    if (type === 'movie') {
        item = await getMovieByCode(code);
        titleKey = '🎬 Kino';
        buttons = [
            [{ text: '✏️ Nomi/Janri/Yili/Tavsifi', callback_data: `edit:${type}:${code}:details` }],
            [{ text: '🎞 Video/rasm/faylni almashtirish', callback_data: `edit:${type}:${code}:media` }],
            [{ text: '🗑 O‘chirish', callback_data: `delete:${type}:${code}` }]
        ];
    } else if (type === 'series') {
        item = await getSeriesByCode(code);
        titleKey = '📺 Serial';
        buttons = [
            [{ text: '✏️ Nomi/Janri/Yili/Tavsifi', callback_data: `edit:${type}:${code}:details` }],
            [{ text: '➕ Epizod qo‘shish', callback_data: `edit:${type}:${code}:add_ep` }],
            [{ text: '➖ Epizodni o‘chirish', callback_data: `edit:${type}:${code}:del_ep` }],
            [{ text: '🗑 Serialni butunlay o‘chirish', callback_data: `delete:${type}:${code}` }]
        ];
    }

    if (!item) {
        return ctx.reply(`${titleKey} topilmadi.`);
    }

    const sourceText = item.file_id
        ? 'Bot ichida saqlangan'
        : item.link
            ? 'Havola orqali saqlangan'
            : 'Hech narsa biriktirilmagan';

    const message = `
${titleKey} <b>${escapeHTML(item.title)}</b> (${escapeHTML(String(item.year))})
<b>Kod:</b> <code>${code}</code>
<b>Janr:</b> ${escapeHTML(item.genre || 'Yoʻq')}
<b>Tavsif:</b> <i>${escapeHTML(item.desc || 'Tavsif yoʻq')}</i>
<b>Saqlanish turi:</b> ${escapeHTML(sourceText)}

---
<b>O‘zgartirish uchun bo‘limni tanlang:</b>
`;

    return ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
    });
}
