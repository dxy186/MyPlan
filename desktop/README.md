# MyPlan 桌面版（Windows 便携版）

把网页版 MyPlan 用 Electron 包成一个双击即用的 `MyPlan-Portable-<版本>.exe`。

## 工作原理

- `main.js` 在本机 `127.0.0.1` 起一个小型静态服务器，加载 `dist/` 里的网页版。
- 端口固定为 **47821**（被占用时依次尝试 47822、47823）。数据存在浏览器 localStorage 里，localStorage 按端口隔离，端口一变数据就「看不见」了，所以端口不能随机。
- 内置 `/MyPlan/__ics_proxy?url=...`：由主进程代为拉取 Canvas / LMS 的 iCal 链接，绕开浏览器跨域限制。
- 单实例运行：重复双击只会把已有窗口调到前面，避免数据分家。

## 打包步骤（在 Windows 上）

```bash
# 1. 仓库根目录先装好依赖
npm install

# 2. 进入 desktop 目录装 Electron 打包工具
cd desktop
npm install

# 3. 一键打包：导出网页版 → 复制到 desktop/dist → 生成 exe
npm run dist
```

生成的文件在 `desktop/release/MyPlan-Portable-1.0.0.exe`。

只想本地调试、不打包：`npm run export-web && npm start`。

## 注意

- 升级版本：改 `desktop/package.json` 里的 `version`。
- 换电脑或重装前，先在应用里用「⚙️ 设置 → 💾 数据备份 → 导出」把数据存成文件。
- `electron` / `electron-builder` 的版本是整理进仓库时重新指定的，原始打包所用版本没有留存。
