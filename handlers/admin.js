import {
    addMovie, getMovieByCode, addSeries, addSeriesEpisode, getSeriesByCode,
    getChannels, addChannel, deleteChannel, isAdmin, deleteMovie, deleteSeries,
    updateMovie, updateSeries, getSeriesEpisodes, deleteSeriesEpisode,
    getAllUserIds
} from '../database.js';
import { adminCommandsHandler } from './admin_commands.js';
import { sendEditDeleteMenu } from './admin_panel_utils.js';
import { getStatsMenuData, createListMenuData } from './admin_stats.js';

async function sendBroadcastAdvanced(bot, message) {
    const userIds = await getAllUserIds();
    let successCount = 0;
    let failCount = 0;

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

    for (const userId of userIds) {
        try {
            if (isPhoto) {
                const fileId = message.photo[message.photo.length - 1].file_id;
                await bot.telegram.sendPhoto(userId, fileId, { caption: caption, ...extra });
            } else if (isVideo) {
                await bot.telegram.sendVideo(userId, message.video.file_id, { caption: caption, ...extra });
            } else if (isDocument) {
                await bot.telegram.sendDocument(userId, message.document.file_id, { caption: caption, ...extra });
            } else if (isText) {
                await bot.telegram.sendMessage(userId, caption, extra);
            } else if (!isMedia && !isText) {
                continue;
            }
            successCount++;
        } catch (error) {
            if (error.message.includes('bot was blocked by the user') || error.message.includes('CHAT_ID_INVALID') || error.message.includes('user is deactivated')) {
                failCount++;
            } else {
                failCount++;
                console.error(`Broadcast xato (ID: ${userId}):`, error.message);
            }
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    return { total: userIds.length, sent: successCount, failed: failCount };
}

export function adminHandler(bot) {

    adminCommandsHandler(bot);

    bot.command('admin', (ctx) => {
        const uid = Number(ctx.from?.id);
        if (!isAdmin(uid)) return ctx.reply('Siz admin emassiz.');
        return ctx.reply(
            'Admin panelga xush kelibsiz 👑',
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Kino qo‘shish', callback_data: 'admin:add_movie' }, { text: '➕ Serial qo‘shish', callback_data: 'admin:add_series' }],
                        [{ text: '✏️ Kino/Serialni tahrirlash', callback_data: 'admin:edit_item' }],
                        [{ text: '📊 Statistika va ro‘yxat', callback_data: 'admin:show_stats' }],
                        [{ text: '📢 Kanal boshqaruvi', callback_data: 'admin:channels' }],
                        [{ text: '📨 Xabar yuborish (Broadcast)', callback_data: 'admin:broadcast' }]
                    ]
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

            ctx.session.adminStep = null;

            const waitMessage = await ctx.reply('⏳ Xabar tahlil qilinyapti va yuborish boshlandi...');

            const results = await sendBroadcastAdvanced(bot, ctx.message);

            await ctx.telegram.deleteMessage(waitMessage.chat.id, waitMessage.message_id).catch(() => {});

            return ctx.reply(`
✅ Xabar yuborish yakunlandi:
👥 Jami foydalanuvchi: ${results.total}
🟢 Yuborildi: ${results.sent}
🔴 Xatolik (bloklaganlar): ${results.failed}
            `);
        }

        if (ctx.message.text) {
            return next();
        }
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

            if (adminAction === 'add_movie') {
                ctx.session.adminStep = 'add_movie_code';
                return ctx.editMessageText('Kino kodini kiriting (Masalan: 1001):');
            } else if (adminAction === 'add_series') {
                ctx.session.adminStep = 'add_series_code';
                return ctx.editMessageText('Serial kodini kiriting (Masalan: 2001):');
            } else if (adminAction === 'edit_item') {
                ctx.session.adminStep = 'edit_item_code';
                return ctx.editMessageText('Tahrirlamoqchi bo‘lgan kino yoki serial kodini kiriting:');
            } else if (adminAction === 'show_stats') {
                const { message, buttons } = await getStatsMenuData();
                return ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
            } else if (adminAction === 'list') {
                const [type, page] = [params[1], Number(params[2])];
                const data = await createListMenuData(type, page);
                if (!data) return ctx.editMessageText('Noto‘g‘ri tur.');
                return ctx.editMessageText(data.message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: data.buttons } });
            } else if (adminAction === 'listpage') {
                const [type, page] = [params[1], Number(params[2])];
                const data = await createListMenuData(type, page);
                if (!data) return ctx.editMessageText('Noto‘g‘ri tur.');
                return ctx.editMessageText(data.message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: data.buttons } });
            } else if (adminAction === 'broadcast') {
                ctx.session.adminStep = 'broadcast_message';
                return ctx.editMessageText('Foydalanuvchilarga yubormoqchi bo‘lgan xabaringizni yuboring (text/photo/video/doc):');
            } else if (adminAction === 'channels') {
                const channels = await getChannels();
                let msg = '📢 Majburiy kanallar ro‘yxati:\n\n';
                if (channels.length === 0) msg += 'Hozircha kanal yo‘q.';
                else channels.forEach(c => { msg += `🔹 ${c.name} — ${c.channel_id} (${c.link})\n`; });
                msg += '\n➕ Qo‘shish: /addchannel\n➖ O‘chirish: /delchannel';
                return ctx.editMessageText(msg);
            }
        }

        if (action === 'delete_channel') {
            const channelId = params[0];
            const result = await deleteChannel(channelId);

            if (result?.deletedCount > 0) {
                await ctx.editMessageText(`✅ Kanal (${channelId}) muvaffaqiyatli o‘chirildi!`).catch(console.error);
            } else {
                await ctx.editMessageText(`⚠️ Kanal (${channelId}) o‘chirishda xatolik yuz berdi yoki u topilmadi.`).catch(console.error);
            }
            return;
        }

        if (action === 'delete') {
            const [type, code] = params;
            const codeNum = Number(code);
            let result;

            if (type === 'movie') {
                // deleteMovie() chaqiruvi oldiga AWAIТ qo'shildi
                result = await deleteMovie(codeNum);
            } else if (type === 'series') {
                // deleteSeries() chaqiruvi oldiga AWAIТ qo'shildi
                result = await deleteSeries(codeNum);
            }

            if (result?.deletedCount > 0) {
                await ctx.editMessageText(`✅ ${type === 'movie' ? 'Kino' : 'Serial'} (Kod: ${code}) bazadan butunlay o‘chirildi!`).catch(console.error);
            } else {
                await ctx.editMessageText(`⚠️ ${type === 'movie' ? 'Kino' : 'Serial'} (Kod: ${code}) o‘chirishda xatolik yuz berdi yoki u topilmadi.`).catch(console.error);
            }
            return;
        }

        if (action === 'edit') {
            const [type, code, editType] = params;
            ctx.session.editItem = { type, code: Number(code) };

            if (editType === 'details') {
                ctx.session.adminStep = 'edit_details';
                return ctx.editMessageText('Iltimos, Nomi | Janri | Yili | Tavsifi formatida ma’lumotlarni kiriting:');
            } else if (editType === 'link' && type === 'movie') {
                ctx.session.adminStep = 'edit_movie_link';
                return ctx.editMessageText('Yangi kino linkini yuboring:');
            } else if (editType === 'add_ep' && type === 'series') {
                ctx.session.adminStep = 'edit_series_add_ep';
                return ctx.editMessageText('Yangi epizod linkini yuboring:');
            } else if (editType === 'del_ep' && type === 'series') {
                ctx.session.adminStep = 'edit_series_del_ep';
                return ctx.editMessageText('O‘chirmoqchi bo‘lgan epizod raqamini kiriting (Masalan: 5):');
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
        if (!step) { return next(); }

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
                return ctx.reply('Bu kodga tegishli Kino yoki Serial bazada topilmadi.');
            }
            ctx.session.adminStep = null;
            return;
        }

        const item = ctx.session.editItem;
        if (item) {

            if (step === 'edit_details') {
                const parts = text.split('|').map(p => p.trim());
                if (parts.length < 4) return ctx.reply('Iltimos, ma’lumotlarni Nomi | Janri | Yili | Tavsifi formatida kiriting.');

                const [title, genre, year, desc] = parts;

                const fields = { title, genre, year: Number(year), desc };

                if (item.type === 'movie') {
                    const existingMovie = await getMovieByCode(item.code);
                    if (!existingMovie) return ctx.reply('Kino topilmadi.');

                    await updateMovie(item.code, { ...fields, link: existingMovie.link });
                } else if (item.type === 'series') {

                    await updateSeries(item.code, fields);
                }

                ctx.session.adminStep = null;
                ctx.session.editItem = null;
                return ctx.reply(`✅ ${item.type === 'movie' ? 'Kino' : 'Serial'} (Kod: ${item.code}) ma’lumotlari muvaffaqiyatli tahrirlandi.`);
            }


            if (step === 'edit_movie_link' && item.type === 'movie') {

                const existingMovie = await getMovieByCode(item.code);
                if (!existingMovie) return ctx.reply('Kino topilmadi.');

                await updateMovie(item.code, {
                    title: existingMovie.title,
                    desc: existingMovie.desc,
                    genre: existingMovie.genre,
                    year: existingMovie.year,
                    link: text
                });

                ctx.session.adminStep = null;
                ctx.session.editItem = null;
                return ctx.reply(`✅ Kino (Kod: ${item.code}) linki muvaffaqiyatli tahrirlandi.`);
            }

            if (step === 'edit_series_add_ep' && item.type === 'series') {
                const episodes = await getSeriesEpisodes(item.code);
                const nextEpNum = episodes ? episodes.length + 1 : 1;

                await addSeriesEpisode(item.code, nextEpNum, text);

                ctx.session.adminStep = null;
                ctx.session.editItem = null;
                return ctx.reply(`✅ Serial (Kod: ${item.code}) ga ${nextEpNum}-epizod muvaffaqiyatli qo‘shildi.`);
            }

            if (step === 'edit_series_del_ep' && item.type === 'series') {
                const episodeNum = Number(text);
                if (!/^\d+$/.test(text) || episodeNum <= 0) return ctx.reply('Iltimos, musbat butun epizod raqamini kiriting.');

                const result = await deleteSeriesEpisode(item.code, episodeNum);

                ctx.session.adminStep = null;
                ctx.session.editItem = null;

                if (result?.deletedCount > 0) {
                    return ctx.reply(`✅ Serial (Kod: ${item.code}) dan ${episodeNum}-epizod muvaffaqiyatli o‘chirildi.`);
                } else {
                    return ctx.reply(`⚠️ Serial (Kod: ${item.code}) da ${episodeNum}-epizod topilmadi yoki o‘chirilmadi.`);
                }
            }
        }

        if (step.startsWith('add_movie') || step.startsWith('add_series') || step.startsWith('add_channel_')) {
            switch (step) {
                case 'add_movie_code':
                    if (!/^\d+$/.test(text)) return ctx.reply('Iltimos faqat raqam kiriting.');
                    if (await getMovieByCode(Number(text))) return ctx.reply('Bu kod oldin olingan. Boshqasini kiriting.');
                    ctx.session.newMovie = { code: Number(text) };
                    ctx.session.adminStep = 'add_movie_title';
                    return ctx.reply('Kino nomini kiriting:');

                case 'add_movie_title':
                    ctx.session.newMovie.title = text;
                    ctx.session.adminStep = 'add_movie_genre';
                    return ctx.reply('Kino janrini kiriting (Masalan: Fantastika, Jangari):');

                case 'add_movie_genre':
                    ctx.session.newMovie.genre = text;
                    ctx.session.adminStep = 'add_movie_year';
                    return ctx.reply('Kino yilini kiriting (Masalan: 2023):');

                case 'add_movie_year':
                    if (!/^\d+$/.test(text)) return ctx.reply('Iltimos faqat yilni kiriting.');
                    ctx.session.newMovie.year = Number(text);
                    ctx.session.adminStep = 'add_movie_desc';
                    return ctx.reply('Kino tavsifini kiriting:');

                case 'add_movie_desc':
                    ctx.session.newMovie.desc = text;
                    ctx.session.adminStep = 'add_movie_link';
                    return ctx.reply('Kino linkini yuboring (Masalan: https://t.me/filmler/1234):');

                case 'add_movie_link':
                    ctx.session.newMovie.link = text;
                    await addMovie(ctx.session.newMovie);
                    ctx.session.adminStep = null;
                    ctx.session.newMovie = null;
                    return ctx.reply('Kino muvaffaqiyatli qo‘shildi! 🎉');

                case 'add_series_code':
                    if (!/^\d+$/.test(text)) return ctx.reply('Faqat raqam kiriting.');
                    if (await getSeriesByCode(Number(text))) return ctx.reply('Bu kod oldin band qilingan.');
                    ctx.session.newSeries = { code: Number(text), episodes: [] };
                    ctx.session.adminStep = 'add_series_title';
                    return ctx.reply('Serial nomini kiriting:');

                case 'add_series_title':
                    ctx.session.newSeries.title = text;
                    ctx.session.adminStep = 'add_series_genre';
                    return ctx.reply('Serial janrini kiriting:');

                case 'add_series_genre':
                    ctx.session.newSeries.genre = text;
                    ctx.session.adminStep = 'add_series_year';
                    return ctx.reply('Serial yilini kiriting:');

                case 'add_series_year':
                    if (!/^\d+$/.test(text)) return ctx.reply('Iltimos faqat yilni kiriting.');
                    ctx.session.newSeries.year = Number(text);
                    ctx.session.adminStep = 'add_series_desc';
                    return ctx.reply('Serial tavsifini kiriting:');

                case 'add_series_desc':
                    ctx.session.newSeries.desc = text;
                    ctx.session.adminStep = 'add_series_episode';
                    return ctx.reply('Serialning 1-qism linkini yuboring:');

                case 'add_series_episode':
                    ctx.session.newSeries.episodes.push(text);
                    ctx.session.adminStep = 'add_series_more';
                    return ctx.reply('Yana epizod qo‘shishni xohlaysizmi? (Ha/Yo‘q)');

                case 'add_series_more':
                    if (text.toLowerCase() === 'ha' || text.toLowerCase() === 'xa') {
                        ctx.session.adminStep = 'add_series_episode';
                        return ctx.reply('Keyingi qism linkini yuboring:');
                    } else {
                        if (ctx.session.newSeries.episodes.length === 0) {
                            ctx.session.adminStep = null;
                            ctx.session.newSeries = null;
                            return ctx.reply('Serial epizodlari qo‘shilmaganligi sababli serial qo‘shilmadi. Jarayon bekor qilindi.');
                        }

                        await addSeries({
                            code: ctx.session.newSeries.code,
                            title: ctx.session.newSeries.title,
                            desc: ctx.session.newSeries.desc,
                            genre: ctx.session.newSeries.genre,
                            year: ctx.session.newSeries.year
                        });

                        for (const [index, link] of ctx.session.newSeries.episodes.entries()) {
                            await addSeriesEpisode(ctx.session.newSeries.code, index + 1, link);
                        }

                        ctx.session.adminStep = null;
                        ctx.session.newSeries = null;
                        return ctx.reply('Serial muvaffaqiyatli qo‘shildi! 🎉');
                    }

                case 'add_channel_id':
                    const channelId = text.startsWith('@') ? text : Number(text);
                    if (!channelId || (typeof channelId === 'string' && channelId.length < 2)) {
                        return ctx.reply('Noto‘g‘ri kanal username/ID sini kiritdingiz.');
                    }
                    ctx.session.newChannel = { channel_id: channelId };
                    ctx.session.adminStep = 'add_channel_name';
                    return ctx.reply('Kanal nomi (Masalan: Rasmiy Kino Kanal) kiriting:');

                case 'add_channel_name':
                    ctx.session.newChannel.name = text;
                    ctx.session.adminStep = 'add_channel_link';
                    return ctx.reply('Kanalga o‘tish linkini kiriting (Masalan: https://t.me/Kanalim):');

                case 'add_channel_link':
                    ctx.session.newChannel.link = text;
                    await addChannel(ctx.session.newChannel);

                    ctx.session.adminStep = null;
                    ctx.session.newChannel = null;
                    // ✅ RETURN qo'shildi
                    return ctx.reply(`✅ Kanal muvaffaqiyatli qo‘shildi!`);
            }
        }

        return;
    });
}