'use strict';

const crypto = require('node:crypto');

const AUTH_RUN_ID_PATTERN = /^[0-9a-f]{12}$/;

function createAuthRunId() {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
}

function isAuthRunId(value) {
  return typeof value === 'string' && AUTH_RUN_ID_PATTERN.test(value);
}

module.exports = { AUTH_RUN_ID_PATTERN, createAuthRunId, isAuthRunId };
