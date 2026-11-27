/**
 * 日历「添加新事项」的快捷写法：
 *   写报告 2小时        → 任务，时长 120 分钟
 *   !复习高数 90分钟     → 开头加 ! 表示高耗能
 *   15:00-17:00 开组会   → 固定日程（排程会避开）；也支持 15点-17点、15:00~17:00
 *   14:00 打电话 30分钟  → 只写开始时间也算固定日程，时长默认 60 分钟
 *   每周二、四 8:00-10:00 高数课 → 每周重复的固定日程
 *   取快递              → 普通小任务（30 分钟、低耗能）
 *   ?写期末论文          → 开头加 ? ：加进去后马上让 AI 帮你拆成小步骤
 *   *妈妈生日           → 开头加 * ：重要事件（只在日历上标出来，不当任务）；生日、纪念日自动每年重复
 *   *每年 结婚纪念日      → 每年重复；「*14:00 面试」可以带个时间
 *   #ES pre             → 开头加 # ：DDL（这天截止，只标红、不自动排）；#? 一起写 = DDL + 马上让 AI 拆
 */
import { EnergyCost, addDays, toDateStr, weekdayOf } from '@/app/utils/planning';

export type QuickParsed =
  | { kind: 'task'; title: string; estimateMin: number; energyCost: EnergyCost; explicitMin: boolean; breakdown?: boolean; ddl?: boolean }
  | { kind: 'fixed'; title: string; start: string; end: string; weekdays?: number[] }
  | { kind: 'event'; title: string; yearly: boolean; time?: string };

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
  // * / ★ / ☆ 开头：重要事件
  if (/^[*＊★☆⭐]/.test(text)) {
    let t = text.replace(/^[*＊★☆⭐]+\s*/, '');
    let yearly = false;
    if (/^每年\s*/.test(t)) {
      yearly = true;
      t = t.replace(/^每年\s*/, '');
    }
    let time: string | undefined;
    const tm = t.match(/^(\d{1,2})[:：](\d{2})\s*/);
    if (tm) {
      time = `${tm[1].padStart(2, '0')}:${tm[2]}`;
      t = t.slice(tm[0].length);
    }
    const title = t.trim() || '重要的日子';
    return { kind: 'event', title, yearly: yearly || /生日|纪念日|周年|忌日/.test(title), time };
  }
  let high = false;
  let breakdown = false;
  let ddl = false;
  // 开头的 ? / ! / # 顺序随意，可以叠着写（?! 、#? …）
  for (;;) {
    if (/^[#＃]/.test(text)) {
      ddl = true;
      text = text.replace(/^[#＃]+\s*/, '');
    } else if (/^[?？]/.test(text)) {
      breakdown = true;
      text = text.replace(/^[?？]+\s*/, '');
    } else if (/^[!！]/.test(text)) {
      high = true;
      text = text.replace(/^[!！]+\s*/, '');
    } else break;
  }
  // DDL：不当固定日程解析，开头写的「23:59」之类当截止时刻，去掉
  if (ddl) {
    const t = text.replace(new RegExp(`^(${CLOCK})\\s*`), '');
    const d = parseDuration(t);
    const title = (d ? d.rest : t).trim() || 'DDL';
    return { kind: 'task', title, estimateMin: d ? d.minutes : 30, energyCost: high ? 'high' : 'medium', explicitMin: !!d, breakdown, ddl: true };
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
  return { kind: 'task', title, estimateMin, energyCost, explicitMin: !!d, ...(breakdown ? { breakdown: true } : {}) };
}

/**
 * 聊天里用 # 标出的 DDL：「#ES pre 12/8」「#交实验报告 下周三」「#12月8日 论文」。
 * 找出日期并从名字里去掉；没写日期 date 为 undefined。
 */
export function parseDdlLine(input: string, from: string): { title: string; date?: string } | null {
  const m = input.trim().match(/^[#＃]+\s*([\s\S]*)$/);
  if (!m) return null;
  let text = m[1].replace(/^[?？!！]+\s*/, '');
  let date: string | undefined;
  const year = Number(from.slice(0, 4));
  const md = (mo: number, d: number) => {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return undefined;
    let ds = toDateStr(new Date(year, mo - 1, d));
    // 写的月日已经过去一个多月了：当成明年的
    if (ds < addDays(from, -31)) ds = toDateStr(new Date(year + 1, mo - 1, d));
    return ds;
  };
  const WK: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const pats: [RegExp, (r: RegExpMatchArray) => string | undefined][] = [
    [/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/, r => toDateStr(new Date(Number(r[1]), Number(r[2]) - 1, Number(r[3])))],
    [/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/, r => md(Number(r[1]), Number(r[2]))],
    [/(?<![\d:：])(\d{1,2})[/-](\d{1,2})(?![\d:：])/, r => md(Number(r[1]), Number(r[2]))],
    [/大后天/, () => addDays(from, 3)],
    [/后天/, () => addDays(from, 2)],
    [/明天/, () => addDays(from, 1)],
    [/今天/, () => from],
    [
      /(下{1,2})?(?:周|星期|礼拜)([一二三四五六日天])/,
      r => {
        const wd = weekdayOf(from);
        const target = WK[r[2]];
        if (!r[1]) return addDays(from, (target - wd + 7) % 7); // 周五：这周五（今天就是周五就是今天）
        const toNextMon = (8 - wd) % 7 || 7;
        return addDays(from, toNextMon + (target + 6) % 7 + 7 * (r[1].length - 1)); // 下周五 / 下下周五
      },
    ],
  ];
  for (const [re, fn] of pats) {
    const r = text.match(re);
    if (!r) continue;
    const d = fn(r);
    if (!d) continue;
    date = d;
    text = text.slice(0, r.index) + ' ' + text.slice((r.index ?? 0) + r[0].length).replace(/^\s*(?:截止|之前|前|due)\s*/i, ' ');
    break;
  }
  const title = text.replace(/\s*(?:截止|之前|前)\s*$/, '').replace(/\s+/g, ' ').trim();
  return { title: title || 'DDL', date };
}
