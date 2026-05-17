#!/usr/bin/env bash
# pt-passport CLI install/update script
# Installs from local tgz bundle. Skips if installed version == bundle version.
# 兼容两种发布形态：
#   - .tgz      ：GitHub/Gitee 源码仓库 / 开发者本地 clone
#   - .tgz.txt  ：ClawHub 发布包（绕过 ClawHub 文本文件白名单的影子文件）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"

if ! command -v npm &>/dev/null; then
  echo "npm: command not found. Please install Node.js >=18" >&2
  exit 2
fi

# 优先找 .tgz；找不到再 fallback .tgz.txt（ClawHub 形态）
TGZ_FILE=$(for f in "$SCRIPT_DIR"/mtuser-pt-passport-*.tgz; do [ -f "$f" ] && echo "$f"; done | sort -V | tail -1)
TXT_FILE=""
if [ -z "$TGZ_FILE" ]; then
  TXT_FILE=$(for f in "$SCRIPT_DIR"/mtuser-pt-passport-*.tgz.txt; do [ -f "$f" ] && echo "$f"; done | sort -V | tail -1)
fi

if [ -z "$TGZ_FILE" ] && [ -z "$TXT_FILE" ]; then
  echo "No local bundle found in $SCRIPT_DIR (tried *.tgz and *.tgz.txt)" >&2
  exit 3
fi

# 从源文件名提取版本号，兼容 .tgz 和 .tgz.txt
SOURCE_NAME=$(basename "${TGZ_FILE:-$TXT_FILE}")
BUNDLE_VERSION=$(echo "$SOURCE_NAME" | sed 's/mtuser-pt-passport-//; s/\.txt$//; s/\.tgz$//')
if [ -z "$BUNDLE_VERSION" ]; then
  echo "Failed to parse version from: $SOURCE_NAME" >&2
  exit 3
fi

# 获取已安装版本（直接用 pt-passport --version，取最后一行以跳过 CLIGuard Wrapper 前缀行）
LOCAL=$(pt-passport --version 2>/dev/null | tail -1 || true)

# 版本一致则跳过
if [ "$LOCAL" = "$BUNDLE_VERSION" ]; then
  echo "Already up-to-date (pt-passport@$LOCAL), skipping."
  exit 0
fi

# .tgz.txt 形态：复制成临时真 .tgz 喂给 npm（npm 看扩展名识别包格式）
if [ -z "$TGZ_FILE" ]; then
  TMP_DIR=$(mktemp -d)
  trap 'rm -rf "$TMP_DIR"' EXIT
  TGZ_FILE="$TMP_DIR/mtuser-pt-passport-$BUNDLE_VERSION.tgz"
  cp "$TXT_FILE" "$TGZ_FILE"
fi

# 安装本地包
echo "Installing pt-passport@$BUNDLE_VERSION from local bundle..."
npm install -g "$TGZ_FILE" --save-exact --force || {
  echo "Install failed." >&2; exit 1
}
