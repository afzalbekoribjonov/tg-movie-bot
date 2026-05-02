import {
    addMovie, getMovieByCode, addSeries, addSeriesEpisode, getSeriesByCode,
    getChannels, addChannel, deleteChannel, isAdmin, deleteMovie, deleteSeries,
    updateMovie, updateSeries, getSeriesEpisodes, deleteSeriesEpisode,
    getAllUserIds, getPremiumSettings, setPremiumSettings,
    getPromoChannelSettings, setPromoChannelSettings, clearPromoChannelSettings
} from '../database.js';
import { adminCommandsHandler } from './admin_commands.js';
import { sendEditDeleteMenu } from './admin_panel_utils.js';
import { getStatsMenuData, createListMenuData } from './admin_stats.js';
import { invalidateChannelsCache } from '../channel_cache.js';
import { escapeHTML, extractTelegramMedia } from '../utils.js';
import { handleNumericCodeLookup } from './code_lookup.js';

const BROADCAST_CONCURRENCY = 5;
const BROADCAST_DELAY_MS = 50;
const SERIES_UPLOAD_FINISH_CALLBACK = 'admin:finish_series_upload';
const PROMO_PUBLISH_CALLBACK = 'admin:promo_publish';
const PROMO_EDIT_CAPTION_CALLBACK = 'admin:promo_edit_caption';
const PROMO_EDIT_BUTTONS_CALLBACK = 'admin:promo_edit_buttons';
const PROMO_CANCEL_CALLBACK = 'admin:promo_cancel';
const PROMO_CHANNEL_CLEAR_CALLBACK = 'admin:promo_clear_channel';
const PROMO_BUTTON_MODE_PREFIX = 'admin:promo_btnmode';
const ADMIN_FLOW_CANCEL_CALLBACK = 'admin:cancel_flow';
const BROADCAST_CONFIRM_CALLBACK = 'admin:broadcast_confirm';
const BROADCAST_CANCEL_CALLBACK = 'admin:broadcast_cancel';

function withAdminCancelRows(rows = [], options = {}) {
    const includeMenu = options.includeMenu ?? false;
    const cancelText = options.cancelText || '❌ Bekor qilish';
    const keyboard = Array.isArray(rows) ? rows.map(row => [...row]) : [];

    keyboard.push([{ text: cancelText, callback_data: ADMIN_FLOW_CANCEL_CALLBACK }]);

    if (includeMenu) {
        keyboard.push([{ text: '🔙 Admin panel', callback_data: 'admin:menu' }]);
    }

    return keyboard;
}

function getAdminCancelKeyboard(options = {}) {
    return {
        inline_keyboard: withAdminCancelRows([], options)
    };
}

function buildDangerConfirmKeyboard(confirmCallback, backCallback) {
    return {
        inline_keyboard: [
            [{ text: '✅ Ha, davom etish', callback_data: confirmCallback }],
            [{ text: '↩️ Yo‘q, ortga qaytish', callback_data: backCallback }],
        ]
    };
}

function isSupportedBroadcastMessage(message) {
    return Boolean(
        message?.text
        || (Array.isArray(message?.photo) && message.photo.length > 0)
        || message?.video
        || message?.document
    );
}

function createBroadcastDraft(ctx) {
    if (!ctx?.chat?.id || !ctx?.message?.message_id || !isSupportedBroadcastMessage(ctx.message)) {
        return null;
    }

    return {
        sourceChatId: ctx.chat.id,
        messageId: ctx.message.message_id,
        summary: {
            type: ctx.message.text
                ? 'text'
                : ctx.message.photo
                    ? 'photo'
                    : ctx.message.video
                        ? 'video'
                        : 'document',
            previewText: String(ctx.message.caption || ctx.message.text || '').trim().slice(0, 180),
        }
    };
}

function buildBroadcastPreviewMessage(draft) {
    const typeLabels = {
        text: '📝 Matnli xabar',
        photo: '🖼 Rasmli xabar',
        video: '🎬 Videoli xabar',
        document: '📎 Faylli xabar',
    };

    const preview = draft?.summary?.previewText
        ? `\n\n<b>Qisqa ko‘rinish:</b>\n<i>${escapeHTML(draft.summary.previewText)}${draft.summary.previewText.length >= 180 ? '…' : ''}</i>`
        : '';

    return `👀 <b>Xabar preview tayyor</b>

<b>Turi:</b> ${typeLabels[draft?.summary?.type] || 'Xabar'}
<b>Holat:</b> Yuqoridagi xabar aynan barcha foydalanuvchilarga yuboriladi.${preview}

Hammasi to‘g‘ri bo‘lsa, yuborishni tasdiqlang.`;
}

function getBroadcastConfirmKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '📨 Tasdiqlab yuborish', callback_data: BROADCAST_CONFIRM_CALLBACK }],
            [{ text: '❌ Yuborishni bekor qilish', callback_data: BROADCAST_CANCEL_CALLBACK }],
        ]
    };
}

async function sendBroadcastToUser(bot, userId, message) {
    if (message?.sourceChatId && message?.messageId) {
        await bot.telegram.copyMessage(userId, message.sourceChatId, message.messageId);
        return true;
    }

    const isText = !!message.text;
    const isPhoto = !!message.photo;
    const isVideo = !!message.video;
    const isDocument = !!message.document;
    const isMedia = isPhoto || isVideo || isDocument;

    const caption = message.caption || message.text || '';
    const parseMode = message.caption_entities || message.entities ? 'HTML' : undefined;

    const replyMarkup = message.reply_markup;
    const extra = {
        parse_mode: parseMode,
        reply_markup: replyMarkup
    };

    if (isPhoto) {
        const fileId = message.photo[message.photo.length - 1].file_id;
        await bot.telegram.sendPhoto(userId, fileId, { caption: caption, ...extra });
        return true;
    }

    if (isVideo) {
        await bot.telegram.sendVideo(userId, message.video.file_id, { caption: caption, ...extra });
        return true;
    }

    if (isDocument) {
        await bot.telegram.sendDocument(userId, message.document.file_id, { caption: caption, ...extra });
        return true;
    }

    if (isText) {
        await bot.telegram.sendMessage(userId, caption, extra);
        return true;
    }

    if (!isMedia && !isText) {
        return false;
    }

    return false;
}

async function sendBroadcastAdvanced(bot, message) {
    const userIds = await getAllUserIds();
    let successCount = 0;
    let failCount = 0;
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < userIds.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            const userId = userIds[currentIndex];

            try {
                const sent = await sendBroadcastToUser(bot, userId, message);
                if (sent) {
                    successCount++;
                }
            } catch (error) {
                failCount++;

                if (
                    !error.message.includes('bot was blocked by the user') &&
                    !error.message.includes('CHAT_ID_INVALID') &&
                    !error.message.includes('user is deactivated')
                ) {
                    console.error(`Broadcast xato (ID: ${userId}):`, error.message);
                }
            }

            if (BROADCAST_DELAY_MS > 0) {
                await new Promise(resolve => setTimeout(resolve, BROADCAST_DELAY_MS));
            }
        }
    }

    const workerCount = Math.min(BROADCAST_CONCURRENCY, Math.max(userIds.length, 1));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return { total: userIds.length, sent: successCount, failed: failCount };
}

function getAdminPanelKeyboard() {
    return [
        [{ text: '➕ Kino qo‘shish', callback_data: 'admin:add_movie' }, { text: '➕ Serial qo‘shish', callback_data: 'admin:add_series' }],
        [{ text: '✏️ Kino/Serialni tahrirlash', callback_data: 'admin:edit_item' }],
        [{ text: '📣 Reklama postlari', callback_data: 'admin:promo_menu' }],
        [{ text: '📊 Statistika va ro‘yxat', callback_data: 'admin:show_stats' }],
        [{ text: '💎 Premium rejim', callback_data: 'admin:premium' }],
        [{ text: '📢 Kanal boshqaruvi', callback_data: 'admin:channels' }],
        [{ text: '📨 Hammaga xabar yuborish', callback_data: 'admin:broadcast' }]
    ];
}

function formatPremiumValue(value, fallback = 'Kiritilmagan') {
    return escapeHTML(value || fallback);
}

function buildPremiumSettingsMessage(settings) {
    const statusText = settings.enabled ? 'Yoqilgan' : 'O‘chirilgan';

    return `
💎 <b>Yopiq kanal premium sozlamalari</b>

<b>Holat:</b> ${escapeHTML(statusText)}
<b>Kanal narxi:</b> ${formatPremiumValue(settings.price)}
<b>Karta raqami:</b> <code>${formatPremiumValue(settings.card_number)}</code>
<b>Karta egasi:</b> ${formatPremiumValue(settings.card_owner)}
<b>Admin username:</b> @${formatPremiumValue(settings.admin_username, 'admin')}
`;
}

