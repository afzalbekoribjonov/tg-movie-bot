import mongoose from 'mongoose';
import config from './config.js';

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

const DB_RECONNECT_DELAY_MS = 15000;
let dbReady = false;
let dbConnecting = false;
let reconnectTimer = null;
let lastDatabaseError = null;
let dbListenersBound = false;

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleReconnect(delayMs = DB_RECONNECT_DELAY_MS) {
    if (!config.MONGODB_URI || reconnectTimer || dbConnecting || mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
        return;
    }

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        await initDB().catch(() => false);
    }, delayMs);
}

function setDatabaseReady() {
    dbReady = true;
    lastDatabaseError = null;
    clearReconnectTimer();
}

function setDatabaseUnavailable(error) {
    dbReady = false;
    if (error) {
        lastDatabaseError = error instanceof Error ? error.message : String(error);
    }
    scheduleReconnect();
}

function bindDatabaseListeners() {
    if (dbListenersBound) {
        return;
    }

    dbListenersBound = true;

    mongoose.connection.on('connected', () => {
        setDatabaseReady();
        console.log('MongoDB ulanish holati: connected');
    });

    mongoose.connection.on('disconnected', () => {
        console.warn('MongoDB ulanish holati: disconnected');
        setDatabaseUnavailable('MongoDB disconnected');
    });

    mongoose.connection.on('error', (error) => {
        console.error('MongoDB ulanish xatosi:', error?.message || error);
        setDatabaseUnavailable(error);
    });
}

export function isDatabaseReady() {
    return dbReady && mongoose.connection.readyState === 1;
}

export function getDatabaseStatus() {
    return {
        ready: isDatabaseReady(),
        lastError: lastDatabaseError,
        readyState: mongoose.connection.readyState,
    };
}

export function isDatabaseUnavailableError(error) {
    if (!error) {
        return false;
    }

    if (error?.code === 'DATABASE_UNAVAILABLE') {
        return true;
    }

    const errorName = String(error?.name || '').toLowerCase();
    const errorMessage = String(error?.message || '').toLowerCase();

    return errorName.includes('mongo')
        || errorName.includes('mongoose')
        || errorMessage.includes('buffering timed out')
        || errorMessage.includes('before initial connection is complete')
        || errorMessage.includes('topology is closed')
        || errorMessage.includes('connection') && errorMessage.includes('mongo');
}

export function recordDatabaseOperationError(error) {
    if (isDatabaseUnavailableError(error)) {
        setDatabaseUnavailable(error);
    }
}

const UserSchema = new mongoose.Schema({
    user_id: { type: Number, required: true, unique: true },
    username: { type: String, default: null },
    first_name: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
});
const User = mongoose.model('User', UserSchema);

const MovieSchema = new mongoose.Schema({
    code: { type: Number, required: true, unique: true },
    title: { type: String, required: true },
    desc: { type: String, default: null },
    genre: { type: String, default: null },
    year: { type: Number, default: null },
    link: { type: String, default: null },
    media_type: { type: String, enum: ['video', 'document', 'photo'], default: null },
    file_id: { type: String, default: null },
    file_unique_id: { type: String, default: null },
    file_name: { type: String, default: null },
    mime_type: { type: String, default: null },
    file_size: { type: Number, default: null },
    duration: { type: Number, default: null },
    created_at: { type: Date, default: Date.now },
});
const Movie = mongoose.model('Movie', MovieSchema);

const SeriesSchema = new mongoose.Schema({
    code: { type: Number, required: true, unique: true },
    title: { type: String, required: true },
    desc: { type: String, default: null },
    genre: { type: String, default: null },
    year: { type: Number, default: null },
    created_at: { type: Date, default: Date.now },
});
const Series = mongoose.model('Series', SeriesSchema);

