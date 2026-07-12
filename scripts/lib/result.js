function success(code, message, data = {}) { return { ok: true, code, message, data }; }
function failure(code, message, data = {}) { return { ok: false, code, message, data }; }
function redact(value) {
  return String(value ?? '')
    .replace(/([?&](?:token|key|sendkey)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/((?:token|key|sendkey)[:=]\s*)[A-Za-z0-9_-]{16,}/gi, '$1[redacted]');
}

module.exports = { success, failure, redact };
