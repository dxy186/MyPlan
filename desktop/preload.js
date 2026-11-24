// 给页面一个很小的桥：点了系统通知后把藏在托盘里的窗口叫出来；换桌面图标
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myplanDesktop', {
  isDesktop: true,
  show: () => ipcRenderer.send('myplan:show-window'),
  setIcon: dataUrl => ipcRenderer.invoke('myplan:set-icon', dataUrl),
  resetIcon: () => ipcRenderer.invoke('myplan:reset-icon'),
  hasIcon: () => ipcRenderer.invoke('myplan:has-icon'),
});