const SeriesEpisodeSchema = new mongoose.Schema({
    series_code: { type: Number, required: true },
    episode: { type: Number, required: true },
    link: { type: String, default: null },
    media_type: { type: String, enum: ['video', 'document', 'photo'], default: null },
    file_id: { type: String, default: null },
    file_unique_id: { type: String, default: null },
    file_name: { type: String, default: null },
    mime_type: { type: String, default: null },
    file_size: { type: Number, default: null },
    duration: { type: Number, default: null },
});

SeriesEpisodeSchema.index({ series_code: 1, episode: 1 }, { unique: true });
const SeriesEpisode = mongoose.model('SeriesEpisode', SeriesEpisodeSchema);

const ChannelSchema = new mongoose.Schema({
    channel_id: { type: String, required: true, unique: true },
    name: { type: String, default: null },
    link: { type: String, default: null },
});
const Channel = mongoose.model('Channel', ChannelSchema);

const PREMIUM_SETTINGS_KEY = 'default';

const PremiumSettingsSchema = new mongoose.Schema({
    singleton_key: { type: String, required: true, unique: true, default: PREMIUM_SETTINGS_KEY },
    enabled: { type: Boolean, default: false },
    price: { type: String, default: null },
    card_number: { type: String, default: null },
    card_owner: { type: String, default: null },
    admin_username: { type: String, default: null },
});
const PremiumSettings = mongoose.model('PremiumSettings', PremiumSettingsSchema);

const BOT_SETTINGS_KEY = 'default';

const BotSettingsSchema = new mongoose.Schema({
    singleton_key: { type: String, required: true, unique: true, default: BOT_SETTINGS_KEY },
    promo_channel_id: { type: String, default: null },
    promo_channel_title: { type: String, default: null },
    promo_channel_username: { type: String, default: null },
    promo_channel_link: { type: String, default: null },
    updated_at: { type: Date, default: Date.now },
});
const BotSettings = mongoose.model('BotSettings', BotSettingsSchema);

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const SessionSchema = new mongoose.Schema({
    session_key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updated_at: { type: Date, default: Date.now, expires: SESSION_TTL_SECONDS },
});
const Session = mongoose.model('Session', SessionSchema);

async function ensureSingletonDocument(model, singletonKeyValue) {
    const docs = await model.find({}).sort({ _id: 1 }).lean();

    if (docs.length <= 1) {
        if (docs.length === 1 && docs[0].singleton_key !== singletonKeyValue) {
            await model.updateOne(
                { _id: docs[0]._id },
                { $set: { singleton_key: singletonKeyValue } }
            );
        }
        return;
    }

    const primaryDoc = docs.find(doc => doc.singleton_key === singletonKeyValue) || docs[0];
    const duplicateIds = docs
        .filter(doc => String(doc._id) !== String(primaryDoc._id))
        .map(doc => doc._id);

    await model.updateOne(
        { _id: primaryDoc._id },
        { $set: { singleton_key: singletonKeyValue } }
    );

    if (duplicateIds.length > 0) {
        await model.deleteMany({ _id: { $in: duplicateIds } });
    }
}

async function ensurePremiumSettingsSingleton() {
    return ensureSingletonDocument(PremiumSettings, PREMIUM_SETTINGS_KEY);
}

async function ensureBotSettingsSingleton() {
    return ensureSingletonDocument(BotSettings, BOT_SETTINGS_KEY);
}

export async function initDB() {
    bindDatabaseListeners();

    if (!config.MONGODB_URI) {
        const message = "MONGODB_URI topilmadi. Bot vaqtincha kutish xabari bilan ishlaydi.";
        console.warn(message);
        setDatabaseUnavailable(message);
        return false;
    }

    if (isDatabaseReady()) {
        return true;
    }

    if (dbConnecting) {
        return false;
    }

    dbConnecting = true;

    try {
        await mongoose.connect(config.MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
            maxPoolSize: 10,
        });
        await ensurePremiumSettingsSingleton();
        await ensureBotSettingsSingleton();
        setDatabaseReady();
        console.log('MongoDB ga muvaffaqiyatli ulanildi!');
        console.log('Barcha kerakli bo‘limlar tayyorlandi.');
        return true;
    } catch (error) {
        console.error('MongoDB ga ulanishda xato:', error);
        setDatabaseUnavailable(error);
        return false;
    } finally {
        dbConnecting = false;
    }
}

