# MCP 接入（金谷园）

配置在 Skill 根目录 `skill.json` 的 `mcp_server` 字段。

| 字段 | 含义 |
|------|------|
| `url` | 远程端点（当前常见值 `https://mcp.jinguyuan.cloud`，**以文件为准**） |
| `transport` | `streamable-http` |

## 主路径：接入 MCP Server

每次新安装后的第一次金谷园查询，以及发现工具不可用时，都执行一次接入检查：

1. 先检查当前宿主是否已有金谷园 MCP 工具；已有则直接复用，不重复登记。
2. 若没有，读 `skill.json` → `mcp_server`。
3. 若宿主支持「添加 / 连接 MCP 服务器」（或已按 Skill 声明自动挂载），将金谷园 MCP **登记为持久远程端点**。
4. 用宿主 MCP 通道执行 `tools/list`（或等价能力）验证成功后，再处理用户问题。
5. 若宿主要求用户在 UI 中配置、授权或重启，明确给出 `url` 与 `transport` 并等待用户完成；不得声称已经接入，也不得直接用示例数据回答。
6. **不要**为每次查询现写 `curl`、临时 `.js` / `.py` 去拼 JSON-RPC。

用户问店 / 排队 / 生饺 / 动态等 → 直接 call 工具名（如 `get_shop_basics`）。  
完整工具列表以 **`tools/list`** 为准；`skill.json` 的 `tools` 仅为平台索引快照，可能不完整。

## 兜底：宿主没有 MCP 客户端时

只有确认宿主完全没有 MCP 客户端时，才允许对 `mcp_server.url` 发 JSON-RPC 2.0 POST。固定同一端点、复用连接 / 会话；**禁止**每轮新建一次性脚本文件。宿主只是“尚未配置 MCP”不等于“没有 MCP 客户端”，此时应优先完成持久接入。

```
POST <skill.json 中 mcp_server.url>
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_shop_basics",
    "arguments": {}
  }
}
```

其他工具：改 `params.name` / `arguments`；需要时先 `method: "tools/list"`。

## 协议说明

- 协议：MCP Streamable HTTP（POST 走 MCP；部分环境 GET 可返回业务 JSON）
- 实现部署：腾讯云 CloudBase（独立仓库 `jgy-mcp`，不是本 Skill 目录的业务服务代码）
