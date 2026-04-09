import { Telegraf } from 'telegraf';
import {
    initDB,
    addUser,
    getRandomMovie,
    checkUserExists,
    isAdmin,
    getPremiumSettings,
    getPromoChannelSettings,
    getDatabaseStatus,
    isDatabaseReady,
    isDatabaseUnavailableError,
    recordDatabaseOperationError,
} from './database.js';
import { userHandler } from './handlers/user.js';
import { adminHandler } from './handlers/admin.js';
import { getCachedChannels } from './channel_cache.js';
import { sendPremiumMessage } from './handlers/premium.js';
import { handleNumericCodeLookup } from './handlers/code_lookup.js';
import config from './config.js';
import { sendMedia, escapeHTML } from './utils.js';
import { persistentSession } from './persistent_session.js';
import { inlineHandler } from './handlers/inline.js';
import { sendMaintenanceNotice, shouldServeMaintenance } from './handlers/maintenance.js';
import http from 'http';

const bot = new Telegraf(config.BOT_TOKEN);

const PROTECTED_CONTENT_METHODS = new Set([
    'sendMessage',
    'sendPhoto',
    'sendVideo',
    'sendAnimation',
    'sendAudio',
    'sendDocument',
    'sendSticker',
    'sendVideoNote',
    'sendVoice',
    'sendLocation',
    'sendVenue',
    'sendContact',
    'sendPoll',
    'sendDice',
    'sendInvoice',
    'sendGame',
    'sendMediaGroup',
    'copyMessage',
    'forwardMessage',
]);

const originalCallApi = bot.telegram.callApi.bind(bot.telegram);
bot.telegram.callApi = async (method, payload, signal) => {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    const finalPayload = PROTECTED_CONTENT_METHODS.has(method)
        ? { ...safePayload, protect_content: true }
        : safePayload;

    return originalCallApi(method, finalPayload, signal);
};

bot.use(persistentSession());

bot.use((ctx, next) => {
    if (!ctx.session || typeof ctx.session !== 'object') {
        ctx.session = {};
    }
    return next();
});

bot.use(async (ctx, next) => {
    try {
        await next();
    } catch (error) {
        recordDatabaseOperationError(error);
        console.error('Middleware xatosi:', error);

        if (isDatabaseUnavailableError(error) || !isDatabaseReady()) {
            return sendMaintenanceNotice(ctx);
        }

        if (ctx.updateType === 'inline_query') {
            return ctx.answerInlineQuery([], {
                cache_time: 0,
                is_personal: true,
            }).catch(() => {});
        }

        if (ctx.updateType === 'callback_query') {
            await ctx.answerCbQuery('⚠️ Xatolik yuz berdi. Qayta urinib ko‘ring.').catch(() => {});
            if (ctx.chat?.id && ctx.callbackQuery?.message) {
                return ctx.reply(escapeHTML('Kechirasiz, so‘rovni bajarishda xatolik yuz berdi. Iltimos, qayta urinib ko‘ring.'), {
                    parse_mode: 'HTML'
                }).catch(() => {});
            }
            return;
        }

        if (ctx.chat?.id) {
            return ctx.reply(escapeHTML('Kechirasiz, so‘rovni bajarishda xatolik yuz berdi. Iltimos, qayta urinib ko‘ring.'), {
                parse_mode: 'HTML'
            }).catch(() => {});
        }
    }
});

bot.action('ignore', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
});

bot.use(async (ctx, next) => {
    if (shouldServeMaintenance(ctx)) {
        return sendMaintenanceNotice(ctx);
    }

    return next();
});

bot.use(async (ctx, next) => {
    if (ctx.updateType === 'callback_query') return next();
    if (!ctx.from || isAdmin(ctx.from.id)) {
        return next();
    }

    if (ctx.message) {
        const channels = await getCachedChannels();

        if (channels.length > 0) {
            const userId = ctx.from.id;
            const membershipChecks = await Promise.all(
                channels.map(async (channel) => {
                    if (!channel.channel_id) {
                        return null;
                    }

                    try {
                        const member = await ctx.telegram.getChatMember(channel.channel_id, userId);
                        const isJoined = !['left', 'kicked'].includes(member.status);

                        return isJoined ? null : channel;
                    } catch (err) {
                        console.error(`Obuna tekshiruvida xato ${channel.channel_id}:`, err.message);
                        return channel;
                    }
                })
            );

            const notJoined = membershipChecks.filter(Boolean);

            if (notJoined.length > 0) {
                const text = 'Davom etish uchun quyidagi kanallarga obuna bo‘ling:';
                const buttons = notJoined.map(c => [{ text: c.name, url: c.link }]);

                return ctx.reply(text, { reply_markup: { inline_keyboard: buttons } });
            }
        }
    }

    return next();
});


