'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');

const { isAuthRunId } = require('./lib/auth-run');

// ClawHub strips any directory named node_modules; vendor lives under bundled_modules.
// Seed NODE_PATH so qrcode can resolve pngjs / dijkstrajs by package name.
const QR_BUNDLED = path.resolve(__dirname, 'vendor/bundled_modules');
process.env.NODE_PATH = [QR_BUNDLED, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const qrcode = require('./vendor/bundled_modules/qrcode');

/**
 * Flat file in workspace root — Agent-friendly, one path segment deep.
 * Not a dotfile: leading-dot names are hidden on macOS/Linux and many Agents
 * skip them in list/read/image tools.
 */
const QR_FILE_PATTERN = /^jinguyuan-auth-qr-([0-9a-f]{12})\.png$/;
const STALE_QR_MAX_AGE_MS = 30 * 60 * 1000;
const LEGACY_QR_FILE_NAMES = ['jinguyuan-auth-qr.png', '.jinguyuan-auth-qr.png'];

function isMissing(error) {
  return error.code === 'ENOENT';
}

/**
 * Default directory that owns the QR file: the session workspace (cwd).
 * File itself: <workspace>/jinguyuan-auth-qr-<authRunId>.png
 *
 * Do NOT put PNG under ~/.jinguyuan — many Agents cannot see home.
 * (Passport token / poll-state still use ~/.jinguyuan.)
 */
function defaultQrRootDir(workspaceDir = process.cwd()) {
  return path.resolve(workspaceDir);
}

/**
 * Prefer a workspace-relative path for markdown / Agent Read.
 * Falls back to absolute if image is outside workspaceDir.
 */
function toWorkspaceRelativePath(imagePath, workspaceDir = process.cwd()) {
  if (typeof imagePath !== 'string' || !imagePath) {
    return imagePath;
  }
  const resolved = path.resolve(imagePath);
  const root = path.resolve(workspaceDir);
  const rel =
    resolved === root || resolved.startsWith(root + path.sep)
      ? path.relative(root, resolved)
      : resolved;
  return rel.split(path.sep).join('/');
}

/**
 * Create a run-owned workspace-root QR PNG.
 * `clientId` stays for call-site compatibility.
 */
function qrFileName(authRunId) {
  if (!isAuthRunId(authRunId)) {
    throw new TypeError('authRunId must be 12 lowercase hex characters');
  }
  return `jinguyuan-auth-qr-${authRunId}.png`;
}

async function cleanupStaleAuthQrs(root, { nowMs = Date.now() } = {}) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries.map(async entry => {
    if (!entry.isFile() || !QR_FILE_PATTERN.test(entry.name)) return;
    const file = path.join(root, entry.name);
    try {
      const stat = await fs.lstat(file);
      if (stat.isFile() && nowMs - stat.mtimeMs > STALE_QR_MAX_AGE_MS) {
        await fs.unlink(file);
      }
    } catch {
      // Stale cleanup is best-effort and must not block a new authorization.
    }
  }));

  await Promise.all(LEGACY_QR_FILE_NAMES.map(async name => {
    const file = path.join(root, name);
    try {
      const stat = await fs.lstat(file);
      if (stat.isFile()) await fs.unlink(file);
    } catch {
      // Missing, inaccessible, or non-file legacy paths are left untouched.
    }
  }));
}

async function createAuthQr(authLink, { tmpDir, authRunId, clientId: _clientId }) {
  const root = path.resolve(tmpDir);
  const imagePath = path.join(root, qrFileName(authRunId));
  const stagingPath = path.join(
    root,
    `jinguyuan-auth-qr-${authRunId}.${crypto.randomUUID()}.tmp`,
  );

  try {
    await cleanupStaleAuthQrs(root);
    const png = await qrcode.toBuffer(authLink, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    await fs.writeFile(stagingPath, png, { mode: 0o600 });
    await fs.rename(stagingPath, imagePath);
  } catch (error) {
    try {
      await fs.unlink(stagingPath);
    } catch {
      // Preserve the creation error.
    }
    throw error;
  }

  return { imagePath };
}

function validateAuthQrPath({ imagePath, tmpDir }) {
  if (typeof imagePath !== 'string' || typeof tmpDir !== 'string') {
    throw new TypeError('imagePath and tmpDir must be strings');
  }

  const resolvedTmpDir = path.resolve(tmpDir);
  const resolvedImagePath = path.resolve(imagePath);

  if (
    path.dirname(resolvedImagePath) !== resolvedTmpDir ||
    !QR_FILE_PATTERN.test(path.basename(resolvedImagePath))
  ) {
    throw new Error('imagePath is not an owned authorization QR path');
  }

  return { imagePath: resolvedImagePath };
}

async function cleanupAuthQr(options) {
  const owned = validateAuthQrPath(options);
  try {
    // Unlink without following: lstat then unlink (symlink removes link only).
    const st = await fs.lstat(owned.imagePath);
    if (st.isSymbolicLink() || st.isFile()) {
      await fs.unlink(owned.imagePath);
    } else {
      throw new Error('owned QR path is not a regular file');
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
}

module.exports = {
  createAuthQr,
  cleanupAuthQr,
  validateAuthQrPath,
  defaultQrRootDir,
  toWorkspaceRelativePath,
  qrFileName,
  cleanupStaleAuthQrs,
  QR_FILE_PATTERN,
  STALE_QR_MAX_AGE_MS,
};
