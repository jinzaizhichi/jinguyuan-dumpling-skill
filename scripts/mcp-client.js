#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 15_000;
const EXPECTED_HOST = 'mcp.jinguyuan.cloud';
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;

function success(code, message, data = {}) {
  return { ok: true, code, message, data };
}

function failure(code, message, data = {}) {
  return { ok: false, code, message, data };
}

function safeMessage(value) {
  return String(value ?? '')
    .replace(/([?&](?:token|key|sendkey)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/((?:token|key|sendkey)[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 500);
}

function readEndpoint(skillRoot = path.resolve(__dirname, '..')) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'skill.json'), 'utf8'));
  } catch {
    throw Object.assign(new Error('无法读取 Skill MCP 配置。'), { code: 'MCP_CONFIG_ERROR' });
  }

  let endpoint;
  try {
    endpoint = new URL(manifest?.mcp_server?.url);
  } catch {
    throw Object.assign(new Error('Skill MCP 地址无效。'), { code: 'MCP_CONFIG_ERROR' });
  }
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== EXPECTED_HOST) {
    throw Object.assign(new Error('Skill MCP 地址不在允许范围内。'), { code: 'MCP_CONFIG_ERROR' });
  }
  endpoint.hash = '';
  return endpoint.toString();
}

function parseEventStream(text) {
  const payloads = [];
  let dataLines = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '') {
      if (dataLines.length) payloads.push(dataLines.join('\n'));
      dataLines = [];
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length) payloads.push(dataLines.join('\n'));
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(payloads[index]);
    } catch {}
  }
  throw Object.assign(new Error('MCP SSE 响应无法解析。'), { code: 'MCP_INVALID_RESPONSE' });
}

function parseRpcPayload(text, contentType = '') {
  const source = String(text ?? '').trim();
  if (!source) {
    throw Object.assign(new Error('MCP 返回空响应。'), { code: 'MCP_INVALID_RESPONSE' });
  }
  try {
    if (String(contentType).toLowerCase().includes('text/event-stream') || /^data:/m.test(source)) {
      return parseEventStream(source);
    }
    return JSON.parse(source);
  } catch (error) {
    if (error?.code === 'MCP_INVALID_RESPONSE') throw error;
    throw Object.assign(new Error('MCP JSON 响应无法解析。'), { code: 'MCP_INVALID_RESPONSE' });
  }
}

function parseTextResult(result) {
  const textPart = Array.isArray(result?.content)
    ? result.content.find((item) => item?.type === 'text' && typeof item.text === 'string')
    : null;
  if (!textPart) return null;
  try {
    return JSON.parse(textPart.text);
  } catch {
    return textPart.text;
  }
}

async function rpc(method, params, {
  endpoint,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('当前 Node.js 不支持 fetch。'), { code: 'MCP_UNSUPPORTED_RUNTIME' });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Protocol-Version': PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `jgy-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
        method,
        params,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw Object.assign(new Error('MCP 请求超时。'), { code: 'MCP_TIMEOUT' });
    }
    throw Object.assign(new Error('无法连接金谷园 MCP。'), { code: 'MCP_NETWORK_ERROR' });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`MCP HTTP ${response.status}`), {
      code: 'MCP_HTTP_ERROR',
      status: response.status,
    });
  }
  const payload = parseRpcPayload(text, response.headers.get('content-type') || '');
  if (payload?.error) {
    throw Object.assign(new Error(payload.error.message || 'MCP 工具调用失败。'), {
      code: 'MCP_RPC_ERROR',
      rpcCode: payload.error.code,
    });
  }
  if (!payload || typeof payload !== 'object' || !('result' in payload)) {
    throw Object.assign(new Error('MCP 响应缺少 result。'), { code: 'MCP_INVALID_RESPONSE' });
  }
  return payload.result;
}

function parseArgsJson(value) {
  if (value === undefined) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw Object.assign(new Error('--args 必须是 JSON 对象。'), { code: 'MCP_INVALID_ARGUMENTS' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('--args 必须是 JSON 对象。'), { code: 'MCP_INVALID_ARGUMENTS' });
  }
  return parsed;
}

function parseCli(argv) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === 'help')) return { command: 'help' };
  if (argv.length === 1 && argv[0] === 'list') return { command: 'list' };
  if (argv[0] !== 'call' || !TOOL_NAME_PATTERN.test(argv[1] || '')) {
    throw Object.assign(new Error('参数无效。'), { code: 'MCP_INVALID_ARGUMENTS' });
  }
  if (argv.length === 2) return { command: 'call', tool: argv[1], args: {} };
  if (argv.length === 4 && argv[2] === '--args') {
    return { command: 'call', tool: argv[1], args: parseArgsJson(argv[3]) };
  }
  throw Object.assign(new Error('参数无效。'), { code: 'MCP_INVALID_ARGUMENTS' });
}

async function run(argv, options = {}) {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    return failure(error.code || 'MCP_INVALID_ARGUMENTS', safeMessage(error.message));
  }
  if (parsed.command === 'help') {
    return success('MCP_HELP', '金谷园固定 MCP 客户端。', {
      commands: [
        'list',
        'call <toolName>',
        'call <toolName> --args <jsonObject>',
      ],
    });
  }

  let endpoint;
  try {
    endpoint = options.endpoint || readEndpoint(options.skillRoot);
    if (!options.endpoint) new URL(endpoint);
  } catch (error) {
    return failure(error.code || 'MCP_CONFIG_ERROR', safeMessage(error.message));
  }

  try {
    if (parsed.command === 'list') {
      const result = await rpc('tools/list', {}, { ...options, endpoint });
      return success('MCP_TOOLS_LIST', '已获取金谷园 MCP 工具列表。', {
        tools: Array.isArray(result?.tools) ? result.tools : [],
      });
    }

    const result = await rpc('tools/call', {
      name: parsed.tool,
      arguments: parsed.args,
    }, { ...options, endpoint });
    const textResult = parseTextResult(result);
    return success('MCP_TOOL_RESULT', '金谷园 MCP 工具调用成功。', {
      tool: parsed.tool,
      result: textResult ?? result?.structuredContent ?? result,
      structuredContent: result?.structuredContent ?? null,
      isError: Boolean(result?.isError),
    });
  } catch (error) {
    return failure(error.code || 'MCP_FAILED', safeMessage(error.message), {
      ...(Number.isInteger(error?.status) ? { status: error.status } : {}),
      ...(Number.isInteger(error?.rpcCode) ? { rpcCode: error.rpcCode } : {}),
    });
  }
}

function exitCodeFor(result) {
  return result?.ok ? 0 : 1;
}

if (require.main === module) {
  run(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = exitCodeFor(result);
  });
}

module.exports = {
  PROTOCOL_VERSION,
  DEFAULT_TIMEOUT_MS,
  EXPECTED_HOST,
  readEndpoint,
  parseEventStream,
  parseRpcPayload,
  parseTextResult,
  parseCli,
  rpc,
  run,
  exitCodeFor,
};
