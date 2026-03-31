import { getPremiumSettings } from '../database.js';

function escapePremiumText(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildPremiumCallbackData(movieCode) {
    if (movieCode === null || movieCode === undefined) {
        return 'buy_premium';
    }

    return `buy_premium:${String(movieCode)}`;
}

export async function sendPremiumMessage(ctx, movieCode = null) {
    const premiumSettings = await getPremiumSettings();

    if (!premiumSettings.enabled) {
        return false;
    }

    const priceText = escapePremiumText(premiumSettings.price || 'Narx admin tomonidan belgilanadi');

    const message = `
🔒 <b>Yopiq subtitrli kino kanaliga qo‘shiling</b>

🎬 Saralangan kinolarni o‘zbekcha va boshqa tillardagi subtitrlar bilan tomosha qiling.
🧠 Subtitr bilan ko‘rish orqali yangi so‘zlarni o‘rganing, tinglab tushunishni kuchaytiring va tilni kino orqali rivojlantiring.
🌍 Inglizcha va boshqa tillardagi subtitrli filmlar til o‘rganish uchun juda qulay formatda taqdim etiladi.
🔥 Bu oddiy kanal emas, foydali va muntazam boyib boradigan yopiq kino kutubxonasi.

💳 <b>Kanalga qo‘shilish narxi:</b> ${priceText}

👇 Hoziroq ulanish uchun tugmani bosing:
`;

    await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔐 Kanalga qo‘shilish', callback_data: buildPremiumCallbackData(movieCode) }]
            ]
        }
    });

    return true;
}
