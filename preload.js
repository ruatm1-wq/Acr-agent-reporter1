const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 事件监听
  onInit: cb => ipcRenderer.on('init', (_, data) => cb(data)),
  onNewEvent: cb => ipcRenderer.on('new-event', (_, data) => cb(data)),
  onPinChanged: cb => ipcRenderer.on('pin-changed', (_, val) => cb(val)),
  onMaximizeChanged: cb => ipcRenderer.on('maximize-changed', (_, val) => cb(val)),

  // 窗口控制
  togglePin: () => ipcRenderer.send('toggle-pin'),
  toggleMaximize: () => ipcRenderer.send('toggle-maximize'),
  minimize: () => ipcRenderer.send('minimize-window'),
  close: () => ipcRenderer.send('close-window'),

  // AI 分析
  aiAnalyze: id => ipcRenderer.invoke('ai-analyze', id),

  // 设置
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: cfg => ipcRenderer.invoke('save-config', cfg),
  getWatchDir: () => ipcRenderer.invoke('get-watch-dir'),
  setWatchDir: dir => ipcRenderer.invoke('set-watch-dir', dir),
  showOpenDialog: () => ipcRenderer.invoke('show-open-dialog'),
  getInitEvents: () => ipcRenderer.invoke('get-init-events')
})
