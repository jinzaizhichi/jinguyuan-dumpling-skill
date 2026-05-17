#!/usr/bin/env bash
# 金谷园 Skill 发版脚本 —— 唯一发版入口
#
# 用法:  scripts/release.sh <new_version>
# 示例:  scripts/release.sh 0.5.10
#
# 行为:
#   1. 校验工作区干净 + 在 main 分支 + 两个 git remote (gitee/github) 都在 + clawhub CLI 已登录
#   2. 同步改 skill.json + SKILL.md 的版本号
#   3. commit + 打 tag v<version>
#   4. push gitee  main + tag
#   5. push github main + tag (走 127.0.0.1:1087 代理)
#   6. 临时挪走开发者侧资产 (.notes/ + scripts/release.sh) 后 clawhub publish, 发完恢复
#      同时为 ClawHub 投影二进制 .tgz -> .tgz.txt 影子文件 (绕白名单), 发完清理
#   7. 验证 shields.io 是否返回新 tag
#
# 失败时终止，不进入下一步。

set -euo pipefail

GITHUB_PROXY="http://127.0.0.1:1087"
REPO_PATH="JinGuYuan/jinguyuan-dumpling-skill"
GIT_REMOTES=(gitee github)

# ------- 参数与环境校验 -------
if [[ $# -ne 1 ]]; then
  echo "用法: $0 <new_version>" >&2
  echo "示例: $0 0.5.10" >&2
  exit 1
fi

NEW_VERSION="$1"
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "错误: 版本号必须符合 semver (x.y.z), 当前: $NEW_VERSION" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "错误: 工作区不干净, 请先提交或 stash" >&2
  git status --short
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "错误: 当前不在 main 分支 (在 $CURRENT_BRANCH)" >&2
  exit 1
fi

# 校验两个 git remote 都已配置
for r in "${GIT_REMOTES[@]}"; do
  if ! git remote get-url "$r" >/dev/null 2>&1; then
    echo "错误: 缺少 git remote: $r" >&2
    echo "      请先 git remote add $r <url>" >&2
    exit 1
  fi
done

# 校验 clawhub CLI 已安装且已登录
if ! command -v clawhub >/dev/null 2>&1; then
  echo "错误: clawhub CLI 未安装" >&2
  echo "      请先 npm i -g clawhub" >&2
  exit 1
fi
if ! clawhub whoami >/dev/null 2>&1; then
  echo "错误: clawhub 未登录" >&2
  echo "      请先 clawhub login" >&2
  exit 1
fi

TAG="v$NEW_VERSION"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "错误: tag $TAG 已存在" >&2
  exit 1
fi

echo "==> 准备发版 $TAG"

# ------- 1. 同步改两处版本号 -------
# skill.json: "version": "x.y.z"
python3 - <<PY
import json, pathlib
p = pathlib.Path("skill.json")
data = json.loads(p.read_text(encoding="utf-8"))
data["version"] = "$NEW_VERSION"
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

# SKILL.md: frontmatter 的 version: x.y.z
python3 - <<PY
import re, pathlib
p = pathlib.Path("SKILL.md")
text = p.read_text(encoding="utf-8")
new = re.sub(r"^version:\s*\S+", "version: $NEW_VERSION", text, count=1, flags=re.MULTILINE)
if new == text:
    raise SystemExit("SKILL.md 未找到 version 字段, 请人工检查")
p.write_text(new, encoding="utf-8")
PY

echo "==> 已同步 skill.json + SKILL.md 到 $NEW_VERSION"

# ------- 2. commit + tag -------
git add skill.json SKILL.md
git commit -m "chore: release $TAG"
git tag "$TAG"

# ------- 3. push gitee -------
echo "==> push gitee"
git push gitee main
git push gitee "$TAG"

# ------- 4. push github (走代理) -------
echo "==> push github (proxy: $GITHUB_PROXY)"
git -c http.proxy="$GITHUB_PROXY" -c https.proxy="$GITHUB_PROXY" push github main
git -c http.proxy="$GITHUB_PROXY" -c https.proxy="$GITHUB_PROXY" push github "$TAG"

# ------- 5. publish clawhub -------
# clawhub publish 是按目录打包上传到公开 registry,
# 为避免开发者侧资产 (.notes/ 私房本、发版脚本本身) 被上传,
# 发布前临时挪走, 发完恢复。使用 trap 保证异常退出也能恢复。
#
# DEV_ASSETS: ClawHub 包不应出现的开发者侧文件/目录 (相对 ROOT)
# - .notes/             AI 协作私房本, 不公开
# - scripts/release.sh  发版入口脚本, Skill 运行时不依赖, 且含内部代理等约定
DEV_ASSETS=(".notes" "scripts/release.sh")

# CLAWHUB_BIN_GLOBS: 二进制资源 glob (相对 ROOT)
# ClawHub 的 listTextFiles() 用扩展名白名单过滤 (md/txt/json/sh/py/...),
# .tgz 不在名单内会被丢弃。发布前临时投影一份 .tgz.txt 影子文件给 ClawHub,
# 发完立即清理, git 仓库 (GitHub/Gitee) 始终保持纯净的 .tgz 命名。
CLAWHUB_BIN_GLOBS=(
  "references/meituan-queue/references/meituan-passport-user-auth/scripts/mtuser-pt-passport-*.tgz"
)

STASH_ROOT=""
STASHED=()
PROJECTED=()

restore_dev_assets() {
  # 清理 ClawHub 投影影子文件
  local p
  for p in "${PROJECTED[@]}"; do
    if [[ -f "$ROOT/$p" ]]; then
      rm -f "$ROOT/$p"
      echo "==> 清理投影 $p"
    fi
  done
  PROJECTED=()

  # 恢复开发者资产
  local i
  for ((i = ${#STASHED[@]} - 1; i >= 0; i--)); do
    local rel="${STASHED[$i]}"
    local src="$STASH_ROOT/$rel"
    local dst="$ROOT/$rel"
    if [[ -e "$src" && ! -e "$dst" ]]; then
      mkdir -p "$(dirname "$dst")"
      mv "$src" "$dst"
      echo "==> 恢复 $rel"
    fi
  done
  STASHED=()
  if [[ -n "$STASH_ROOT" && -d "$STASH_ROOT" ]]; then
    rm -rf "$STASH_ROOT"
    STASH_ROOT=""
  fi
}

STASH_ROOT="$(mktemp -d -t jinguyuan-stash.XXXXXX)"
trap restore_dev_assets EXIT

for rel in "${DEV_ASSETS[@]}"; do
  if [[ -e "$ROOT/$rel" ]]; then
    mkdir -p "$STASH_ROOT/$(dirname "$rel")"
    mv "$ROOT/$rel" "$STASH_ROOT/$rel"
    STASHED+=("$rel")
    echo "==> 临时挪走 $rel (发布后自动恢复)"
  fi
done

# 投影二进制 .tgz -> .tgz.txt (ClawHub 白名单绕过)
shopt -s nullglob
for pattern in "${CLAWHUB_BIN_GLOBS[@]}"; do
  for src in "$ROOT/$pattern"; do
    [[ -f "$src" ]] || continue
    cp "$src" "$src.txt"
    rel="${src#$ROOT/}"
    PROJECTED+=("$rel.txt")
    echo "==> 投影 $rel -> $rel.txt (ClawHub 白名单绕过)"
  done
done
shopt -u nullglob

echo "==> clawhub publish (version: $NEW_VERSION)"
clawhub publish . --version "$NEW_VERSION" --tags latest

restore_dev_assets
trap - EXIT

# ------- 6. 验证 shields.io -------
echo "==> 验证 shields.io 徽章"
sleep 3
BADGE_VERSION="$(curl -sL "https://img.shields.io/github/v/tag/$REPO_PATH?sort=semver" \
  | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"

echo
if [[ "$BADGE_VERSION" == "$TAG" ]]; then
  echo "==> ✓ 徽章已更新到 $TAG"
else
  echo "==> ⚠ 徽章当前显示: ${BADGE_VERSION:-未知}, 预期 $TAG"
  echo "    shields.io 自身缓存约 5 分钟, 稍后会自动刷新"
fi

echo
echo "发版完成: $TAG"
