import { getChannels, addChannel, deleteChannel, isAdmin } from '../database.js';

export function adminCommandsHandler(bot) {

    bot.command('addchannel', (ctx) => {
        const uid = Number(ctx.from?.id);
        if (!isAdmin(uid)) return ctx.reply('Siz admin emassiz.');
        if (!ctx.session) ctx.session = {};
        ctx.session.adminStep = 'add_channel_id';
        return ctx.reply('Kanal username/ID sini kiriting (Masalan: @Kanalim, -1001234567890):');
    });

    bot.command('delchannel', (ctx) => {
        const uid = Number(ctx.from?.id);
        if (!isAdmin(uid)) return ctx.reply('Siz admin emassiz.');
        const channels = getChannels();

        if (channels.length === 0) {
            return ctx.reply('Hozircha o‘chirish uchun kanal mavjud emas.');
        }

        const buttons = channels.map(c => [
            {
                text: `🗑 ${c.name} (${c.channel_id})`,
                callback_data: `delete_channel:${c.channel_id}`
            }
        ]);

        return ctx.reply('O‘chirmoqchi bo‘lgan kanalni tanlang:', { reply_markup: { inline_keyboard: buttons } });
    });
}