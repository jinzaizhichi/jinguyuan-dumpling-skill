'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const Module = require('node:module');

// ClawHub strips any directory named node_modules; vendor lives under bundled_modules.
// Seed NODE_PATH so qrcode can resolve pngjs / dijkstrajs by package name.
const QR_BUNDLED = path.resolve(__dirname, 'vendor/bundled_modules');
process.env.NODE_PATH = [QR_BUNDLED, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const qrcode = require('./vendor/bundled_modules/qrcode');

/** Flat file in workspace root — Agent-friendly, one path segment deep. */
const QR_FILE_NAME = '.jinguyuan-auth-qr.png';
const QR_FILE_PATTERN = /^\.jinguyuan-auth-qr\.png$/;

function isMissing(error) {
  return error.code === 'ENOENT';
}

/**
 * Default directory that owns the QR file: the session workspace (cwd).
 * File itself: <workspace>/.jinguyuan-auth-qr.png
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
 * Create (or overwrite) the workspace-root QR PNG.
 * `clientId` kept for call-site compatibility; path is fixed and flat.
 */
async function createAuthQr(authLink, { tmpDir, clientId: _clientId }) {
  const root = path.resolve(tmpDir);
  const imagePath = path.join(root, QR_FILE_NAME);
  const stagingPath = path.join(
    root,
    `.jinguyuan-auth-qr.${crypto.randomUUID()}.tmp`,
  );

  try {
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
  QR_FILE_NAME,
};
