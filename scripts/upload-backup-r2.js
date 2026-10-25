// Native S3 SigV4 uploader & retention manager for Cloudflare R2 (Zero external dependencies)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const https = require('node:https');

const parseArgs = () => {
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].substring(2);
            options[key] = args[++i];
        }
    }
    return options;
};

const hmac = (key, string, encoding) => {
    return crypto.createHmac('sha256', key).update(string).digest(encoding);
};

const sha256 = (buffer) => {
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

const r2Request = async ({ endpoint, accessKeyId, secretAccessKey, bucket, method = 'GET', key = '', query = {}, buffer = null, contentType = '' }) => {
    const url = new URL(endpoint);
    const host = `${bucket}.${url.host}`;
    const payloadBuffer = buffer || Buffer.alloc(0);
    const payloadHash = sha256(payloadBuffer);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const region = 'auto';
    const service = 's3';

    const canonicalUri = '/' + key.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    
    // Sort query keys
    const sortedQueryKeys = Object.keys(query).sort();
    const canonicalQueryString = sortedQueryKeys
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
        .join('&');

    let canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    let signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    if (contentType) {
        canonicalHeaders = `content-type:${contentType}\n` + canonicalHeaders;
        signedHeaders = 'content-type;' + signedHeaders;
    }

    const canonicalRequest = [
        method,
        canonicalUri || '/',
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256(Buffer.from(canonicalRequest, 'utf8'))
    ].join('\n');

    const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = hmac(kSigning, stringToSign, 'hex');

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers = {
        'Host': host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        'Authorization': authorizationHeader
    };

    if (contentType) headers['Content-Type'] = contentType;
    if (buffer) headers['Content-Length'] = buffer.length;

    const requestPath = canonicalUri + (canonicalQueryString ? `?${canonicalQueryString}` : '');

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: host,
            port: 443,
            path: requestPath || '/',
            method: method,
            headers: headers
        }, (res) => {
            let resBody = '';
            res.on('data', chunk => { resBody += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ statusCode: res.statusCode, headers: res.headers, body: resBody });
                } else {
                    reject(new Error(`R2 ${method} failed (${res.statusCode}): ${resBody}`));
                }
            });
        });

        req.on('error', reject);
        if (buffer) req.write(buffer);
        req.end();
    });
};

const listObjects = async (r2Config, prefix = 'backups/') => {
    const res = await r2Request({
        ...r2Config,
        method: 'GET',
        key: '',
        query: { 'list-type': '2', 'prefix': prefix }
    });
    const keys = [];
    for (const match of res.body.matchAll(/<Key>(.*?)<\/Key>/g)) {
        keys.push(match[1]);
    }
    return keys;
};

const deleteObject = async (r2Config, key) => {
    return r2Request({
        ...r2Config,
        method: 'DELETE',
        key: key
    });
};

// Grandfather-Father-Son retention logic:
// Keep 7 daily backups (most recent 7 days) + 4 weekly Monday backups (most recent 4 Mondays)
const determineKeptStamps = (allStamps) => {
    const stampObjects = allStamps.map(s => {
        // format: YYYY-MM-DD_HHmmss
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})$/);
        if (!m) return null;
        const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
        return { stamp: s, date, dayOfWeek: date.getUTCDay() }; // 1 is Monday
    }).filter(Boolean);

    // Sort descending (newest first)
    stampObjects.sort((a, b) => b.date.getTime() - a.date.getTime());

    const kept = new Set();

    // 1. Giữ 7 bản gần nhất (Daily 7 ngày)
    for (let i = 0; i < Math.min(7, stampObjects.length); i++) {
        kept.add(stampObjects[i].stamp);
    }

    // 2. Giữ thêm 4 bản của các ngày Thứ 2 gần nhất (Weekly 4 tuần)
    let mondaysCount = 0;
    for (const item of stampObjects) {
        if (item.dayOfWeek === 1) { // Monday
            kept.add(item.stamp);
            mondaysCount++;
            if (mondaysCount >= 4) break;
        }
    }

    return kept;
};

