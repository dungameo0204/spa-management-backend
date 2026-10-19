const createRateLimiter = ({ windowMs, max, message }) => {
    const attempts = new Map();

    return (req, res, next) => {
        const now = Date.now();
        const forwardedIp = req.get('cf-connecting-ip');
        const key = forwardedIp || req.ip || req.socket.remoteAddress || 'unknown';
        const current = attempts.get(key);

        if (!current || current.resetAt <= now) {
            attempts.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        current.count += 1;
        if (current.count <= max) return next();

        const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({ message });
    };
};

module.exports = { createRateLimiter };