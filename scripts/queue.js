#!/usr/bin/env node
'use strict';

const os = require('node:os');
const path = require('node:path');

const { createPassport } = require('./passport');
const {
  createAuthQr,
  cleanupAuthQr,
  validateAuthQrPath,
  defaultQrRootDir,
  toWorkspaceRelativePath,
} = require('./auth-qr');
const { createQueueApi } = require('./lib/queue-api');
const { success, failure } = require('./lib/result');
const { createAuthRunId, isAuthRunId } = require('./lib/auth-run');
const {
  startBackgroundPoll,
  readState,
  recordPollResult,
} = require('./lib/auth-poll-bg');

const CLIENT_ID = '170f5f2dbbde4048bd4a5e4ed28209cc';
const BUSINESS_COMMANDS = new Set(['index', 'take-number', 'order-detail', 'order-cancel']);
const HELP_COMMANDS = [
  'index <shopId>',
  'take-number <shopId> --people-count N --table-type-id ID --confirm',
  'order-detail <shopId>',
  'order-cancel <shopId> --confirm',
  'auth-start',
  'auth-poll [--background|--wait] [--qr-image-path <path>]',
  'auth-status',
  'logout',
];

function invalidArguments() {
  return failure('INVALID_ARGUMENTS', '参数错误，请使用 --help 查看命令。');
}

function helpResult() {
  return success('HELP', '金谷园排队 CLI（需要 Node.js 18 或更高版本）。', {
    nodeRequirement: '>=18',
    commands: HELP_COMMANDS,
  });
}

function positiveInteger(value) {
  if (!/^\d+$/.test(String(value ?? ''))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validShopId(value) {
  return /^\d+$/.test(String(value ?? '')) && Number(value) > 0;
}

function parseArguments(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { command: 'help' };
  }

  const command = argv[0];
  if (!command) return null;

  if (command === 'logout') {
    return argv.length === 1 ? { command } : null;
  }

  if (command === 'auth-status') {
    return argv.length === 1 ? { command } : null;
  }

  // One-shot authorization entry: fetch authLink + render QR + start background poll.
  // Avoids the footgun where agents run `auth-poll --background` alone (which only
  // starts a worker and never produces a link or QR).
  if (command === 'auth-start') {
    return argv.length === 1 ? { command } : null;
  }

  // Internal worker for detached background poll (not for Agent use).
  if (command === 'auth-poll-worker') {
    const rest = argv.slice(1);
    let authRunId;
    let qrImagePath;
    for (let index = 0; index < rest.length; index += 2) {
      const name = rest[index];
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) return null;
      if (name === '--auth-run-id' && authRunId === undefined) authRunId = value;
      else if (name === '--qr-image-path' && qrImagePath === undefined) qrImagePath = value;
      else return null;
    }
    if (!isAuthRunId(authRunId)) return null;
    return { command, mode: 'worker', authRunId, qrImagePath };
  }

  if (command === 'auth-poll') {
    const rest = argv.slice(1);
    let mode = 'wait';
    let qrImagePath;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === '--background') {
        mode = 'background';
        continue;
      }
      if (arg === '--wait') {
        mode = 'wait';
        continue;
      }
      if (arg === '--qr-image-path') {
        const value = rest[i + 1];
        if (!value || value.startsWith('--')) return null;
        qrImagePath = value;
        i += 1;
        continue;
      }
      return null;
    }
    return { command, mode, qrImagePath };
  }

  if (!BUSINESS_COMMANDS.has(command) || !validShopId(argv[1])) return null;

  if (command === 'index' || command === 'order-detail') {
    return argv.length === 2 ? { command, shopId: argv[1] } : null;
  }

  if (command === 'order-cancel') {
    if (argv.length === 2) {
      return { command, shopId: argv[1], confirmed: false };
    }
    if (argv.length === 3 && argv[2] === '--confirm') {
      return { command, shopId: argv[1], confirmed: true };
    }
    return null;
  }

  // take-number <shopId> --people-count N --table-type-id ID [--confirm]
  if (command !== 'take-number') return null;

  const rest = argv.slice(2);
  let confirmed = false;
  if (rest.length > 0 && rest[rest.length - 1] === '--confirm') {
    confirmed = true;
    rest.pop();
  }
  // Without --confirm: still parse people/table so CLI can return CONFIRM_REQUIRED
  if (rest.length !== 4) return null;
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!['--people-count', '--table-type-id'].includes(name) || options.has(name)) return null;
    options.set(name, value);
  }
  const peopleCount = positiveInteger(options.get('--people-count'));
  const tableTypeId = positiveInteger(options.get('--table-type-id'));
  if (peopleCount === null || tableTypeId === null) return null;
  return { command, shopId: argv[1], peopleCount, tableTypeId, confirmed };
}

