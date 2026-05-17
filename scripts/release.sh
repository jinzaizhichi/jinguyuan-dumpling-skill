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
#   6. clawhub skill publish . --version <version> (发布到 ClawHub Skill Registry)
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
# 为避免 .notes/ 这类工作区私房本被上传, 发布前临时挪走, 发完恢复。
# 使用 trap 保证异常退出时也能恢复。
NOTES_DIR="$ROOT/.notes"
NOTES_STASH=""
restore_notes() {
  if [[ -n "$NOTES_STASH" && -d "$NOTES_STASH" && ! -e "$NOTES_DIR" ]]; then
    mv "$NOTES_STASH" "$NOTES_DIR"
    echo "==> .notes/ 已恢复"
  fi
}
if [[ -d "$NOTES_DIR" ]]; then
  NOTES_STASH="$(mktemp -d -t jinguyuan-notes.XXXXXX)/.notes"
  mkdir -p "$(dirname "$NOTES_STASH")"
  mv "$NOTES_DIR" "$NOTES_STASH"
  trap restore_notes EXIT
  echo "==> .notes/ 已临时挪走 ($NOTES_STASH), 发布后自动恢复"
fi

echo "==> clawhub publish (version: $NEW_VERSION)"
clawhub publish . --version "$NEW_VERSION" --tags latest

restore_notes
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