export async function addUser(userId, username, firstName) {
    try {
        return await User.findOneAndUpdate(
            { user_id: Number(userId) },
            {
                user_id: Number(userId),
                username: username,
                first_name: firstName
            },
            {
                upsert: true,
                new: true,
                runValidators: true
            }
        );
    } catch (error) {
        if (error.code === 11000) {
            return null;
        }
        throw error;
    }
}

export async function checkUserExists(userId) {
    const user = await User.findOne({ user_id: Number(userId) }).select('user_id').lean();
    return !!user;
}

export async function getAllUserIds() {
    const users = await User.find({}).select('user_id').lean();
    return users.map(row => Number(row.user_id));
}

export async function countUsers() {
    return await User.countDocuments();
}

function cleanUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTitleSearchFilter(query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
        return {};
    }

    const regex = new RegExp(escapeRegex(trimmed), 'i');
    const filters = [{ title: regex }];

    if (/^\d+$/.test(trimmed)) {
        filters.unshift({ code: Number(trimmed) });
    }

    return { $or: filters };
}


export async function addMovie(movie) {
    const newMovie = new Movie(cleanUndefined({
        code: Number(movie.code),
        title: movie.title,
        desc: movie.desc,
        genre: movie.genre,
        year: movie.year ? Number(movie.year) : null,
        link: movie.link ?? null,
        media_type: movie.media_type ?? null,
        file_id: movie.file_id ?? null,
        file_unique_id: movie.file_unique_id ?? null,
        file_name: movie.file_name ?? null,
        mime_type: movie.mime_type ?? null,
        file_size: movie.file_size ?? null,
        duration: movie.duration ?? null,
    }));
    return await newMovie.save();
}

export async function getMovieByCode(code) {
    return await Movie.findOne({ code: Number(code) }).lean();
}

export async function getAllMovies() {
    return await Movie.find({}).lean();
}

export async function getRandomMovie() {
    const [movie] = await Movie.aggregate([
        { $sample: { size: 1 } }
    ]);

    return movie || null;
}

export async function updateMovie(code, fields) {
    const updateFields = cleanUndefined({
        title: fields.title,
        desc: fields.desc,
        genre: fields.genre,
        year: fields.year ? Number(fields.year) : fields.year === null ? null : undefined,
        link: fields.link,
        media_type: fields.media_type,
        file_id: fields.file_id,
        file_unique_id: fields.file_unique_id,
        file_name: fields.file_name,
        mime_type: fields.mime_type,
        file_size: fields.file_size,
        duration: fields.duration,
    });
    return await Movie.updateOne({ code: Number(code) }, { $set: updateFields });
}

export async function deleteMovie(code) {
    return await Movie.deleteOne({ code: Number(code) });
}

export async function countMovies() {
    return await Movie.countDocuments();
}

export async function addSeries(series) {
    const newSeries = new Series({
        code: Number(series.code),
        title: series.title,
        desc: series.desc,
        genre: series.genre,
        year: Number(series.year)
    });
    return await newSeries.save();
}

export async function getSeriesByCode(code) {
    return await Series.findOne({ code: Number(code) }).lean();
}

export async function deleteSeries(code) {
    const seriesCode = Number(code);
    await SeriesEpisode.deleteMany({ series_code: seriesCode });
    return await Series.deleteOne({ code: seriesCode });
}

export async function updateSeries(code, fields) {
    const updateFields = cleanUndefined({
        title: fields.title,
        desc: fields.desc,
        genre: fields.genre,
        year: fields.year ? Number(fields.year) : undefined
    });
    return await Series.updateOne({ code: Number(code) }, { $set: updateFields });
}

export async function countSeries() {
    return await Series.countDocuments();
}

export async function deleteSeriesEpisode(series_code, episode) {
    return await SeriesEpisode.deleteOne({
        series_code: Number(series_code),
        episode: Number(episode)
    });
}