function tokenFrom(result) {
  return typeof result?.token === 'string' && result.token ? result.token : null;
}

function sanitized(value, token) {
  if (typeof value === 'string') {
    return token ? value.split(token).join('[redacted]') : value;
  }
  if (Array.isArray(value)) return value.map(item => sanitized(item, token));
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (/token|authorization|cookie|password|secret|credential|api[-_]?key|session[-_]?id/i.test(key)) {
        copy[key] = '[redacted]';
      } else {
        copy[key] = sanitized(entryValue, token);
      }
    }
    return copy;
  }
  return value;
}

function passportFailure(error) {
  switch (error?.code) {
    case 'PASSPORT_PENDING':
      return failure('AUTH_PENDING', '授权尚未完成。');
    case 'PASSPORT_CANCELLED':
      return failure('AUTH_CANCELLED', '授权已取消。');
    case 'PASSPORT_RISK_DENIED':
      return failure('AUTH_RISK_DENIED', '授权被风控拒绝。');
    case 'PASSPORT_TIMEOUT':
      return failure('AUTH_TIMEOUT', '授权已超时。');
    default:
      return failure('PASSPORT_FAILED', '授权服务调用失败。');
  }
}

function authStatusResult(status) {
  const code = String(status?.code || status?.status || '').toUpperCase();
  const aliases = {
    PENDING: 'PASSPORT_PENDING',
    AUTH_PENDING: 'PASSPORT_PENDING',
    CANCELLED: 'PASSPORT_CANCELLED',
    AUTH_CANCELLED: 'PASSPORT_CANCELLED',
    RISK_DENIED: 'PASSPORT_RISK_DENIED',
    AUTH_RISK_DENIED: 'PASSPORT_RISK_DENIED',
    TIMEOUT: 'PASSPORT_TIMEOUT',
    AUTH_TIMEOUT: 'PASSPORT_TIMEOUT',
  };
  return aliases[code] ? passportFailure({ code: aliases[code] }) : null;
}

function confirmationRequired(parsed) {
  if (parsed.command === 'take-number') {
    return failure(
      'CONFIRM_REQUIRED',
      '取号前须取得用户对本次动作的明确确认。确认后请带上 --confirm 再执行 take-number。',
      {
        shopId: parsed.shopId,
        peopleCount: parsed.peopleCount,
        tableTypeId: parsed.tableTypeId,
        requiredFlag: '--confirm',
      },
    );
  }
  if (parsed.command === 'order-cancel') {
    return failure(
      'CONFIRM_REQUIRED',
      '取消排队前须取得用户对本次动作的明确确认。确认后请执行 order-cancel <shopId> --confirm。',
      {
        shopId: parsed.shopId,
        requiredFlag: '--confirm',
      },
    );
  }
  return null;
}

async function dispatchBusiness(parsed, token, makeQueueApi) {
  if ((parsed.command === 'take-number' || parsed.command === 'order-cancel') && !parsed.confirmed) {
    return confirmationRequired(parsed);
  }

  const api = makeQueueApi({ token });
  let result;
  switch (parsed.command) {
    case 'index':
      result = await api.index(parsed.shopId);
      break;
    case 'take-number':
      result = await api.takeNumber(parsed.shopId, parsed.peopleCount, parsed.tableTypeId);
      break;
    case 'order-detail':
      result = await api.orderDetail(parsed.shopId);
      break;
    case 'order-cancel':
      result = await api.orderCancel(parsed.shopId);
      break;
    default:
      return invalidArguments();
  }
  return sanitized(result, token);
}

