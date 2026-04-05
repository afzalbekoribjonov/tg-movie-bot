import dotenv from 'dotenv';

dotenv.config();

const config = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    MONGODB_URI: process.env.MONGODB_URI,
    ADMINS: process.env.ADMINS
        ? process.env.ADMINS.split(',').map(id => Number(id.trim()))
        : [],
};

if (!config.BOT_TOKEN) {
    console.error("XATO: BOT_TOKEN topilmadi.");
    process.exit(1);
}

if (!config.MONGODB_URI) {
    console.warn("OGOHLANTIRISH: MONGODB_URI topilmadi. Bot vaqtincha kutish xabari bilan ishga tushadi.");
}

export default config;