class AuthError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const respondAuthError = (res, error) => {
    if (error instanceof AuthError) {
        return res.status(error.status).json({ code: error.code, message: error.message });
    }
    console.error('[Auth Error]', error.message);
    return res.status(500).json({ code: 'AUTH_SERVICE_ERROR', message: 'Không thể xử lý xác thực lúc này. Vui lòng thử lại sau.' });
};

module.exports = { AuthError, respondAuthError };