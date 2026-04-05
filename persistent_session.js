import { deleteSession, getSession, recordDatabaseOperationError, saveSession } from './database.js';

const fallbackSessions = new Map();

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

        let storedSession = null;

        try {
            storedSession = await getSession(sessionKey);
        } catch (error) {
            recordDatabaseOperationError(error);
            storedSession = fallbackSessions.get(sessionKey) ?? null;
        }

        const initialSession = normalizeSession(storedSession ?? fallbackSessions.get(sessionKey));
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
                fallbackSessions.delete(sessionKey);
                try {
                    await deleteSession(sessionKey);
                } catch (error) {
                    recordDatabaseOperationError(error);
                }
                return;
            }

            fallbackSessions.set(sessionKey, normalizedSession);
            try {
                await saveSession(sessionKey, normalizedSession);
            } catch (error) {
                recordDatabaseOperationError(error);
            }
        }
    };
}
