
const config = {
    BOT_TOKEN: process.env.BOT_TOKEN,

    ADMINS: process.env.ADMINS ? process.env.ADMINS.split(',').map(id => Number(id.trim())) : [7567330249, 6359606238],

    ENV: process.env.NODE_ENV || 'development',
};

export default config;