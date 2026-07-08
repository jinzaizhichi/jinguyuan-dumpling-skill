# 金谷园饺子馆 Skill

![Version](https://img.shields.io/github/v/tag/JinGuYuan/jinguyuan-dumpling-skill?label=version&color=blue&sort=semver) ![License](https://img.shields.io/badge/license-MIT-green) ![MCP](https://img.shields.io/badge/protocol-MCP-purple) ![Transport](https://img.shields.io/badge/transport-Streamable%20HTTP-orange)

这是一个 AI Skill——安装后，你的 AI 助手就能查询金谷园饺子馆的信息：在哪吃、几点开门、外卖渠道、Wi-Fi 密码、这会儿排不排队、晚上几点开始排、明天午饭前几点去不用排、生饺子怎么煮。还能直接帮你在美团上排队取号。

开了快二十年的饺子馆，有了自己的AI服务。

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

本 Skill 内嵌了基于**美团排队**的取号能力，AI 助手可以直接帮你完成取号、查本人订单、取消排队等动作，无需打开美团 App。

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

1. 告诉 AI 助手你要排队，说明门店（北邮店 / 五道口店）
2. AI 查询可选桌型，跟你确认桌型和人数
3. 确认后自动取号，返回排队号和等待信息
4. 随时可查进度或取消

首次使用需完成美团账号授权（AI 助手会引导你完成），同一会话内无需重复登录。

## 安装

直接拷贝下面这句话发给你的 AI 助手：

> 帮我安装金谷园饺子馆 Skill，仓库地址：https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill

Agent 会自动克隆仓库并安装到对应的 Skill 目录。

## 发布平台

- GitHub：https://github.com/JinGuYuan/jinguyuan-dumpling-skill
- Gitee：https://gitee.com/JinGuYuan/jinguyuan-dumpling-skill

## 版本

版本号见顶部徽章，以 [`skill.json`](./skill.json) 为准。

> 说明：本 Skill 版本与内嵌排队组件（meituan-queue）版本独立演进，互不影响。

## License

[MIT](LICENSE)