function getPremiumSettingsKeyboard(isEnabled) {
    const buttons = [];

    if (isEnabled) {
        buttons.push([
            { text: '✏️ Tahrirlash', callback_data: 'admin:premium_edit' },
            { text: '⛔ O‘chirish', callback_data: 'admin:premium_disable' }
        ]);
    } else {
        buttons.push([
            { text: '✅ Yoqish', callback_data: 'admin:premium_enable' }
        ]);
    }

    buttons.push([
        { text: '🔙 Admin panel', callback_data: 'admin:menu' }
    ]);

    return buttons;
}


function normalizeChannelTarget(value) {
    const raw = String(value || '').trim();

    if (!raw) {
        return null;
    }

    if (/^-?\d+$/.test(raw)) {
        return raw;
    }

    const usernameMatch = raw.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,})\/?$/i);
    if (usernameMatch) {
        return `@${usernameMatch[1]}`;
    }

    if (/^@[A-Za-z0-9_]{4,}$/.test(raw)) {
        return raw;
    }

    return null;
}

function extractPromoMedia(message) {
    if (!message) {
        return null;
    }

    if (Array.isArray(message.photo) && message.photo.length > 0) {
        const bestPhoto = message.photo[message.photo.length - 1];
        return {
            media_type: 'photo',
            file_id: bestPhoto.file_id,
            file_unique_id: bestPhoto.file_unique_id || null,
        };
    }

    if (message.video) {
        return {
            media_type: 'video',
            file_id: message.video.file_id,
            file_unique_id: message.video.file_unique_id || null,
        };
    }

    return null;
}

function getPromoDefaultButton(itemType, code, botUsername) {
    const safeCode = String(code || '').trim();
    const safeBotUsername = String(botUsername || '').trim();

    if (!safeCode || !safeBotUsername) {
        return null;
    }

    return {
        text: itemType === 'series' ? '📺 Serialni ko‘rish' : '🎬 Kino ko‘rish',
        url: `https://t.me/${safeBotUsername}?start=${safeCode}`,
    };
}

function getPromoMediaStepText() {
    return 'Endi reklama posti uchun rasm yoki qisqa video yuboring.\n\nAgar tayyor kanal postingiz bo‘lsa, uni botga uzatib yuborsangiz rasm/video va matn avtomatik olinadi.';
}

function getPromoButtonsStepText() {
    return `Qo‘shimcha URL tugmalarni yuboring.
Har qatorda 1-3 ta tugma bo‘lishi mumkin.

Namuna:
Kanal - https://t.me/kanalim
Treyler - https://example.com | Instagram - https://instagram.com/kanalim

Tugma kerak bo‘lmasa: skip`;
}

function getPromoChannelButton(promoChannel) {
    const channelUrl = promoChannel?.promo_channel_link || (promoChannel?.promo_channel_username ? `https://t.me/${promoChannel.promo_channel_username}` : null);

    if (!channelUrl) {
        return null;
    }

    return {
        text: '📢 Kanalga o‘tish',
        url: channelUrl,
    };
}

function getPromoButtonsModeText(promoChannel) {
    const hasChannelButton = Boolean(getPromoChannelButton(promoChannel));

    return `🔘 <b>Promo tugmalari</b>

Asosiy <b>“${promoChannel ? 'Kino ko‘rish / Serialni ko‘rish' : 'Ko‘rish'}”</b> tugmasi avtomatik qo‘shiladi.
${hasChannelButton ? 'Quyidan tez variant tanlang yoki qo‘lda tugma yozish rejimiga o‘ting.' : 'Kanal username bo‘lmagani uchun tez “Kanalga o‘tish” tugmasi yashirin. Kerak bo‘lsa qo‘lda URL tugma yozishingiz mumkin.'}`;
}

function getPromoButtonsModeKeyboard(promoChannel) {
    const hasChannelButton = Boolean(getPromoChannelButton(promoChannel));
    const rows = [
        [{ text: '✅ Faqat asosiy tugma', callback_data: `${PROMO_BUTTON_MODE_PREFIX}:default` }],
    ];

    if (hasChannelButton) {
        rows.push([{ text: '📢 Kanal + asosiy tugma', callback_data: `${PROMO_BUTTON_MODE_PREFIX}:channel` }]);
    }

    rows.push([{ text: '🎞 Treyler + asosiy tugma', callback_data: `${PROMO_BUTTON_MODE_PREFIX}:trailer` }]);

    if (hasChannelButton) {
        rows.push([{ text: '📢 Kanal + 🎞 Treyler', callback_data: `${PROMO_BUTTON_MODE_PREFIX}:channel_trailer` }]);
    }

    rows.push([{ text: '✍️ Tugmalarni qo‘lda yozish', callback_data: `${PROMO_BUTTON_MODE_PREFIX}:custom` }]);
    rows.push([{ text: '❌ Bekor qilish', callback_data: PROMO_CANCEL_CALLBACK }]);

    return rows;
}

function parseSinglePromoButton(text, defaultText = '🎞 Treyler') {
    const raw = String(text || '').trim();

    if (!raw || /^skip$/i.test(raw) || raw === '-') {
        throw new Error('URL yuboring yoki qo‘lda tugma yozish rejimini tanlang.');
    }

    if (/^(https?:\/\/\S+|tg:\/\/\S+|t\.me\/\S+)$/i.test(raw)) {
        const normalizedUrl = /^t\.me\//i.test(raw) ? `https://${raw}` : raw;
        return { text: defaultText, url: normalizedUrl };
    }

    const rows = parsePromoButtons(raw);
    if (rows.length !== 1 || rows[0].length !== 1) {
        throw new Error('Bu tez rejimda bitta tugma yuboring. Masalan: https://example.com yoki Treyler - https://example.com');
    }

    return rows[0][0];
}

function buildQuickPromoButtons(mode, promoChannel, inputText) {
    const channelButton = getPromoChannelButton(promoChannel);

    if (mode === 'default') {
        return [];
    }

    if (mode === 'channel') {
        if (!channelButton) {
            throw new Error('Kanal tez tugmasi uchun kanal username yoki public link topilmadi.');
        }
        return [[channelButton]];
    }

    const trailerButton = parseSinglePromoButton(inputText);

    if (mode === 'trailer') {
        return [[trailerButton]];
    }

    if (mode === 'channel_trailer') {
        if (!channelButton) {
            throw new Error('Kanal tez tugmasi uchun kanal username yoki public link topilmadi.');
        }
        return [[channelButton, trailerButton]];
    }

    throw new Error('Noma’lum promo tugma rejimi.');
}

async function promptPromoButtonsMode(ctx) {
    const promoChannel = await getPromoChannelSettings();
    const message = getPromoButtonsModeText(promoChannel);
    const replyMarkup = { inline_keyboard: getPromoButtonsModeKeyboard(promoChannel) };

    if (ctx.updateType === 'callback_query') {
        return ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: replyMarkup });
    }

    return ctx.reply(message, { parse_mode: 'HTML', reply_markup: replyMarkup });
}

function parsePromoButtons(text) {
    const raw = String(text || '').trim();

    if (!raw || /^skip$/i.test(raw) || raw === '-') {
        return [];
    }

    const rows = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (rows.length > 8) {
        throw new Error('Tugmalar qatori 8 tadan oshmasin.');
    }

    return rows.map((row) => {
        const buttonSpecs = row
            .split('|')
            .map(part => part.trim())
            .filter(Boolean);

        if (buttonSpecs.length === 0) {
            throw new Error('Bo‘sh tugma qatori yuborildi.');
        }

        if (buttonSpecs.length > 3) {
            throw new Error('Bir qatorda ko‘pi bilan 3 ta tugma bo‘lsin.');
        }

        return buttonSpecs.map((spec) => {
            const match = spec.match(/^(.+?)\s*(?:-|=|:)\s*(https?:\/\/\S+|tg:\/\/\S+|t\.me\/\S+)$/i);
            if (!match) {
                throw new Error('Tugma formati noto‘g‘ri. Namuna: Kanal - https://t.me/kanalim');
            }

            let url = match[2].trim();
            if (/^t\.me\//i.test(url)) {
                url = `https://${url}`;
            }

            return {
                text: match[1].trim().slice(0, 64),
                url,
            };
        });
    });
}

