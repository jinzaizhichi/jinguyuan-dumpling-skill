# 金谷园饺子馆 Skill

![Version](https://img.shields.io/github/v/tag/JinGuYuan/jinguyuan-dumpling-skill?label=version&color=blue&sort=semver) ![License](https://img.shields.io/badge/license-MIT-green) ![MCP](https://img.shields.io/badge/protocol-MCP-purple) ![Transport](https://img.shields.io/badge/transport-Streamable%20HTTP-orange)

这是一个 AI Skill——安装后，你的 AI 助手就能帮你查金谷园在哪、几点开门、这会儿排不排队、几点去更稳，也能查推荐菜、外卖和生饺子吃法。北邮店需要时，还能帮你在线排队取号。

开了快二十年的饺子馆，有了自己的AI服务。


## 版本线说明

- **当前默认（本仓库 `main`）**：Skill **2.x**（纯 Node 排队运行时，无需 npm 安装依赖）。
- **1.x 冻结线**：请使用分支 [`1.x`](https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill/tree/1.x) 或 tag [`v1.0.2`](https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill/tree/v1.0.2) / [`v1-stable`](https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill/tree/v1-stable)。1.x 含嵌套 meituan-queue 安装形态，**不再作为默认安装源**。

## 关于金谷园

北邮旁边的饺子馆。官网：[jinguyuan.cloud](https://jinguyuan.cloud)

| 项目 | 内容 |
|------|------|
| 餐厅名称 | 金谷园饺子馆 |
| 营业时间 | 10:00 - 22:00（以实际查询为准） |
| 北邮店 | 杏坛路文教产业园K座南2层 |
| 五道口店 | 五道口东源大厦4层 |

## 这个 Skill 能做什么

金谷园饺子馆的官方信息服务，可以查店、查活动、查推荐菜，也能处理到店自取和排队取号这些具体场景：

| 能力 | 你可以问 |
|------|----------|
| 餐厅信息 | "金谷园在哪？""几点开门？""能外卖吗？""Wi-Fi 密码？" |
| 推荐菜 | "有什么好吃的？""今天吃什么""招牌菜" |
| **到店自取** | "帮我来份饺子""提前点餐到店取" |
| 排队信息&建议 | "这会儿排队吗？""晚上七点去用排么？""几点去不用排？" |
| **排队取号** | "帮我排个队""取消排队""排队进度" |
| 生饺子打包 | "能打包吗？""生饺子怎么煮？" |
| 最新消息 | "有什么新活动？" |

## 在线排队取号

本 Skill 内置了基于**美团排队**的真实动作，AI 助手可以帮你取号、查本人订单和取消排队。取号和取消前，都会再跟你确认一次。

> 在线取号目前用于北邮总店；五道口店不引导在线取号。

**支持的操作：**

| 操作 | 说明 | 你可以说 |
|------|------|----------|
| 查询排队状态 | 查看当前等待桌数和排队压力 | "金谷园现在排队情况怎么样？" |
| 查询餐段事实 | 查询已经发生的午市/晚市实际观测 | "今天中午几点开始排？" |
| 查询餐段建议 | 参考前一天和上周同日，给未来餐段建议 | "明天中午几点去比较稳？" |
| 取号 | 选择桌型和人数，在线取号 | "帮我在北邮店排个队，2个人" |
| 查询进度 | 查看当前排队号、前方等待桌数 | "我前面还有几桌？" |
| 取消排队 | 取消已有的排队订单 | "取消排队" |

**使用流程：**

1. 告诉 AI 助手你要在北邮店排队
2. AI 查询可选桌型，跟你确认桌型和人数
3. 确认后自动取号，返回排队号和等待信息
4. 随时可查进度或取消

首次使用需完成美团账号授权（AI 助手会引导你完成）。授权在本机保存，跨会话或重装 Skill 后也可继续使用；Token 不会展示给你。

### 关于美团授权组件（说明一下）

只查店、查排队状态时，走金谷园自己的 MCP，**不会**加载美团登录组件。

只有你要 **真实取号 / 查本人排队进度 / 取消排队** 时，本机才会运行 Skill 里随包附带的美团用户授权工具（`@mtuser/pt-passport`，以及它依赖的 `@sec/cliguard` 签名核心）。它负责 **Passport 登录、接口请求签名与设备侧风控校验**。

签名核心是上游提供的混淆代码，审查者可将它按安全敏感依赖处理。Skill 已移除上游入口中加载即启动的后台守护进程、用户目录动态更新机制和 `http/https` 全局拦截，只保留 Passport 实际需要的 `fetch` 请求签名与公参注入。金谷园自己的排队编排和适配层（如 `scripts/queue.js` 及签名入口 `index.js`）均为明文，可直接审查。

授权产生的登录凭证只保存在你本机用户目录（`~/.jinguyuan/`），不会打进 Git 仓库，也不会发给金谷园 MCP。若只想用查询、不想走美团授权，不发起取号即可。

## 运行环境

这是一个单 Skill，支持 Windows、macOS 和 Linux。真实排队动作需要 Node.js 18 或更高版本，无需 npm 安装。

## 安装

直接拷贝下面这句话发给你的 AI 助手：

> 安装 https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill-v2

Agent 会自动克隆仓库并安装到对应的 Skill 目录。

安装后无需先配置 MCP：宿主已有金谷园 MCP 时直接使用；没有时由随包纯 JS 客户端完成实时查询，不生成临时脚本。

## 发布平台

- GitHub：https://github.com/JinGuYuan/jinguyuan-dumpling-skill
- Gitee：https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill

## 版本

版本号见顶部徽章，以 [`skill.json`](./skill.json) 为准。

## License

[MIT](LICENSE)
