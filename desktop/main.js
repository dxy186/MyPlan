const { app, BrowserWindow, shell, dialog } = require('electron');
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
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

app.on('window-all-closed', () => {
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Windows 系统通知需要 AppUserModelId，否则到点提醒弹不出来
  if (process.platform === 'win32') app.setAppUserModelId('com.myplan.calendar');

  app.whenReady().then(() => {
    createWindow().catch((err) => {
      dialog.showErrorBox('MyPlan 启动失败', String((err && err.message) || err));
      app.quit();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
