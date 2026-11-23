// 给页面一个很小的桥：点了系统通知后把藏在托盘里的窗口叫出来
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myplanDesktop', {
  isDesktop: true,
  show: () => ipcRenderer.send('myplan:show-window'),
});
