const express = require('express');
const { verifyToken } = require('../middlewares/auth');
const { getVersion } = require('../controllers/systemController');
const { readReleaseMetadata } = require('../utils/releaseMetadata');

const router = express.Router();
const release = readReleaseMetadata();
const startedAt = new Date().toISOString();

router.use(verifyToken);
router.get('/version', getVersion(release, startedAt));

module.exports = router;