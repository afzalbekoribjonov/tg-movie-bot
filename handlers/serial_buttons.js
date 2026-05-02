export const EPISODES_PER_PAGE = 10;

export function createSerialButtons(code, episodes, page = 0) {
    const buttons = [];
    const startIndex = page * EPISODES_PER_PAGE;
    const endIndex = Math.min(startIndex + EPISODES_PER_PAGE, episodes.length);

    let episodeRow = [];
    for (let i = startIndex; i < endIndex; i++) {
        const episodeNumber = i + 1;
        episodeRow.push({ text: `${episodeNumber}-qism`, callback_data: `sendEp:${code}:${i}` });

        if (episodeRow.length === 5) {
            buttons.push(episodeRow);
            episodeRow = [];
        }
    }

    if (episodeRow.length > 0) {
        buttons.push(episodeRow);
    }

    const paginationRow = [];
    const totalPages = Math.ceil(episodes.length / EPISODES_PER_PAGE);

    if (page > 0) {
        paginationRow.push({ text: '« Oldingi 10', callback_data: `pageEp:${code}:${page - 1}` });
    }

    if (totalPages > 1) {
        paginationRow.push({ text: `${page + 1}/${totalPages}`, callback_data: 'ignore' });
    }

    if (page < totalPages - 1) {
        paginationRow.push({ text: 'Keyingi 10 »', callback_data: `pageEp:${code}:${page + 1}` });
    }

    if (paginationRow.length > 0) {
        buttons.push(paginationRow);
    }

    return buttons;
}
