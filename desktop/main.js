const { app, BrowserWindow, shell, dialog, Tray, Menu, nativeImage, ipcMain, session, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');

// 与 MyPlan/app.json 里 experiments.baseUrl 保持一致
const BASE_PATH = '/MyPlan';

// 端口必须固定！localStorage 是按 origin（协议+主机+端口）隔离的，
// 端口一变，之前存的任务/日历在应用里就全「看不见」了。
// 原来这里是 listen(0) 由系统随机分配端口，正是「关掉程序后数据丢失」的原因。
const PREFERRED_PORTS = [47821, 47822, 47823];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function createStaticServer(rootDir, basePath) {
  const indexFile = path.join(rootDir, 'index.html');

  const server = http.createServer((req, res) => {
    // Canvas / LMS iCal 代理：由主进程（Node）发起请求，绕开渲染进程的 CORS 限制
    const rawPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
    if (rawPath === basePath + '/__ics_proxy') {
      handleIcsProxy(req.url || '/', res);
      return;
    }

    let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);

    // 去掉 /MyPlan 前缀，映射到 dist 根目录
    if (urlPath === basePath) {
      urlPath = '/';
    } else if (urlPath.startsWith(basePath + '/')) {
      urlPath = urlPath.slice(basePath.length);
    }

    // 打包时 node_modules 子目录被改名成 __nm（见 scripts/copy-dist.js）
    urlPath = urlPath.split('/node_modules/').join('/__nm/');
    let filePath = path.normalize(path.join(rootDir, urlPath));
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    // 无扩展名时按静态导出规则补 .html（支持路由）
    if (!path.extname(filePath)) {
      filePath += '.html';
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // 单页应用路由回退
        fs.readFile(indexFile, (err2, html) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
            res.end(html);
          }
        });
        return;
      }
      // 页面文件不让浏览器缓存：装了新版本一打开就是新界面
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  // 按固定顺序挑一个没被占用的端口，保证每次启动都是同一个 origin
  return new Promise((resolve, reject) => {
    let i = 0;
    const tryListen = () => {
      if (i >= PREFERRED_PORTS.length) {
        reject(new Error(`端口 ${PREFERRED_PORTS.join(' / ')} 都被占用了`));
        return;
      }
      const port = PREFERRED_PORTS[i++];
      const onError = (err) => {
        server.removeListener('error', onError);
        if (err.code === 'EADDRINUSE') tryListen();
        else reject(err);
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve(server);
      });
    };
    tryListen();
  });
}

// 代理拉取远程 iCal：Node 侧发起，不受浏览器 CORS 约束；只允许 http/https，跟随有限次重定向
function handleIcsProxy(rawUrl, res, depth = 0) {
  const send = (code, body, type) => {
    res.writeHead(code, {
      'Content-Type': type || 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  };
  if (depth > 5) return send(508, 'too many redirects');

  let target = '';
  try {
    target = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('url') || '';
  } catch {
    return send(400, 'bad request');
  }
  let u;
  try {
    u = new URL(target);
  } catch {
    return send(400, 'invalid url');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return send(400, 'only http/https is allowed');
  }

  const mod = u.protocol === 'https:' ? https : http;
  const proxyReq = mod.get(
    u,
    { headers: { 'User-Agent': 'Mozilla/5.0 MyPlan/1.0', Accept: 'text/calendar, text/plain, */*' } },
    (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        r.resume();
        const next = new URL(r.headers.location, u).toString();
        return handleIcsProxy(`${basePath}/__ics_proxy?url=${encodeURIComponent(next)}`, res, depth + 1);
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        send(200, Buffer.concat(chunks), r.headers['content-type'] || 'text/plain; charset=utf-8');
      });
      r.on('error', (e) => send(502, 'stream error: ' + e.message));
    }
  );
  proxyReq.on('error', (e) => send(502, 'fetch error: ' + e.message));
  proxyReq.setTimeout(20000, () => proxyReq.destroy(new Error('timeout')));
}

let mainWindow;
let staticServer;
let tray = null;
let isQuitting = false;