function buildPromoKeyboard(promoDraft, botUsername) {
    const keyboard = [];
    const defaultButton = getPromoDefaultButton(promoDraft?.itemType, promoDraft?.code, botUsername);

    if (defaultButton) {
        keyboard.push([defaultButton]);
    }

    if (Array.isArray(promoDraft?.customButtons) && promoDraft.customButtons.length > 0) {
        keyboard.push(...promoDraft.customButtons);
    }

    return keyboard.length > 0
        ? { inline_keyboard: keyboard }
        : undefined;
}

function buildPromoMenuMessage(settings) {
    const linkedText = settings?.promo_channel_id
        ? `✅ <b>Ulangan</b>\n<b>Kanal:</b> ${escapeHTML(settings.promo_channel_title || settings.promo_channel_id)}\n<b>Manzil:</b> <code>${escapeHTML(settings.promo_channel_id)}</code>${settings.promo_channel_link ? `\n<b>Link:</b> ${escapeHTML(settings.promo_channel_link)}` : ''}`
        : '⚠️ <b>Asosiy promo kanal ulanmagan</b>';

    return `📣 <b>Reklama postlari bo‘limi</b>\n\n${linkedText}\n\nBu yerda kino yoki serial uchun rasm yoki video, matn va tugmalar bilan tayyor reklama posti chiqarasiz.`;
}

function getPromoMenuKeyboard(hasChannel) {
    const buttons = [
        [{ text: '⚙️ Promo kanalni ulash', callback_data: 'admin:promo_set_channel' }],
        [{ text: '🎞 Promo post yaratish', callback_data: 'admin:promo_create' }],
    ];

    if (hasChannel) {
        buttons.push([{ text: '🗑 Promo kanalni uzish', callback_data: PROMO_CHANNEL_CLEAR_CALLBACK }]);
    }

    buttons.push([{ text: '🔙 Admin panel', callback_data: 'admin:menu' }]);
    return buttons;
}

async function showPromoMenu(ctx) {
    const promoSettings = await getPromoChannelSettings();
    const message = buildPromoMenuMessage(promoSettings);
    const keyboard = getPromoMenuKeyboard(Boolean(promoSettings?.promo_channel_id));

    if (ctx.updateType === 'callback_query') {
        return ctx.editMessageText(message, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    return ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function sendPromoPreview(ctx, promoDraft, botUsername) {
    const replyMarkup = buildPromoKeyboard(promoDraft, botUsername);
    const caption = String(promoDraft?.caption || '').trim();

    if (!promoDraft?.media?.file_id) {
        return ctx.reply('Ko‘rsatish uchun rasm yoki video topilmadi.');
    }

    if (promoDraft.media.media_type === 'video') {
        return ctx.replyWithVideo(promoDraft.media.file_id, {
            caption,
            reply_markup: replyMarkup,
        });
    }

    return ctx.replyWithPhoto(promoDraft.media.file_id, {
        caption,
        reply_markup: replyMarkup,
    });
}

async function showPromoReview(ctx, botUsername) {
    await ctx.reply('👀 Ko‘rinishi tayyor:');
    await sendPromoPreview(ctx, ctx.session.promoDraft, botUsername);

    return ctx.reply('Postni tekshirib oling. Ma’qul bo‘lsa kanalga joylang.', {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📣 Kanalga joylash', callback_data: PROMO_PUBLISH_CALLBACK }],
                [
                    { text: '✏️ Captionni o‘zgartirish', callback_data: PROMO_EDIT_CAPTION_CALLBACK },
                    { text: '🔘 Tugmalarni o‘zgartirish', callback_data: PROMO_EDIT_BUTTONS_CALLBACK }
                ],
                [{ text: '❌ Bekor qilish', callback_data: PROMO_CANCEL_CALLBACK }]
            ]
        }
    });
}

async function publishPromoPost(bot, promoChannel, promoDraft, botUsername) {
    const replyMarkup = buildPromoKeyboard(promoDraft, botUsername);
    const caption = String(promoDraft?.caption || '').trim();
    const chatId = promoChannel?.promo_channel_id;

    if (!chatId) {
        throw new Error('Promo kanal sozlanmagan.');
    }

    if (promoDraft?.media?.media_type === 'video') {
        return bot.telegram.sendVideo(chatId, promoDraft.media.file_id, {
            caption,
            reply_markup: replyMarkup,
        });
    }

    if (promoDraft?.media?.media_type === 'photo') {
        return bot.telegram.sendPhoto(chatId, promoDraft.media.file_id, {
            caption,
            reply_markup: replyMarkup,
        });
    }

    return bot.telegram.sendMessage(chatId, caption || 'Promo post', {
        reply_markup: replyMarkup,
        disable_web_page_preview: true,
    });
}

function getPromoCreatedKeyboard(code, itemType) {
    return {
        inline_keyboard: [
            [{ text: '📣 Shu kontent uchun promo yaratish', callback_data: `admin:promo_from:${itemType}:${code}` }],
            [{ text: '🔙 Admin panel', callback_data: 'admin:menu' }]
        ]
    };
}

async function beginPromoFlow(ctx, type, code) {
    const promoSettings = await getPromoChannelSettings();

    if (!promoSettings?.promo_channel_id) {
        return ctx.reply('Avval reklama posti chiqadigan kanalni ulang. /admin ichidan sozlashingiz mumkin.');
    }

    const normalizedType = type === 'series' ? 'series' : 'movie';
    const codeNumber = Number(code);
    const item = normalizedType === 'movie'
        ? await getMovieByCode(codeNumber)
        : await getSeriesByCode(codeNumber);

    if (!item) {
        return ctx.reply(normalizedType === 'movie' ? 'Kino topilmadi.' : 'Serial topilmadi.');
    }

    await resetAdminSession(ctx.session);
    ctx.session.promoDraft = {
        code: codeNumber,
        itemType: normalizedType,
        title: item.title,
        caption: '',
        customButtons: [],
        media: null,
    };
    ctx.session.adminStep = 'promo_media';

    return ctx.reply(
        `${normalizedType === 'movie' ? '🎬' : '📺'} <b>${escapeHTML(item.title)}</b> uchun promo boshlandi.\n\nEndi promo post uchun rasm yoki qisqa video yuboring.`,
        {
            parse_mode: 'HTML',
            reply_markup: getAdminCancelKeyboard()
        }
    );
}

function parseLabeledDetailsText(text) {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return null;
    }

    const lines = normalized
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    if (lines.length < 3) {
        return null;
    }

    const fields = {};

    for (const line of lines) {
        const match = line.match(/^([^:|]+)\s*[:|-]\s*(.+)$/);
        if (!match) continue;

        const rawKey = match[1].trim().toLowerCase();
        const value = match[2].trim();

        if (!value) continue;

        if (['nomi', 'name', 'title'].includes(rawKey)) fields.title = value;
        else if (['janri', 'genre'].includes(rawKey)) fields.genre = value;
        else if (['yili', 'year'].includes(rawKey)) fields.year = value;
        else if (['tavsifi', 'tavsif', 'desc', 'description'].includes(rawKey)) fields.desc = value;
    }

    const year = Number(fields.year);
    if (!fields.title || !fields.genre || !fields.year || !Number.isFinite(year)) {
        return null;
    }

    return {
        title: fields.title,
        genre: fields.genre,
        year,
        desc: fields.desc || null,
    };
}

function parseDetailsText(text) {
    const raw = String(text || '').trim();
    if (!raw) {
        return null;
    }

    const pipeParts = raw.split('|').map(part => part.trim());
    if (pipeParts.length >= 4) {
        const [title, genre, yearRaw, ...descParts] = pipeParts;
        const year = Number(yearRaw);

        if (title && genre && yearRaw && Number.isFinite(year)) {
            return {
                title,
                genre,
                year,
                desc: descParts.join(' | ').trim() || null,
            };
        }
    }

    return parseLabeledDetailsText(raw);
}

function shouldRollbackSeriesDraft(session) {
    return ['add_series_code', 'add_series_metadata', 'add_series_upload_episode'].includes(String(session?.adminStep || ''))
        && Number.isFinite(Number(session?.newSeries?.code));
}

async function resetAdminSession(session) {
    if (!session || typeof session !== 'object') {
        return;
    }

    if (shouldRollbackSeriesDraft(session)) {
        await deleteSeries(session.newSeries.code).catch((error) => {
            console.error('Bekor qilingan serial draftini o‘chirishda xato:', error?.message || error);
        });
    }

    session.premiumDraft = null;
    session.newChannel = null;
    session.broadcastDraft = null;
    session.adminStep = null;
    session.newMovie = null;
    session.newSeries = null;
    session.editItem = null;
    session.promoDraft = null;
}

