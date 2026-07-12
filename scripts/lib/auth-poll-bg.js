'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { PASSPORT_BUNDLED } = require('../passport');

const STATE_BASENAME = 'auth-poll-state.json';

function statePath(homeDir) {
  return path.join(homeDir, '.jinguyuan', STATE_BASENAME);
}

function ensureJinguyuanDir(homeDir) {
  const dir = path.join(homeDir, '.jinguyuan');
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

function writeState(homeDir, state) {
  ensureJinguyuanDir(homeDir);
  const file = statePath(homeDir);
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  return payload;
}

function readState(homeDir) {
  try {
    const raw = fs.readFileSync(statePath(homeDir), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function clearState(homeDir) {
  try {
    fs.unlinkSync(statePath(homeDir));
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
}

/**
 * Spawn a detached worker that runs blocking Passport poll-token and writes state.
 * Returns immediately so the Agent turn is not blocked.
 */
function startBackgroundPoll({
  homeDir,
  qrImagePath = null,
  execPath = process.execPath,
  scriptPath,
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  if (typeof scriptPath !== 'string' || !scriptPath) {
    throw new TypeError('scriptPath is required');
  }

  writeState(homeDir, {
    status: 'pending',
    code: 'AUTH_PENDING',
    message: '后台等待美团授权确认中。请先向用户展示授权链接与二维码图，再用 auth-status 查询。',
    qrImagePath: typeof qrImagePath === 'string' ? qrImagePath : null,
    startedAt: new Date().toISOString(),
    pid: null,
  });

  const args = [scriptPath, 'auth-poll-worker'];
  if (typeof qrImagePath === 'string' && qrImagePath) {
    args.push('--qr-image-path', qrImagePath);
  }

  // Worker re-spawns the pt-passport CLI, which requires @sec/cliguard from
  // PASSPORT_BUNDLED via NODE_PATH. Seed it explicitly so the detached worker
  // never fails to resolve the bundled module even if process.env.NODE_PATH
  // was cleared or rewritten (e.g. by auth-qr.js's Module._initPaths()).
  const existingNodePath = typeof env.NODE_PATH === 'string' ? env.NODE_PATH : '';
  const nodePathParts = existingNodePath
    ? existingNodePath.split(path.delimiter)
    : [];
  if (!nodePathParts.includes(PASSPORT_BUNDLED)) {
    nodePathParts.unshift(PASSPORT_BUNDLED);
  }
  const workerEnv = {
    ...env,
    NODE_PATH: nodePathParts.join(path.delimiter),
  };

  const child = spawnImpl(execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: workerEnv,
    windowsHide: true,
  });

  if (typeof child.unref === 'function') child.unref();

  const pid = child.pid ?? null;
  writeState(homeDir, {
    ...readState(homeDir),
    status: 'pending',
    code: 'AUTH_PENDING',
    message: '后台等待美团授权确认中。请先向用户展示授权链接与二维码图，再用 auth-status 查询。',
    qrImagePath: typeof qrImagePath === 'string' ? qrImagePath : null,
    pid,
  });

  return { pid, statePath: statePath(homeDir) };
}

function recordPollResult(homeDir, result, { qrImagePath = null } = {}) {
  const code = result?.code || 'PASSPORT_FAILED';
  const ok = Boolean(result?.ok);
  let status = 'failed';
  if (code === 'AUTH_SUCCESS' || (ok && code === 'AUTH_SUCCESS')) status = 'success';
  else if (code === 'AUTH_PENDING' || code === 'PASSPORT_PENDING') status = 'pending';
  else if (code === 'AUTH_CANCELLED' || code === 'PASSPORT_CANCELLED') status = 'cancelled';
  else if (code === 'AUTH_TIMEOUT' || code === 'PASSPORT_TIMEOUT') status = 'timeout';
  else if (code === 'AUTH_RISK_DENIED' || code === 'PASSPORT_RISK_DENIED') status = 'risk';
  else if (code === 'QR_CLEANUP_FAILED') status = ok ? 'success' : 'failed';

  return writeState(homeDir, {
    status,
    code,
    message: result?.message || '',
    ok,
    qrImagePath:
      (typeof result?.data?.qrImagePath === 'string' && result.data.qrImagePath) ||
      qrImagePath ||
      readState(homeDir)?.qrImagePath ||
      null,
    finishedAt: status === 'pending' ? undefined : new Date().toISOString(),
  });
}

module.exports = {
  STATE_BASENAME,
  statePath,
  writeState,
  readState,
  clearState,
  startBackgroundPoll,
  recordPollResult,
};
