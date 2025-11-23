import {
    countMovies,
    countSeries,
    countUsers,
    getPaginatedMovies,
    getTotalMoviePages,
    getPaginatedSeries,
    getTotalSeriesPages
} from '../database.js';

const ITEMS_PER_PAGE = 15;

export function getStatsMenuData() {
    const movieCount = countMovies();
    const seriesCount = countSeries();
    const userCount = countUsers();

    const message = `
📊 <b>Bot Statistikasi</b> 📊

👤 Foydalanuvchilar: ${userCount}
🎬 Kino soni: ${movieCount}
📺 Serial soni: ${seriesCount}
`;

    const buttons = [
        [{ text: '🎬 Kinolar ro‘yxati', callback_data: 'admin:list:movie:0' }], // Callback: admin:list:type:page
        [{ text: '📺 Seriallar ro‘yxati', callback_data: 'admin:list:series:0' }] // Callback: admin:list:type:page
    ];

    return { message, buttons };
}

export function createListMenuData(type, page) {
    let items;
    let totalPages;
    let title;

    if (type === 'movie') {
        items = getPaginatedMovies(page);
        totalPages = getTotalMoviePages();
        title = '🎬 Kinolar Ro‘yxati';
    } else if (type === 'series') {
        items = getPaginatedSeries(page);
        totalPages = getTotalSeriesPages();
        title = '📺 Seriallar Ro‘yxati';
    } else {
        return null;
    }

    let message = `<b>${title}</b> (Sahifa ${page + 1}/${totalPages})\n\n`;

    if (items.length === 0) {
        message += "Ro'yxat bo'sh.";
    } else {
        items.forEach(item => {
            message += `<code>${item.code}</code> | ${item.title}\n`;
        });
    }

    const buttons = [];
    const paginationRow = [];

    if (page > 0) {
        paginationRow.push({ text: '« Oldingi', callback_data: `admin:listpage:${type}:${page - 1}` });
    }

    paginationRow.push({ text: `${page + 1}/${totalPages}`, callback_data: `ignore` });

    if (page < totalPages - 1) {
        paginationRow.push({ text: 'Keyingi »', callback_data: `admin:listpage:${type}:${page + 1}` });
    }

    if (paginationRow.length > 0) {
        buttons.push(paginationRow);
    }

    buttons.push([{ text: '🔙 Statistika', callback_data: 'admin:show_stats' }]);

    return { message, buttons };
}