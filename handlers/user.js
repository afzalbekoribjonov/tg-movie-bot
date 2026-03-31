import { getMovieByCode, getSeriesByCode, getSeriesEpisodes, getAllMovies, isAdmin, getPremiumSettings } from '../database.js';
import { serialHandler } from './serial.js';
import { sendMedia, escapeHTML } from '../utils.js';
import { createSerialButtons } from './serial_buttons.js';


export function userHandler(bot) {
    serialHandler(bot);

    bot.on('text', async (ctx) => {
        const userId = Number(ctx.from?.id);
        const text = ctx.message?.text?.trim?.();

        if (!text || isAdmin(userId) || text.startsWith('/')) {
            return;
        }

        if (!/^\d+$/.test(text)) {
            return ctx.reply(escapeHTML('Iltimos, raqamli kod yuboring!'), { parse_mode: 'HTML' });
        }

        try {
            const code = Number(text);

            const movie = await getMovieByCode(code);
            if (movie) {
                await sendMedia(ctx, movie);
                return;
            }

            const series = await getSeriesByCode(code);
            if (series) {
                const episodes = await getSeriesEpisodes(code);

                const title = escapeHTML(series.title);
                const year = escapeHTML(String(series.year));
                const genre = escapeHTML(series.genre || 'Yoʻq');
                const desc = escapeHTML(series.desc || 'Tavsif yoʻq');

                if (!episodes || episodes.length === 0) {
                    return ctx.reply(`📺 <b>${title}</b> uchun hali epizod mavjud emas.`, { parse_mode: 'HTML' });
                }

                const buttons = createSerialButtons(code, episodes, 0);

                const message = `
📺 <b>${title}</b> (${year})

<b>🎦 Janr:</b> ${genre}
<b>📄 Tavsif:</b> <i>${desc}</i>

<b>Seriyalar soni:</b> ${episodes.length}

<b>Iltimos, qismni tanlang:</b>
`;

                return ctx.reply(message, {
                    reply_markup: { inline_keyboard: buttons },
                    parse_mode: 'HTML'
                });
            }

            return ctx.reply(escapeHTML('Afsuski bunday kod mavjud emas!'), { parse_mode: 'HTML' });
        } catch (error) {
            console.error(`Foydalanuvchi kodi ${text} ni qayta ishlashda xato:`, error);
            return ctx.reply(
                escapeHTML('Kechirasiz, hozircha so‘rovni bajarishda muammo yuz berdi. Iltimos, birozdan keyin qayta urinib ko‘ring.'),
                { parse_mode: 'HTML' }
            );
        }
    });

    bot.on('callback_query', async (ctx, next) => {
        const data = ctx.callbackQuery?.data;

        if (data === 'check_subscription') {
            await ctx.answerCbQuery('Obuna tekshirilmoqda...');
            await ctx.deleteMessage().catch(() => {});

            return ctx.reply(escapeHTML('✅ Obuna holati yangilandi. Iltimos, kod kiritishni davom ettiring.'), { parse_mode: 'HTML' });
        }

        if (data?.startsWith('buy_premium')) {
            await ctx.answerCbQuery().catch(() => {});

            const premiumSettings = await getPremiumSettings();

            if (!premiumSettings.enabled) {
                return ctx.editMessageText('💎 Premium rejim hozircha faol emas.');
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

📌 To‘lov qilganingizdan keyin quyidagi tugmani bosing:
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
                return ctx.editMessageText('💎 Premium rejim hozircha faol emas.');
            }

            const adminUsername = escapeHTML((premiumSettings.admin_username || 'admin').replace(/^@+/, ''));

            const message = `
✅ <b>Rahmat!</b>

🧾 To‘lov chekini adminga yuboring:
@${adminUsername}

⏳ To‘lov tasdiqlangach, siz yopiq kanal bo‘yicha yo‘riqnoma olasiz.
`;

            return ctx.editMessageText(message, {
                parse_mode: 'HTML'
            });
        }

        return next();
    });
}