/**
 * Pre-built user-facing markdown (V1-style inline image).
 * Image tag MUST use an absolute path so chat UIs can inline it (relative paths
 * often become attachment cards). Always include plain URL as cloud fallback.
 */
function buildAuthUserReplyMarkdown({ authLink, qrImagePath }) {
  const lines = [];
  // Order matches V1 passport Step 3: image first, then copy.
  if (typeof qrImagePath === 'string' && qrImagePath) {
    // Wrap path in angle brackets so Markdown parsers handle spaces in paths
    // like ".../Application Support/TRAE SOLO CN/.../qr.png" correctly.
    lines.push(`![美团授权二维码](<${qrImagePath}>)`);
    lines.push('');
  }
  lines.push('---');
  lines.push('📱 **扫码授权 / 点击链接**');
  lines.push('');
  lines.push(
    typeof qrImagePath === 'string' && qrImagePath
      ? '请用美团 App 扫描上方二维码，或点击下方链接，在授权页点击「**确认授权**」：'
      : '请点击下方链接，在授权页点击「**确认授权**」（若未见二维码图，用链接即可）：',
  );
  lines.push('');
  lines.push(`👉 [打开美团授权页面](${authLink})`);
  lines.push('');
  lines.push(authLink);
  lines.push('');
  lines.push('> ⏱ 约 10 分钟有效。后台已在等待授权，无需回复「已授权」。');
  lines.push(
    '> 云端：用户手机通常打不开 Agent 本机路径；**链接必须出现在主气泡**。桌面侧应用 `![](绝对路径)` 把图嵌进气泡，勿只发附件。',
  );
  return lines.join('\n');
}

const AUTH_INLINE_QR_HINT =
  'CRITICAL（对齐 V1 内联图）：' +
  '① 若有 data.qrImagePath：先 Read 该 PNG（绝对路径），再把 Markdown `![美团授权二维码](<绝对路径>)` **写入主气泡正文**——这是聊天框可见图的关键；' +
  '② ⚠️ 仅 Read / 仅附件侧栏 / 步骤卡「已展示」都不算：用户扫不到码；' +
  '③ 推荐整段粘贴 data.userReplyMarkdown（已含绝对路径图 + 链接）；' +
  '④ 链接必现（云端主通道）；' +
  '⑤ 展示后 auth-status 短查；禁止 auth-poll --wait。';

