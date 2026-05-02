import { isAdmin, getPremiumSettings } from '../database.js';
import { serialHandler } from './serial.js';
import { escapeHTML } from '../utils.js';
import { handleNumericCodeLookup } from './code_lookup.js';

function getInlineSearchKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🔎 Kino qidirish', switch_inline_query_current_chat: '' }]
        ]
    };
}

export function userHandler(bot) {
    serialHandler(bot);

    bot.on('text', async (ctx) => {
        const userId = Number(ctx.from?.id);
        const text = ctx.message?.text?.trim?.();

        if (!text || isAdmin(userId) || text.startsWith('/')) {
            return;
        }

        if (!/^\d+$/.test(text)) {
            return ctx.reply(
                escapeHTML('🤖 Kino yoki serialni topish uchun raqamli kod yuboring. Nom bo‘yicha qidirmoqchi bo‘lsangiz, pastdagi tugmadan foydalaning.'),
                {
                    parse_mode: 'HTML',
                    reply_markup: getInlineSearchKeyboard()
                }
            );
        }

        return handleNumericCodeLookup(ctx, text);
    });

    bot.on('callback_query', async (ctx, next) => {
        const data = ctx.callbackQuery?.data;

        if (data === 'check_subscription') {
            await ctx.answerCbQuery('Obuna tekshirilmoqda...');
            await ctx.deleteMessage().catch(() => {});

            return ctx.reply(escapeHTML('✅ Obuna holati yangilandi. Endi kino kodini yuborishingiz yoki inline qidiruvdan foydalanishingiz mumkin.'), {
                parse_mode: 'HTML',
                reply_markup: getInlineSearchKeyboard()
            });
        }

        if (data?.startsWith('buy_premium')) {
            await ctx.answerCbQuery().catch(() => {});

            const premiumSettings = await getPremiumSettings();

            if (!premiumSettings.enabled) {
                return ctx.editMessageText('💎 Yopiq bo‘lim hozircha ochilmagan.');
            }

            const priceText = escapeHTML(premiumSettings.price || 'Narx admin tomonidan belgilanadi');
            const cardNumber = escapeHTML(premiumSettings.card_number || 'Kiritilmagan');
            const cardOwner = escapeHTML(premiumSettings.card_owner || 'Kiritilmagan');

            const message = `
🔐 <b>Yopiq kino kanaliga qo‘shilish</b>

💰 <b>Kanal narxi:</b>
${priceText}

💳 <b>Karta raqami:</b>
<code>${cardNumber}</code>

👤 <b>Karta egasi:</b>
${cardOwner}

📌 To‘lov qilganingizdan keyin quyidagi tugmani bosing. Chekni saqlab qo‘ying:
`;

            return ctx.editMessageText(message, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'To‘lov qildim ✅', callback_data: 'paid_premium' }]
                    ]
                }
            });
        }

        if (data === 'paid_premium') {
            await ctx.answerCbQuery().catch(() => {});

            const premiumSettings = await getPremiumSettings();

            if (!premiumSettings.enabled) {
                return ctx.editMessageText('💎 Yopiq bo‘lim hozircha ochilmagan.');
            }

            const adminUsername = escapeHTML((premiumSettings.admin_username || 'admin').replace(/^@+/, ''));

            const message = `
✅ <b>Rahmat!</b>

🧾 To‘lov chekini adminga yuboring:
@${adminUsername}

⏳ To‘lov tasdiqlangach, siz yopiq kanal bo‘yicha yo‘riqnoma olasiz. Sabr uchun rahmat.
`;

            return ctx.editMessageText(message, {
                parse_mode: 'HTML'
            });
        }

        return next();
    });
}
