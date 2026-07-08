# Skill 演进待办与 session 记录

本文档记录 jinguyuan-dumpling-skill 的已完成变更和待办事项，供下次直接读取开工。

---

## 已完成

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

### 1. MCP 侧合并 `get_restaurant_info` / `get_delivery_info` / `get_wifi_info`

**现状**：MCP Server（`/Users/libo/Projects/金谷园AI/jgy-mcp`）当前暴露三个独立工具：
- `get_restaurant_info` — 餐厅基本信息（名称、简介、营业时间、地址）
- `get_delivery_info` — 外卖配送信息
- `get_wifi_info` — 店内 Wi-Fi 密码

三者数据来源都是硬编码（见 [design-decisions.md §2](../../jgy-mcp/docs/design-decisions.md)），且 SKILL.md 已要求 Agent 在用户问店铺基本信息时**一并调用**这三个工具合并回复（见 [SKILL.md "使用示例"综合查询](../SKILL.md)）。

**计划**：合并为单一工具（暂定名 `get_shop_basics` 或类似），一次调用返回餐厅信息 + 外卖 + Wi-Fi。

**为什么是 breaking change**：
- MCP `tools/list` 会少两个工具名。
- `skill.json` 的 `tools` 索引需同步删除旧名、加入新名。
- `SKILL.md` 中所有引用旧工具名的地方（"使用示例"、"排队路由"以外的基础查询说明）都要改。
- 已安装旧版 Skill 的 Agent 在 MCP 升级后调用旧工具名会失败，需配合提高 `service_config` 中 `skill_update.latest_version` 强制升级（见 [design-decisions.md §10](../../jgy-mcp/docs/design-decisions.md)）。

**收尾清单**（合并时按顺序做）：
1. MCP 侧（`jgy-mcp/src/index.js`）：实现合并工具，保留旧工具名做兼容期或直接删除。
2. MCP golden test（`jgy-mcp/scripts/test-mcp-golden.mjs`）：更新 `tools/list` 断言和调用断言。
3. `skill.json`：更新 `tools` 数组。
4. `SKILL.md`：更新"使用示例"和所有引用旧工具名的段落。
5. `service_config`：提高 `skill_update.latest_version` 到新版 Skill 版本。
6. MCP 侧 README 工具表同步更新。

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
