/**
 * Storage abstraction — S3-compatible (AWS S3, Cloudflare R2, MinIO).
 * Falls back to local filesystem if no S3 config is present.
 *
 * Tenant-scoped keys: `${orgId}/${simulationId}/${agentRunId}/${kind}_${stepIdx}.{ext}`
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let S3Client = null, PutObjectCommand = null, GetObjectCommand = null, getSignedUrl = null;
try {
  ({ S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'));
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
} catch (e) { /* SDK not installed; fallback only */ }

const S3_ENABLED = !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && S3Client);

const LOCAL_ROOT = path.join(__dirname, '..', 'data', 'evidence');
if (!S3_ENABLED) {
  if (!fs.existsSync(LOCAL_ROOT)) fs.mkdirSync(LOCAL_ROOT, { recursive: true });
}

let s3 = null;
function getClient() {
  if (!S3_ENABLED) return null;
  if (s3) return s3;
  s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!process.env.S3_FORCE_PATH_STYLE,
  });
  return s3;
}

function buildKey({ orgId, simulationId, agentRunId, kind, stepIndex, ext }) {
  const step = stepIndex != null ? `_${String(stepIndex).padStart(3, '0')}` : '';
  const id = crypto.randomBytes(4).toString('hex');
  return `${orgId}/${simulationId}/${agentRunId}/${kind}${step}_${id}.${ext}`;
}

async function putObject({ key, body, contentType }) {
  if (S3_ENABLED) {
    const client = getClient();
    await client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
    return { storage: 's3', key, size: Buffer.isBuffer(body) ? body.length : body.length };
  }
  // Local fallback
  const full = path.join(LOCAL_ROOT, key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return { storage: 'local', key, size: Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body) };
}

async function getObject(key) {
  if (S3_ENABLED) {
    const client = getClient();
    const res = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    // res.Body is a readable stream; caller handles
    return res.Body;
  }
  const full = path.join(LOCAL_ROOT, key);
  return fs.createReadStream(full);
}

async function getPresignedUrl(key, { expiresIn = 3600 } = {}) {
  if (S3_ENABLED) {
    const client = getClient();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn });
  }
  // For local mode, serve via our own signed-ish endpoint (token baked into URL)
  const token = crypto.createHmac('sha256', process.env.STORAGE_SIGN_KEY || 'dev-key').update(key).digest('hex').substring(0, 16);
  return `/api/evidence/local?key=${encodeURIComponent(key)}&t=${token}`;
}

function verifyLocalSignature(key, token) {
  const expected = crypto.createHmac('sha256', process.env.STORAGE_SIGN_KEY || 'dev-key').update(key).digest('hex').substring(0, 16);
  return expected === token;
}

function localPath(key) {
  return path.join(LOCAL_ROOT, key);
}

module.exports = {
  S3_ENABLED,
  buildKey,
  putObject,
  getObject,
  getPresignedUrl,
  verifyLocalSignature,
  localPath,
};