function getSeriesUploadKeyboard() {
    return {
        inline_keyboard: withAdminCancelRows([
            [{ text: '✅ Yakunlash', callback_data: SERIES_UPLOAD_FINISH_CALLBACK }],
        ])
    };
}

async function showPremiumSettingsMenu(ctx) {
    const premiumSettings = await getPremiumSettings();
    await resetAdminSession(ctx.session);

    return ctx.editMessageText(
        buildPremiumSettingsMessage(premiumSettings),
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: getPremiumSettingsKeyboard(premiumSettings.enabled)
            }
        }
    );
}

async function startPremiumSetup(ctx, title) {
    const premiumSettings = await getPremiumSettings();

    await resetAdminSession(ctx.session);
    ctx.session.adminStep = 'premium_price';
    ctx.session.premiumDraft = {
        price: premiumSettings.price ?? '',
        card_number: premiumSettings.card_number ?? '',
        card_owner: premiumSettings.card_owner ?? '',
        admin_username: premiumSettings.admin_username ?? ''
    };

    return ctx.editMessageText(
        `💎 <b>${escapeHTML(title)}</b>\n\n<b>Joriy kanal narxi:</b> ${formatPremiumValue(premiumSettings.price)}\n\nKanalga qo‘shilish narxini kiriting:`,
        {
            parse_mode: 'HTML',
            reply_markup: getAdminCancelKeyboard()
        }
    );
}

