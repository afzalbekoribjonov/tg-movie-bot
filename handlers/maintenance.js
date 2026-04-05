import { isAdmin, isDatabaseReady } from '../database.js';

export const MAINTENANCE_MESSAGE_HTML = `🛠 <b>Botda vaqtincha uzilish bor.</b>

Iltimos, birozdan keyin yana urinib ko‘ring.`;

function buildInlineMaintenanceResult() {
    return [{
        type: 'article',
        id: 'maintenance',
        title: 'Bot vaqtincha ishlamayapti',
        description: 'Hozircha qidiruv va ko‘rish vaqtincha to‘xtagan.',
        input_message_content: {
            message_text: '🛠 Botda vaqtincha uzilish bor. Iltimos, birozdan keyin yana urinib ko‘ring.',
            disable_web_page_preview: true,
        },
    }];
}

export async function sendMaintenanceNotice(ctx) {
    if (ctx.updateType === 'inline_query') {
        return ctx.answerInlineQuery(buildInlineMaintenanceResult(), {
            cache_time: 0,
            is_personal: true,
        }).catch(() => {});
    }

    if (ctx.updateType === 'callback_query') {
        await ctx.answerCbQuery('🛠 Hozircha kutib turing.', {
            show_alert: false,
        }).catch(() => {});

        if (ctx.chat?.id && ctx.callbackQuery?.message) {
            return ctx.reply(MAINTENANCE_MESSAGE_HTML, { parse_mode: 'HTML' }).catch(() => {});
        }
        return;
    }

    if (ctx.chat?.id) {
        return ctx.reply(MAINTENANCE_MESSAGE_HTML, { parse_mode: 'HTML' }).catch(() => {});
    }
}

export function shouldServeMaintenance(ctx) {
    if (isDatabaseReady()) {
        return false;
    }

    if (ctx.from?.id && isAdmin(ctx.from.id)) {
        return false;
    }

    const data = ctx.callbackQuery?.data;
    if (data === 'ignore') {
        return false;
    }

    return true;
}
