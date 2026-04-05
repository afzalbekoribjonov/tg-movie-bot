import { sendPremiumMessage } from './handlers/premium.js';
import { getShareButtonRow } from './handlers/share.js';

export function escapeHTML(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

function inferMediaTypeFromValue(value) {
    const normalizedValue = String(value || '').toLowerCase().split('?')[0];

    if (
        normalizedValue.includes('/video') ||
        normalizedValue.includes('/videos/') ||
        /\.(mp4|mov|m4v|mkv|webm)$/i.test(normalizedValue)
    ) {
        return 'video';
    }

    if (
        normalizedValue.includes('/photo') ||
        normalizedValue.includes('/photos/') ||
        /\.(jpg|jpeg|png|webp|gif)$/i.test(normalizedValue)
    ) {
        return 'photo';
    }

    if (
        normalizedValue.includes('/document') ||
        normalizedValue.includes('/documents/') ||
        /\.(pdf|doc|docx|xls|xlsx|zip|rar|7z|txt)$/i.test(normalizedValue)
    ) {
        return 'document';
    }

    return null;
}

export function extractTelegramMedia(message) {
    if (!message) {
        return null;
    }

    if (message.video) {
        return {
            media_type: 'video',
            file_id: message.video.file_id,
            file_unique_id: message.video.file_unique_id,
            file_name: message.video.file_name || null,
            mime_type: message.video.mime_type || null,
            file_size: message.video.file_size || null,
            duration: message.video.duration || null,
        };
    }

    if (message.document) {
        return {
            media_type: 'document',
            file_id: message.document.file_id,
            file_unique_id: message.document.file_unique_id,
            file_name: message.document.file_name || null,
            mime_type: message.document.mime_type || null,
            file_size: message.document.file_size || null,
            duration: null,
        };
    }

    if (Array.isArray(message.photo) && message.photo.length > 0) {
        const bestPhoto = message.photo[message.photo.length - 1];
        return {
            media_type: 'photo',
            file_id: bestPhoto.file_id,
            file_unique_id: bestPhoto.file_unique_id,
            file_name: null,
            mime_type: null,
            file_size: bestPhoto.file_size || null,
            duration: null,
        };
    }

    return null;
}

function getItemMediaSource(item) {
    if (item?.file_id) {
        return {
            source: item.file_id,
            mediaType: item.media_type || inferMediaTypeFromValue(item.file_name) || 'video',
            isLegacy: false,
        };
    }

    if (item?.link) {
        return {
            source: item.link,
            mediaType: null,
            isLegacy: true,
        };
    }

    return null;
}

async function detectMediaType(ctx, link) {
    const directType = inferMediaTypeFromValue(link);
    if (directType) {
        return directType;
    }

    const isUrl = /^https?:\/\//i.test(String(link || '').trim());
    if (isUrl) {
        return null;
    }

    try {
        const file = await ctx.telegram.getFile(link);
        return inferMediaTypeFromValue(file?.file_path);
    } catch {
        return null;
    }
}

async function sendMediaByType(ctx, link, caption, mediaType, options = {}) {
    const extra = {
        ...options,
        caption,
        parse_mode: 'HTML',
        protect_content: true,
    };

    if (mediaType === 'photo') {
        return ctx.replyWithPhoto(link, extra);
    }

    if (mediaType === 'document') {
        return ctx.replyWithDocument(link, extra);
    }

    return ctx.replyWithVideo(link, extra);
}

export async function sendMediaWithFallback(ctx, link, caption, extra = {}) {
    const detectedMediaType = await detectMediaType(ctx, link);
    const mediaTypes = detectedMediaType
        ? [detectedMediaType, ...['video', 'photo', 'document'].filter(type => type !== detectedMediaType)]
        : ['video', 'photo', 'document'];

    let lastError = null;

    for (const mediaType of mediaTypes) {
        try {
            await sendMediaByType(ctx, link, caption, mediaType, extra);
            return mediaType;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Media yuborishda noma’lum xatolik yuz berdi.');
}

export async function sendStoredMedia(ctx, item, caption, extra = {}) {
    const mediaInfo = getItemMediaSource(item);

    if (!mediaInfo) {
        throw new Error('Media topilmadi.');
    }

    if (!mediaInfo.isLegacy && mediaInfo.mediaType) {
        await sendMediaByType(ctx, mediaInfo.source, caption, mediaInfo.mediaType, extra);
        return mediaInfo.mediaType;
    }

    return sendMediaWithFallback(ctx, mediaInfo.source, caption, extra);
}

export function buildItemCaption(item, emoji = '🎬') {
    const title = escapeHTML(item.title);
    const year = escapeHTML(String(item.year || 'Noma’lum'));
    const genre = escapeHTML(item.genre || 'Yoʻq');
    const desc = escapeHTML(item.desc || 'Tavsif yoʻq');

    return `
${emoji} <b>${title}</b> (${year})

<b>🎦 Janr:</b> ${genre}
<b>📄 Tavsif:</b> <i>${desc}</i>
`;
}

export async function sendMedia(ctx, item) {
    const caption = buildItemCaption(item, '🎬');
    const shareButtonRow = getShareButtonRow('movie', item?.code);

    if (!item?.file_id && !item?.link) {
        return ctx.reply(`<b>${escapeHTML(item.title)}</b> uchun video, rasm yoki fayl topilmadi.\n${caption}`, { parse_mode: 'HTML' });
    }

    try {
        await sendStoredMedia(ctx, item, caption, shareButtonRow ? {
            reply_markup: { inline_keyboard: [shareButtonRow] }
        } : {});
        try {
            await sendPremiumMessage(ctx, item.code ?? null);
        } catch (premiumError) {
            console.error(`Premium xabar yuborishda xato ${item.code}:`, premiumError.message);
        }
    } catch (error) {
        console.error(`Media yuborishda xato ${item.code}:`, error.message);

        const sourceInfo = item.file_id
            ? `<b>Saqlangan fayl:</b> <code>${escapeHTML(item.file_id)}</code>`
            : `<b>Link:</b> <code>${escapeHTML(item.link)}</code>`;

        const errorMessageText = `⚠️ Kino yuborishda muammo bo‘ldi.
<b>Xato:</b> <pre>${escapeHTML(error.message)}</pre>

${caption}
${sourceInfo}
`;

        return ctx.reply(errorMessageText, { parse_mode: 'HTML' });
    }
}
