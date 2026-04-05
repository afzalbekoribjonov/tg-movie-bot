import { getChannels, recordDatabaseOperationError } from './database.js';

const CHANNELS_CACHE_TTL_MS = 30 * 1000;

let cachedChannels = null;
let cacheExpiresAt = 0;

export async function getCachedChannels() {
    const now = Date.now();

    if (cachedChannels && now < cacheExpiresAt) {
        return cachedChannels;
    }

    try {
        cachedChannels = await getChannels();
        cacheExpiresAt = now + CHANNELS_CACHE_TTL_MS;
        return cachedChannels;
    } catch (error) {
        recordDatabaseOperationError(error);
        cachedChannels = [];
        cacheExpiresAt = now + 5 * 1000;
        return cachedChannels;
    }
}

export function invalidateChannelsCache() {
    cachedChannels = null;
    cacheExpiresAt = 0;
}