export async function addSeriesEpisode(series_code, episode, episodeData) {
    const normalizedData = typeof episodeData === 'string'
        ? { link: episodeData }
        : episodeData;

    return await SeriesEpisode.findOneAndUpdate(
        { series_code: Number(series_code), episode: Number(episode) },
        cleanUndefined({
            link: normalizedData?.link,
            media_type: normalizedData?.media_type,
            file_id: normalizedData?.file_id,
            file_unique_id: normalizedData?.file_unique_id,
            file_name: normalizedData?.file_name,
            mime_type: normalizedData?.mime_type,
            file_size: normalizedData?.file_size,
            duration: normalizedData?.duration,
        }),
        { upsert: true, new: true, runValidators: true }
    );
}

export async function getSeriesEpisodes(series_code) {
    return await SeriesEpisode.find({ series_code: Number(series_code) })
        .sort({ episode: 1 })
        .lean();
}

export async function addChannel(channel) {
    return await Channel.findOneAndUpdate(
        { channel_id: channel.channel_id },
        {
            channel_id: channel.channel_id,
            name: channel.name,
            link: channel.link
        },
        { upsert: true, new: true, runValidators: true }
    );
}

export async function getChannels() {
    if (!isDatabaseReady()) {
        return [];
    }
    return await Channel.find({}).lean();
}

export async function deleteChannel(channel_id) {
    return await Channel.deleteOne({ channel_id: channel_id });
}

export async function getPremiumSettings() {
    if (!isDatabaseReady()) {
        return {
            enabled: false,
            price: null,
            card_number: null,
            card_owner: null,
            admin_username: null
        };
    }

    let settings = await PremiumSettings.findOne({ singleton_key: PREMIUM_SETTINGS_KEY }).lean();

    if (!settings) {
        const legacySettings = await PremiumSettings.findOne({}).lean();

        if (legacySettings) {
            settings = await PremiumSettings.findOneAndUpdate(
                { _id: legacySettings._id },
                { $set: { singleton_key: PREMIUM_SETTINGS_KEY } },
                { new: true }
            ).lean();
        }
    }

    if (settings) {
        return settings;
    }

    return {
        enabled: false,
        price: null,
        card_number: null,
        card_owner: null,
        admin_username: null
    };
}

