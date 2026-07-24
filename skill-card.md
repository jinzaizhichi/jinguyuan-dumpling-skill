## Description: <br>
金谷园饺子馆 Skill helps agents answer restaurant information questions and handle online queue-number actions for 金谷园饺子馆 using current MCP data and local Meituan authorization when needed. <br>

This skill is intended for users who understand and accept local Meituan authorization for live queue actions. Ordinary restaurant and queue-status questions use the public Jin Guyuan MCP endpoint and do not require Meituan login. <br>

## Publisher: <br>
[jinguyuan](https://clawhub.ai/user/jinguyuan) <br>

### License/Terms of Use: <br>
MIT-0 <br>

## Use Case: <br>
External users and agents use this skill to check 金谷园饺子馆 locations, hours, delivery, recommendations, queue status, pickup information, and to request Meituan queue-number, progress, or cancellation actions after explicit same-turn confirmation. <br>

### Deployment Geography for Use: <br>
Global <br>

## Known Risks and Mitigations: <br>
Risk: Meituan account authorization is required for live queue operations, and local tokens are stored on the user's machine. <br>
Mitigation: Install only when this authorization model is acceptable, do not display tokens, and use the skill's logout action to clear local auth when finished. <br>
Risk: Taking a queue number or cancelling a queue number can change live restaurant queue state. <br>
Mitigation: Require explicit same-turn confirmation before live queue-number or cancellation commands, and restate the store, party size, and table type before execution. <br>
Risk: A temporary authorization poller may run while the user completes login. <br>
Mitigation: Use the documented auth-start/auth-status flow, avoid blocking polling in conversation, and stop or clear authorization if the user cancels or times out. <br>
Risk: 五道口店通常以到店取号为主，但 may occasionally show online queue availability in fresh platform data. <br>
Mitigation: Do not present 五道口店 as online-queue capable unless the same-turn fresh MCP snapshot or Meituan shop index shows current online-queue support. <br>

## Reference(s): <br>
- [ClawHub skill listing](https://clawhub.ai/jinguyuan/skills/jinguyuan-dumpling-skill) <br>
- [金谷园 official website](https://jinguyuan.cloud) <br>
- [金谷园 MCP endpoint](https://mcp.jinguyuan.cloud) <br>
- [MCP access reference](references/mcp-access.md) <br>
- [MCP reply contract](references/mcp-reply-contract.md) <br>
- [Queue actions reference](references/queue-actions.md) <br>

## Skill Output: <br>
**Output Type(s):** [text, markdown, shell commands, guidance] <br>
**Output Format:** [Markdown text with inline command guidance and JSON command results when queue actions are run] <br>
**Output Parameters:** [1D] <br>
**Other Properties Related to Output:** [May include QR-code image links for Meituan authorization and must distinguish current, stale, historical, and personal queue information.] <br>

## Skill Version(s): <br>
2.3.0 (source: release evidence, SKILL.md frontmatter, skill.json, package.json) <br>

## Ethical Considerations: <br>
Users should evaluate whether this skill is appropriate for their environment, review any generated or modified files before relying on them, and apply their organization's safety, security, and compliance requirements before deployment. <br>
