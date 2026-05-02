import {
    getMovieByCode,
    getSeriesByCode,
    getLatestMoviesForInline,
    getLatestSeriesForInline,
    getSeriesEpisodeCounts,
    searchMoviesForInline,
    searchSeriesForInline,
} from '../database.js';
import { buildItemCaption, escapeHTML } from '../utils.js';
import { buildRecommendationMessage } from './share.js';
import { buildPrivateInlineSelectionMessage } from './inline_private.js';

const INLINE_MOVIE_LIMIT = 20;
const INLINE_SERIES_LIMIT = 10;
const INLINE_CACHE_SECONDS = 5;
const SHARE_QUERY_REGEX = /^share_(movie|series)_(\d+)$/i;

function buildMovieDescription(movie) {
    const parts = [];

    if (movie.year) parts.push(String(movie.year));
    if (movie.genre) parts.push(movie.genre);
    parts.push('Kino');

    return parts.join(' • ');
}

function buildSeriesDescription(series, episodeCount) {
    const parts = [];

    if (series.year) parts.push(String(series.year));
    if (series.genre) parts.push(series.genre);
    parts.push(`Serial${episodeCount ? ` • ${episodeCount} qism` : ''}`);

    return parts.join(' • ');
}

function buildSeriesInlineText(series, episodeCount) {
    const title = escapeHTML(series.title);
    const year = escapeHTML(String(series.year || 'Noma’lum'));
    const genre = escapeHTML(series.genre || 'Yo‘q');
    const desc = escapeHTML(series.desc || 'Tavsif yo‘q');
    const totalEpisodes = Number(episodeCount || 0);

    return `
📺 <b>${title}</b> (${year})

<b>🎦 Janr:</b> ${genre}
<b>📄 Tavsif:</b> <i>${desc}</i>
<b>🎞 Qismlar:</b> ${totalEpisodes || 'Hali qo‘shilmagan'}

<b>To‘liq ko‘rish uchun quyidagi tugma orqali botni oching.</b>
`.trim();
}

function isPrivateInlineChat(ctx) {
    const chatType = String(ctx.inlineQuery?.chat_type || '').toLowerCase();
    return chatType === 'private' || chatType === 'sender';
}

function createMovieInlineResult(movie, botUsername, isPrivateChat = false) {
    const title = movie.title || `Kino ${movie.code}`;
    const caption = buildItemCaption(movie, '🎬').trim();

    if (isPrivateChat) {
        return {
            type: 'article',
            id: `movie:${movie.code}`,
            title,
            description: `${buildMovieDescription(movie)} • Tanlanganda bot darrov yuboradi`,
            input_message_content: {
                message_text: buildPrivateInlineSelectionMessage('movie', movie),
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            },
        };
    }

    const replyMarkup = {
        inline_keyboard: [
            [{ text: '🤖 Botda ochish', url: `https://t.me/${botUsername}?start=${movie.code}` }]
        ]
    };

    return {
        type: 'article',
        id: `movie:${movie.code}`,
        title,
        description: `${buildMovieDescription(movie)} • Himoyalangan holda botda ochiladi`,
        input_message_content: {
            message_text: `${caption}\n\n<b>Media bot ichida himoyalangan holda ochiladi.</b>`,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        },
        reply_markup: replyMarkup,
    };
}

function createSeriesInlineResult(series, episodeCount, botUsername, isPrivateChat = false) {
    if (isPrivateChat) {
        return {
            type: 'article',
            id: `series:${series.code}`,
            title: series.title || `Serial ${series.code}`,
            description: `${buildSeriesDescription(series, episodeCount)} • Tanlanganda 1-qism ochiladi`,
            input_message_content: {
                message_text: buildPrivateInlineSelectionMessage('series', {
                    ...series,
                    episode_count: episodeCount,
                }),
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            },
        };
    }

    return {
        type: 'article',
        id: `series:${series.code}`,
        title: series.title || `Serial ${series.code}`,
        description: buildSeriesDescription(series, episodeCount),
        input_message_content: {
            message_text: buildSeriesInlineText(series, episodeCount),
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        },
        reply_markup: {
            inline_keyboard: [
                [{ text: '📺 Botda epizodlarni ochish', url: `https://t.me/${botUsername}?start=${series.code}` }]
            ]
        },
    };
}

