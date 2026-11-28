/**
 * 给 AI 发图片：粘贴（Ctrl+V）、本地上传、拖进来都行。
 * 图片先在浏览器里压缩（长边 ≤ 2000px，转成 JPEG），再以 data URL 发给支持看图的模型。
 */
export type AttachedImage = { id: string; dataUrl: string; name: string };

const MAX_SIDE = 2000;
export const MAX_IMAGES = 6;

const newId = () => Math.random().toString(36).slice(2);

/** 把一张位图画到画布上，压成 JPEG（长边不超过 maxSide） */
function drawToJpeg(src: CanvasImageSource, iw: number, ih: number, maxSide: number, quality: number): string | null {
  if (!iw || !ih) return null;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const out = canvas.toDataURL('image/jpeg', quality);
  // 画布导出失败时浏览器会给一个空的 "data:,"，AI 会报「Unsupported image_url format」
  return out.startsWith('data:image/') && out.length > 100 ? out : null;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('读取图片失败'));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });
}

/**
 * 图片 → 压缩后的 data URL。微信 / QQ 截图复制出来的图，有的没有类型、有的是 BMP，
 * 先用 createImageBitmap 解码（格式支持最全），不行再用 <img> 解码，再不行就用原图。
 */
export async function fileToImage(file: File, maxSide = MAX_SIDE, quality = 0.88): Promise<AttachedImage> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('只能发图片');
  const name = file.name || '截图';
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      const out = drawToJpeg(bmp, bmp.width, bmp.height, maxSide, quality);
      bmp.close?.();
      if (out) return { id: newId(), dataUrl: out, name };
    } catch {}
  }
  const src = await readAsDataUrl(file);
  const viaImg = await new Promise<string | null>(resolve => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => resolve(drawToJpeg(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxSide, quality));
    img.src = src;
  });
  if (viaImg) return { id: newId(), dataUrl: viaImg, name };
  if (/^data:image\/(png|jpe?g|webp|gif)/i.test(src)) return { id: newId(), dataUrl: src, name };
  throw new Error('这张图片读不出来，换成截图（PNG / JPG）再试试');
}

/** 从粘贴 / 拖拽事件里取出图片文件（有的软件复制的图没有类型，也先收下，解码时再判断） */
export function imagesFromTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === 'file' && (item.type.startsWith('image/') || item.type === '')) {
      const f = item.getAsFile();
      if (f && (f.type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name) || f.type === '')) out.push(f);
    }
  }
  if (out.length === 0) for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name)) out.push(f);
  return out;
}

function dataUrlToFile(url: string, name = '截图.png'): File | null {
  const m = url.match(/^data:(image\/[\w.+-]+);base64,(.*)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: m[1] });
}

/**
 * 粘贴事件里没有图片文件时的补救（微信截图常见）：
 * ① 复制的是一段 HTML，里面嵌着 <img src="data:…">；② 桌面版：直接读系统剪贴板里的图片；
 * ③ 网页版：用浏览器的剪贴板接口再读一次（第一次会问你要不要允许）。
 */
export async function imagesFromClipboardFallback(dt: DataTransfer | null): Promise<File[]> {
  const html = dt?.getData('text/html') || '';
  const inline = [...html.matchAll(/<img[^>]+src=["'](data:image\/[^"']+)["']/gi)].map(m => dataUrlToFile(m[1])).filter(Boolean) as File[];
  if (inline.length) return inline;
  const desk = (typeof window !== 'undefined' ? (window as unknown as { myplanDesktop?: { clipboardImage?: () => string } }).myplanDesktop : undefined) ?? null;
  if (desk?.clipboardImage) {
    try {
      const url = desk.clipboardImage();
      const f = url ? dataUrlToFile(url) : null;
      if (f) return [f];
    } catch {}
  }
  try {
    const cb = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
    if (cb?.read) {
      const items = await cb.read();
      const out: File[] = [];
      for (const it of items) {
        const t = it.types.find(x => x.startsWith('image/'));
        if (t) out.push(new File([await it.getType(t)], '截图.png', { type: t }));
      }
      return out;
    }
  } catch {}
  return [];
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