const APP_ID = 'com.myplan.calendar';
// 开机自启时带上这个参数：只在托盘里待命，不弹窗口
const START_HIDDEN = process.argv.includes('--hidden');

// ---------- 桌面设置（开机自启等），存在用户数据目录 ----------
function settingsFile() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}
function loadDesktopSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveDesktopSettings(s) {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  } catch {}
}

// 便携版每次运行都会解压到临时目录，所以开机自启和快捷方式要指向原始 exe
function exePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function setAutostart(on) {
  if (!app.isPackaged) return; // 开发模式（npm start）不注册
  app.setLoginItemSettings({ openAtLogin: on, path: exePath(), args: ['--hidden'] });
  saveDesktopSettings({ ...loadDesktopSettings(), autostart: on });
}
function autostartOn() {
  const s = loadDesktopSettings();
  return s.autostart !== false;
}

// Windows 只有在「开始」菜单里有一个带 AppUserModelID 的快捷方式时，才会显示系统通知
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    fs.mkdirSync(dir, { recursive: true });
    const lnk = path.join(dir, 'MyPlan.lnk');
    const opts = { target: exePath(), appUserModelId: APP_ID, description: 'MyPlan 日历', icon: exePath(), iconIndex: 0 };
    let same = false;
    if (fs.existsSync(lnk)) {
      try {
        const cur = shell.readShortcutLink(lnk);
        same = cur.target === opts.target && cur.appUserModelId === APP_ID;
      } catch {}
    }
    if (!same) shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', opts);
  } catch (e) {
    console.error('shortcut', e);
  }
}

// ---------- 关窗口的方式、呼出 / 收起窗口的全局快捷键 ----------
const DEFAULT_HOTKEY = 'Ctrl+Alt+M';
const STARTED_AT = Date.now();

function closeAction() {
  return loadDesktopSettings().closeAction === 'quit' ? 'quit' : 'tray';
}
function currentHotkey() {
  const s = loadDesktopSettings();
  return s.hotkey === undefined ? DEFAULT_HOTKEY : s.hotkey; // '' = 不用快捷键
}
function toggleWindow() {
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused() && !mainWindow.isMinimized()) mainWindow.hide();
  else showWindow();
}
/** 注册快捷键：成功返回 true；被别的软件占用等返回 false */
function registerHotkey(acc) {
  globalShortcut.unregisterAll();
  if (!acc) return true;
  try {
    return globalShortcut.register(acc, toggleWindow);
  } catch {
    return false;
  }
}
function quitApp() {
  isQuitting = true;
  app.quit();
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------- 自定义图标：用户自己选的图片，只存在这台电脑上 ----------
function customIconPath() {
  return path.join(app.getPath('userData'), 'custom-icon.ico');
}
function customIconPng() {
  return path.join(app.getPath('userData'), 'custom-icon.png');
}
function hasCustomIcon() {
  return fs.existsSync(customIconPath()) && fs.existsSync(customIconPng());
}

/** 把一张 PNG 包成 .ico（Windows Vista 起支持 ICO 里直接放 PNG） */
function pngToIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 图标
  header.writeUInt16LE(1, 4); // 1 张
  const dir = Buffer.alloc(16);
  dir.writeUInt8(0, 0); // 宽 256 记作 0
  dir.writeUInt8(0, 1); // 高 256 记作 0
  dir.writeUInt8(0, 2);
  dir.writeUInt8(0, 3);
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(pngBuf.length, 8);
  dir.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, dir, pngBuf]);
}

/** 桌面、开始菜单里指向 MyPlan 的快捷方式 */
function myShortcuts() {
  const dirs = [
    app.getPath('desktop'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  const out = [];
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) {
        if (!f.toLowerCase().endsWith('.lnk')) continue;
        const p = path.join(d, f);
        try {
          const info = shell.readShortcutLink(p);
          if (/myplan/i.test(f) || (info.target && path.basename(info.target).toLowerCase() === path.basename(exePath()).toLowerCase())) out.push(p);
        } catch {}
      }
    } catch {}
  }
  return out;
}

