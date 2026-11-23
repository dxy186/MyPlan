const { app, BrowserWindow, shell, dialog, Tray, Menu, nativeImage, ipcMain } = require('electron');
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
            res.writeHead(200, { 'Content-Type': MIME['.html'] });
            res.end(html);
          }
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
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

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function trayIcon() {
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
      label: '退出（不再提醒）',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'MyPlan',
    backgroundColor: '#F8FAFC',
    icon: path.join(__dirname, 'dist', 'favicon.ico'),
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
    e.preventDefault();
    mainWindow.hide();
    const s = loadDesktopSettings();
    if (!s.trayTipShown && tray && process.platform === 'win32') {
      tray.displayBalloon({ title: 'MyPlan 还在后台', content: '关掉窗口后会在托盘里待命，到点照样提醒。右键托盘图标可以退出。' });
      saveDesktopSettings({ ...s, trayTipShown: true });
    }
  });

  const distPath = path.join(__dirname, 'dist');
  staticServer = await createStaticServer(distPath, BASE_PATH);
  const { port } = staticServer.address();

  mainWindow.loadURL(`http://127.0.0.1:${port}${BASE_PATH}/`);

  // 外部链接交给系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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
  app.on('second-instance', () => showWindow());

  // Windows 系统通知需要 AppUserModelId，否则到点提醒弹不出来
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  // 页面里点了系统通知 → 把窗口叫出来
  ipcMain.on('myplan:show-window', () => showWindow());

  app.whenReady().then(() => {
    ensureStartMenuShortcut();
    // 第一次运行默认打开开机自启；之后以托盘菜单里的勾选为准
    const ds = loadDesktopSettings();
    if (ds.autostart === undefined) setAutostart(true);
    else if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!ds.autostart, path: exePath(), args: ['--hidden'] });
    createTray();
    createWindow().catch((err) => {
      dialog.showErrorBox('MyPlan 启动失败', String((err && err.message) || err));
      app.quit();
    });

    app.on('activate', () => {
      showWindow();
    });
  });
}
