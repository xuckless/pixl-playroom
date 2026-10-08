/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS dev spike, never shipped */
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('spike', {
  headroom: () => ipcRenderer.invoke('headroom'),
  done: (r) => ipcRenderer.send('done', r)
})