async function beginAuthorization(deps, { force = false } = {}) {
  let started;
  try {
    started = await deps.passport.startAuth({ force });
  } catch (error) {
    return { result: passportFailure(error) };
  }

  const token = tokenFrom(started);
  if (token) return { token };
  if (typeof started?.authLink !== 'string' || !started.authLink) {
    return { result: failure('PASSPORT_FAILED', '授权服务未返回有效结果。') };
  }

  const authLink = started.authLink;
  const authRunId = deps.createAuthRunId();
  const data = {
    authLink,
    authRunId,
    pollMode: 'background',
    // Hard deliverable: copy this string into the user-visible main bubble this turn.
    userReplyMarkdown: null,
    agentHint: AUTH_INLINE_QR_HINT,
  };
  // Absolute path for markdown inline + cleanup (V1: absolute path in ![](...)).
  let qrImagePathAbs = null;
  try {
    const qr = await deps.createAuthQr(authLink, {
      tmpDir: deps.tmpDir,
      authRunId,
      clientId: CLIENT_ID,
    });
    if (typeof qr?.imagePath === 'string') {
      qrImagePathAbs = path.resolve(qr.imagePath);
      // Primary: absolute path for chat inline (V1).
      data.qrImagePath = qrImagePathAbs;
      // Optional: workspace-relative for tools that prefer cwd-relative Read.
      data.qrImagePathRelative = toWorkspaceRelativePath(
        qrImagePathAbs,
        deps.workspaceDir,
      );
    }
  } catch {
    // authLink remains a complete fallback when local QR generation fails.
  }

  data.userReplyMarkdown = buildAuthUserReplyMarkdown({
    authLink,
    // Inline tag must be absolute — relative paths often render as attachments.
    qrImagePath: qrImagePathAbs || null,
  });

  try {
    const startedBg = deps.startBackgroundPoll({
      homeDir: deps.homeDir,
      authRunId,
      qrImagePath: qrImagePathAbs || null,
      scriptPath: deps.scriptPath,
      execPath: deps.execPath,
    });
    if (startedBg?.pid != null) data.pollPid = startedBg.pid;
  } catch {
    data.pollMode = 'manual';
    data.agentHint =
      AUTH_INLINE_QR_HINT +
      '后台未启动：展示后 auth-poll --background，再用 auth-status。';
  }

  const message = [
    '需要完成美团授权。',
    '【Agent 必做·对齐 V1】有图时：Read 绝对路径 PNG 后，把 `![美团授权二维码](<绝对路径>)` 写进主气泡正文（仅 Read/仅附件不算）；并原样贴 data.userReplyMarkdown（链接必现）。',
    `授权链接: ${authLink}`,
    data.qrImagePath
      ? `二维码图绝对路径: ${data.qrImagePath}` +
        (data.qrImagePathRelative
          ? `（工作区相对: ${data.qrImagePathRelative}）`
          : '') +
        '；主气泡必须出现 Markdown 图片标签，不要只当附件。'
      : '本机未生成二维码图，请至少发出上方链接。',
    '后台已在等待；展示后再 auth-status。禁止 auth-poll --wait。',
  ].join(' ');

  return {
    result: failure('AUTH_REQUIRED', message, data),
  };
}

function qrOptionsFrom(parsed, deps) {
  if (!parsed.qrImagePath) return null;
  return { imagePath: parsed.qrImagePath, tmpDir: deps.tmpDir };
}

async function pollAuthorizationWait(parsed, deps) {
  const qrOptions = qrOptionsFrom(parsed, deps);
  if (qrOptions) {
    try {
      deps.validateAuthQrPath(qrOptions);
    } catch {
      return invalidArguments();
    }
  }

  async function cleanupCancelledQr() {
    if (!qrOptions) return failure('AUTH_CANCELLED', '授权已取消。');
    try {
      await deps.cleanupAuthQr(qrOptions);
      return failure('AUTH_CANCELLED', '授权已取消。');
    } catch {
      return failure('QR_CLEANUP_FAILED', '授权已取消，但二维码清理失败。');
    }
  }

  let polled;
  try {
    polled = await deps.passport.pollAuth();
  } catch (error) {
    const result = passportFailure(error);
    return result.code === 'AUTH_CANCELLED' ? cleanupCancelledQr() : result;
  }

  const token = tokenFrom(polled);
  if (!token) {
    const result = authStatusResult(polled) || failure('PASSPORT_FAILED', '授权服务未返回有效结果。');
    return result.code === 'AUTH_CANCELLED' ? cleanupCancelledQr() : result;
  }

  if (qrOptions) {
    try {
      await deps.cleanupAuthQr(qrOptions);
    } catch {
      return failure('QR_CLEANUP_FAILED', '授权成功，但二维码清理失败。');
    }
  }
  return success('AUTH_SUCCESS', '授权成功。');
}

