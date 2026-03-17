const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dashboardApi', {
  getSettings: () => ipcRenderer.invoke('dashboard:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('dashboard:save-settings', settings),
  testOpenAI: (config) => ipcRenderer.invoke('dashboard:test-openai', config),
  generatePriorities: (request) => ipcRenderer.invoke('dashboard:generate-priorities', request),
  reindexVectors: () => ipcRenderer.invoke('dashboard:reindex-vectors'),
  connectService: (service) => ipcRenderer.invoke('dashboard:connect-service', service),
  syncService: (service) => ipcRenderer.invoke('dashboard:sync-service', service),
  disconnectService: (service) => ipcRenderer.invoke('dashboard:disconnect-service', service),
})
