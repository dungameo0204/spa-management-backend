const getVersion = (release, startedAt) => (_req, res) => res.status(200).json({
    message: 'Lấy phiên bản máy chủ thành công',
    data: { ...release, startedAt }
});

module.exports = { getVersion };