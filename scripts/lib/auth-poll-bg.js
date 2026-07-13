'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { PASSPORT_BUNDLED } = require('../passport');
const { isAuthRunId } = require('./auth-run');

const CURRENT_BASENAME = 'auth-poll-current.json';
const LEGACY_STATE_BASENAME = 'auth-poll-state.json';
const RUN_STATE_PATTERN = /^auth-poll-state-([0-9a-f]{12})\.json$/;
const STALE_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function jinguyuanDir(homeDir) {
  return path.join(homeDir, '.jinguyuan');
}

function statePath(homeDir) {
  return path.join(jinguyuanDir(homeDir), LEGACY_STATE_BASENAME);
}

function currentPath(homeDir) {
  return path.join(jinguyuanDir(homeDir), CURRENT_BASENAME);
}

function runStatePath(homeDir, authRunId) {
  if (!isAuthRunId(authRunId)) {
    throw new TypeError('authRunId must be 12 lowercase hex characters');
  }
  return path.join(jinguyuanDir(homeDir), `auth-poll-state-${authRunId}.json`);
}

function ensureJinguyuanDir(homeDir) {
  const dir = jinguyuanDir(homeDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // best-effort
    }
  }
  return dir;
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const payload = { ...value, updatedAt: new Date().toISOString() };
  fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  return payload;
}

function writeRunState(homeDir, authRunId, state) {
  ensureJinguyuanDir(homeDir);
  return writeJsonAtomic(runStatePath(homeDir, authRunId), { ...state, authRunId });
}

function writeCurrentRun(homeDir, authRunId) {
  if (!isAuthRunId(authRunId)) {
    throw new TypeError('authRunId must be 12 lowercase hex characters');
  }
  ensureJinguyuanDir(homeDir);
  return writeJsonAtomic(currentPath(homeDir), { authRunId });
}

function readRunState(homeDir, authRunId) {
  if (!isAuthRunId(authRunId)) return null;
  const state = readJson(runStatePath(homeDir, authRunId));
  return state?.authRunId === authRunId ? state : null;
}

function readState(homeDir) {
  const pointerFile = currentPath(homeDir);
  if (fs.existsSync(pointerFile)) {
    const pointer = readJson(pointerFile);
    if (!isAuthRunId(pointer?.authRunId)) return null;
    return readRunState(homeDir, pointer.authRunId);
  }
  return readJson(statePath(homeDir));
}

function clearState(homeDir) {
  const pointer = readJson(currentPath(homeDir));
  const files = [currentPath(homeDir), statePath(homeDir)];
  if (isAuthRunId(pointer?.authRunId)) files.push(runStatePath(homeDir, pointer.authRunId));
  for (const file of files) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function cleanupStaleRunStates(homeDir, { nowMs = Date.now() } = {}) {
  const dir = ensureJinguyuanDir(homeDir);
  const current = readJson(currentPath(homeDir));
  const currentRunId = isAuthRunId(current?.authRunId) ? current.authRunId : null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const match = RUN_STATE_PATTERN.exec(entry.name);
    if (!entry.isFile() || !match || match[1] === currentRunId) continue;
    const file = path.join(dir, entry.name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && nowMs - stat.mtimeMs > STALE_RUN_MAX_AGE_MS) {
        fs.unlinkSync(file);
      }
    } catch {
      // Stale cleanup must never block a new authorization.
    }
  }
}

function startBackgroundPoll({
  homeDir,
  authRunId,
  qrImagePath = null,
  execPath = process.execPath,
  scriptPath,
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  if (typeof scriptPath !== 'string' || !scriptPath) {
    throw new TypeError('scriptPath is required');
  }
  if (!isAuthRunId(authRunId)) {
    throw new TypeError('authRunId must be 12 lowercase hex characters');
  }

  cleanupStaleRunStates(homeDir);
  writeRunState(homeDir, authRunId, {
    status: 'pending',
    code: 'AUTH_PENDING',
    message: '后台等待美团授权确认中。请先向用户展示授权链接与二维码图，再用 auth-status 查询。',
    qrImagePath: typeof qrImagePath === 'string' ? qrImagePath : null,
    startedAt: new Date().toISOString(),
    pid: null,
  });
  writeCurrentRun(homeDir, authRunId);

  const args = [scriptPath, 'auth-poll-worker', '--auth-run-id', authRunId];
  if (typeof qrImagePath === 'string' && qrImagePath) {
    args.push('--qr-image-path', qrImagePath);
  }

  const existingNodePath = typeof env.NODE_PATH === 'string' ? env.NODE_PATH : '';
  const nodePathParts = existingNodePath ? existingNodePath.split(path.delimiter) : [];
  if (!nodePathParts.includes(PASSPORT_BUNDLED)) nodePathParts.unshift(PASSPORT_BUNDLED);
  const workerEnv = { ...env, NODE_PATH: nodePathParts.join(path.delimiter) };

  const child = spawnImpl(execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: workerEnv,
    windowsHide: true,
  });
  if (typeof child.unref === 'function') child.unref();

  return {
    pid: child.pid ?? null,
    statePath: runStatePath(homeDir, authRunId),
    authRunId,
  };
}

function recordPollResult(homeDir, result, { authRunId, qrImagePath = null } = {}) {
  if (!isAuthRunId(authRunId)) {
    throw new TypeError('authRunId must be 12 lowercase hex characters');
  }
  const code = result?.code || 'PASSPORT_FAILED';
  const ok = Boolean(result?.ok);
  let status = 'failed';
  if (code === 'AUTH_SUCCESS') status = 'success';
  else if (code === 'AUTH_PENDING' || code === 'PASSPORT_PENDING') status = 'pending';
  else if (code === 'AUTH_CANCELLED' || code === 'PASSPORT_CANCELLED') status = 'cancelled';
  else if (code === 'AUTH_TIMEOUT' || code === 'PASSPORT_TIMEOUT') status = 'timeout';
  else if (code === 'AUTH_RISK_DENIED' || code === 'PASSPORT_RISK_DENIED') status = 'risk';
  else if (code === 'QR_CLEANUP_FAILED') status = ok ? 'success' : 'failed';

  const prior = readRunState(homeDir, authRunId);
  return writeRunState(homeDir, authRunId, {
    status,
    code,
    message: result?.message || '',
    ok,
    qrImagePath:
      (typeof result?.data?.qrImagePath === 'string' && result.data.qrImagePath) ||
      qrImagePath ||
      prior?.qrImagePath ||
      null,
    startedAt: prior?.startedAt,
    finishedAt: status === 'pending' ? undefined : new Date().toISOString(),
  });
}

module.exports = {
  CURRENT_BASENAME,
  LEGACY_STATE_BASENAME,
  RUN_STATE_PATTERN,
  STALE_RUN_MAX_AGE_MS,
  statePath,
  currentPath,
  runStatePath,
  readState,
  readRunState,
  clearState,
  cleanupStaleRunStates,
  startBackgroundPoll,
  recordPollResult,
};
