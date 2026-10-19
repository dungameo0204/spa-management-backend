const createHealthHandler = (pool) => async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        return res.status(200).json({ status: 'ok' });
    } catch (_error) {
        return res.status(503).json({ status: 'unavailable' });
    }
};

module.exports = { createHealthHandler };