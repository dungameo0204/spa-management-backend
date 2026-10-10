const parsePagination = ({ page = '1', pageSize = '20' } = {}) => {
    const valid = value => (typeof value === 'string' || typeof value === 'number') && /^(?:[1-9]\d*)$/.test(String(value)) && Number.isSafeInteger(Number(value));
    if (!valid(page) || !valid(pageSize) || Number(pageSize) > 100 || !Number.isSafeInteger((Number(page) - 1) * Number(pageSize))) {
        const error = new Error('page phải là số nguyên >= 1; pageSize phải là số nguyên từ 1 đến 100.');
        error.status = 400;
        throw error;
    }
    return { page: Number(page), pageSize: Number(pageSize), offset: (Number(page) - 1) * Number(pageSize) };
};

const respondListError = (res, error) => res.status(error.status === 400 ? 400 : 500).json({ message: error.message });

// baseQuery excludes ORDER BY so the count sees exactly the same filters/joins/permissions.
const paginateQuery = async (pool, baseQuery, params, orderBy, pagination) => {
    const { page, pageSize, offset } = parsePagination(pagination);
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM (${baseQuery}) AS page_count`, params);
    const total = Number(countRows[0].total);
    const [data] = await pool.query(`${baseQuery} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
    return { total, page, pageSize, totalPages: Math.ceil(total / pageSize), data };
};

module.exports = { parsePagination, paginateQuery, respondListError };