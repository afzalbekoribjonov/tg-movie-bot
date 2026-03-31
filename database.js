import mongoose from 'mongoose';
import config from './config.js';

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
    link: { type: String, required: true },
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

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const SessionSchema = new mongoose.Schema({
    session_key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updated_at: { type: Date, default: Date.now, expires: SESSION_TTL_SECONDS },
});
const Session = mongoose.model('Session', SessionSchema);

async function ensurePremiumSettingsSingleton() {
    const settingsDocs = await PremiumSettings.find({}).sort({ _id: 1 }).lean();

    if (settingsDocs.length <= 1) {
        if (settingsDocs.length === 1 && settingsDocs[0].singleton_key !== PREMIUM_SETTINGS_KEY) {
            await PremiumSettings.updateOne(
                { _id: settingsDocs[0]._id },
                { $set: { singleton_key: PREMIUM_SETTINGS_KEY } }
            );
        }
        return;
    }

    const primaryDoc = settingsDocs.find(doc => doc.singleton_key === PREMIUM_SETTINGS_KEY) || settingsDocs[0];
    const duplicateIds = settingsDocs
        .filter(doc => String(doc._id) !== String(primaryDoc._id))
        .map(doc => doc._id);

    await PremiumSettings.updateOne(
        { _id: primaryDoc._id },
        { $set: { singleton_key: PREMIUM_SETTINGS_KEY } }
    );

    if (duplicateIds.length > 0) {
        await PremiumSettings.deleteMany({ _id: { $in: duplicateIds } });
    }
}


export async function initDB() {
    if (!config.MONGODB_URI) {
        console.error("XATO: MONGODB_URI atrof-muhit o'zgaruvchisi o'rnatilmagan. Ulanish qatorini o'rnatish shart.");
        process.exit(1);
    }

    try {
        await mongoose.connect(config.MONGODB_URI);
        await ensurePremiumSettingsSingleton();
        console.log('MongoDB ga muvaffaqiyatli ulanildi!');
        console.log('All models initialized (collections automatically created/managed).');
        return true;
    } catch (error) {
        console.error('MongoDB ga ulanishda xato:', error);
        process.exit(1);
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


export async function addMovie(movie) {
    const newMovie = new Movie({
        code: Number(movie.code),
        title: movie.title,
        desc: movie.desc,
        genre: movie.genre,
        year: Number(movie.year),
        link: movie.link
    });
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
    const updateFields = {
        title: fields.title,
        desc: fields.desc,
        genre: fields.genre,
        year: fields.year ? Number(fields.year) : undefined,
        link: fields.link
    };
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
    const updateFields = {
        title: fields.title,
        desc: fields.desc,
        genre: fields.genre,
        year: fields.year ? Number(fields.year) : undefined
    };
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

export async function addSeriesEpisode(series_code, episode, link) {
    return await SeriesEpisode.findOneAndUpdate(
        { series_code: Number(series_code), episode: Number(episode) },
        { link: link }, // Yangilash uchun
        { upsert: true, new: true, runValidators: true } // Agar mavjud bo'lmasa yarat
    );
}

export async function getSeriesEpisodes(series_code) {
    return await SeriesEpisode.find({ series_code: Number(series_code) })
        .sort({ episode: 1 }) // ASC
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
    return await Channel.find({}).lean();
}

export async function deleteChannel(channel_id) {
    return await Channel.deleteOne({ channel_id: channel_id });
}

export async function getPremiumSettings() {
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

export async function getSession(sessionKey) {
    const session = await Session.findOne({ session_key: sessionKey })
        .select('data')
        .lean();

    return session?.data ?? null;
}

export async function saveSession(sessionKey, data) {
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
        .sort({ code: -1 }) // DESC
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
        .sort({ code: -1 }) // DESC
        .skip(offset)
        .limit(ITEMS_PER_PAGE)
        .lean();
}

export async function getTotalSeriesPages() {
    const totalItems = await countSeries();
    return Math.ceil(totalItems / ITEMS_PER_PAGE);
}