const applyRetention = async (r2Config) => {
    console.log('[R2 Retention] Checking backups against retention policy (Keep 7 daily + 4 weekly Mondays)...');
    const allKeys = await listObjects(r2Config, 'backups/');
    const stampMap = new Map(); // stamp -> [keys]

    for (const key of allKeys) {
        const m = key.match(/^backups\/([^\/]+)\//);
        if (m) {
            const stamp = m[1];
            if (!stampMap.has(stamp)) stampMap.set(stamp, []);
            stampMap.get(stamp).push(key);
        }
    }

    const allStamps = Array.from(stampMap.keys());
    const keptStamps = determineKeptStamps(allStamps);

    console.log(`[R2 Retention] Total backup stamps on R2: ${allStamps.length}. Keeping ${keptStamps.size} stamps.`);

    for (const stamp of allStamps) {
        if (!keptStamps.has(stamp)) {
            console.log(`[R2 Retention] Expired backup stamp found: ${stamp}. Deleting from R2...`);
            const keysToDelete = stampMap.get(stamp) || [];
            for (const k of keysToDelete) {
                await deleteObject(r2Config, k);
                console.log(`[R2 Retention] Deleted: ${k}`);
            }
        }
    }
};

const main = async () => {
    const options = parseArgs();
    const configPath = options.config || path.resolve(__dirname, '../config/r2-backup.json');

    if (!fs.existsSync(configPath)) {
        throw new Error(`R2 config file not found: ${configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    const dumpPath = options.dump;
    if (!dumpPath || !fs.existsSync(dumpPath)) {
        throw new Error(`Dump file not found: ${dumpPath}`);
    }

    const stamp = options.stamp || path.basename(path.dirname(dumpPath));
    const backupDir = path.dirname(dumpPath);
    console.log(`[R2 Backup] Processing backup stamp: ${stamp}`);

    // 1. Gzip nén file dump .sql
    const gzPath = `${dumpPath}.gz`;
    console.log(`[R2 Backup] Compressing ${path.basename(dumpPath)} to gzip...`);
    const rawSql = fs.readFileSync(dumpPath);
    const gzippedSql = zlib.gzipSync(rawSql, { level: 9 });
    fs.writeFileSync(gzPath, gzippedSql);
    const origSizeMb = (rawSql.length / (1024 * 1024)).toFixed(2);
    const gzSizeMb = (gzippedSql.length / (1024 * 1024)).toFixed(2);
    console.log(`[R2 Backup] Compressed: ${origSizeMb} MB -> ${gzSizeMb} MB`);

    // 2. Upload file nén .sql.gz lên R2
    const s3Key = `backups/${stamp}/spa-databases.sql.gz`;
    console.log(`[R2 Backup] Uploading to R2: ${config.bucket}/${s3Key}...`);
    await r2Request({
        ...config,
        method: 'PUT',
        key: s3Key,
        buffer: gzippedSql,
        contentType: 'application/gzip'
    });
    console.log(`[R2 Backup] Uploaded dump successfully.`);

    // 3. Upload file manifest.json nếu có
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        const manifestBuf = fs.readFileSync(manifestPath);
        const manifestKey = `backups/${stamp}/manifest.json`;
        console.log(`[R2 Backup] Uploading manifest: ${config.bucket}/${manifestKey}...`);
        await r2Request({
            ...config,
            method: 'PUT',
            key: manifestKey,
            buffer: manifestBuf,
            contentType: 'application/json'
        });
        console.log(`[R2 Backup] Uploaded manifest successfully.`);
    }

    // 4. Áp dụng chính sách Retention (Xóa bản cũ tự động)
    try {
        await applyRetention(config);
    } catch (retentionErr) {
        console.warn(`[R2 Retention Warning]: ${retentionErr.message}`);
    }

    console.log(`[R2 Backup] Finished successfully for stamp: ${stamp}`);
};

main().catch(err => {
    console.error(`[R2 Backup Error]: ${err.message}`);
    process.exit(1);
});
