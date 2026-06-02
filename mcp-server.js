#!/usr/bin/env node
/**
 * MCP Server — ACR-Agent代码助手 MCP 协议接入
 *
 * 用途：让支持 MCP 的 AI Agent（如 Claude Code）直接推送代码到 ACR 窗口
 * 协议：JSON-RPC 2.0 over stdio
 *
 * 用法：
 *   在 MCP 客户端配置中指向此脚本：
 *   {
 *     "mcpServers": {
 *       "acr-reporter": {
 *         "command": "node",
 *         "args": ["path/to/acr-reporter/mcp-server.js"]
 *       }
 *     }
 *   }
 *
 * 暴露的工具：
 *   - push_code: 推送代码到 ACR 窗口
 *    参数: { agent, path, content, action }
 */

const http = require('http')

const ACR_HOST = '127.0.0.1'
const ACR_PORT = 5112
const SERVER_NAME = 'acr-reporter'
const SERVER_VERSION = '0.1.0'

// ===== JSON-RPC 工具 =====
const tools = [
  {
    name: 'push_code',
    description: '将你创建或修改的代码文件实时推送到 ACR 桌面窗口展示。在输出代码文件之后，自动调用此工具让用户看到代码内容。参数 content 传入完整文件内容，path 传入文件路径。',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent 名称（显示在卡片标签上）',
          default: 'mcp'
        },
        path: {
          type: 'string',
          description: '文件路径（相对或绝对）'
        },
        content: {
          type: 'string',
          description: '文件内容'
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['write', 'edit', 'delete'],
          default: 'write'
        }
      },
      required: ['path', 'content']
    }
  }
]

// ===== MCP 协议处理 =====
function handleMessage(msg) {
  // 处理通知（没有 id 的消息）
  if (!msg.id) {
    // notifications/initialized 等忽略
    return
  }

  switch (msg.method) {
    case 'initialize':
      writeResponse(msg.id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION
        }
      })
      break

    case 'tools/list':
      writeResponse(msg.id, { tools })
      break

    case 'tools/call':
      handleToolCall(msg.id, msg.params)
      break

    case 'notified':
      // 忽略已通知
      writeResponse(msg.id, {})
      break

    default:
      if (msg.method && msg.method.startsWith('notifications/')) {
        // 忽略所有通知
        return
      }
      writeError(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

function handleToolCall(id, params) {
  const toolName = params?.name
  const args = params?.arguments || {}

  if (toolName === 'push_code') {
    pushCode(id, args)
  } else {
    writeError(id, -32601, `Unknown tool: ${toolName}`)
  }
}

function pushCode(id, args) {
  const { agent = 'mcp', path, content, action = 'write' } = args

  if (!path || !content) {
    writeError(id, -32602, 'Missing required arguments: path, content')
    return
  }

  const data = JSON.stringify({
    agent,
    action,
    path,
    content
  })

  const req = http.request({
    hostname: ACR_HOST,
    port: ACR_PORT,
    path: '/api/report',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  }, (res) => {
    let body = ''
    res.on('data', chunk => body += chunk)
    res.on('end', () => {
      try {
        const result = JSON.parse(body)
        writeResponse(id, {
          content: [{
            type: 'text',
            text: result.ok
              ? `✅ 代码已推送至 ACR 窗口\n文件: ${path}\n问题数: ${(result.issues || []).length}`
              : `❌ 推送失败: ${result.error || '未知错误'}`
          }]
        })
      } catch {
        writeResponse(id, {
          content: [{ type: 'text', text: `✅ 代码已推送: ${path}` }]
        })
      }
    })
  })

  req.on('error', (e) => {
    writeError(id, -32000, `无法连接 ACR 服务 (${ACR_HOST}:${ACR_PORT}): ${e.message}。请先启动 ACR 桌面应用。`)
  })

  req.write(data)
  req.end()
}

// ===== JSON-RPC 通信 =====
function writeResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result })
  process.stdout.write(msg + '\n')
}

function writeError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
  process.stdout.write(msg + '\n')
}

// ===== 启动 =====
const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const msg = JSON.parse(trimmed)
    handleMessage(msg)
  } catch (e) {
    console.error('MCP parse error:', e.message, '- raw:', trimmed)
  }
})

rl.on('close', () => {
  // 等待未完成的异步操作
  setTimeout(() => process.exit(0), 2000)
})

// 启动日志（stderr，不影响 stdout 的 JSON-RPC）
process.stderr.write('🟢 ACR MCP Server ready\n')
