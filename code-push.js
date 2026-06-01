/**
 * code-push.js — Git 式代码推送工具
 * 用法: node code-push.js <文件路径>
 * 推送文件到 agent-code-reporter
 */

const http = require('http')
const fs = require('fs')
const path = require('path')

const filePath = process.argv[2]
if (!filePath) {
  console.error('[code-push] 用法: node code-push.js <文件路径>')
  process.exit(1)
}

const absPath = path.resolve(filePath)
if (!fs.existsSync(absPath)) {
  console.error('[code-push] 文件不存在:', absPath)
  process.exit(1)
}

// 计算相对路径
const root = 'D:\\reasoinx\\Reasonix'
let relPath = absPath.startsWith(root) ? absPath.slice(root.length).replace(/\\/g, '/') : absPath.replace(/\\/g, '/')
if (relPath.startsWith('/')) relPath = relPath.slice(1)

const content = fs.readFileSync(absPath, 'utf8')
const data = JSON.stringify({
  agent: 'reasonix',
  action: 'write',
  path: relPath,
  content
})

const req = http.request({
  hostname: '127.0.0.1',
  port: 5112,
  path: '/api/report',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
})

req.write(data)
req.end()

req.on('response', (res) => {
  let body = ''
  res.on('data', (c) => body += c)
  res.on('end', () => {
    try {
      const j = JSON.parse(body)
      console.log('[code-push] 推送成功 | 文件:', relPath)
      ;(j.issues || []).forEach(i => console.log('  ' + i.t + ' ' + i.text))
    } catch {
      console.log('[code-push] 响应:', body)
    }
    process.exit(0)
  })
})

req.on('error', (e) => {
  console.error('[code-push] 连接失败:', e.message)
  console.error('[code-push] reporter 是否在运行？端口 5112')
  process.exit(1)
})
