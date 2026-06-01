const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const http = require('http')
const https = require('https')
const path = require('path')
const fs = require('fs')
const { analyze, initParser } = require('./analyzer')

// ===== 文件监听配置 =====
const WATCH_EXTS = new Set(['.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.rs','.go','.java','.c','.h','.cpp','.hpp','.rb','.php','.swift','.kt','.kts','.cs','.dart','.scala','.lua','.r','.pl','.hs','.ex','.exs','.vue','.svelte','.astro','.zig','.nim','.ml','.clj','.cljs','.edn','.erl','.elm','.gd','.scm','.ss','.jl'])
const SKIP_DIRS = /\b(node_modules|dist|build|\.git|__pycache__|target|\.next|\.nuxt|\.venv|out|\.reasonix)\b/i
let WATCH_DIR = process.env.WATCH_DIR || 'D:\\reasoinx\\Reasonix'  // 默认监听 Reasonix 工作目录
const WATCH_DEBOUNCE = 500  // 500ms 防抖

let watchTimers = {}

/** 文件变化处理 */
function handleFileChange(filePath) {
  // 跳过非代码文件和忽略目录
  if (SKIP_DIRS.test(filePath)) return
  const ext = path.extname(filePath).toLowerCase()
  if (!WATCH_EXTS.has(ext)) return
  if (!fs.existsSync(filePath)) return

  // 防抖
  if (watchTimers[filePath]) clearTimeout(watchTimers[filePath])
  watchTimers[filePath] = setTimeout(() => {
    delete watchTimers[filePath]
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      if (!content.trim()) return

      const ev = {
        agent: 'file-watch',
        action: 'change',
        path: filePath,
        content,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        id: Date.now()
      }
      const issues = analyze(content, filePath)
      ev.issues = issues

      events.unshift(ev)
      if (events.length > MAX_EVENTS) events.length = MAX_EVENTS

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-event', events.slice(0, 20))
      }
    } catch {}
  }, WATCH_DEBOUNCE)
}

/** 启动文件监听 */
function restartWatcher(d) { if (d) { WATCH_DIR = d; startWatcher() } }

function startWatcher() {
  try { const c = JSON.parse(fs.readFileSync(CONFIG_PATH,"utf8")); if (c.watchDir) WATCH_DIR = c.watchDir } catch (e) {}
  if (!fs.existsSync(WATCH_DIR)) {
    console.log(`⚠️ 监听目录不存在: ${WATCH_DIR}`)
    return
  }
  try {
    fs.watch(WATCH_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      handleFileChange(path.join(WATCH_DIR, filename))
    })
    console.log(`👀 Watching: ${WATCH_DIR}`)
  } catch (e) {
    console.log(`⚠️ fs.watch error: ${e.message}`)
  }
}

// ===== AI API 配置 =====
const CONFIG_PATH = path.join(__dirname, 'config.json')

function getApiKey() {
  // 1. 环境变量
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  // 2. 配置文件
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    if (cfg.deepseekApiKey) return cfg.deepseekApiKey
  } catch {}
  return null
}

function callDeepSeek(code, filename) {
  return new Promise((resolve) => {
    const apiKey = getApiKey()
    if (!apiKey) {
      resolve({ ok: false, error: '请配置 API Key: 创建 config.json 写入 {"deepseekApiKey":"sk-..."}' })
      return
    }

    const ext = path.extname(filename || '').toLowerCase()
    const lang = ext === '.py' ? 'Python' : ext === '.ts' || ext === '.tsx' ? 'TypeScript' : 'JavaScript'

    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是一个专业的代码审查助手。分析用户提交的代码，用中文给出以下评价：\n1. 代码质量（优/良/中/差）\n2. 潜在问题（如果有）\n3. 优化建议（简洁具体）\n4. 安全风险（如果有）\n控制在150字以内，用短句。' },
        { role: 'user', content: `分析这段${lang}代码\n\`\`\`${filename}\n${code}\n\`\`\`` }
      ],
      stream: false,
      max_tokens: 500
    })

    const req = https.request({
      hostname: 'api.deepseek.com',
      path: '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    }, (res) => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.choices && json.choices[0]) {
            resolve({ ok: true, analysis: json.choices[0].message.content })
          } else {
            resolve({ ok: false, error: json.error?.message || 'API 返回异常' })
          }
        } catch {
          resolve({ ok: false, error: '解析 API 响应失败' })
        }
      })
    })
    req.on('error', (e) => resolve({ ok: false, error: e.message }))
    req.write(body)
    req.end()
  })
}

