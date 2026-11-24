/**
 * 全屏彩带：今天的计划全部完成时，从屏幕左下、右下两角往上喷彩带（类似 Canvas 按时交作业的效果）。
 * 直接在页面最上层盖一张透明 canvas，不挡点击，播完自己移除。
 */
const COLORS = ['#FF5252', '#FFB300', '#FFEB3B', '#66BB6A', '#29B6F6', '#7E57C2', '#EC407A', '#26C6DA'];

type P = { x: number; y: number; vx: number; vy: number; w: number; h: number; rot: number; vr: number; color: string; shape: 0 | 1 | 2; tilt: number };

export function fireConfetti(durationMs = 4200) {
  if (typeof document === 'undefined') return;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${W}px`,
    height: `${H}px`,
    pointerEvents: 'none',
    zIndex: '2147483647',
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();
  ctx.scale(dpr, dpr);

  const parts: P[] = [];
  const burst = (fromLeft: boolean, n: number) => {
    for (let i = 0; i < n; i++) {
      const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 50; // 朝屏幕中间往上喷
      const speed = (H / 55) * (0.75 + Math.random() * 0.6);
      const rad = (angle * Math.PI) / 180;
      parts.push({
        x: fromLeft ? -10 : W + 10,
        y: H + 10,
        vx: Math.cos(rad) * speed,
        vy: Math.sin(rad) * speed,
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        shape: (Math.random() * 3) as 0 | 1 | 2 | 0,
        tilt: Math.random() * Math.PI,
      });
    }
  };
  const count = reduce ? 40 : Math.min(160, Math.round(W / 6));
  burst(true, count);
  burst(false, count);
  // 第二波，更有层次
  const second = setTimeout(() => {
    burst(true, Math.round(count * 0.6));
    burst(false, Math.round(count * 0.6));
  }, 350);

  const start = performance.now();
  let raf = 0;
  const tick = (t: number) => {
    const el = t - start;
    ctx.clearRect(0, 0, W, H);
    const fade = el > durationMs - 800 ? Math.max(0, (durationMs - el) / 800) : 1;
    for (const p of parts) {
      p.vy += 0.32; // 重力
      p.vx *= 0.992;
      p.vy *= 0.992;
      p.x += p.vx + Math.sin(p.tilt) * 0.8;
      p.y += p.vy;
      p.rot += p.vr;
      p.tilt += 0.08;
      if (p.y > H + 40) continue;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const sx = Math.abs(Math.cos(p.tilt)); // 翻转的感觉
      if (Math.floor(p.shape) === 1) {
        ctx.beginPath();
        ctx.ellipse(0, 0, (p.w / 2) * sx + 1, p.w / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (Math.floor(p.shape) === 2) {
        ctx.fillRect((-p.w * sx) / 2, -1.5, p.w * sx + 1, 3); // 细条彩带
      } else {
        ctx.fillRect((-p.w * sx) / 2, -p.h / 2, p.w * sx + 1, p.h);
      }
      ctx.restore();
    }
    if (el < durationMs) raf = requestAnimationFrame(tick);
    else {
      clearTimeout(second);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(second);
    canvas.remove();
  };
}
