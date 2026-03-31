import { getChannels } from './database.js';

const CHANNELS_CACHE_TTL_MS = 30 * 1000;

let cachedChannels = null;
let cacheExpiresAt = 0;

export async function getCachedChannels() {
    const now = Date.now();

    if (cachedChannels && now < cacheExpiresAt) {
        return cachedChannels;
    }

    cachedChannels = await getChannels();
    cacheExpiresAt = now + CHANNELS_CACHE_TTL_MS;

    return cachedChannels;
}

export function invalidateChannelsCache() {
    cachedChannels = null;
    cacheExpiresAt = 0;
}
