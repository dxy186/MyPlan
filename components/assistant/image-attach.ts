/**
 * 给 AI 发图片：粘贴（Ctrl+V）、本地上传、拖进来都行。
 * 图片先在浏览器里压缩（长边 ≤ 2000px，转成 JPEG），再以 data URL 发给支持看图的模型。
 */
export type AttachedImage = { id: string; dataUrl: string; name: string };

const MAX_SIDE = 2000;
export const MAX_IMAGES = 6;

export function fileToImage(file: File, maxSide = MAX_SIDE, quality = 0.88): Promise<AttachedImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('只能发图片'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('图片格式不支持'));
      img.onload = () => {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        // 读不出尺寸（少数软件复制出来的图）：原图本身是常见格式就直接用，否则报错
        if (!iw || !ih) {
          if (/^data:image\/(png|jpe?g|webp|gif)/i.test(src)) return resolve({ id: Math.random().toString(36).slice(2), dataUrl: src, name: file.name || '截图' });
          return reject(new Error('这张图片读不出来，换成截图（PNG / JPG）再试试'));
        }
        const scale = Math.min(1, maxSide / Math.max(iw, ih));
        const w = Math.max(1, Math.round(iw * scale));
        const h = Math.max(1, Math.round(ih * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve({ id: Math.random().toString(36).slice(2), dataUrl: src, name: file.name });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/jpeg', quality);
        // 画布导出失败时浏览器会给一个空的 "data:,"，AI 会报「Unsupported image_url format」
        const ok = out.startsWith('data:image/') && out.length > 100;
        if (!ok && !/^data:image\/(png|jpe?g|webp|gif)/i.test(src)) return reject(new Error('这张图片处理失败，换成截图（PNG / JPG）再试试'));
        resolve({ id: Math.random().toString(36).slice(2), dataUrl: ok ? out : src, name: file.name || '截图' });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/** 从粘贴 / 拖拽事件里取出图片文件 */
export function imagesFromTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  if (out.length === 0) for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith('image/')) out.push(f);
  return out;
}

/** 打开系统的选择文件窗口 */
export function pickImageFiles(): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

export const IMAGE_PROMPT =
  '（用户附上了任务要求的截图。请先仔细读图：找出要做什么、交付物、截止时间、字数 / 页数、评分要点和格式要求。' +
  '然后用 split_task 把它拆成父任务 + 具体子任务（每步写清要做到什么程度），按截止日和可用时间排进日程；' +
  '截图里的截止日期要写进 due。在 reply 里先用 2–4 行复述你从图里读到的关键要求，让用户核对。看不清的地方直说。）';

/** 看图请求的模型参数：DeepSeek 的 deepseek-flash 默认会先长时间「思考」，这里关掉，回得更快也不会把字数耗在思考上 */
export function visionOpts(visionModel?: string) {
  const model = (visionModel || 'deepseek-flash').trim();
  return { model, extra: model.startsWith('deepseek') ? { thinking: { type: 'disabled' } } : undefined };
}