function formatReadyStateLabel(readyState) {
    const map = {
        0: 'Ulanmagan',
        1: 'Ulangan',
        2: 'Ulanmoqda',
        3: 'Uzilmoqda',
    };

    return map[Number(readyState)] || 'Noma’lum';
}

async function buildAdminStatusMessage() {
    const dbStatus = getDatabaseStatus();
    const promoSettings = await getPromoChannelSettings().catch(() => null);
    const botUsername = bot.botInfo?.username ? `@${bot.botInfo.username}` : 'Noma’lum';

    return `🩺 <b>Bot holati</b>

<b>Bot:</b> ${escapeHTML(botUsername)}
<b>Baza:</b> ${isDatabaseReady() ? '✅ Ishlayapti' : '⚠️ Vaqtincha ulanmagan'}
<b>Ulanish:</b> ${escapeHTML(formatReadyStateLabel(dbStatus.readyState))}
<b>Oxirgi muammo:</b> ${escapeHTML(dbStatus.lastError || 'Yo‘q')}
<b>Reklama kanali:</b> ${promoSettings?.promo_channel_title ? escapeHTML(promoSettings.promo_channel_title) : 'Ulanmagan'}

<b>Eslatma:</b> Agar baza ulanmagan bo‘lsa, foydalanuvchilarga kutish xabari ko‘rsatiladi.`;
}

bot.command('random', async (ctx) => {
    const movie = await getRandomMovie();

    if (!movie) {
        return ctx.reply(escapeHTML('Hozircha kino mavjud emas.'), { parse_mode: 'HTML' });
    }

    await sendMedia(ctx, movie);
});

bot.command('premium', async (ctx) => {
    const premiumSettings = await getPremiumSettings();

    if (!premiumSettings.enabled) {
        return ctx.reply(escapeHTML('Hozircha yopiq bo‘lim ochilmagan.'), { parse_mode: 'HTML' });
    }

    await sendPremiumMessage(ctx);
});


bot.command('status', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) {
        return;
    }

    return ctx.reply(await buildAdminStatusMessage(), { parse_mode: 'HTML' });
});

bot.command('health', async (ctx) => {
    if (!ctx.from || !isAdmin(ctx.from.id)) {
        return;
    }

    return ctx.reply(await buildAdminStatusMessage(), { parse_mode: 'HTML' });
});

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || null;
    const firstName = ctx.from.first_name || 'Foydalanuvchi';
    const rawText = ctx.message?.text || '';
    const startPayload = rawText.replace(/^\/start(@\w+)?\s*/i, '').trim();

    const userAlreadyExists = await checkUserExists(userId);

    await addUser(userId, username, firstName);

    if (/^\d+$/.test(startPayload)) {
        return handleNumericCodeLookup(ctx, startPayload);
    }

    let welcomeMessage;

    if (!userAlreadyExists) {
        welcomeMessage = `
Assalomu alaykum, <b>${escapeHTML(firstName)}</b>!
Xush kelibsiz. Kino kodini yuboring!
`;
    } else {
        welcomeMessage = `
<b>${escapeHTML(firstName)}</b>, kino kodini yuboring!
`;
    }

    return ctx.reply(welcomeMessage, { parse_mode: 'HTML' });
});

adminHandler(bot);
userHandler(bot);
inlineHandler(bot);

const BOT_RETRY_DELAY_MS = 15000;
let botLaunchInProgress = false;
let botLaunchRetryTimer = null;