async function handleMovieMediaUpload(ctx) {
    const media = extractTelegramMedia(ctx.message);
    if (!media) {
        return ctx.reply('Video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
    }

    const movieDraft = ctx.session.newMovie;
    if (!movieDraft) {
        await resetAdminSession(ctx.session);
        return ctx.reply('Saqlanayotgan kino ma’lumoti topilmadi. Jarayonni boshidan boshlang.');
    }

    await addMovie({
        ...movieDraft,
        ...media,
        link: movieDraft.link ?? null,
    });

    const savedCode = movieDraft.code;
    await resetAdminSession(ctx.session);
    return ctx.reply(
        '✅ Kino saqlandi. Endi bot uni o‘zida ochib yubora oladi.',
        { reply_markup: getPromoCreatedKeyboard(savedCode, 'movie') }
    );
}

async function handleSeriesEpisodeUpload(ctx) {
    const media = extractTelegramMedia(ctx.message);
    if (!media) {
        return ctx.reply('Qism uchun video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
    }

    const seriesDraft = ctx.session.newSeries;
    if (!seriesDraft?.code) {
        await resetAdminSession(ctx.session);
        return ctx.reply('Serial yuklash holati topilmadi. Jarayonni qaytadan boshlang.');
    }

    const nextEpisode = Number(seriesDraft.episodesCount || 0) + 1;
    await addSeriesEpisode(seriesDraft.code, nextEpisode, media);
    ctx.session.newSeries.episodesCount = nextEpisode;

    return ctx.reply(
        `✅ ${nextEpisode}-epizod qo‘shildi. Yana epizod yuboring yoki “Yakunlash” tugmasini bosing.`,
        { reply_markup: getSeriesUploadKeyboard() }
    );
}

async function handleMovieCreateFromCaptionedMedia(ctx) {
    const media = extractTelegramMedia(ctx.message);
    const fields = parseDetailsText(ctx.message?.caption || '');

    if (!media) {
        return ctx.reply('Video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
    }

    if (!fields) {
        return ctx.reply(`Xabar matnida kerakli ma’lumot topilmadi. Quyidagi ko‘rinishlardan birini ishlating:

Nomi | Janri | Yili | Tavsifi

yoki

Nomi: ...
Janri: ...
Yili: ...
Tavsifi: ...`);
    }

    const movieDraft = { ...(ctx.session.newMovie || {}), ...fields };
    await addMovie({
        ...movieDraft,
        ...media,
        link: null,
    });

    const savedCode = movieDraft.code;
    await resetAdminSession(ctx.session);
    return ctx.reply('✅ Kino bitta xabar bilan saqlandi. Matn ham, fayl ham saqlandi.', {
        reply_markup: getPromoCreatedKeyboard(savedCode, 'movie')
    });
}

async function handleSeriesCreateFromCaptionedMedia(ctx) {
    const media = extractTelegramMedia(ctx.message);
    const fields = parseDetailsText(ctx.message?.caption || '');

    if (!media) {
        return ctx.reply('Video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
    }

    if (!fields) {
        return ctx.reply(`Xabar matnida kerakli ma’lumot topilmadi. Quyidagi ko‘rinishlardan birini ishlating:

Nomi | Janri | Yili | Tavsifi

yoki

Nomi: ...
Janri: ...
Yili: ...
Tavsifi: ...`);
    }

    const seriesDraft = { ...(ctx.session.newSeries || {}), ...fields, episodesCount: 1 };

    await addSeries({
        code: seriesDraft.code,
        title: seriesDraft.title,
        desc: seriesDraft.desc,
        genre: seriesDraft.genre,
        year: seriesDraft.year,
    });
    await addSeriesEpisode(seriesDraft.code, 1, media);

    ctx.session.newSeries = seriesDraft;
    ctx.session.adminStep = 'add_series_upload_episode';

    return ctx.reply('✅ Serial ma’lumoti va 1-qism birga saqlandi. Endi qolgan qismlarni yuboring yoki “Yakunlash” tugmasini bosing.', {
        reply_markup: getSeriesUploadKeyboard()
    });
}

async function handleEditMovieMedia(ctx) {
    const media = extractTelegramMedia(ctx.message);
    if (!media) {
        return ctx.reply('Video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
    }

    const item = ctx.session.editItem;
    if (!item?.code || item.type !== 'movie') {
        await resetAdminSession(ctx.session);
        return ctx.reply('Tahrirlash holati topilmadi.');
    }

    const existingMovie = await getMovieByCode(item.code);
    if (!existingMovie) {
        await resetAdminSession(ctx.session);
        return ctx.reply('Kino topilmadi.');
    }

    await updateMovie(item.code, {
        title: existingMovie.title,
        desc: existingMovie.desc,
        genre: existingMovie.genre,
        year: existingMovie.year,
        link: null,
        ...media,
    });

    await resetAdminSession(ctx.session);
    return ctx.reply(`✅ Kino (Kod: ${item.code}) videosi, rasmi yoki fayli yangilandi.`);
}

async function handleEditSeriesAddEpisode(ctx) {
    const media = extractTelegramMedia(ctx.message);
    if (!media) {
        return ctx.reply('Qism uchun video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
    }

    const item = ctx.session.editItem;
    if (!item?.code || item.type !== 'series') {
        await resetAdminSession(ctx.session);
        return ctx.reply('Tahrirlash holati topilmadi.');
    }

    const episodes = await getSeriesEpisodes(item.code);
    const nextEpNum = episodes.length + 1;
    await addSeriesEpisode(item.code, nextEpNum, media);

    await resetAdminSession(ctx.session);
    return ctx.reply(`✅ Serial (Kod: ${item.code}) ga ${nextEpNum}-epizod muvaffaqiyatli qo‘shildi.`);
}

export function adminHandler(bot) {
    adminCommandsHandler(bot);

    bot.command('cancel', async (ctx) => {
        const uid = Number(ctx.from?.id);
        if (!isAdmin(uid)) return;
        if (!ctx.session) ctx.session = {};

        await resetAdminSession(ctx.session);

        return ctx.reply('⛔ Jarayon bekor qilindi. Kerak bo‘lsa /admin orqali qayta boshlashingiz mumkin.');
    });

    bot.command('admin', (ctx) => {
        const uid = Number(ctx.from?.id);
        if (!isAdmin(uid)) return ctx.reply('Siz admin emassiz.');
        return ctx.reply(
            'Admin bo‘limiga xush kelibsiz 👑',
            {
                reply_markup: {
                    inline_keyboard: getAdminPanelKeyboard()
                }
            }
        );
    });

    bot.on('message', async (ctx, next) => {
        const uid = Number(ctx.from?.id);
        if (!isAdmin(uid)) { return next(); }

        if (!ctx.session) ctx.session = {};
        const step = ctx.session.adminStep;

        if (step === 'broadcast_message' && ctx.message) {
            const draft = createBroadcastDraft(ctx);
            if (!draft) {
                return ctx.reply(
                    '⚠️ Broadcast uchun hozircha faqat matn, rasm, video yoki fayl yuborish mumkin.',
                    { reply_markup: getAdminCancelKeyboard() }
                );
            }

            ctx.session.adminStep = 'broadcast_confirm';
            ctx.session.broadcastDraft = draft;

            return ctx.reply(buildBroadcastPreviewMessage(draft), {
                parse_mode: 'HTML',
                reply_markup: getBroadcastConfirmKeyboard()
            });
        }

        if (step === 'broadcast_confirm' && ctx.message) {
            return ctx.reply('👆 Yuqoridagi preview tayyor. Endi pastdagi tugmalar orqali yuborishni tasdiqlang yoki bekor qiling.');
        }

        return next();
    });

    bot.on('message', async (ctx, next) => {
        const uid = Number(ctx.from?.id);
        if (!isAdmin(uid)) { return next(); }

        if (!ctx.session) ctx.session = {};
        const step = ctx.session.adminStep;

        if (!step) {
            return next();
        }

        if (step === 'add_movie_metadata' && extractTelegramMedia(ctx.message)) {
            return handleMovieCreateFromCaptionedMedia(ctx);
        }

        if (step === 'add_movie_media') {
            return handleMovieMediaUpload(ctx);
        }

        if (step === 'add_series_metadata' && extractTelegramMedia(ctx.message)) {
            return handleSeriesCreateFromCaptionedMedia(ctx);
        }

        if (step === 'add_series_upload_episode') {
            return handleSeriesEpisodeUpload(ctx);
        }

        if (step === 'edit_movie_media') {
            return handleEditMovieMedia(ctx);
        }

        if (step === 'edit_series_add_ep') {
            return handleEditSeriesAddEpisode(ctx);
        }

        if (step === 'promo_media') {
            const promoMedia = extractPromoMedia(ctx.message);

            if (!promoMedia) {
                return ctx.reply('Reklama posti uchun rasm yoki qisqa video yuboring. Tayyor kanal postini ham uzatib yuborishingiz mumkin.', {
                    reply_markup: getAdminCancelKeyboard()
                });
            }

            const forwardedCaption = String(ctx.message?.caption || '').trim();
            const shouldUseForwardedCaption = forwardedCaption.length > 0 && forwardedCaption.length <= 1024;

            ctx.session.promoDraft = {
                ...(ctx.session.promoDraft || {}),
                media: promoMedia,
                caption: shouldUseForwardedCaption ? forwardedCaption : String(ctx.session.promoDraft?.caption || ''),
            };

            if (shouldUseForwardedCaption) {
                ctx.session.adminStep = 'promo_buttons_mode';
                await ctx.reply(`✅ Rasm yoki video qabul qilindi.
🪄 Uzatib yuborilgan postdagi matn ham avtomatik olindi.`);
                return promptPromoButtonsMode(ctx);
            }

            ctx.session.adminStep = 'promo_caption';
            return ctx.reply('✏️ Endi post matnini yuboring. Xohlasangiz tayyor kanal postingizni uzatib yuborsangiz, matn o‘zi olinadi.', {
                reply_markup: getAdminCancelKeyboard()
            });
        }

        return next();
    });

    bot.on('callback_query', async (ctx, next) => {
        const uid = Number(ctx.from?.id);
        const data = ctx.callbackQuery?.data;

        if (!data?.startsWith('admin:') && !data?.startsWith('delete_channel:') && !data?.startsWith('edit:') && !data?.startsWith('delete:')) {
            return next();
        }

        if (!isAdmin(uid)) return ctx.answerCbQuery('Siz admin emassiz.');
        if (!ctx.session) ctx.session = {};

        const [action, ...params] = data.split(':');
        await ctx.answerCbQuery().catch(() => {});

        if (action === 'admin') {
            const adminAction = params[0];

            if (adminAction === 'menu') {
                await resetAdminSession(ctx.session);
                return ctx.editMessageText('Admin bo‘limiga xush kelibsiz 👑', {
                    reply_markup: {
                        inline_keyboard: getAdminPanelKeyboard()
                    }
                });
            } else if (adminAction === 'add_movie') {
                await resetAdminSession(ctx.session);
                ctx.session.adminStep = 'add_movie_code';
                return ctx.editMessageText('🎬 Yangi kino qo‘shamiz.\n\nAvval kino kodini kiriting. Masalan: <code>1001</code>', {
                    parse_mode: 'HTML',
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (adminAction === 'add_series') {
                await resetAdminSession(ctx.session);
                ctx.session.adminStep = 'add_series_code';
                return ctx.editMessageText('📺 Yangi serial qo‘shamiz.\n\nAvval serial kodini kiriting. Masalan: <code>2001</code>', {
                    parse_mode: 'HTML',
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (adminAction === 'edit_item') {
                await resetAdminSession(ctx.session);
                ctx.session.adminStep = 'edit_item_code';
                return ctx.editMessageText('✏️ Tahrirlash uchun kino yoki serial kodini yuboring:', {
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (adminAction === 'promo_menu') {
                await resetAdminSession(ctx.session);
                return showPromoMenu(ctx);
            } else if (adminAction === 'promo_set_channel') {
                await resetAdminSession(ctx.session);
                ctx.session.adminStep = 'promo_channel_id';
                return ctx.editMessageText('📢 Reklama posti chiqadigan kanalni yuboring.\n\n@username, t.me link yoki raqamli ID bo‘lishi mumkin. Bot o‘sha kanalda admin bo‘lishi kerak.', {
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (adminAction === 'promo_create') {
                await resetAdminSession(ctx.session);
                ctx.session.adminStep = 'promo_item_code';
                return ctx.editMessageText('📣 Reklama qilinadigan kino yoki serial kodini yuboring.\n\nKeyin tayyor kanal postingizni uzatsangiz, rasm/video va matn avtomatik olinadi.', {
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (adminAction === 'promo_from') {
                const [itemType, code] = [params[1], params[2]];
                return beginPromoFlow(ctx, itemType, code);
            } else if (adminAction === 'promo_publish') {
                const promoDraft = ctx.session.promoDraft;
                if (!promoDraft?.code || !promoDraft?.media?.file_id) {
                    return ctx.editMessageText('Tayyorlanayotgan post topilmadi yoki hali bitmagan.');
                }

                const promoChannel = await getPromoChannelSettings();
                const botUsername = ctx.botInfo?.username || bot.botInfo?.username;

                try {
                    const sentMessage = await publishPromoPost(bot, promoChannel, promoDraft, botUsername);
                    const publicLink = promoChannel.promo_channel_username
                        ? `https://t.me/${promoChannel.promo_channel_username}/${sentMessage.message_id}`
                        : null;

                    await resetAdminSession(ctx.session);

                    return ctx.editMessageText(
                        publicLink
                            ? `✅ Promo post kanalga joylandi.\n\n🔗 ${publicLink}`
                            : '✅ Promo post kanalga muvaffaqiyatli joylandi.'
                    );
                } catch (error) {
                    console.error('Promo postni kanalga joylashda xato:', error);
                    return ctx.editMessageText(`⚠️ Promo postni joylashda xatolik yuz berdi:\n${error.message}`);
                }
            } else if (adminAction === 'promo_edit_caption') {
                if (!ctx.session.promoDraft?.code) {
                    return ctx.editMessageText('Tayyorlanayotgan post topilmadi.');
                }
                ctx.session.adminStep = 'promo_caption';
                return ctx.editMessageText('✏️ Yangi post matnini yuboring:', {
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (adminAction === 'promo_edit_buttons') {
                if (!ctx.session.promoDraft?.code) {
                    return ctx.editMessageText('Tayyorlanayotgan post topilmadi.');
                }
                ctx.session.adminStep = 'promo_buttons_mode';
                return promptPromoButtonsMode(ctx);
            } else if (adminAction === 'promo_btnmode') {
                if (!ctx.session.promoDraft?.code) {
                    return ctx.editMessageText('Tayyorlanayotgan post topilmadi.');
                }

                const mode = params[1];
                const promoChannel = await getPromoChannelSettings();

                try {
                    if (mode === 'custom') {
                        ctx.session.adminStep = 'promo_buttons';
                        return ctx.editMessageText(getPromoButtonsStepText(), {
                            reply_markup: getAdminCancelKeyboard()
                        });
                    }

                    if (mode === 'trailer' || mode === 'channel_trailer') {
                        ctx.session.adminStep = 'promo_trailer_url';
                        ctx.session.promoDraft = {
                            ...(ctx.session.promoDraft || {}),
                            buttonPreset: mode,
                        };
                        return ctx.editMessageText('🎞 Treyler havolasini yuboring. Xohlasangiz <code>Tugma nomi - havola</code> ko‘rinishida ham yozishingiz mumkin.', {
                            parse_mode: 'HTML',
                            reply_markup: getAdminCancelKeyboard()
                        });
                    }

                    const customButtons = buildQuickPromoButtons(mode, promoChannel);
                    ctx.session.promoDraft = {
                        ...(ctx.session.promoDraft || {}),
                        customButtons,
                        buttonPreset: null,
                    };
                    ctx.session.adminStep = null;

                    await ctx.editMessageText('✅ Promo tugma varianti tanlandi.');
                    const botUsername = ctx.botInfo?.username || bot.botInfo?.username;
                    return showPromoReview(ctx, botUsername);
                } catch (error) {
                    return ctx.editMessageText(`⚠️ Tugmalarni tayyorlashda muammo bo‘ldi: ${error.message}`);
                }
            } else if (adminAction === 'promo_cancel') {
                await resetAdminSession(ctx.session);
                return showPromoMenu(ctx);
            } else if (adminAction === 'promo_clear_channel') {
                await clearPromoChannelSettings();
                await resetAdminSession(ctx.session);
                return showPromoMenu(ctx);
            } else if (adminAction === 'show_stats') {
                const menuData = await getStatsMenuData();
                return ctx.editMessageText(menuData.message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: menuData.buttons } });
            } else if (adminAction === 'list') {
                const [type, page] = [params[1], Number(params[2])];
                const listData = await createListMenuData(type, page);
                if (!listData) return ctx.editMessageText('Noto‘g‘ri tur.');
                return ctx.editMessageText(listData.message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: listData.buttons } });
            } else if (adminAction === 'listpage') {
                const [type, page] = [params[1], Number(params[2])];
                const listData = await createListMenuData(type, page);
                if (!listData) return ctx.editMessageText('Noto‘g‘ri tur.');
                return ctx.editMessageText(listData.message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: listData.buttons } });
            } else if (adminAction === 'broadcast') {
                await resetAdminSession(ctx.session);
                ctx.session.adminStep = 'broadcast_message';
                return ctx.editMessageText('📨 Hammaga yuboriladigan xabarni yuboring.\n\nMatn, rasm, video yoki fayl bo‘lishi mumkin. Avval preview ko‘rsatiladi, keyin tasdiqlaysiz.', {
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (adminAction === 'broadcast_confirm') {
                const draft = ctx.session.broadcastDraft;
                if (!draft?.sourceChatId || !draft?.messageId) {
                    await resetAdminSession(ctx.session);
                    return ctx.editMessageText('⚠️ Broadcast draft topilmadi. Iltimos, xabarni qayta yuboring.');
                }

                await ctx.editMessageText('⏳ Xabar barcha foydalanuvchilarga yuborilmoqda...');
                const results = await sendBroadcastAdvanced(bot, draft);
                await resetAdminSession(ctx.session);

                return ctx.reply(
                    `✅ Broadcast yakunlandi.\n\n👥 Jami foydalanuvchi: ${results.total}\n🟢 Yuborildi: ${results.sent}\n🔴 Xatolik: ${results.failed}`
                );
            } else if (adminAction === 'broadcast_cancel') {
                await resetAdminSession(ctx.session);
                return ctx.editMessageText('❌ Broadcast yuborilishi bekor qilindi.');
            } else if (adminAction === 'cancel_flow') {
                await resetAdminSession(ctx.session);
                return ctx.editMessageText('⛔ Jarayon bekor qilindi. Kerak bo‘lsa /admin orqali qayta boshlashingiz mumkin.');
            } else if (adminAction === 'delete_confirm') {
                const [type, code] = [params[1], params[2]];
                const codeNum = Number(code);
                let result;

                if (type === 'movie') {
                    result = await deleteMovie(codeNum);
                } else if (type === 'series') {
                    result = await deleteSeries(codeNum);
                }

                await resetAdminSession(ctx.session);
                if (result?.deletedCount > 0) {
                    return ctx.editMessageText(`✅ ${type === 'movie' ? 'Kino' : 'Serial'} (Kod: ${code}) bazadan butunlay o‘chirildi.`);
                }

                return ctx.editMessageText(`⚠️ ${type === 'movie' ? 'Kino' : 'Serial'} (Kod: ${code}) o‘chirishda xatolik yuz berdi yoki u topilmadi.`);
            } else if (adminAction === 'delete_cancel') {
                const [type, code] = [params[1], Number(params[2])];
                await ctx.editMessageText('✅ O‘chirish bekor qilindi.');
                return sendEditDeleteMenu(ctx, code, type);
            } else if (adminAction === 'delete_episode_confirm') {
                const [code, episode] = [Number(params[1]), Number(params[2])];
                const result = await deleteSeriesEpisode(code, episode);
                await resetAdminSession(ctx.session);

                if (result?.deletedCount > 0) {
                    return ctx.editMessageText(`✅ Serial (Kod: ${code}) dan ${episode}-epizod muvaffaqiyatli o‘chirildi.`);
                }

                return ctx.editMessageText(`⚠️ Serial (Kod: ${code}) da ${episode}-epizod topilmadi yoki o‘chirilmadi.`);
            } else if (adminAction === 'delete_episode_cancel') {
                const code = Number(params[1]);
                await resetAdminSession(ctx.session);
                await ctx.editMessageText('✅ Epizodni o‘chirish bekor qilindi.');
                return sendEditDeleteMenu(ctx, code, 'series');
            } else if (adminAction === 'channels') {
                const channels = await getChannels();
                let msg = '📢 Majburiy kanallar ro‘yxati:\n\n';
                if (channels.length === 0) msg += 'Hozircha kanal yo‘q.';
                else channels.forEach(c => { msg += `🔹 ${c.name} — ${c.channel_id} (${c.link})\n`; });
                msg += '\n➕ Qo‘shish: /addchannel\n➖ O‘chirish: /delchannel';
                return ctx.editMessageText(msg);
            } else if (adminAction === 'premium') {
                return showPremiumSettingsMenu(ctx);
            } else if (adminAction === 'premium_enable') {
                return startPremiumSetup(ctx, 'Premium rejimni yoqish');
            } else if (adminAction === 'premium_edit') {
                return startPremiumSetup(ctx, 'Premium sozlamalarini tahrirlash');
            } else if (adminAction === 'premium_disable') {
                await setPremiumSettings({ enabled: false });
                return showPremiumSettingsMenu(ctx);
            } else if (adminAction === 'finish_series_upload') {
                const seriesDraft = ctx.session.newSeries;
                if (!seriesDraft?.code) {
                    await resetAdminSession(ctx.session);
                    return ctx.editMessageText('Davom etayotgan serial saqlash jarayoni topilmadi.');
                }

                if (!seriesDraft.episodesCount) {
                    await deleteSeries(seriesDraft.code);
                    await resetAdminSession(ctx.session);
                    return ctx.editMessageText('⚠️ Hech qaysi qism yuborilmagani uchun serial saqlanmadi.');
                }

                const savedCount = seriesDraft.episodesCount;
                const savedCode = seriesDraft.code;
                ctx.session.adminStep = null;
                ctx.session.newSeries = null;
                return ctx.editMessageText(`✅ Serial saqlandi. Jami qismlar: ${savedCount}`, {
                    reply_markup: getPromoCreatedKeyboard(savedCode, 'series')
                });
            }
        }

        if (action === 'delete_channel') {
            const channelId = params[0];
            const result = await deleteChannel(channelId);

            if (result?.deletedCount > 0) {
                invalidateChannelsCache();
                await ctx.editMessageText(`✅ Kanal (${channelId}) muvaffaqiyatli o‘chirildi!`).catch(console.error);
            } else {
                await ctx.editMessageText(`⚠️ Kanal (${channelId}) o‘chirishda xatolik yuz berdi yoki u topilmadi.`).catch(console.error);
            }
            return;
        }

        if (action === 'delete') {
            const [type, code] = params;
            const typeLabel = type === 'series' ? 'serial' : 'kino';
            await ctx.editMessageText(
                `⚠️ Siz ${typeLabel}ni butunlay o‘chirmoqchisiz.\n\n<b>Kod:</b> <code>${escapeHTML(code)}</code>\nBu amalni ortga qaytarib bo‘lmaydi.`,
                {
                    parse_mode: 'HTML',
                    reply_markup: buildDangerConfirmKeyboard(
                        `admin:delete_confirm:${type}:${code}`,
                        `admin:delete_cancel:${type}:${code}`
                    )
                }
            ).catch(console.error);
            return;
        }

        if (action === 'edit') {
            const [type, code, editType] = params;
            ctx.session.editItem = { type, code: Number(code) };

            if (editType === 'details') {
                ctx.session.adminStep = 'edit_details';
                return ctx.editMessageText('✏️ Ma’lumotlarni yuboring.\n\nFormat: <code>Nomi | Janri | Yili | Tavsifi</code>', {
                    parse_mode: 'HTML',
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (editType === 'media' && type === 'movie') {
                ctx.session.adminStep = 'edit_movie_media';
                return ctx.editMessageText('🎞 Yangi kino videosi, rasmi yoki faylini yuboring. Kanal postini ham uzatib yuborishingiz mumkin.', {
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (editType === 'add_ep' && type === 'series') {
                ctx.session.adminStep = 'edit_series_add_ep';
                return ctx.editMessageText('➕ Yangi qism videosi, rasmi yoki faylini yuboring. Kanal postini ham uzatib yuborishingiz mumkin.', {
                    reply_markup: getAdminCancelKeyboard()
                });
            } else if (editType === 'del_ep' && type === 'series') {
                ctx.session.adminStep = 'edit_series_del_ep';
                return ctx.editMessageText('🗑 O‘chirmoqchi bo‘lgan epizod raqamini yuboring. Masalan: <code>5</code>', {
                    parse_mode: 'HTML',
                    reply_markup: getAdminCancelKeyboard()
                });
            }
        }

        return;
    });

    bot.on('text', async (ctx, next) => {
        const uid = Number(ctx.from?.id);
        if (!isAdmin(uid)) { return next(); }

        if (!ctx.session) ctx.session = {};
        const text = ctx.message?.text?.trim?.();
        if (!text) return;

        if (text.startsWith('/')) return next();

        const step = ctx.session.adminStep;
        if (!step) {
            if (/^\d+$/.test(text)) {
                const codeNum = Number(text);
                const movie = await getMovieByCode(codeNum);
                const series = !movie ? await getSeriesByCode(codeNum) : null;

                if (movie || series) {
                    await handleNumericCodeLookup(ctx, text);
                    await sendEditDeleteMenu(ctx, codeNum, movie ? 'movie' : 'series');
                    return;
                }

                return ctx.reply('🤷 Bu kod bo‘yicha kino yoki serial topilmadi.\n\nKerak bo‘lsa /admin orqali yangi kontent qo‘shishingiz mumkin.');
            }

            return ctx.reply('👑 Admin rejimidasiz. Kino yoki serial kodini yuboring, yoki /admin orqali kerakli bo‘limni tanlang.');
        }

        if (step === 'premium_price') {
            ctx.session.premiumDraft = {
                ...(ctx.session.premiumDraft || {}),
                price: text
            };
            ctx.session.adminStep = 'premium_card_number';
            return ctx.reply('💳 Endi karta raqamini yuboring:', {
                reply_markup: getAdminCancelKeyboard()
            });
        }

        if (step === 'premium_card_number') {
            ctx.session.premiumDraft = {
                ...(ctx.session.premiumDraft || {}),
                card_number: text
            };
            ctx.session.adminStep = 'premium_card_owner';
            return ctx.reply('👤 Karta egasi ismini kiriting:', {
                reply_markup: getAdminCancelKeyboard()
            });
        }

        if (step === 'premium_card_owner') {
            ctx.session.premiumDraft = {
                ...(ctx.session.premiumDraft || {}),
                card_owner: text
            };
            ctx.session.adminStep = 'premium_admin_username';
            return ctx.reply('📨 Admin username yuboring. Masalan: kinobot_admin yoki @kinobot_admin', {
                reply_markup: getAdminCancelKeyboard()
            });
        }

        if (step === 'premium_admin_username') {
            const normalizedUsername = text.replace(/^@+/, '').trim();
            if (!normalizedUsername) {
                return ctx.reply('Admin username noto‘g‘ri. Qaytadan yuboring.');
            }

            ctx.session.premiumDraft = {
                ...(ctx.session.premiumDraft || {}),
                admin_username: normalizedUsername
            };

            const premiumDraft = ctx.session.premiumDraft;

            await setPremiumSettings({
                enabled: true,
                price: premiumDraft.price,
                card_number: premiumDraft.card_number,
                card_owner: premiumDraft.card_owner,
                admin_username: premiumDraft.admin_username
            });

            await resetAdminSession(ctx.session);

            return ctx.reply(
                `✅ Premium sozlamalari saqlandi!\n\n💰 Narx: ${premiumDraft.price}\n💳 Karta: ${premiumDraft.card_number}\n👤 Egasi: ${premiumDraft.card_owner}\n📨 Admin: @${premiumDraft.admin_username}`
            );
        }

        if (step === 'promo_channel_id') {
            const normalizedChannel = normalizeChannelTarget(text);
            if (!normalizedChannel) {
                return ctx.reply('Kanal noto‘g‘ri yozilgan. @username, t.me/link yoki raqamli ID yuboring.');
            }

            try {
                const chat = await ctx.telegram.getChat(normalizedChannel);

                if (chat?.type !== 'channel') {
                    return ctx.reply('Bu kanal emas. Kanalning @username yoki ID sini yuboring.');
                }

                const botInfo = ctx.botInfo || bot.botInfo || await ctx.telegram.getMe();
                let botMember = null;

                try {
                    botMember = await ctx.telegram.getChatMember(chat.id, botInfo.id);
                } catch (memberError) {
                    console.error('Promo kanalida bot holatini tekshirishda xato:', memberError.message);
                }

                if (botMember && !['administrator', 'creator'].includes(botMember.status)) {
                    return ctx.reply('Bot bu kanalda admin emas. Avval botga ruxsat bering.');
                }

                await setPromoChannelSettings({
                    promo_channel_id: String(chat.id),
                    promo_channel_title: chat.title || normalizedChannel,
                    promo_channel_username: chat.username || null,
                    promo_channel_link: chat.username ? `https://t.me/${chat.username}` : null,
                });

                await resetAdminSession(ctx.session);
                return ctx.reply(
                    `✅ Promo kanal saqlandi.\n\n📢 Kanal: ${chat.title || 'Noma’lum'}\n🆔 ${chat.id}${chat.username ? `\n🔗 https://t.me/${chat.username}` : ''}`
                );
            } catch (error) {
                console.error('Promo kanalni ulashda xato:', error);
                return ctx.reply('Kanalni tekshirib bo‘lmadi. Bot kanalga qo‘shilganini va ruxsat berilganini tekshirib, qayta yuboring.');
            }
        }

        if (step === 'promo_item_code') {
            if (!/^\d+$/.test(text)) {
                return ctx.reply('Promo uchun raqamli kino yoki serial kodini yuboring.');
            }

            const codeNum = Number(text);
            const movie = await getMovieByCode(codeNum);
            const series = !movie ? await getSeriesByCode(codeNum) : null;

            if (!movie && !series) {
                return ctx.reply('Bu kod bo‘yicha kino yoki serial topilmadi.');
            }

            return beginPromoFlow(ctx, movie ? 'movie' : 'series', codeNum);
        }

        if (step === 'promo_caption') {
            if (text.length > 1024) {
                return ctx.reply('Matn juda uzun. 1024 belgidan oshirmang.');
            }

            ctx.session.promoDraft = {
                ...(ctx.session.promoDraft || {}),
                caption: text,
            };
            ctx.session.adminStep = 'promo_buttons_mode';

            return promptPromoButtonsMode(ctx);
        }

        if (step === 'promo_trailer_url') {
            try {
                const promoChannel = await getPromoChannelSettings();
                const buttonPreset = ctx.session.promoDraft?.buttonPreset;
                const customButtons = buildQuickPromoButtons(buttonPreset, promoChannel, text);

                ctx.session.promoDraft = {
                    ...(ctx.session.promoDraft || {}),
                    customButtons,
                    buttonPreset: null,
                };
                ctx.session.adminStep = null;

                const botUsername = ctx.botInfo?.username || bot.botInfo?.username;
                return showPromoReview(ctx, botUsername);
            } catch (error) {
                return ctx.reply(`⚠️ Treyler tugmasini tayyorlashda muammo bo‘ldi: ${error.message}`);
            }
        }

        if (step === 'promo_buttons') {
            try {
                const customButtons = parsePromoButtons(text);
                ctx.session.promoDraft = {
                    ...(ctx.session.promoDraft || {}),
                    customButtons,
                    buttonPreset: null,
                };
                ctx.session.adminStep = null;

                const botUsername = ctx.botInfo?.username || bot.botInfo?.username;
                return showPromoReview(ctx, botUsername);
            } catch (error) {
                return ctx.reply(`⚠️ Tugmalarni o‘qishda muammo bo‘ldi: ${error.message}`);
            }
        }

        if (step === 'edit_item_code') {
            if (!/^\d+$/.test(text)) return ctx.reply('Iltimos faqat raqamli kod kiriting.');
            const codeNum = Number(text);

            const movie = await getMovieByCode(codeNum);
            const series = await getSeriesByCode(codeNum);

            if (movie) {
                await sendEditDeleteMenu(ctx, codeNum, 'movie');
            } else if (series) {
                await sendEditDeleteMenu(ctx, codeNum, 'series');
            } else {
                return ctx.reply('Bu kod bo‘yicha kino yoki serial topilmadi.');
            }
            ctx.session.adminStep = null;
            return;
        }

        const item = ctx.session.editItem;
        if (item) {
            if (step === 'edit_details') {
                const fields = parseDetailsText(text);
                if (!fields) return ctx.reply(`Iltimos, ma’lumotlarni quyidagi formatlardan biri bilan kiriting:

Nomi | Janri | Yili | Tavsifi

yoki

Nomi: ...
Janri: ...
Yili: ...
Tavsifi: ...`);

                if (item.type === 'movie') {
                    const existingMovie = await getMovieByCode(item.code);
                    if (!existingMovie) return ctx.reply('Kino topilmadi.');

                    await updateMovie(item.code, {
                        ...fields,
                        link: existingMovie.link,
                        media_type: existingMovie.media_type,
                        file_id: existingMovie.file_id,
                        file_unique_id: existingMovie.file_unique_id,
                        file_name: existingMovie.file_name,
                        mime_type: existingMovie.mime_type,
                        file_size: existingMovie.file_size,
                        duration: existingMovie.duration,
                    });
                } else if (item.type === 'series') {
                    await updateSeries(item.code, fields);
                }

                await resetAdminSession(ctx.session);
                return ctx.reply(`✅ ${item.type === 'movie' ? 'Kino' : 'Serial'} (Kod: ${item.code}) ma’lumotlari muvaffaqiyatli tahrirlandi.`);
            }

            if (step === 'edit_series_del_ep' && item.type === 'series') {
                const episodeNum = Number(text);
                if (!/^\d+$/.test(text) || episodeNum <= 0) return ctx.reply('Iltimos, musbat butun epizod raqamini kiriting.');
                ctx.session.adminStep = 'edit_series_del_ep_confirm';
                return ctx.reply(
                    `⚠️ Serial (Kod: ${item.code}) dan ${episodeNum}-epizodni o‘chirmoqchimisiz?\nBu amalni ortga qaytarib bo‘lmaydi.`,
                    {
                        reply_markup: buildDangerConfirmKeyboard(
                            `admin:delete_episode_confirm:${item.code}:${episodeNum}`,
                            `admin:delete_episode_cancel:${item.code}`
                        )
                    }
                );
            }
        }

        if (step === 'broadcast_confirm') {
            return ctx.reply('👆 Yuqoridagi preview ostidagi tugmalar orqali broadcastni tasdiqlang yoki bekor qiling.');
        }

        if (step === 'add_movie_media') {
            return ctx.reply('Bu yerga matn emas, video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
        }

        if (step === 'add_series_upload_episode') {
            return ctx.reply('Qism uchun video, rasm yoki fayl yuboring yoki “Yakunlash” tugmasini bosing.');
        }

        if (step === 'edit_movie_media') {
            return ctx.reply('Kino uchun yangi video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
        }

        if (step === 'edit_series_add_ep') {
            return ctx.reply('Yangi qism uchun video, rasm yoki fayl yuboring. Kanal postini ham uzatib yuborishingiz mumkin.');
        }

        if (step === 'promo_media') {
            return ctx.reply('Bu yerga matn emas, rasm yoki qisqa video yuboring. Tayyor kanal postini ham uzatib yuborishingiz mumkin.', {
                reply_markup: getAdminCancelKeyboard()
            });
        }

        if (step === 'promo_buttons_mode') {
            return ctx.reply('Tugmalar ko‘rinishini pastdagi tugmalardan tanlang.');
        }

        if (step.startsWith('add_movie') || step.startsWith('add_series') || step.startsWith('add_channel_')) {
            switch (step) {
                case 'add_movie_code':
                    if (!/^\d+$/.test(text)) return ctx.reply('Iltimos faqat raqam kiriting.');
                    if (await getMovieByCode(Number(text))) return ctx.reply('Bu kod oldin olingan. Boshqasini kiriting.');
                    if (await getSeriesByCode(Number(text))) return ctx.reply('Bu kod serial uchun ishlatilgan. Boshqa kod kiriting.');
                    ctx.session.newMovie = { code: Number(text) };
                    ctx.session.adminStep = 'add_movie_metadata';
                    return ctx.reply('📝 Kino ma’lumotlarini yuboring:\nNomi | Janri | Yili | Tavsifi\n\nYoki video, rasm yoki fayl yuborib, shu matnni xabar ichiga yozing.', {
                        reply_markup: getAdminCancelKeyboard()
                    });

                case 'add_movie_metadata': {
                    const movieFields = parseDetailsText(text);
                    if (!movieFields) return ctx.reply(`Formatlardan biri bilan yuboring:

Nomi | Janri | Yili | Tavsifi

yoki

Nomi: ...
Janri: ...
Yili: ...
Tavsifi: ...`);
                    ctx.session.newMovie = { ...ctx.session.newMovie, ...movieFields };
                    ctx.session.adminStep = 'add_movie_media';
                    return ctx.reply('🎞 Endi kino videosi, rasmi yoki faylini yuboring. Xohlasangiz kanal postini ham uzatib yuborishingiz mumkin. Bot uni o‘zida saqlab oladi.', {
                        reply_markup: getAdminCancelKeyboard()
                    });
                }

                case 'add_series_code':
                    if (!/^\d+$/.test(text)) return ctx.reply('Faqat raqam kiriting.');
                    if (await getSeriesByCode(Number(text))) return ctx.reply('Bu kod oldin band qilingan.');
                    if (await getMovieByCode(Number(text))) return ctx.reply('Bu kod kino uchun ishlatilgan. Boshqa kod kiriting.');
                    ctx.session.newSeries = { code: Number(text), episodesCount: 0 };
                    ctx.session.adminStep = 'add_series_metadata';
                    return ctx.reply('📝 Serial ma’lumotlarini yuboring:\nNomi | Janri | Yili | Tavsifi\n\nYoki birinchi qismni yuborib, shu matnni xabar ichiga yozing.', {
                        reply_markup: getAdminCancelKeyboard()
                    });

                case 'add_series_metadata': {
                    const seriesFields = parseDetailsText(text);
                    if (!seriesFields) return ctx.reply(`Formatlardan biri bilan yuboring:

Nomi | Janri | Yili | Tavsifi

yoki

Nomi: ...
Janri: ...
Yili: ...
Tavsifi: ...`);

                    ctx.session.newSeries = { ...ctx.session.newSeries, ...seriesFields, episodesCount: 0 };
                    await addSeries({
                        code: ctx.session.newSeries.code,
                        title: ctx.session.newSeries.title,
                        desc: ctx.session.newSeries.desc,
                        genre: ctx.session.newSeries.genre,
                        year: ctx.session.newSeries.year
                    });
                    ctx.session.adminStep = 'add_series_upload_episode';
                    return ctx.reply(
                        'Endi serial qismlarini bittalab yuboring yoki kanal postlarini uzatib yuboring. Bot ularni o‘zida saqlab boradi. Tugaganda “Yakunlash” tugmasini bosing.',
                        { reply_markup: getSeriesUploadKeyboard() }
                    );
                }

                case 'add_channel_id': {
                    const channelId = text.startsWith('@') ? text : Number(text);
                    if (!channelId || (typeof channelId === 'string' && channelId.length < 2)) {
                        return ctx.reply('Kanal noto‘g‘ri yozilgan.');
                    }
                    ctx.session.newChannel = { channel_id: channelId };
                    ctx.session.adminStep = 'add_channel_name';
                    return ctx.reply('📛 Kanal nomini kiriting. Masalan: Rasmiy Kino Kanal', {
                        reply_markup: getAdminCancelKeyboard()
                    });
                }

                case 'add_channel_name':
                    ctx.session.newChannel.name = text;
                    ctx.session.adminStep = 'add_channel_link';
                    return ctx.reply('🔗 Kanalga o‘tish linkini kiriting. Masalan: https://t.me/Kanalim', {
                        reply_markup: getAdminCancelKeyboard()
                    });

                case 'add_channel_link':
                    ctx.session.newChannel.link = text;
                    await addChannel(ctx.session.newChannel);
                    invalidateChannelsCache();

                    await resetAdminSession(ctx.session);
                    return ctx.reply('✅ Kanal saqlandi!');
            }
        }

        return;
    });
}
