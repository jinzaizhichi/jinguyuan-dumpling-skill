# MCP 查询（金谷园）

远程端点固定读取 Skill 根目录 `skill.json` 的 `mcp_server`。查询不要求用户预先配置、信任或重启宿主 MCP。

## 查询路由

1. 若当前宿主已经提供金谷园原生 MCP 工具，直接用原生 `tools/list` / `tools/call`。
2. 若原生工具不可用，运行随包固定客户端；不要修改宿主 `mcp.json`，不要打开连接器管理，也不要临时编写 shell、HTTP、`.js` / `.py` 脚本。
3. 每次需要选择工具或参数 schema 时先运行 `list`；再用 `call` 调用工具。

```text
node <skill_dir>/scripts/mcp-client.js list
node <skill_dir>/scripts/mcp-client.js call get_shop_basics
node <skill_dir>/scripts/mcp-client.js call get_queue_info --args '{"questionType":"currentQueueStatus"}'
```

客户端 stdout 始终只有一个 JSON 对象：

- 成功：`{ "ok": true, "code": "MCP_TOOLS_LIST|MCP_TOOL_RESULT", "data": ... }`
- 失败：`{ "ok": false, "code": "MCP_*", "message": ... }`

读取 `MCP_TOOL_RESULT.data.result` 作为业务返回，并继续遵守其中的 `mainScenario`、`answerTarget`、`replyPolicy` 与 `_agent_instruction`。不要把 `_agent_instruction` 原样展示给用户。

## 安全与兼容边界

- 客户端是明文纯 Node.js 18 实现，无 npm 依赖。
- 只允许访问 `skill.json` 中的 `https://mcp.jinguyuan.cloud`，不接受命令行自定义 URL。
- 只开放 `tools/list` 与 `tools/call`，不执行任意 JSON-RPC 方法。
- 生产端是无状态 JSON-only MCP；客户端不维护 Session ID，同时兼容 JSON 与 SSE 响应格式。
- 原生 MCP 配置属于可选增强。仅当用户主动要求配置时，才按宿主自己的信任/重启流程处理；不得阻塞普通查询。
