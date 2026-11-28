// 给页面一个很小的桥：点了系统通知后把藏在托盘里的窗口叫出来；换桌面图标
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myplanDesktop', {
  isDesktop: true,
  version: (() => {
    try {
      return ipcRenderer.sendSync('myplan:version');
    } catch {
      return '';
    }
  })(),
  show: () => ipcRenderer.send('myplan:show-window'),
  setIcon: dataUrl => ipcRenderer.invoke('myplan:set-icon', dataUrl),
  resetIcon: () => ipcRenderer.invoke('myplan:reset-icon'),
  hasIcon: () => ipcRenderer.invoke('myplan:has-icon'),
  setOpacity: v => ipcRenderer.send('myplan:set-opacity', v),
  glass: (() => {
    try {
      return ipcRenderer.sendSync('myplan:glass') === true;
    } catch {
      return false;
    }
  })(),
  win: a => ipcRenderer.send('myplan:win', a),
  getWindowPrefs: () => ipcRenderer.invoke('myplan:desktop-get'),
  setWindowPrefs: patch => ipcRenderer.invoke('myplan:desktop-set', patch),
  quit: () => ipcRenderer.send('myplan:quit'),
  http: req => ipcRenderer.invoke('myplan:http', req),
  setTitleBar: o => ipcRenderer.send('myplan:titlebar', o),
  frameless: true,
  onOpacityReset: cb => ipcRenderer.on('myplan:opacity-reset', () => cb()),
});
