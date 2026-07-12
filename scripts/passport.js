const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLIENT_ID = '170f5f2dbbde4048bd4a5e4ed28209cc';
const PASSPORT_ENV = 'prod';
const CLI_PATH = path.resolve(__dirname, 'vendor/pt-passport/dist/index.js');
// ClawHub strips dirs named node_modules; cliguard ships under bundled_modules.
const PASSPORT_BUNDLED = path.resolve(__dirname, 'vendor/pt-passport/bundled_modules');

function defaultRun(args, options) {
  return new Promise((resolve) => {
    childProcess.execFile(
      options.executable,
      [options.cliPath, ...args],
      { env: options.env, encoding: 'utf8' },
      (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '' });
      }
    );
  });
}

function parseJson(output) {
  const candidates = [String(output ?? '').trim(), ...String(output ?? '').trim().split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

function tokenResult(token) {
  const result = {};
  Object.defineProperty(result, 'token', {
    value: token,
    enumerable: false,
  });
  return result;
}

function parseToken(output) {
  const json = parseJson(output);
  if (typeof json?.token === 'string' && json.token) return json.token;
  const labelled = String(output ?? '').match(/Token:\s*([^\s]+)/i);
  if (labelled) return labelled[1];

  const plain = String(output ?? '').trim();
  if (/^[A-Za-z0-9_-]{16,}$/.test(plain)) return plain;
  return null;
}

function normalizeAuthLink(link) {
  if (typeof link !== 'string') return null;
  const trimmed = link.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  // Meituan short links are emitted as http:// but resolve over https://.
  return trimmed.replace(/^http:\/\//i, 'https://');
}

function parseAuthLink(output) {
  const json = parseJson(output);
  if (typeof json?.auth_link === 'string') {
    const normalized = normalizeAuthLink(json.auth_link);
    if (normalized) return normalized;
  }
  const labelled = String(output ?? '').match(/AUTH_LINK:\s*(https?:\/\/[^\s]+)/i)?.[1];
  return normalizeAuthLink(labelled);
}

function passportError(output) {
  const text = String(output ?? '');
  let code = 'PASSPORT_FAILED';
  let message = 'Passport command failed';

  if (/PollTimeoutError|timeout|timed out|超时/i.test(text)) {
    code = 'PASSPORT_TIMEOUT';
    message = 'Passport authorization timed out';
  } else if (/UserCancelError|cancel(?:led)?|取消/i.test(text)) {
    code = 'PASSPORT_CANCELLED';
    message = 'Passport authorization was cancelled';
  } else if (/RiskDenyError|risk.?deny|风控.*拒绝|拒绝.*授权/i.test(text)) {
    code = 'PASSPORT_RISK_DENIED';
    message = 'Passport authorization was denied by risk control';
  }

  const error = new Error(message);
  error.code = code;
  return error;
}

function createPassport({ run = defaultRun, homeDir = os.homedir(), tmpDir = os.tmpdir() } = {}) {
  const cacheDir = path.join(homeDir, '.jinguyuan');
  const authFile = path.join(cacheDir, 'passport-auth.json');
  const env = {
    ...process.env,
    PT_PASSPORT_AUTH_FILE: authFile,
    TMPDIR: tmpDir,
    TEMP: tmpDir,
    TMP: tmpDir,
    NODE_PATH: [PASSPORT_BUNDLED, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
  };

  async function invoke(args, { missingCacheIsNull = false } = {}) {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(cacheDir, 0o700);
    let completed;
    try {
      completed = await run(args, {
        executable: process.execPath,
        cliPath: CLI_PATH,
        env,
      });
    } catch (error) {
      throw passportError(error?.message);
    }

    const output = [completed?.stdout, completed?.stderr].filter(Boolean).join('\n');
    if (completed?.code !== 0) {
      if (missingCacheIsNull && completed?.code === 1) {
        if (!parseToken(output)) return null;
        return output;
      }
      throw passportError(output);
    }
    return output;
  }

  return {
    async getToken() {
      const output = await invoke([
        'get-token', '--client_id', CLIENT_ID, '--env', PASSPORT_ENV, '--json',
      ], { missingCacheIsNull: true });
      if (output === null) return null;
      const token = parseToken(output);
      if (!token) throw passportError(output);
      return tokenResult(token);
    },

    async startAuth({ force = false } = {}) {
      const args = [
        'auth', 'get-code', '--client_id', CLIENT_ID, '--env', PASSPORT_ENV, '--json',
      ];
      if (force) args.push('--force');
      const output = await invoke(args);
      const authLink = parseAuthLink(output);
      if (authLink) return { authLink };

      const token = parseToken(output);
      if (token) return tokenResult(token);
      throw passportError(output);
    },

    async pollAuth() {
      const output = await invoke([
        'auth', 'poll-token', '--client_id', CLIENT_ID, '--json',
      ]);
      const token = parseToken(output);
      if (!token) throw passportError(output);
      return tokenResult(token);
    },

    async logout() {
      await invoke([
        'logout', '--client_id', CLIENT_ID, '--env', PASSPORT_ENV,
      ]);
      return {};
    },
  };
}

module.exports = { createPassport, PASSPORT_BUNDLED };
