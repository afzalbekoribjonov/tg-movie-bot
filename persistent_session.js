import { deleteSession, getSession, saveSession } from './database.js';

function getSessionKey(ctx) {
    const fromId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (fromId == null || chatId == null) {
        return null;
    }

    return `${fromId}:${chatId}`;
}

function normalizeSession(session) {
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
        return {};
    }

    const entries = Object.entries(session)
        .filter(([, value]) => value !== null && value !== undefined);

    return Object.fromEntries(entries);
}

export function persistentSession() {
    return async (ctx, next) => {
        const sessionKey = getSessionKey(ctx);

        if (!sessionKey) {
            ctx.session = {};
            return next();
        }

        const storedSession = await getSession(sessionKey);
        const initialSession = normalizeSession(storedSession);
        const initialSerialized = JSON.stringify(initialSession);

        ctx.session = initialSession;

        try {
            await next();
        } finally {
            const normalizedSession = normalizeSession(ctx.session);
            const normalizedSerialized = JSON.stringify(normalizedSession);

            if (normalizedSerialized === initialSerialized) {
                return;
            }

            if (Object.keys(normalizedSession).length === 0) {
                await deleteSession(sessionKey);
                return;
            }

            await saveSession(sessionKey, normalizedSession);
        }
    };
}
