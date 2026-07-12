# MCP 接入（金谷园）

配置在 Skill 根目录 `skill.json` 的 `mcp_server` 字段。

| 字段 | 含义 |
|------|------|
| `url` | 远程端点（当前常见值 `https://mcp.jinguyuan.cloud`，**以文件为准**） |
| `transport` | `streamable-http` |

## 主路径：接入 MCP Server

1. 读 `skill.json` → `mcp_server`。
2. 若宿主支持「添加 / 连接 MCP 服务器」（或已按 Skill 声明自动挂载），将金谷园 MCP **登记为远程端点并保持会话内可用**。
3. 用宿主 MCP 通道调用工具（`tools/list` / `tools/call` 的等价能力）。
4. **不要**为每次查询现写 `curl`、临时 `.js` / `.py` 去拼 JSON-RPC。

用户问店 / 排队 / 生饺 / 动态等 → 直接 call 工具名（如 `get_shop_basics`）。  
完整工具列表以 **`tools/list`** 为准；`skill.json` 的 `tools` 仅为平台索引快照，可能不完整。

## 兜底：宿主没有 MCP 客户端时

才允许对 `mcp_server.url` 发 JSON-RPC 2.0 POST。固定同一端点、复用连接 / 会话；**禁止**每轮新建一次性脚本文件。

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