function setShortcutIcons(iconPath) {
  if (process.platform !== 'win32') return 0;
  let n = 0;
  for (const lnk of myShortcuts()) {
    try {
      const info = shell.readShortcutLink(lnk);
      shell.writeShortcutLink(lnk, 'update', { ...info, icon: iconPath, iconIndex: 0 });
      n++;
    } catch (e) {
      console.error('icon', lnk, e);
    }
  }
  return n;
}

function applyWindowIcons() {
  const img = hasCustomIcon() ? nativeImage.createFromPath(customIconPng()) : null;
  if (img && !img.isEmpty()) {
    mainWindow && mainWindow.setIcon(img);
    tray && tray.setImage(img.resize({ width: 16, height: 16 }));
  } else {
    mainWindow && mainWindow.setIcon(path.join(__dirname, 'dist', 'favicon.ico'));
    tray && tray.setImage(trayIcon());
  }
}

function trayIcon() {
  if (hasCustomIcon()) {
    const img = nativeImage.createFromPath(customIconPng());
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
  }
  const candidates = [path.join(__dirname, 'dist', 'favicon.ico'), path.join(__dirname, 'icon.png')];
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      const img = nativeImage.createFromPath(f);
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    }
  }
  return nativeImage.createEmpty();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开 MyPlan', click: showWindow },
    {
      // 窗口调得太透明、看不见了：从托盘一键恢复
      label: '窗口恢复不透明',
      click: () => {
        if (!mainWindow) return;
        showWindow();
        // 页面会把设置改回 100%，并通知这里换回普通窗口
        mainWindow.webContents.send('myplan:opacity-reset');
      },
    },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: autostartOn(),
      click: (item) => {
        setAutostart(item.checked);
        tray && tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    {
      label: '点窗口的 × 直接退出',
      type: 'checkbox',
      checked: closeAction() === 'quit',
      click: (item) => {
        saveDesktopSettings({ ...loadDesktopSettings(), closeAction: item.checked ? 'quit' : 'tray' });
        tray && tray.setContextMenu(buildTrayMenu());
      },
    },
    { type: 'separator' },
    { label: '彻底退出（不再提醒）', click: quitApp },
  ]);
}

function createTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('MyPlan — 双击打开；关掉窗口后仍会按时提醒');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

// 「玻璃模式」：窗口不透明度调到 100% 以下时，用真正透明的窗口，只让背景变透明、字保持清楚
// （以前用 setOpacity，会把字也一起变淡）。透明窗口不能拖边框改大小，用页面上的按钮最大化 / 还原。
let glassOn = loadDesktopSettings().glass === true;
let savedBounds = null;

