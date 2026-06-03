# Vibe Coding 代码助手

实时监控 AI Agent 写的代码，自动检测语法错误、重复代码，支持 AI 深度分析。

## 功能

### 三种接入方式

| 方式 | 说明 | 快速开始 |
|---|---|---|
| **MCP 协议** | 支持 MCP 的 AI Agent（如 Claude Code）自动推送 | 设置 → MCP 连接 → 一键启用 |
| **API 推送** | 任何 Agent 或脚本 POST 到本机端口 | `POST /api/report`，Body: `{ agent, path, content }` |
| **文件监控** | 设置监听目录，文件修改自动抓取 | 设置 → 监听文件夹 |

### 代码分析

- **语法检测** — Tree-sitter WASM 覆盖 91 种编程语言
- **重复检测** — 指纹比对，标记 100% 重复和相似代码
- **Diff 高亮** — 同一文件修改后自动计算行级 diff，绿色新增/红色删除
- **AI 深度分析** — 支持 DeepSeek / GLM，点"AI"按钮或开启自动分析

### 桌面体验

- Frameless 深色窗口，可拖拽、缩放、置顶
- 系统托盘驻留，关闭窗口不退出
- 窗口位置/大小自动记忆
- 键盘快捷键：`Ctrl+W` 关闭 · `Ctrl+,` 设置 · `Ctrl+L` 清空事件
- 实时状态栏显示事件数、代码行数、监控状态

## 安装

### 便携版（解压即用）

从 [Releases](https://github.com/ruatm1-wq/Acr-agent-reporter1/releases) 下载 `Vibe coding代码助手_v1.2.0.zip`，解压运行 `Vibe coding代码助手.exe`。

### 源码运行

```bash
npm install
npm start
```

## 配置

配置文件 `config.json` 位于应用根目录：

```json
{
  "aiProvider": "deepseek",
  "deepseekApiKey": "",
  "glmApiKey": "",
  "autoAnalyze": false,
  "watchDir": ""
}
```

- `aiProvider` — AI 模型：`deepseek` / `glm` / `ollama`
- `autoAnalyze` — 是否自动 AI 分析每次推送的代码

## API 文档

### 推送代码

```http
POST /api/report
Content-Type: application/json

{
  "agent": "agent-name",
  "path": "src/file.ts",
  "content": "code content here"
}
```

兼容字段：`code` → `content`，`file`/`filePath` → `path`。

### 查询事件

```http
GET /api/events
```

### 健康检查

```http
GET /api/ping
```

## MCP 配置

```json
{
  "mcpServers": {
    "acr-reporter": {
      "command": "node",
      "args": ["path/to/mcp-server.js"]
    }
  }
}
```

暴露工具：`push_code` — Agent 写代码后自动推送至桌面窗口。

## 技术栈

- **Electron 33** — 桌面壳
- **Tree-sitter WASM** — 语法分析引擎
- **web-tree-sitter** — WASM 绑定
- **DeepSeek / GLM API** — AI 代码审查
- **NSIS** — Windows 安装包
