// 把仓库根目录 `npx expo export -p web` 生成的 dist/ 复制到 desktop/dist/，供 Electron 打包
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', 'dist');
const dest = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('找不到 ../dist/index.html，请先在仓库根目录运行：npx expo export -p web');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

// electron-builder 打包时会丢掉 app 里所有叫 node_modules 的子文件夹，
// 而网页版的图片资源（比如日历翻页的箭头）就放在 dist/assets/node_modules/ 下。
// 这里改名成 __nm，main.js 的本地服务器再把 /node_modules/ 的请求映射过去。
function renameNodeModules(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = path.join(dir, ent.name);
    if (ent.name === 'node_modules') {
      const to = path.join(dir, '__nm');
      fs.renameSync(p, to);
      renameNodeModules(to);
    } else renameNodeModules(p);
  }
}
renameNodeModules(dest);
console.log('已复制网页版到', dest);