async function createWindow(bounds) {
  const glass = glassOn;
  mainWindow = new BrowserWindow({
    width: (bounds && bounds.width) || 1100,
    height: (bounds && bounds.height) || 750,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'MyPlan',
    ...(glass
      ? { frame: false, transparent: true, resizable: false, backgroundColor: '#00000000' }
      : {
          // 去掉系统白色标题栏，背景铺满整个窗口；右上角的 最小化 / 最大化 / 关闭 按钮叠在页面上
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#00000000', symbolColor: '#37474F', height: 32 },
          backgroundColor: '#F8FAFC',
        }),
    icon: hasCustomIcon() ? customIconPng() : path.join(__dirname, 'dist', 'favicon.ico'),
    show: !START_HIDDEN,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      // 窗口藏在托盘里时，页面里的定时器也要照常跑，否则到点提醒会迟到
      backgroundThrottling: false,
    },
  });

  // 点 × 不退出，只是藏到托盘里，到点照样提醒
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    if (closeAction() === 'quit') {
      isQuitting = true;
      return;
    }
    e.preventDefault();
    mainWindow.hide();
    const s = loadDesktopSettings();
    if (!s.trayTipShown && tray && process.platform === 'win32') {
      tray.displayBalloon({ title: 'MyPlan 还在后台', content: '关掉窗口后会在托盘里待命，到点照样提醒。按 Ctrl+Alt+M 随时叫出来；右键托盘图标可以彻底退出。想点 × 就退出：设置 → 外观最下面改。' });
      saveDesktopSettings({ ...s, trayTipShown: true });
    }
  });

  if (!staticServer) {
    const distPath = path.join(__dirname, 'dist');
    staticServer = await createStaticServer(distPath, BASE_PATH);
  }
  const { port } = staticServer.address();

  mainWindow.loadURL(`http://127.0.0.1:${port}${BASE_PATH}/`);

  // 外部链接交给系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const thisWin = mainWindow;
  thisWin.on('closed', () => {
    // 换玻璃 / 普通窗口时旧窗口会被关掉，不能把新窗口清掉
    if (mainWindow === thisWin) mainWindow = null;
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (!isQuitting) return; // 托盘模式：窗口关了也继续在后台
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

// 单实例：开第二个实例会拿到另一个端口，等于又开了一份新的 localStorage，数据会分家
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 装了新版本后再打开：旧版本还在托盘里跑的话，自动重启成新版本
    try {
      if (fs.statSync(process.execPath).mtimeMs > STARTED_AT) {
        isQuitting = true;
        app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') });
        app.exit(0);
        return;
      }
    } catch {}
    showWindow();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  ipcMain.handle('myplan:desktop-get', async () => ({
    closeAction: closeAction(),
    hotkey: currentHotkey(),
    hotkeyOk: !currentHotkey() || globalShortcut.isRegistered(currentHotkey()),
    defaultHotkey: DEFAULT_HOTKEY,
  }));
  ipcMain.handle('myplan:desktop-set', async (_e, patch) => {
    const s = loadDesktopSettings();
    if (patch && (patch.closeAction === 'quit' || patch.closeAction === 'tray')) s.closeAction = patch.closeAction;
    let hotkeyOk = true;
    if (patch && typeof patch.hotkey === 'string') {
      hotkeyOk = registerHotkey(patch.hotkey);
      if (hotkeyOk) s.hotkey = patch.hotkey;
      else registerHotkey(currentHotkey()); // 注册不上：恢复原来的
    }
    saveDesktopSettings(s);
    tray && tray.setContextMenu(buildTrayMenu());
    return { closeAction: closeAction(), hotkey: currentHotkey(), hotkeyOk };
  });
  ipcMain.on('myplan:quit', () => quitApp());
  // AI 请求由后台转发：没有浏览器的跨域限制（本机 Ollama、Claude 等网页直连不了的也能用）
  ipcMain.handle('myplan:http', async (_e, req) => {
    const url = String((req && req.url) || '');
    if (!/^https?:\/\//i.test(url)) return { status: 0, text: '地址要以 http:// 或 https:// 开头' };
    try {
      const r = await fetch(url, {
        method: req.method || 'GET',
        headers: req.headers || {},
        body: req.body,
        signal: AbortSignal.timeout(180000),
      });
      return { status: r.status, text: await r.text() };
    } catch (err) {
      return { status: 0, text: JSON.stringify({ error: { message: '连不上：' + ((err && err.message) || err) } }) };
    }
  });
  // 按皮肤 / 背景调右上角三个按钮的颜色
  ipcMain.on('myplan:titlebar', (_e, o) => {
    try {
      if (mainWindow && mainWindow.setTitleBarOverlay && o && typeof o.symbolColor === 'string') {
        mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: o.symbolColor, height: 32 });
      }
    } catch {}
  });

  // Windows 系统通知需要 AppUserModelId，否则到点提醒弹不出来
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  // 页面里点了系统通知 → 把窗口叫出来
  ipcMain.on('myplan:show-window', () => showWindow());

  // 设置 → 桌面图标：换成用户自己的图片 / 恢复默认
  ipcMain.handle('myplan:set-icon', async (_e, dataUrl) => {
    let img = nativeImage.createFromDataURL(String(dataUrl || ''));
    if (img.isEmpty()) throw new Error('图片读不出来');
    // 补成正方形（白底居中），再放大到 256×256
    const { width, height } = img.getSize();
    const side = Math.max(width, height);
    if (width !== height) {
      const bmp = Buffer.alloc(side * side * 4, 255);
      const src = img.toBitmap(); // BGRA
      const ox = Math.floor((side - width) / 2);
      const oy = Math.floor((side - height) / 2);
      for (let y = 0; y < height; y++) src.copy(bmp, ((y + oy) * side + ox) * 4, y * width * 4, (y + 1) * width * 4);
      img = nativeImage.createFromBitmap(bmp, { width: side, height: side });
    }
    const png = img.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(customIconPng(), png);
    fs.writeFileSync(customIconPath(), pngToIco(png));
    applyWindowIcons();
    return { shortcuts: setShortcutIcons(customIconPath()) };
  });
  ipcMain.handle('myplan:reset-icon', async () => {
    try {
      fs.rmSync(customIconPath(), { force: true });
      fs.rmSync(customIconPng(), { force: true });
    } catch {}
    applyWindowIcons();
    return { shortcuts: setShortcutIcons(exePath()) };
  });
  ipcMain.handle('myplan:has-icon', async () => hasCustomIcon());
  // 页面告诉我们窗口不透明度：低于 100% 换成玻璃窗口（透明度由页面自己画，字不变淡），100% 换回普通窗口
  ipcMain.on('myplan:set-opacity', (_e, v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const want = n < 0.999;
    if (want === glassOn || !mainWindow) return;
    glassOn = want;
    saveDesktopSettings({ ...loadDesktopSettings(), glass: want });
    const old = mainWindow;
    const b = old.isMaximized() ? savedBounds || old.getNormalBounds() : old.getBounds();
    const visible = old.isVisible();
    old.removeAllListeners('close');
    createWindow(b).then(() => {
      if (visible) mainWindow.show();
      old.destroy();
    });
  });
  ipcMain.on('myplan:glass', (e) => {
    e.returnValue = glassOn;
  });
  // 玻璃窗口没有系统按钮：页面上的 — □ × 调这里
  ipcMain.on('myplan:win', (_e, a) => {
    if (!mainWindow) return;
    if (a === 'min') mainWindow.minimize();
    else if (a === 'close') mainWindow.close();
    else if (a === 'max') {
      const { screen } = require('electron');
      const area = screen.getDisplayMatching(mainWindow.getBounds()).workArea;
      const cur = mainWindow.getBounds();
      const full = cur.x === area.x && cur.y === area.y && cur.width === area.width && cur.height === area.height;
      if (full && savedBounds) {
        mainWindow.setBounds(savedBounds);
        savedBounds = null;
      } else {
        savedBounds = cur;
        mainWindow.setBounds(area);
      }
    }
  });
  ipcMain.on('myplan:version', (e) => {
    e.returnValue = app.getVersion();
  });

  app.whenReady().then(() => {
    ensureStartMenuShortcut();
    // 重新安装会生成新的快捷方式：有自定义图标的话再套一次
    if (hasCustomIcon()) setShortcutIcons(customIconPath());
    // 第一次运行默认打开开机自启；之后以托盘菜单里的勾选为准
    const ds = loadDesktopSettings();
    if (ds.autostart === undefined) setAutostart(true);
    else if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!ds.autostart, path: exePath(), args: ['--hidden'] });
    createTray();
    registerHotkey(currentHotkey());
    // 换了版本：清掉旧版本留下的网页缓存（只清缓存，不动你的数据 localStorage）
    const clearOld =
      ds.lastVersion !== app.getVersion()
        ? Promise.all([
            session.defaultSession.clearCache(),
            session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage', 'shadercache'] }),
          ])
            .catch(() => {})
            .then(() => saveDesktopSettings({ ...loadDesktopSettings(), lastVersion: app.getVersion() }))
        : Promise.resolve();
    clearOld.then(() => createWindow()).catch((err) => {
      dialog.showErrorBox('MyPlan 启动失败', String((err && err.message) || err));
      app.quit();
    });

    app.on('activate', () => {
      showWindow();
    });
  });
}
