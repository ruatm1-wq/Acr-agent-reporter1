# code-reporter 技能

## 作用
让你的代码被 agent-code-reporter 桌面工具实时看到和分析。

## 工作原理
每次你写代码（write_file / edit_file / multi_edit）后，将改动 **POST** 到 reporter 的 HTTP 端点。
reporter 会帮你检查语法、检测重复、分析引用，并在小窗口里实时展示。

## 接入方式

### 方式一：配置 endpoint（推荐，实时可靠）

在 Agent 配置文件里加上：

```yaml
# .reasonix/config.yaml 或 cc-haha 的配置
code_reporter:
  endpoint: http://localhost:5112/api/report
  enabled: true
```

之后每次 write_file / edit_file / multi_edit，Agent 运行时自动 POST 代码到 reporter。

### 方式二：手动触发（不推荐，可能遗漏）

每次写完代码后，手动调用：

```
POST http://localhost:5112/api/report
Content-Type: application/json

{
  "agent": "reasonix",
  "action": "write",
  "path": "src/example.ts",
  "content": "// 文件完整内容"
}
```

## 请求格式

| 字段 | 类型 | 说明 |
|:---|:---|:---|
| agent | string | 你的名字（reasonix / cc-haha / 其他） |
| action | string | write / edit / delete |
| path | string | 文件路径 |
| content | string | 文件完整内容 |

## 响应格式

```json
{
  "ok": true,
  "issues": [
    { "t": "ok",   "text": "语法通过" },
    { "t": "warn", "text": "代码重复",   "src": "tools.ts:42" },
    { "t": "err",  "text": "语法错误: ..." }
  ]
}
```

## 验证连通性

```bash
curl http://localhost:5112/api/ping
# 返回: {"ok":true,"port":5112,"events":0}
```

## 注意事项

- reporter 未启动时，连接失败不影响正常写代码
- 支持语言: JavaScript / TypeScript / Python
- 端口固定 5112，可在 main.js 中修改
