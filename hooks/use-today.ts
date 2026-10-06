import { useEffect, useState } from 'react';

/** 本地时间的今天，YYYY-MM-DD（不能用 toISOString，会差 8 小时） */
function currentDateStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * 返回「今天」，并在跨天时自动触发重渲染。
 *
 * 桌面端经常一开就是好几天。如果只在渲染那一刻算一次日期，
 * 日历上「今天」的高亮、各处的「今日统计」就会一直停在前一天。
 * 这里每 30 秒对一次表，窗口重新获得焦点时也立刻对一次。
 */
export function useTodayStr(): string {
  const [today, setToday] = useState(currentDateStr);

  useEffect(() => {
    const check = () => {
      const now = currentDateStr();
      setToday(prev => (prev === now ? prev : now));
    };

    const timer = setInterval(check, 30 * 1000);
    if (typeof window !== 'undefined') window.addEventListener('focus', check);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', check);

    return () => {
      clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('focus', check);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', check);
    };
  }, []);

  return today;
}
