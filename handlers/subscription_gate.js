import { extractPrivateInlineSelection } from './inline_private.js';

const START_PAYLOAD_REGEX = /^\/start(?:@\w+)?\s+(.+)$/i;

export async function getMissingSubscriptionChannels(ctx, channels = []) {
    const userId = Number(ctx.from?.id);
    if (!userId || !Array.isArray(channels) || channels.length === 0) {
        return [];
    }

    const membershipChecks = await Promise.all(
        channels.map(async (channel) => {
            if (!channel?.channel_id) {
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

    return membershipChecks.filter(Boolean);
}

export function extractPendingLookupRequest(text) {
    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
        return null;
    }

    const inlineSelection = extractPrivateInlineSelection(normalizedText);
    if (inlineSelection?.code) {
        return {
            code: Number(inlineSelection.code),
            source: 'inline',
            rawText: normalizedText,
        };
    }

    if (/^\d+$/.test(normalizedText)) {
        return {
            code: Number(normalizedText),
            source: 'code',
            rawText: normalizedText,
        };
    }

    const startMatch = normalizedText.match(START_PAYLOAD_REGEX);
    const startPayload = startMatch?.[1]?.trim();
    if (startPayload && /^\d+$/.test(startPayload)) {
        return {
            code: Number(startPayload),
            source: 'start',
            rawText: normalizedText,
        };
    }

    return null;
}

export function buildSubscriptionPrompt(notJoined = [], pendingLookup = null) {
    const buttons = notJoined
        .filter(channel => channel?.link)
        .map(channel => [{ text: channel.name || 'Kanal', url: channel.link }]);

    buttons.push([{ text: '✅ Obuna bo‘ldim', callback_data: 'check_subscription' }]);

    const pendingHint = pendingLookup?.code
        ? `\n\n🎟 <b>Siz tanlagan kod:</b> <code>${pendingLookup.code}</code>\nObuna tasdiqlangach, shu kino yoki serialni shu yerning o‘zida chiqarib beraman.`
        : '';

    return {
        text: `📢 <b>Davom etish uchun quyidagi kanallarga obuna bo‘ling.</b>\n\n✨ Obuna bo‘lib bo‘lgach, pastdagi tugmani bosing.${pendingHint}`,
        reply_markup: {
            inline_keyboard: buttons,
        }
    };
}