function scheduleBotLaunchRetry() {
    if (botLaunchRetryTimer) return;

    botLaunchRetryTimer = setTimeout(() => {
        botLaunchRetryTimer = null;
        startTelegramBot().catch((error) => {
            console.error('Botni qayta ulashda xato:', error);
            scheduleBotLaunchRetry();
        });
    }, BOT_RETRY_DELAY_MS);
}

async function startTelegramBot() {
    if (botLaunchInProgress) {
        return false;
    }

    botLaunchInProgress = true;
    try {
        const me = await bot.telegram.getMe();
        bot.botInfo = me;
        console.log(`Bot foydalanuvchisi: @${me.username}`);

        if (!me.supports_inline_queries) {
            console.warn('⚠️ Chat ichida qidirish hali yoqilmagan. @BotFather orqali /setinline ni yoqing.');
        }

        await bot.launch({
            polling: {
                timeout: 30,
                limit: 100,
            }
        });
        console.log('Bot Telegram bilan bog‘landi va ishlamoqda.');
        return true;
    } catch (error) {
        console.error('Telegram bilan ulanishda muammo bo‘ldi:', error);
        scheduleBotLaunchRetry();
        return false;
    } finally {
        botLaunchInProgress = false;
    }
}

bot.catch(async (error, ctx) => {
    recordDatabaseOperationError(error);
    console.error('Bot.catch xatosi:', error);

    if (isDatabaseUnavailableError(error) || !isDatabaseReady()) {
        await sendMaintenanceNotice(ctx);
        return;
    }

    if (ctx?.updateType === 'inline_query') {
        await ctx.answerInlineQuery([], {
            cache_time: 0,
            is_personal: true,
        }).catch(() => {});
        return;
    }

    if (ctx?.updateType === 'callback_query') {
        await ctx.answerCbQuery('⚠️ Xatolik yuz berdi.').catch(() => {});
        if (ctx.chat?.id && ctx.callbackQuery?.message) {
            await ctx.reply(escapeHTML('Kechirasiz, so‘rovni bajarishda xatolik yuz berdi. Iltimos, qayta urinib ko‘ring.'), {
                parse_mode: 'HTML'
            }).catch(() => {});
        }
        return;
    }

    if (ctx?.chat?.id) {
        await ctx.reply(escapeHTML('Kechirasiz, so‘rovni bajarishda xatolik yuz berdi. Iltimos, qayta urinib ko‘ring.'), {
            parse_mode: 'HTML'
        }).catch(() => {});
    }
});

async function startBot() {
    const PORT = process.env.PORT || 3000;

    const server = http.createServer((req, res) => {
        const method = req.method || 'GET';
        const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const isHealthRoute = requestUrl.pathname === '/' || requestUrl.pathname === '/health' || requestUrl.pathname === '/healthz';

        res.setHeader('Cache-Control', 'no-store');

        if (isHealthRoute && (method === 'GET' || method === 'HEAD')) {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });

            if (method === 'HEAD') {
                res.end();
                return;
            }

            res.end('OK');
            return;
        }

        if (isHealthRoute) {
            res.writeHead(405, {
                'Content-Type': 'application/json; charset=utf-8',
                'Allow': 'GET, HEAD'
            });
            res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
    });

    server.listen(PORT, () => {
        console.log(`🤖 Render Web Service uchun port ${PORT} ni tinglayapti!`);
    });

    await startTelegramBot();

    const dbConnected = await initDB();
    const dbStatus = getDatabaseStatus();

    if (dbConnected) {
        console.log('MongoDB ulanishi muvaffaqiyatli yakunlandi.');
    } else {
        console.warn(`⚠️ Baza ulanmagan. Bot foydalanuvchilarga kutish haqida xabar ko‘rsatadi. readyState=${dbStatus.readyState}; lastError=${dbStatus.lastError || 'noma’lum'}`);
    }
}

startBot().catch((error) => {
    console.error('Botni ishga tushirishda muammo bo‘ldi:', error);
    scheduleBotLaunchRetry();
});

process.on('unhandledRejection', (error) => {
    console.error('Kutilmagan promise xatosi:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Kutilmagan xato:', error);
});

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    console.log('Bot SIGINT orqali to‘xtatildi.');
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    console.log('Bot SIGTERM orqali to‘xtatildi.');
});
