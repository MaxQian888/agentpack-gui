<div align="center">

# agentpack

**看清 AI 编程到底花了多少钱，顺手把各个 CLI 的配置也管了。**

一个跨平台桌面应用，管 Claude Code、Codex、OpenCode 和 Pi：从你自己的会话历史里读出真实
花销，然后在同一个窗口里装 CLI、切账号和镜像、管理 skills 和 MCP 服务器。

[English](./README.md) · [下载](https://github.com/Arxtect/agentpack-gui/releases) · [参与贡献](./CONTRIBUTING.md)

<img src="./docs/assets/usage-card.svg" alt="agentpack 花销卡片 — 示例数据" width="720">

<sub>上面这张图就是 agentpack 自己导出的（示例数据），你可以在用量看板里导出自己的。</sub>

</div>

---

## 为什么做这个

`ccusage` 这类工具能告诉你 agent 花了多少钱，CLI 的配置文件能告诉你环境是怎么配的 ——
但没有东西把两者连起来。所以当那个数字让你意外的那一刻，你还是得回到终端里手改 JSON。

agentpack 把两件事放进同一个窗口：看到花销，然后当场处理 —— 换一个更便宜的服务商、切到
镜像、关掉那个你从来没用过的 MCP 服务器。

所有内容都读写 CLI 本来就在用的那些文件。没有账号、没有埋点、没有服务端 —— agentpack
只读你的磁盘，没有任何东西离开你的电脑。

## 它能做什么

**花销与历史**

- 直接从磁盘**只读**解析 Claude Code（JSONL）、Codex（rollout JSONL）、OpenCode
  （SQLite）和 Pi（v1–v3 树形 JSONL）的会话历史。
- 首页显示本月至今花销；完整看板包含成本趋势、5 小时计费窗口、消耗速率、按模型和按项目
  的拆分。
- 来源本身记录了费用的（OpenCode）是**精确值**；Pi 的 `usage.cost.total` 明确标为
  **来源估算**；其余是**按 token 数估算**。没有已知价格
  的模型会被明确标为「未定价」，绝不当成真实的 `$0` 混进总额。
- 浏览和阅读历史对话，包括 sub-agent 的运行记录。
- 导出 CSV/JSON 给表格用，或导出一张可分享的卡片 / Markdown 摘要。

**安装与配置**

- 安装或升级 Claude Code、Codex、OpenCode、Pi、cc-switch、cc-connect，以及它们依赖的
  Node / Bun / Python / uv；在 Windows 10 2004 及以上版本中，还会检测并安装缺失的
  Windows 终端。命令输出实时流式显示，升级会匹配当初的安装方式，不会留下两份互相遮蔽
  的副本。
- **Pi 管理**：管理全局/项目 Packages 与四类资源过滤，查看项目 Trust 和脱敏后的
  Provider 认证状态；登录/登出仍由 Pi 官方交互流程完成。
- **Skills 管理**，覆盖 `~/.claude`、`~/.codex`、`~/.opencode`、`~/.pi/agent` 和 `~/.agents`：查看已装
  内容、从 GitHub 仓库安装、检查更新、删除前自动备份、处理重名冲突。
- **MCP 服务器**：精选目录 + 官方 MCP registry 搜索，健康检查会真的跑一次 `initialize`
  握手，支持 `mcpServers` 配置块的导入导出。
- **网络 / 镜像**与代理配置，落地前可以先发一个真实请求验证代理是否可用。
- **cc-switch** 服务商与账号管理（含其 SQLite 库的备份），以及 **cc-connect** 桥接控制。

**它的行为方式**

- **试运行预览**：动手之前先看到每一条「将写入 / 将执行」。预览模式下**完全不会**调用任何
  会改动系统的命令。
- 中英双语。
- 可以把整套配置存成文件，之后一键还原。

## 安装

从 **[Releases](https://github.com/Arxtect/agentpack-gui/releases/latest)** 下载对应平台的安装包：

| 平台    | 文件                     |
| ------- | ------------------------ |
| macOS   | `.dmg`                   |
| Windows | `.msi` 或 `.exe`（NSIS） |
| Linux   | `.AppImage`、`.deb`      |

装好之后应用会自己更新 —— 在「关于」页面里检查更新即可。

### ⚠️ macOS 提示「已损坏，无法打开」

它没有损坏。这个版本还没有经过 Apple 公证（那要 $99/年），而 macOS 对**所有**未公证的
下载都会显示这句有误导性的提示。把应用拖进「应用程序」，然后执行一次：

```bash
xattr -dr com.apple.quarantine /Applications/agentpack.app
```

维护者：[`src-tauri/MACOS_SIGNING.md`](src-tauri/MACOS_SIGNING.md) 写了一次性的签名 +
公证配置，配好之后这段提示就再也用不上了。

### ⚠️ Windows 弹 SmartScreen 警告

点「更多信息」→「仍要运行」。原因一样：安装包还没有签名。

## 常见问题

**它会把我的数据传到哪里吗？**
不会。没有埋点，也没有后端。会话历史从你的磁盘读取并留在原地。唯一的外部请求都是你主动
触发的：从 GitHub 拉取 skill、查询 MCP registry、去 npm 查 CLI 的新版本、测试代理或服务
商连通性，以及检查应用更新。

**费用数字准吗？**
OpenCode 是精确的，因为它自己记录了真实费用。Claude Code 和 Codex 是按 token 数估算的，
价格表在 [`lib/history/pricing.ts`](./lib/history/pricing.ts)。如果你用的是订阅制套餐，
这个数字不会等于你的账单 —— 因为订阅本来就不是按 token 计费的。没有已知价格的模型会单独
标出来，而不是被算进总额。

**我只用一个 CLI，能用吗？**
能。所有功能都是按工具独立的，没装的工具对应的区块就是空的。

**为什么第一次启动比较慢？**
首次扫描要解析磁盘上的所有会话记录，历史多的话大约 17 秒。之后会走缓存，再次启动约
200 毫秒。

**它会不打招呼就改我的配置文件吗？**
不会。打开试运行可以先看到所有将要发生的写入；真正执行时每条命令和每处改动都会实时显示。
cc-switch 的数据库在写入前会自动备份。

## 从源码构建

需要 **Node 20+**、**pnpm 10+** 和 **Rust 1.95+**。

```bash
git clone https://github.com/Arxtect/agentpack-gui.git
cd agentpack-gui
pnpm install
pnpm tauri dev     # 桌面应用，支持热重载
pnpm tauri build   # 生产安装包
```

`pnpm dev` 会在 <http://localhost:3000> 用浏览器跑界面，适合调布局；但所有会触碰系统的
操作都是 Tauri 命令，所以安装、扫描、写文件只有在桌面应用里才能真正工作。

架构说明、目录结构、测试方式和贡献流程都在
**[CONTRIBUTING.md](./CONTRIBUTING.md)**。

## 许可证

[MIT](./LICENSE)