// ===== 状态 =====
let mainWindow = null
let tray = null
let events = []
const PORT = 5112
const MAX_EVENTS = 200

// ===== HTTP 服务 =====
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return
  }

  // 健康检查
  if (req.method === 'GET' && req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, port: PORT, events: events.length }))
    return
  }

  // 接收代码报告
  if (req.method === 'POST' && req.url === '/api/report') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        data.time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
        data.id = Date.now()

        // 分析
        const issues = analyze(data.content, data.path)

        events.unshift({ ...data, issues })
        if (events.length > MAX_EVENTS) events.length = MAX_EVENTS

        // 推送到窗口
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('new-event', events.slice(0, 20))
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, issues }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  // 获取事件列表
  if (req.method === 'GET' && req.url === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(events.slice(0, 50)))
    return
  }

  // AI 深度分析
  if (req.method === 'POST' && req.url === '/api/ai-analyze') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body)
        const ev = events.find(e => e.id === id)
        if (!ev) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: '事件不存在' })); return }

        const result = await callDeepSeek(ev.content, ev.path)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
    return
  }

  res.writeHead(404); res.end()
})

// ===== 窗口 =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 660,
    resizable: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.setMinimumSize(360, 480)

  // 置顶控制
  ipcMain.on('toggle-pin', () => {
    const pinned = !mainWindow.isAlwaysOnTop()
    mainWindow.setAlwaysOnTop(pinned)
    mainWindow.webContents.send('pin-changed', pinned)
  })

  ipcMain.on('minimize-window', () => mainWindow.minimize())
  ipcMain.on('close-window', () => mainWindow.hide())

  // AI 分析 IPC
  ipcMain.handle('ai-analyze', async (_, id) => {
    const ev = events.find(e => e.id === id)
    if (!ev) return { ok: false, error: '事件不存在' }
    return await callDeepSeek(ev.content, ev.path)
  })

  // 设置 IPC
  ipcMain.handle('get-watch-dir', () => WATCH_DIR)

  ipcMain.handle('set-watch-dir', (_, dir) => {
    try {
      const c = JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')||'{}')
      c.watchDir = dir
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(c,null,2))
      if (mainWindow && !mainWindow.isDestroyed()) {
        const ev = { agent:'system', action:'info', path:'Watch changed', content:'', time:new Date().toLocaleTimeString('zh-CN',{hour12:false}), id:Date.now(), issues:[{t:'ok',text:'Watching: '+dir}] }
        events.unshift(ev)
        if (events.length > 200) events.length = 200
        mainWindow.webContents.send('new-event', events.slice(0,20))
      }
      return { ok: true }
    } catch(e) { return { ok: false, error: e.message } }
  })

  ipcMain.handle('get-config', () => {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      }
    } catch {}
    return {}
  })

  ipcMain.handle('save-config', (_, cfg) => {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // 初始状态发送
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('init', events.slice(0, 20))
  })
}

// ===== 系统托盘 =====
function createTray() {
  // 用文字图标替代，避免找不到图标文件
  tray = new Tray(nativeImage.createEmpty())
  const ctx = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow.show() },
    { label: '退出', click: () => { app.isQuitting = true; app.quit() } }
  ])
  tray.setToolTip('agent-code-reporter :5112')
  tray.setContextMenu(ctx)
  tray.on('double-click', () => mainWindow.show())
}

// ===== 生命周期 =====
app.whenReady().then(async () => {
  startWatcher()
    await initParser()
  server.listen(PORT, () => console.log(`🟢 HTTP :${PORT}`))
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  server.close()
})