function startAuthPollBackground(parsed, deps) {
  if (parsed.qrImagePath) {
    try {
      deps.validateAuthQrPath({ imagePath: parsed.qrImagePath, tmpDir: deps.tmpDir });
    } catch {
      return invalidArguments();
    }
  }
  const authRunId = deps.createAuthRunId();
  try {
    const started = deps.startBackgroundPoll({
      homeDir: deps.homeDir,
      authRunId,
      qrImagePath: parsed.qrImagePath || null,
      scriptPath: deps.scriptPath,
      execPath: deps.execPath,
    });
    return success('AUTH_POLL_STARTED', '已在后台等待授权，不阻塞当前对话。', {
      pollMode: 'background',
      authRunId,
      pollPid: started?.pid ?? null,
      qrImagePath: parsed.qrImagePath || null,
      agentHint: '请先确保用户主气泡已展示链接与二维码图，然后周期性执行 auth-status（短命令）。',
    });
  } catch {
    return failure('PASSPORT_FAILED', '无法启动后台授权轮询。');
  }
}

async function runAuthPollWorker(parsed, deps) {
  const result = await pollAuthorizationWait(parsed, deps);
  try {
    deps.recordPollResult(deps.homeDir, result, {
      authRunId: parsed.authRunId,
      qrImagePath: parsed.qrImagePath || null,
    });
  } catch {
    // State write failure must not crash worker after poll finished.
  }
  return result;
}

async function authStatus(deps) {
  const state = deps.readPollState(deps.homeDir);
  if (!state) {
    return failure('AUTH_STATUS_NONE', '当前没有进行中的授权轮询记录。可重新触发需授权的命令。');
  }

  const code = state.code || 'AUTH_PENDING';
  const message =
    state.message ||
    (code === 'AUTH_PENDING'
      ? '授权尚未完成。'
      : code === 'AUTH_SUCCESS'
        ? '授权成功。'
        : '授权状态已更新。');
  const data = {
    pollMode: 'background',
    authRunId: state.authRunId || null,
    status: state.status || null,
    qrImagePath: state.qrImagePath || null,
    startedAt: state.startedAt || null,
    updatedAt: state.updatedAt || null,
    finishedAt: state.finishedAt || null,
  };

  if (code === 'AUTH_SUCCESS' || state.status === 'success') {
    return success('AUTH_SUCCESS', message, data);
  }
  if (code === 'AUTH_PENDING' || state.status === 'pending') {
    try {
      const cached = await deps.passport.getToken();
      if (tokenFrom(cached)) {
        const result = success('AUTH_SUCCESS', '授权成功。');
        try {
          deps.recordPollResult(deps.homeDir, result, {
            authRunId: state.authRunId,
            qrImagePath: state.qrImagePath || null,
          });
        } catch {
          // A valid cached Token wins even if the local status write fails.
        }
        data.status = 'success';
        return success('AUTH_SUCCESS', '授权成功。', data);
      }
    } catch {
      // A transient cache lookup failure must not replace the live pending state.
    }
    return failure('AUTH_PENDING', message, data);
  }
  if (code === 'AUTH_CANCELLED' || state.status === 'cancelled') {
    return failure('AUTH_CANCELLED', message, data);
  }
  if (code === 'AUTH_TIMEOUT' || state.status === 'timeout') {
    return failure('AUTH_TIMEOUT', message, data);
  }
  if (code === 'AUTH_RISK_DENIED' || state.status === 'risk') {
    return failure('AUTH_RISK_DENIED', message, data);
  }
  if (code === 'QR_CLEANUP_FAILED') {
    return state.ok
      ? success('QR_CLEANUP_FAILED', message, data)
      : failure('QR_CLEANUP_FAILED', message, data);
  }
  return failure(code, message, data);
}

