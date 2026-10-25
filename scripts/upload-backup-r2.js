// Native S3 SigV4 uploader for Cloudflare R2 (Zero external dependencies)
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

const uploadToR2 = async ({ endpoint, accessKeyId, secretAccessKey, bucket, key, buffer, contentType = 'application/octet-stream' }) => {
    const url = new URL(endpoint);
    const host = `${bucket}.${url.host}`;
    const payloadHash = sha256(buffer);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const region = 'auto';
    const service = 's3';

    const canonicalUri = '/' + key.split('/').map(encodeURIComponent).join('/');
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
        'PUT',
        canonicalUri,
        '', // canonical query string
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

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: host,
            port: 443,
            path: canonicalUri,
            method: 'PUT',
            headers: {
                'Host': host,
                'Content-Type': contentType,
                'Content-Length': buffer.length,
                'x-amz-date': amzDate,
                'x-amz-content-sha256': payloadHash,
                'Authorization': authorizationHeader
            }
        }, (res) => {
            let resBody = '';
            res.on('data', chunk => { resBody += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ statusCode: res.statusCode, etag: res.headers.etag });
                } else {
                    reject(new Error(`R2 upload failed (${res.statusCode}): ${resBody}`));
                }
            });
        });

        req.on('error', reject);
        req.write(buffer);
        req.end();
    });
};

const main = async () => {
    const options = parseArgs();
    const configPath = options.config || path.resolve(__dirname, '../config/r2-backup.json');

    if (!fs.existsSync(configPath)) {
        throw new Error(`R2 config file not found: ${configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
    await uploadToR2({
        endpoint: config.endpoint,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        bucket: config.bucket,
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
        await uploadToR2({
            endpoint: config.endpoint,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            bucket: config.bucket,
            key: manifestKey,
            buffer: manifestBuf,
            contentType: 'application/json'
        });
        console.log(`[R2 Backup] Uploaded manifest successfully.`);
    }

    console.log(`[R2 Backup] Finished successfully for stamp: ${stamp}`);
};

main().catch(err => {
    console.error(`[R2 Backup Error]: ${err.message}`);
    process.exit(1);
});
