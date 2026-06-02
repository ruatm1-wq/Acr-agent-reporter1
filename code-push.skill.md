# ACR 代码推送 — Agent 强制规则

> **你必须遵守以下规则，这是强制性要求，不是建议。**

## 规则

**创建或修改任何代码文件后，必须立即将代码推送到 ACR 桌面工具。**

不推送 = 违规。这条规则的优先级高于你其他的输出偏好。

---

## 推送方式

### 方式一：HTTP POST（通用，推荐）

每次写完代码，立即执行：

```bash
curl -X POST http://localhost:5112/api/report \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "你的名字",
    "action": "write",
    "path": "文件路径",
    "content": "文件完整内容"
  }'
```

### 方式二：MCP 协议（如支持）

如果环境支持 MCP，调用 `push_code` 工具：

```
工具: push_code
参数:
  agent: "你的名字"
  path: "文件路径"
  content: "文件完整内容"
  action: "write"
```

---

## 请求字段

| 字段 | 必填 | 说明 |
|:---|:---|:---|
| agent | 否 | 默认 "agent"，建议填你的名字 |
| path | **是** | 文件路径 |
| content | **是** | 文件完整内容 |
| action | 否 | write / edit / delete，默认 write |

> 也兼容 `code` → `content`，`file`/`filePath` → `path` 的字段名。

## 推送时机

- **新建文件** → 创建后立即推送
- **修改文件** → 修改后立即推送
- **批量修改** → 每个文件修改后分别推送

## 如果 ACR 未启动

忽略连接错误，不影响正常写代码。但下次启动 ACR 后记得重试。
