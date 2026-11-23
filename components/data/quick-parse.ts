/**
 * 日历「添加新事项」的快捷写法：
 *   写报告 2小时        → 任务，时长 120 分钟
 *   !复习高数 90分钟     → 开头加 ! 表示高耗能
 *   15:00-17:00 开组会   → 固定日程（排程会避开）；也支持 15点-17点、15:00~17:00
 *   14:00 打电话 30分钟  → 只写开始时间也算固定日程，时长默认 60 分钟
 *   每周二、四 8:00-10:00 高数课 → 每周重复的固定日程
 *   取快递              → 普通小任务（30 分钟、低耗能）
 */
import { EnergyCost } from '@/app/utils/planning';

export type QuickParsed =
  | { kind: 'task'; title: string; estimateMin: number; energyCost: EnergyCost; explicitMin: boolean }
  | { kind: 'fixed'; title: string; start: string; end: string; weekdays?: number[] };

const WD: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

/** 「每周二、四」「每周一到五」→ [2,4] / [1,2,3,4,5] */
function parseWeekly(text: string): { weekdays: number[]; rest: string } | null {
  const m = text.match(/^每(?:周|星期|礼拜)([一二三四五六日天](?:\s*(?:[、,，和及]|到|至|-|~)\s*(?:周|星期)?[一二三四五六日天])*)\s*/);
  if (!m) return null;
  const body = m[1];
  const out = new Set<number>();
  const range = body.match(/^([一二三四五六日天])\s*(?:到|至|-|~)\s*(?:周|星期)?([一二三四五六日天])$/);
  if (range) {
    let a = WD[range[1]];
    const b = WD[range[2]];
    for (let i = 0; i < 7; i++) {
      out.add(a);
      if (a === b) break;
      a = (a + 1) % 7;
    }
  } else {
    for (const ch of body) if (ch in WD) out.add(WD[ch]);
  }
  if (out.size === 0) return null;
  return { weekdays: [...out].sort(), rest: text.slice(m[0].length) };
}

function hm(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 「15:00」「15：30」「15点」「15点半」「下午3点」 → 分钟 */
function parseClock(raw: string): number | null {
  const s = raw.replace('：', ':').trim();
  let m = s.match(/^(上午|下午|晚上|中午)?\s*(\d{1,2})(?::(\d{2})|点(半|(\d{1,2})分?)?)?$/);
  if (!m) return null;
  let h = Number(m[2]);
  const min = m[3] ? Number(m[3]) : m[4] === '半' ? 30 : m[5] ? Number(m[5]) : 0;
  if ((m[1] === '下午' || m[1] === '晚上') && h < 12) h += 12;
  if (m[1] === '中午' && h < 11) h += 12;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const CLOCK = '(?:上午|下午|晚上|中午)?\\s*\\d{1,2}(?:[:：]\\d{2}|点(?:半|\\d{1,2}分?)?)';

export function parseDuration(text: string): { minutes: number; rest: string } | null {
  const re = /(\d+(?:\.\d+)?)\s*(小时|个小时|h|hr|hrs|分钟|min|mins|m)(?![a-z])|半小时|半个小时/i;
  const m = text.match(re);
  if (!m) return null;
  let minutes: number;
  if (/半/.test(m[0]) && !m[1]) minutes = 30;
  else {
    const n = Number(m[1]);
    minutes = /小时|h/i.test(m[2]) ? Math.round(n * 60) : Math.round(n);
  }
  if (!(minutes >= 5 && minutes <= 24 * 60)) return null;
  return { minutes, rest: (text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, ' ').trim() };
}

export function quickParse(input: string): QuickParsed {
  let text = input.trim();
  let high = false;
  if (/^[!！]/.test(text)) {
    high = true;
    text = text.replace(/^[!！]+\s*/, '');
  }
  // 每周重复：每周二、四 8:00-10:00 高数课
  const weekly = parseWeekly(text);
  if (weekly) {
    const inner = quickParse(weekly.rest);
    if (inner.kind === 'fixed') return { ...inner, weekdays: weekly.weekdays };
  }
  // 时间段：15:00-17:00 开组会
  const range = text.match(new RegExp(`^(${CLOCK})\\s*(?:-|~|～|到|至|—)\\s*(${CLOCK})\\s*(.+)$`));
  if (range) {
    const s = parseClock(range[1]);
    let e = parseClock(range[2]);
    // 「下午3点-5点」：结束时间沿用开始的上下午
    if (s !== null && e !== null && e <= s && e + 12 * 60 > s && e < 12 * 60) e += 12 * 60;
    if (s !== null && e !== null && e > s && range[3].trim()) {
      return { kind: 'fixed', title: range[3].trim(), start: hm(Math.floor(s / 60), s % 60), end: hm(Math.floor(e / 60), e % 60) };
    }
  }
  // 单个开始时间：14:00 打电话 30分钟
  const point = text.match(new RegExp(`^(${CLOCK})\\s+(.+)$`));
  if (point) {
    const s = parseClock(point[1]);
    if (s !== null) {
      const d = parseDuration(point[2]);
      const title = (d ? d.rest : point[2]).trim();
      const len = d ? d.minutes : 60;
      const e = Math.min(s + len, 24 * 60 - 1);
      if (title) return { kind: 'fixed', title, start: hm(Math.floor(s / 60), s % 60), end: hm(Math.floor(e / 60), e % 60) };
    }
  }
  const d = parseDuration(text);
  const title = (d ? d.rest : text).trim() || text;
  const estimateMin = d ? d.minutes : high ? 60 : 30;
  const energyCost: EnergyCost = high ? 'high' : estimateMin <= 30 ? 'low' : 'medium';
  return { kind: 'task', title, estimateMin, energyCost, explicitMin: !!d };
}