export async function setPremiumSettings(fields) {
    const updateFields = Object.fromEntries(
        Object.entries({
            enabled: fields.enabled,
            price: fields.price,
            card_number: fields.card_number,
            card_owner: fields.card_owner,
            admin_username: fields.admin_username
        }).filter(([, value]) => value !== undefined)
    );

    return await PremiumSettings.findOneAndUpdate(
        { singleton_key: PREMIUM_SETTINGS_KEY },
        {
            $set: updateFields,
            $setOnInsert: { singleton_key: PREMIUM_SETTINGS_KEY }
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    ).lean();
}

export async function getPromoChannelSettings() {
    if (!isDatabaseReady()) {
        return {
            promo_channel_id: null,
            promo_channel_title: null,
            promo_channel_username: null,
            promo_channel_link: null,
        };
    }

    let settings = await BotSettings.findOne({ singleton_key: BOT_SETTINGS_KEY }).lean();

    if (!settings) {
        const legacySettings = await BotSettings.findOne({}).lean();

        if (legacySettings) {
            settings = await BotSettings.findOneAndUpdate(
                { _id: legacySettings._id },
                { $set: { singleton_key: BOT_SETTINGS_KEY } },
                { new: true }
            ).lean();
        }
    }

    if (settings) {
        return settings;
    }

    return {
        promo_channel_id: null,
        promo_channel_title: null,
        promo_channel_username: null,
        promo_channel_link: null,
    };
}

export async function setPromoChannelSettings(fields) {
    const updateFields = Object.fromEntries(
        Object.entries({
            promo_channel_id: fields.promo_channel_id,
            promo_channel_title: fields.promo_channel_title,
            promo_channel_username: fields.promo_channel_username,
            promo_channel_link: fields.promo_channel_link,
            updated_at: new Date(),
        }).filter(([, value]) => value !== undefined)
    );

    return await BotSettings.findOneAndUpdate(
        { singleton_key: BOT_SETTINGS_KEY },
        {
            $set: updateFields,
            $setOnInsert: { singleton_key: BOT_SETTINGS_KEY }
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    ).lean();
}

export async function clearPromoChannelSettings() {
    return await setPromoChannelSettings({
        promo_channel_id: null,
        promo_channel_title: null,
        promo_channel_username: null,
        promo_channel_link: null,
    });
}

export async function getSession(sessionKey) {
    if (!isDatabaseReady()) {
        return null;
    }

    const session = await Session.findOne({ session_key: sessionKey })
        .select('data')
        .lean();

    return session?.data ?? null;
}

export async function saveSession(sessionKey, data) {
    if (!isDatabaseReady()) {
        return null;
    }

    return await Session.findOneAndUpdate(
        { session_key: sessionKey },
        {
            session_key: sessionKey,
            data,
            updated_at: new Date()
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    );
}

export async function deleteSession(sessionKey) {
    if (!isDatabaseReady()) {
        return null;
    }

    return await Session.deleteOne({ session_key: sessionKey });
}

export function isAdmin(user_id) {
    return config.ADMINS.includes(Number(user_id));
}

const ITEMS_PER_PAGE = 15;

export async function getPaginatedMovies(page = 0) {
    const offset = page * ITEMS_PER_PAGE;
    return await Movie.find({})
        .select('code title')
        .sort({ code: -1 })
        .skip(offset)
        .limit(ITEMS_PER_PAGE)
        .lean();
}

export async function getTotalMoviePages() {
    const totalItems = await countMovies();
    return Math.ceil(totalItems / ITEMS_PER_PAGE);
}

export async function getPaginatedSeries(page = 0) {
    const offset = page * ITEMS_PER_PAGE;
    return await Series.find({})
        .select('code title')
        .sort({ code: -1 })
        .skip(offset)
        .limit(ITEMS_PER_PAGE)
        .lean();
}

export async function getTotalSeriesPages() {
    const totalItems = await countSeries();
    return Math.ceil(totalItems / ITEMS_PER_PAGE);
}


export async function searchMoviesForInline(query, limit = 20) {
    return await Movie.find(buildTitleSearchFilter(query))
        .select('code title year genre desc media_type file_id link created_at')
        .sort({ created_at: -1, code: -1 })
        .limit(Math.min(Number(limit) || 20, 50))
        .lean();
}

export async function searchSeriesForInline(query, limit = 10) {
    return await Series.find(buildTitleSearchFilter(query))
        .select('code title year genre desc created_at')
        .sort({ created_at: -1, code: -1 })
        .limit(Math.min(Number(limit) || 10, 50))
        .lean();
}

export async function getLatestMoviesForInline(limit = 20) {
    return await Movie.find({})
        .select('code title year genre desc media_type file_id link created_at')
        .sort({ created_at: -1, code: -1 })
        .limit(Math.min(Number(limit) || 20, 50))
        .lean();
}

export async function getLatestSeriesForInline(limit = 10) {
    return await Series.find({})
        .select('code title year genre desc created_at')
        .sort({ created_at: -1, code: -1 })
        .limit(Math.min(Number(limit) || 10, 50))
        .lean();
}

export async function getSeriesEpisodeCounts(seriesCodes = []) {
    const codes = Array.from(new Set(seriesCodes.map(code => Number(code)).filter(Number.isFinite)));
    if (codes.length === 0) {
        return new Map();
    }

    const rows = await SeriesEpisode.aggregate([
        { $match: { series_code: { $in: codes } } },
        { $group: { _id: '$series_code', count: { $sum: 1 } } }
    ]);

    return new Map(rows.map(row => [Number(row._id), Number(row.count)]));
}
