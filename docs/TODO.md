# Skill 演进待办与 session 记录

本文档记录 jinguyuan-dumpling-skill 的已完成变更和待办事项，供下次直接读取开工。

---

## 已完成

### 2026-07-08：MCP 三接口合并 `get_restaurant_info` / `get_delivery_info` / `get_wifi_info` → `get_shop_basics`

**背景**：SKILL.md 已要求 Agent 在用户问店铺基本信息时一并调用这三个工具，合并为单一工具可减少一次对话中多次 MCP 调用。

**变更**：
- MCP 侧（`jgy-mcp/src/index.js`）：删除三个旧工具注册，新增 `get_shop_basics` 工具，一次返回 `restaurant`（餐厅信息）+ `delivery`（外卖）+ `wifi` 三份数据。
- MCP golden test（`test-mcp-golden.mjs`）：新增 `get_shop_basics` 断言，确认旧工具已被移除。
- MCP smoke test（`smoke.sh`）：替换旧工具名引用，更新工具计数从 10 到 11。
- MCP JSON-only test（`test-json-only.mjs`）：替换旧工具名引用。
- MCP README：工具表更新为 `get_shop_basics`。
- `skill.json`：`tools` 数组把三个旧名替换为 `get_shop_basics`。
- `SKILL.md`：更新 frontmatter 描述、"使用示例"综合查询示例、MCP 调用示例。
- GET 兜底路由：`/restaurant-info` / `/delivery-info` / `/wifi-info` 替换为 `/shop-basics`。

**影响范围**：
- breaking change：已安装旧版 Skill 调用旧工具名会失败。
- 需部署 MCP 后再发新版 Skill。
- 需提高 `service_config` 中 `skill_update.latest_version` 到新版 Skill 版本。

### 2026-07-08：删除 `brand_prompt` 字段

**背景**：`skill.json` 中的 `brand_prompt`（含 `system_instruction`、`tone`、`brand_keywords`）属于可能过时的静态描述。品牌调性、语气约束、排队路由规则等指令已沉淀在 [SKILL.md](../SKILL.md) 的"品牌调性与语气"和"排队路由"章节，由 Agent 读取 SKILL.md 时生效；`skill.json` 里再放一份属于冗余，且存在两处不一致的风险。

**变更**：
- 从 [skill.json](../skill.json) 删除 `brand_prompt` 整块（`system_instruction`、`tone`、`brand_keywords`）。
- 同步去掉 `tools` 数组后的尾逗号，保持 JSON 合法。

**影响范围**：
- 仅 `skill.json` 一个文件。
- 不影响 MCP 工具列表、不影响内嵌 meituan-queue Skill。
- SKILL.md 未改动，品牌调性和排队路由指令仍由 SKILL.md 承载。

---

## 待办

### 1. ~~MCP 侧合并 `get_restaurant_info` / `get_delivery_info` / `get_wifi_info`~~ 已完成

详见上方已完成记录。

### 2. 缺少 Skill 侧 golden test / 集成测试

**现状**：MCP 侧已有较完整的 golden test（`jgy-mcp/scripts/test-mcp-golden.mjs`），覆盖 `tools/list`、排队路由、营业时间边界、餐段事实/建议等。但 **Skill 侧没有对应的测试**来保证 SKILL.md / skill.json 升级不倒退。

**风险**：
- `skill.json` 的 `tools` 索引与 MCP `tools/list` 漂移时无自动发现。
- `SKILL.md` 指令被误删或改弱（如排队路由禁令、盲区红线）时无报警。
- `brand_prompt` 删除这类"静态描述清理"后，无法自动验证 Agent 行为不退化。

**建议方向**（下次讨论定方案，不必现在实现）：
- 在 `jgy-mcp/scripts/` 新增 `check-skill-manifest.mjs` 的增强版，校验 `skill.json.tools` 与线上 `tools/list` 一致。
- 针对 SKILL.md 关键指令（禁令、路由表、盲区红线）做断言：文件中必须包含某些关键句。
- 有条件时做端到端集成测试：模拟 Agent 按 SKILL.md 指令调用 MCP，验证关键场景的回答骨架。

**相关脚本**：现有 `jgy-mcp/scripts/check-skill-manifest.mjs` 已做部分 manifest 校验，可作为起点。
