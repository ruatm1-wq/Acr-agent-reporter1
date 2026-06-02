const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } = require('electron')
const http = require('http')
const https = require('https')
const path = require('path')
const fs = require('fs')
const { analyze, initParser, computeDiff } = require('./analyzer')

// ===== 单实例锁 =====
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) return app.quit()
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

// ===== 配置读写 =====
const CONFIG_PATH = path.join(__dirname, 'config.json')
function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch {}
  return {}
}
function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

// ===== 文件监控 =====
const WATCH_EXTS = new Set(['.py','.js','.mjs','.cjs','.ts','.tsx','.jsx','.rs','.go','.java','.c','.h','.cpp','.hpp','.rb','.php','.swift','.kt','.kts','.cs','.dart','.scala','.lua','.r','.pl','.hs','.ex','.exs','.vue','.svelte','.astro','.zig','.nim','.ml','.clj','.cljs','.edn','.erl','.elm','.gd','.scm','.ss','.jl'])
const SKIP_DIRS = /\b(node_modules|dist|build|\.git|__pycache__|target|\.next|\.nuxt|\.venv|out)\b/i
let watcher = null
let watchDir = ''
const DEBOUNCE_MS = 500
let debounceTimers = {}

function startWatcher(dir) {
  stopWatcher()
  if (!dir) return
  watchDir = dir
  if (!fs.existsSync(watchDir)) return
  try {
    watcher = fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      const fp = path.join(watchDir, filename)
      if (SKIP_DIRS.test(fp)) return
      const ext = path.extname(fp).toLowerCase()
      if (!WATCH_EXTS.has(ext)) return
      if (!fs.existsSync(fp)) return
      if (debounceTimers[fp]) clearTimeout(debounceTimers[fp])
      debounceTimers[fp] = setTimeout(() => {
        delete debounceTimers[fp]
        // 如果刚被 API 推送过，跳过文件监控
        var lastPush = recentPushes.get(fp)
        if (lastPush && Date.now() - lastPush < 5000) { recentPushes.delete(fp); return }
        try {
          const content = fs.readFileSync(fp, 'utf8')
          if (!content.trim()) return
          pushEvent({
            agent: 'file-watch',
            action: 'change',
            path: fp,
            content,
            time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            id: Date.now(),
            issues: analyze(content, fp)
          })
        } catch {}
      }, DEBOUNCE_MS)
    })
  } catch {}
}

function stopWatcher() {
  if (watcher) { watcher.close(); watcher = null }
}

// ===== 事件存储 =====
const events = []
const MAX_EVENTS = 200
const recentPushes = new Map()  // 防止 API 推送和文件监控重复

function pushEvent(ev) {
  events.unshift(ev)

  // 计算 diff：对比同一文件的上一个事件
  if (ev.content && ev.path) {
    const len = Math.min(events.length, MAX_EVENTS)
    for (let i = 1; i < len; i++) {
      const prev = events[i]
      if (prev && prev.path === ev.path && prev.content && prev.content !== ev.content) {
        ev.diff = computeDiff(prev.content, ev.content)
        break
      }
    }
  }
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('new-event', events.slice(0, 20))
  }
  // 自动 AI 分析
  const cfg = readConfig()
  if (cfg.autoAnalyze && ev.content && ev.content.length > 20) {
    callAI(ev.content, ev.path).then(result => {
      if (!result.ok) return
      // 更新事件数组中的 aiResult
      for (const e of events) {
        if (e.id === ev.id) { e.aiResult = result.analysis; break }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-result', { id: ev.id, result: result.analysis })
      }
    }).catch(() => {})
  }
}

// ===== HTTP 服务 =====
const PORT = 5112
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // 健康检查
  if (req.method === 'GET' && req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, port: PORT, events: events.length }))
    return
  }

  // 接收代码推送
  if (req.method === 'POST' && req.url === '/api/report') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        const data = JSON.parse(body)
        data.time = data.time || new Date().toLocaleTimeString('zh-CN', { hour12: false })
        data.id = data.id || Date.now()
        data.issues = analyze(data.content || '', data.path || '')
        if (data.path) recentPushes.set(data.path, Date.now())
        pushEvent(data)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, issues: data.issues }))
      } catch (e) {
        res.writeHead(400)
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

  res.writeHead(404); res.end()
})

