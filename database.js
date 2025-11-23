import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from './config.js';
const dbPath = path.resolve('./data/sqlite.db');

if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.closeSync(fs.openSync(dbPath, 'w'));
    console.log('Database yaratildi: ', dbPath);
}

const db = new Database(dbPath);

export function initDB() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY NOT NULL,
            username TEXT,
            first_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS movies (
                                              id INTEGER PRIMARY KEY AUTOINCREMENT,
                                              code INTEGER UNIQUE NOT NULL,
                                              title TEXT NOT NULL,
                                              desc TEXT,
                                              genre TEXT,
                                              year INTEGER,
                                              link TEXT,
                                              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS series (
                                              id INTEGER PRIMARY KEY AUTOINCREMENT,
                                              code INTEGER UNIQUE NOT NULL,
                                              title TEXT NOT NULL,
                                              desc TEXT,
                                              genre TEXT,
                                              year INTEGER,
                                              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS series_episodes (
                                                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                       series_code INTEGER NOT NULL,
                                                       episode INTEGER NOT NULL,
                                                       link TEXT NOT NULL,
                                                       UNIQUE(series_code, episode)
            )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS channels (
                                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                                channel_id TEXT UNIQUE NOT NULL,
                                                name TEXT,
                                                link TEXT
        )
    `).run();

    console.log('All tables created / initialized.');
}

export function addUser(userId, username, firstName) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO users (user_id, username, first_name) VALUES (?, ?, ?)
    `);
    return stmt.run(Number(userId), username, firstName);
}

export function checkUserExists(userId) {
    const stmt = db.prepare('SELECT user_id FROM users WHERE user_id = ?');
    return !!stmt.get(Number(userId));
}

export function getAllUserIds() {
    const stmt = db.prepare('SELECT user_id FROM users');
    return stmt.all().map(row => Number(row.user_id));
}

export function countUsers() {
    return db.prepare('SELECT COUNT(*) as count FROM users').get().count;
}

export function addMovie(movie) {
    const stmt = db.prepare(`
        INSERT INTO movies (code, title, desc, genre, year, link)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(Number(movie.code), movie.title, movie.desc, movie.genre, Number(movie.year), movie.link);
}

export function getMovieByCode(code) {
    const stmt = db.prepare(`SELECT * FROM movies WHERE code = ?`);
    return stmt.get(Number(code));
}

export function getAllMovies() {
    return db.prepare(`SELECT * FROM movies`).all();
}

export function updateMovie(code, fields) {
    const { title, desc, genre, year, link } = fields;
    const stmt = db.prepare(`
        UPDATE movies SET title = ?, desc = ?, genre = ?, year = ?, link = ?
        WHERE code = ?
    `);
    return stmt.run(title, desc, genre, Number(year), link, Number(code));
}

export function deleteMovie(code) {
    return db.prepare(`DELETE FROM movies WHERE code = ?`).run(Number(code));
}

export function addSeries(series) {
    const stmt = db.prepare(`
        INSERT INTO series (code, title, desc, genre, year)
        VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(Number(series.code), series.title, series.desc, series.genre, Number(series.year));
}

export function getSeriesByCode(code) {
    const stmt = db.prepare(`SELECT * FROM series WHERE code = ?`);
    return stmt.get(Number(code));
}

export function deleteSeries(code) {
    db.prepare(`DELETE FROM series_episodes WHERE series_code = ?`).run(Number(code));
    return db.prepare(`DELETE FROM series WHERE code = ?`).run(Number(code));
}

export function updateSeries(code, fields) {
    const { title, desc, genre, year } = fields;
    const stmt = db.prepare(`
        UPDATE series SET title = ?, desc = ?, genre = ?, year = ?
        WHERE code = ?
    `);
    return stmt.run(title, desc, genre, Number(year), Number(code));
}

export function deleteSeriesEpisode(series_code, episode) {
    return db.prepare(`DELETE FROM series_episodes WHERE series_code = ? AND episode = ?`).run(Number(series_code), Number(episode));
}

export function countMovies() {
    return db.prepare('SELECT COUNT(*) as count FROM movies').get().count;
}

export function countSeries() {
    return db.prepare('SELECT COUNT(*) as count FROM series').get().count;
}

export function addSeriesEpisode(series_code, episode, link) {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO series_episodes (series_code, episode, link)
        VALUES (?, ?, ?)
    `);
    return stmt.run(Number(series_code), Number(episode), link);
}

export function getSeriesEpisodes(series_code) {
    return db.prepare(`
        SELECT * FROM series_episodes WHERE series_code = ? ORDER BY episode ASC
    `).all(Number(series_code));
}

export function addChannel(channel) {
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO channels (channel_id, name, link) VALUES (?, ?, ?)
    `);
    return stmt.run(channel.channel_id, channel.name, channel.link);
}

export function getChannels() {
    return db.prepare(`SELECT * FROM channels`).all();
}

export function deleteChannel(channel_id) {
    return db.prepare(`DELETE FROM channels WHERE channel_id = ?`).run(channel_id);
}

export function isAdmin(user_id) {
    return config.ADMINS.includes(Number(user_id));
}


const ITEMS_PER_PAGE = 15; // Bir sahifadagi elementlar soni

export function getPaginatedMovies(page = 0) {
    const offset = page * ITEMS_PER_PAGE;
    return db.prepare(`
        SELECT code, title FROM movies ORDER BY code DESC LIMIT ? OFFSET ?
    `).all(ITEMS_PER_PAGE, offset);
}

export function getTotalMoviePages() {
    const totalItems = countMovies();
    return Math.ceil(totalItems / ITEMS_PER_PAGE);
}

export function getPaginatedSeries(page = 0) {
    const offset = page * ITEMS_PER_PAGE;
    return db.prepare(`
        SELECT code, title FROM series ORDER BY code DESC LIMIT ? OFFSET ?
    `).all(ITEMS_PER_PAGE, offset);
}

export function getTotalSeriesPages() {
    const totalItems = countSeries();
    return Math.ceil(totalItems / ITEMS_PER_PAGE);
}

export default db;