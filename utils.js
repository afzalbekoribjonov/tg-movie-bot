import { sendPremiumMessage } from './handlers/premium.js';

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
        await sendMediaWithFallback(ctx, item.link, caption);
        try {
            await sendPremiumMessage(ctx, item.code ?? null);
        } catch (premiumError) {
            console.error(`Premium xabar yuborishda xato ${item.code}:`, premiumError.message);
        }
    } catch (error) {
        console.error(`Media yuborishda xato ${item.code}:`, error.message);

        const errorMessageText = `⚠️ Media yuborishda xatolik yuz berdi.
<b>Xato:</b> <pre>${escapeHTML(error.message)}</pre>

${caption}
<b>Link:</b> <code>${escapeHTML(item.link)}</code>
`;

        return ctx.reply(errorMessageText, { parse_mode: 'HTML' });
    }
}
