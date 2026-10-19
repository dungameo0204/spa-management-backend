const getServerConfig = (env = process.env) => {
    const production = env.NODE_ENV === 'production';
    const port = Number(env.PORT || 5000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT phải là số nguyên từ 1 đến 65535.');
    const host = production ? '127.0.0.1' : (env.HOST || '0.0.0.0');
    const allowedOrigins = env.CORS_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean);
    if (production) {
        for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_SYSTEM_NAME', 'JWT_SECRET']) {
            if (!env[key]?.trim()) throw new Error(`Thiếu ${key} trong môi trường production.`);
        }
        if (!allowedOrigins?.length || allowedOrigins.some(origin => !/^https:\/\/[^/\s]+$/.test(origin))) {
            throw new Error('CORS_ORIGINS phải gồm URL HTTPS frontend, ngăn cách bằng dấu phẩy.');
        }
    }
    return { port, host, allowedOrigins };
};

module.exports = { getServerConfig };