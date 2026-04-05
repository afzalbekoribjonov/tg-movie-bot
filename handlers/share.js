function escapeHTML(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildShareSwitchQuery(itemType, code) {
    return `share_${itemType}_${Number(code)}`;
}

export function getShareButtonRow(itemType, code) {
    if (!code || !['movie', 'series'].includes(itemType)) {
        return null;
    }

    const query = buildShareSwitchQuery(itemType, code);

    return [
        {
            text: '📤 Tavsiya qilish',
            switch_inline_query: query,
        },
        {
            text: '💬 Shu chatga',
            switch_inline_query_current_chat: query,
        }
    ];
}

export function appendKeyboardRow(keyboard = [], row) {
    const normalizedKeyboard = Array.isArray(keyboard)
        ? keyboard.filter(item => Array.isArray(item) && item.length > 0).map(item => [...item])
        : [];

    if (Array.isArray(row) && row.length > 0) {
        normalizedKeyboard.push(row);
    }

    return normalizedKeyboard;
}

export function buildRecommendationMessage(itemType, item) {
    const title = escapeHTML(item?.title || `${itemType === 'series' ? 'Serial' : 'Kino'} ${item?.code || ''}`.trim());
    const year = item?.year ? ` (${escapeHTML(String(item.year))})` : '';
    const genre = item?.genre ? `\n🎦 <b>Janr:</b> ${escapeHTML(item.genre)}` : '';
    const desc = item?.desc
        ? `\n📄 <b>Qisqacha:</b> <i>${escapeHTML(String(item.desc).slice(0, 220))}${String(item.desc).length > 220 ? '…' : ''}</i>`
        : '';

    if (itemType === 'series') {
        return `📺 <b>Men sizga ushbu serialni tavsiya qilaman:</b>\n<b>${title}</b>${year}${genre}${desc}\n\n👇 Ko‘rish uchun tugmani bosing.`;
    }

    return `🎬 <b>Men sizga ushbu kinoni tavsiya qilaman:</b>\n<b>${title}</b>${year}${genre}${desc}\n\n👇 Ko‘rish uchun tugmani bosing.`;
}