// ===== AI 分析 =====
function callAI(code, filename) {
  const cfg = readConfig()
  const provider = cfg.aiProvider || 'deepseek'
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'glm-4-flash'
  const apiKey = cfg.deepseekApiKey || cfg.glmApiKey || process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) return Promise.resolve({ ok: false, error: '请先在设置中配置 API Key' })

  const ext = path.extname(filename || '').toLowerCase()
  const lang = ext === '.py' ? 'Python' : /\.tsx?/.test(ext) ? 'TypeScript' : ext === '.js' || ext === '.mjs' ? 'JavaScript' : (ext || '').slice(1) || '代码'

  const hostname = provider === 'glm' ? 'open.bigmodel.cn' : 'api.deepseek.com'
  const apiPath = provider === 'glm' ? '/api/paas/v4/chat/completions' : '/chat/completions'

  return new Promise(resolve => {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是一个专业的代码审查助手。分析用户提交的代码，用中文给出以下评价：\n1. 代码质量（优/良/中/差）\n2. 潜在问题（如果有）\n3. 优化建议（简洁具体）\n4. 安全风险（如果有）\n控制在150字以内，用短句。' },
        { role: 'user', content: `分析这段${lang}代码\n\`\`\`${filename}\n${code}\n\`\`\`` }
      ],
      stream: false,
      max_tokens: 500
    })

    const req = https.request({ hostname, path: apiPath, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` } }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.choices && json.choices[0]) resolve({ ok: true, analysis: json.choices[0].message.content })
          else resolve({ ok: false, error: json.error?.message || 'API 返回异常' })
        } catch { resolve({ ok: false, error: '解析 API 响应失败' }) }
      })
    })
    req.on('error', e => resolve({ ok: false, error: e.message }))
    req.write(body)
    req.end()
  })
}

// ===== 窗口 =====
let mainWindow = null
let tray = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440, height: 660, resizable: true,
    frame: false, transparent: false, backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  })

  // 先注册 did-finish-load，再 loadFile（防止加载太快 listener 错过事件）
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('init', events.slice(0, 20))
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.setMinimumSize(360, 480)

  // IPC: 窗口控制
  ipcMain.on('toggle-pin', () => {
    const pinned = !mainWindow.isAlwaysOnTop()
    mainWindow.setAlwaysOnTop(pinned)
    mainWindow.webContents.send('pin-changed', pinned)
  })
  ipcMain.on('minimize-window', () => mainWindow.minimize())
  ipcMain.on('close-window', () => mainWindow.hide())
  ipcMain.on('toggle-maximize', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  mainWindow.on('maximize', () => mainWindow.webContents.send('maximize-changed', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('maximize-changed', false))

  // IPC: AI 分析
  ipcMain.handle('ai-analyze', async (_, id) => {
    const ev = events.find(e => e.id === id)
    if (!ev) return { ok: false, error: '事件不存在' }
    return await callAI(ev.content, ev.path)
  })

  // IPC: 设置
  ipcMain.handle('get-watch-dir', () => watchDir)
  ipcMain.handle('set-watch-dir', (_, dir) => {
    try {
      const cfg = readConfig()
      cfg.watchDir = dir
      writeConfig(cfg)
      startWatcher(dir)
      pushEvent({ agent:'system', action:'info', path:'Watch', content:'', time:new Date().toLocaleTimeString('zh-CN',{hour12:false}), id:Date.now(), issues:[{t:'ok',text:'监控目录: '+dir}] })
      return { ok: true }
    } catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('get-config', () => readConfig())
  ipcMain.handle('save-config', (_, cfg) => {
    try { writeConfig(cfg); return { ok: true } }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('show-open-dialog', async () => {
    return await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  })
  ipcMain.handle('get-init-events', () => events.slice(0, 20))
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty())
  const ctx = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit() } }
  ])
  tray.setToolTip('ACR-Agent代码助手 :5112')
  tray.setContextMenu(ctx)
  tray.on('double-click', () => mainWindow.show())
}

// ===== 生命周期 =====
app.whenReady().then(async () => {
  const cfg = readConfig()
  if (cfg.watchDir) startWatcher(cfg.watchDir)
  await initParser()
  server.listen(PORT)
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  stopWatcher()
  server.close()
})