function createShareInlineResult(itemType, item, botUsername) {
    const actionText = itemType === 'series' ? '📺 Serialni ko‘rish' : '🎬 Kinoni ko‘rish';
    const typeLabel = itemType === 'series' ? 'Serial tavsiyasi' : 'Kino tavsiyasi';

    return {
        type: 'article',
        id: `share:${itemType}:${item.code}`,
        title: `${typeLabel}: ${item.title || item.code}`,
        description: `${item.year ? `${item.year} • ` : ''}${item.genre || typeLabel}`,
        input_message_content: {
            message_text: buildRecommendationMessage(itemType, item),
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        },
        reply_markup: {
            inline_keyboard: [
                [{ text: actionText, url: `https://t.me/${botUsername}?start=${item.code}` }]
            ]
        }
    };
}

async function loadShareInlineItem(query) {
    const match = String(query || '').trim().match(SHARE_QUERY_REGEX);
    if (!match) {
        return null;
    }

    const [, itemType, codeText] = match;
    const code = Number(codeText);

    if (!Number.isFinite(code)) {
        return null;
    }

    const item = itemType === 'series'
        ? await getSeriesByCode(code)
        : await getMovieByCode(code);

    if (!item) {
        return null;
    }

    return { itemType: itemType.toLowerCase(), item };
}

async function loadInlineData(query) {
    if (!query) {
        const [movies, series] = await Promise.all([
            getLatestMoviesForInline(INLINE_MOVIE_LIMIT),
            getLatestSeriesForInline(INLINE_SERIES_LIMIT),
        ]);

        return { movies, series };
    }

    const [movies, series] = await Promise.all([
        searchMoviesForInline(query, INLINE_MOVIE_LIMIT),
        searchSeriesForInline(query, INLINE_SERIES_LIMIT),
    ]);

    return { movies, series };
}

export function inlineHandler(bot) {
    bot.on('inline_query', async (ctx) => {
        try {
            const query = String(ctx.inlineQuery?.query || '').trim();
            const botUsername = ctx.botInfo?.username || bot.botInfo?.username;
            const privateChatMode = isPrivateInlineChat(ctx);

            if (!botUsername) {
                return ctx.answerInlineQuery([], {
                    cache_time: 0,
                    is_personal: true,
                });
            }

            const shareInlineItem = await loadShareInlineItem(query);
            if (shareInlineItem) {
                return ctx.answerInlineQuery([
                    createShareInlineResult(shareInlineItem.itemType, shareInlineItem.item, botUsername)
                ], {
                    cache_time: INLINE_CACHE_SECONDS,
                    is_personal: true,
                });
            }

            const { movies, series } = await loadInlineData(query);
            movies.sort((a, b) => Number(Boolean(b.file_id)) - Number(Boolean(a.file_id)));
            const episodeCountMap = await getSeriesEpisodeCounts(series.map(item => item.code));

            const movieResults = movies.map(movie => createMovieInlineResult(movie, botUsername, privateChatMode));
            const seriesResults = series.map(seriesItem => createSeriesInlineResult(
                seriesItem,
                episodeCountMap.get(Number(seriesItem.code)) || 0,
                botUsername,
                privateChatMode,
            ));

            const results = [...movieResults, ...seriesResults].slice(0, 50);

            return ctx.answerInlineQuery(results, {
                cache_time: INLINE_CACHE_SECONDS,
                is_personal: true,
            });
        } catch (error) {
            console.error('Inline query qayta ishlashda xato:', error);
            return ctx.answerInlineQuery([], {
                cache_time: 0,
                is_personal: true,
            }).catch(() => {});
        }
    });
}
