import { escapeHTML } from '../utils.js';

const PRIVATE_INLINE_OPEN_REGEX = /__beigo_open_(movie|series)_(\d+)__/i;

export function extractPrivateInlineSelection(text) {
    const match = String(text || '').match(PRIVATE_INLINE_OPEN_REGEX);
    if (!match) {
        return null;
    }

    return {
        itemType: match[1].toLowerCase(),
        code: Number(match[2]),
    };
}

export function buildPrivateInlineSelectionMessage(itemType, item) {
    const emoji = itemType === 'series' ? '📺' : '🎬';
    const action = itemType === 'series' ? 'Serial tayyorlanmoqda' : 'Kino tayyorlanmoqda';
    const title = escapeHTML(item?.title || `${itemType === 'series' ? 'Serial' : 'Kino'} ${item?.code || ''}`.trim());
    const code = Number(item?.code);

    return `${emoji} <b>${action}</b>
<i>${title}</i>
<tg-spoiler>__beigo_open_${itemType}_${code}__</tg-spoiler>`;
}

export function isOwnInlinePlaceholderMessage(message, botId) {
    return Number(message?.via_bot?.id) > 0 && Number(message?.via_bot?.id) === Number(botId);
}