function defaultDependencies(overrides) {
  const homeDir = overrides.homeDir || os.homedir();
  // QR PNG: flat visible run-owned file under the session workspace root.
  // Passport token/poll-state stay under homeDir; process temp on OS tmpdir.
  const workspaceDir = overrides.workspaceDir || process.cwd();
  const qrRootDir =
    overrides.qrRootDir || overrides.tmpDir || defaultQrRootDir(workspaceDir);
  const passportTmpDir = overrides.passportTmpDir || os.tmpdir();
  const scriptPath = overrides.scriptPath || path.resolve(__dirname, 'queue.js');
  return {
    passport:
      overrides.passport ||
      createPassport({ homeDir, tmpDir: passportTmpDir }),
    createAuthQr: overrides.createAuthQr || createAuthQr,
    cleanupAuthQr: overrides.cleanupAuthQr || cleanupAuthQr,
    validateAuthQrPath: overrides.validateAuthQrPath || validateAuthQrPath,
    createQueueApi: overrides.createQueueApi || createQueueApi,
    startBackgroundPoll: overrides.startBackgroundPoll || startBackgroundPoll,
    readPollState: overrides.readPollState || readState,
    recordPollResult: overrides.recordPollResult || recordPollResult,
    createAuthRunId: overrides.createAuthRunId || createAuthRunId,
    // createAuthQr / cleanup still take { tmpDir } as the owned QR root.
    tmpDir: qrRootDir,
    qrRootDir,
    workspaceDir,
    homeDir,
    scriptPath,
    execPath: overrides.execPath || process.execPath,
    nodeVersion: overrides.nodeVersion || process.versions.node,
  };
}

async function run(argv, overrides = {}) {
  const deps = defaultDependencies(overrides);
  const nodeMajor = Number.parseInt(String(deps.nodeVersion).split('.')[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 18) {
    return failure('UNSUPPORTED_NODE_VERSION', '需要 Node.js 18 或更高版本。');
  }

  const parsed = parseArguments(Array.isArray(argv) ? argv : []);
  if (!parsed) return invalidArguments();
  if (parsed.command === 'help') return helpResult();

  if (parsed.command === 'logout') {
    try {
      await deps.passport.logout();
      return success('LOGOUT_SUCCESS', '已退出登录。');
    } catch (error) {
      return passportFailure(error);
    }
  }

  if (parsed.command === 'auth-status') return authStatus(deps);

  if (parsed.command === 'auth-start') {
    // Reuse the same beginAuthorization path business commands use, so the
    // agent has a single self-contained authorization entry that produces
    // authLink + QR + background poll in one shot.
    const authorization = await beginAuthorization(deps);
    if (authorization.result) return authorization.result;
    return success('AUTH_SUCCESS', '已授权，可直接执行排队命令。');
  }

  if (parsed.command === 'auth-poll-worker') {
    return runAuthPollWorker(parsed, deps);
  }

  if (parsed.command === 'auth-poll') {
    if (parsed.mode === 'background') return startAuthPollBackground(parsed, deps);
    // --wait (default): blocking Passport poll — avoid in Agent chat turns.
    return pollAuthorizationWait(parsed, deps);
  }

  if ((parsed.command === 'take-number' || parsed.command === 'order-cancel') && !parsed.confirmed) {
    return confirmationRequired(parsed);
  }

  let cached;
  try {
    cached = await deps.passport.getToken();
  } catch (error) {
    return passportFailure(error);
  }
  let token = tokenFrom(cached);
  if (!token) {
    const authorization = await beginAuthorization(deps);
    if (authorization.result) return authorization.result;
    token = authorization.token;
  }

  try {
    const result = await dispatchBusiness(parsed, token, deps.createQueueApi);
    if (result?.code !== 'AUTH_REQUIRED') return result;

    const authorization = await beginAuthorization(deps, { force: true });
    if (authorization.result) return authorization.result;
    const retryResult = await dispatchBusiness(parsed, authorization.token, deps.createQueueApi);
    return sanitized(retryResult, token);
  } catch {
    return failure('CLI_FAILED', '排队命令执行失败。');
  }
}

function exitCodeFor(result) {
  if (
    result?.code === 'AUTH_REQUIRED' ||
    result?.code === 'AUTH_PENDING' ||
    result?.code === 'AUTH_POLL_STARTED' ||
    result?.code === 'AUTH_STATUS_NONE'
  ) {
    return 2;
  }
  return result?.ok ? 0 : 1;
}

async function main() {
  let result;
  try {
    result = await run(process.argv.slice(2));
  } catch {
    result = failure('CLI_FAILED', '排队命令执行失败。');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = exitCodeFor(result);
}

if (require.main === module) void main();

module.exports = { run, exitCodeFor };
