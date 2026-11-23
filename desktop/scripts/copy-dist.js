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
console.log('已复制网页版到', dest);
