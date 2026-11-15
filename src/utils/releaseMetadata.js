const { execFileSync } = require('node:child_process');
const path = require('node:path');

const readGit = (repositoryPath, args) => execFileSync('git', ['-C', repositoryPath, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
}).trim();

const readReleaseMetadata = (env = process.env, repositoryPath = path.resolve(__dirname, '..', '..')) => {
    let version = env.DEPLOY_VERSION?.trim() || null;
    let commit = env.DEPLOY_COMMIT?.trim() || null;
    try {
        if (!version) version = readGit(repositoryPath, ['describe', '--exact-match', '--tags', 'HEAD']);
        if (!commit) commit = readGit(repositoryPath, ['rev-parse', 'HEAD']);
    } catch (_error) {
        // Release archives may intentionally exclude Git metadata.
    }
    return { version: version || 'unknown', commit: commit || 'unknown' };
};

module.exports = { readReleaseMetadata };