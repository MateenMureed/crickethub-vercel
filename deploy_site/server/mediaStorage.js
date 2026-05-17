const fs = require('fs');
const path = require('path');
const { APP_DATA_ROOT, REPO_ROOT, IS_AZURE } = require('./runtimePaths');

let BlobServiceClient = null;
try {
  ({ BlobServiceClient } = require('@azure/storage-blob'));
} catch {
  BlobServiceClient = null;
}

const LOCAL_ROOT = process.env.APP_MEDIA_ROOT || (IS_AZURE ? APP_DATA_ROOT : REPO_ROOT);
const LOCAL_UPLOADS_DIR = path.join(LOCAL_ROOT, 'uploads');
const LOCAL_MEDIA_DIR = path.join(LOCAL_ROOT, 'media');
const FALLBACK_MEDIA_DIR = LOCAL_ROOT === REPO_ROOT ? null : path.join(REPO_ROOT, 'media');

const AZURE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
const AZURE_CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || 'crickethub-media';
const FORCE_CLOUD = String(process.env.MEDIA_STORAGE_MODE || '').toLowerCase() === 'azure';
const USE_AZURE = !!(BlobServiceClient && AZURE_CONNECTION_STRING && (FORCE_CLOUD || true));

let containerClient = null;

function normalizeRelativePath(relativePath) {
  const cleaned = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..')) {
    throw new Error('Invalid storage path');
  }
  return cleaned;
}

function contentTypeFromName(fileName, fallback) {
  if (fallback) return fallback;
  const ext = path.extname(fileName).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  };
  return map[ext] || 'application/octet-stream';
}

function ensureLocalParent(relativePath) {
  const absPath = path.join(LOCAL_ROOT, normalizeRelativePath(relativePath));
  const parent = path.dirname(absPath);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  return absPath;
}

function randomToken() {
  return Math.random().toString(36).slice(2, 11);
}

function safeBaseName(originalName, fallbackBaseName = 'file') {
  const raw = path.basename(String(originalName || fallbackBaseName));
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_') || `${fallbackBaseName}.bin`;
}

function extensionFromMime(mime) {
  const byMime = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return byMime[String(mime || '').toLowerCase()] || '.png';
}

async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function init() {
  if (!USE_AZURE) {
    try {
      if (!fs.existsSync(LOCAL_UPLOADS_DIR)) fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true });
      if (!fs.existsSync(LOCAL_MEDIA_DIR)) fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
    } catch (error) {
      console.error('Local media storage init failed:', error.message);
    }
    return;
  }

  const blobService = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING);
  containerClient = blobService.getContainerClient(AZURE_CONTAINER_NAME);
  await containerClient.createIfNotExists();
}

async function writeBufferToPath(relativePath, buffer, contentType) {
  const normalized = normalizeRelativePath(relativePath);
  const finalContentType = contentTypeFromName(normalized, contentType);

  if (USE_AZURE) {
    const blob = containerClient.getBlockBlobClient(normalized);
    await blob.uploadData(buffer, {
      blobHTTPHeaders: {
        blobContentType: finalContentType,
      },
    });
    return `/${normalized}`;
  }

  const absPath = ensureLocalParent(normalized);
  fs.writeFileSync(absPath, buffer);
  return `/${normalized}`;
}

async function writeDataUrlToPath(relativePath, dataUrl) {
  const match = String(dataUrl || '').match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data');
  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  return writeBufferToPath(relativePath, buffer, mimeType);
}

async function saveMulterFile(file, relativeDir = 'uploads', fallbackBaseName = 'file') {
  if (!file?.buffer) return null;
  const originalName = safeBaseName(file.originalname || fallbackBaseName, fallbackBaseName);
  const ext = path.extname(originalName) || extensionFromMime(file.mimetype);
  const stem = path.basename(originalName, path.extname(originalName));
  const finalName = `${Date.now()}-${randomToken()}-${stem}${ext}`;
  const relativePath = path.posix.join(relativeDir, finalName);
  return writeBufferToPath(relativePath, file.buffer, file.mimetype);
}

async function saveDataUrl(dataUrl, relativeDir = 'uploads', originalName = 'image.png') {
  const match = String(dataUrl || '').match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = match[1];
  const ext = path.extname(originalName) || extensionFromMime(mimeType);
  const stem = path.basename(safeBaseName(originalName, 'image'), path.extname(originalName));
  const finalName = `${Date.now()}-${randomToken()}-${stem}${ext}`;
  const relativePath = path.posix.join(relativeDir, finalName);
  return writeDataUrlToPath(relativePath, dataUrl);
}

async function readAsset(relativePath) {
  const normalized = normalizeRelativePath(relativePath);

  if (USE_AZURE) {
    const blob = containerClient.getBlobClient(normalized);
    const exists = await blob.exists();
    if (!exists) return null;

    const downloaded = await blob.download();
    const buffer = await streamToBuffer(downloaded.readableStreamBody);
    return {
      buffer,
      contentType: downloaded.contentType || contentTypeFromName(normalized),
    };
  }

  const absPath = path.join(LOCAL_ROOT, normalized);
  if (fs.existsSync(absPath)) {
    return {
      buffer: fs.readFileSync(absPath),
      contentType: contentTypeFromName(absPath),
    };
  }

  if (FALLBACK_MEDIA_DIR) {
    const fallbackPath = path.join(REPO_ROOT, normalized);
    if (fs.existsSync(fallbackPath)) {
      return {
        buffer: fs.readFileSync(fallbackPath),
        contentType: contentTypeFromName(fallbackPath),
      };
    }
  }

  return null;
}

function isCloudEnabled() {
  return USE_AZURE;
}

module.exports = {
  init,
  readAsset,
  saveDataUrl,
  saveMulterFile,
  writeBufferToPath,
  writeDataUrlToPath,
  isCloudEnabled,
  getLocalUploadsDir: () => LOCAL_UPLOADS_DIR,
  getLocalMediaDir: () => LOCAL_MEDIA_DIR,
  getFallbackMediaDir: () => FALLBACK_MEDIA_DIR,
};
