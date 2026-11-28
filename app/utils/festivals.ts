/**
 * 日历上显示的节日和二十四节气（一般中文日历上会标的那些）。
 * - 公历节日：元旦、情人节、妇女节……圣诞节
 * - 按星期算的：母亲节（5 月第 2 个周日）、父亲节（6 月第 3 个周日）、感恩节（11 月第 4 个周四）
 * - 农历节日：春节、元宵、龙抬头、端午、七夕、中元、中秋、重阳、腊八、小年、除夕
 * - 二十四节气：寿星公式（21 世纪常数），2000–2099 年内和天文台公布的日期一致（个别年份会差一天，已做修正）
 */
import { solarToLunar } from './lunar';

export type Festival = { name: string; kind: 'lunar' | 'solar' | 'term' };

const SOLAR: Record<string, string> = {
  '01-01': '元旦',
  '02-14': '情人节',
  '03-08': '妇女节',
  '03-12': '植树节',
  '04-01': '愚人节',
  '05-01': '劳动节',
  '05-04': '青年节',
  '06-01': '儿童节',
  '07-01': '建党节',
  '08-01': '建军节',
  '09-10': '教师节',
  '10-01': '国庆节',
  '10-31': '万圣夜',
  '12-24': '平安夜',
  '12-25': '圣诞节',
};

/** [月, 第几个, 星期几(0=周日), 名字] */
const NTH_WEEKDAY: [number, number, number, string][] = [
  [5, 2, 0, '母亲节'],
  [6, 3, 0, '父亲节'],
  [11, 4, 4, '感恩节'],
];

/** 农历「月-日」（数字）→ 节日 */
const LUNAR: Record<string, string> = {
  '1-1': '春节',
  '1-15': '元宵节',
  '2-2': '龙抬头',
  '5-5': '端午节',
  '7-7': '七夕',
  '7-15': '中元节',
  '8-15': '中秋节',
  '9-9': '重阳节',
  '12-8': '腊八节',
  '12-23': '小年',
};

const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
];

const MONTH_ALIASES: Record<string, number> = { 冬: 11, 十一: 11, 腊: 12, 十二: 12 };

let intlFmt: Intl.DateTimeFormat | null | undefined;
function chineseFmt(): Intl.DateTimeFormat | null {
  if (intlFmt !== undefined) return intlFmt;
  try {
    const f = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'numeric', day: 'numeric' });
    // 确认真的是农历（不支持时会退回公历）
    const p = f.formatToParts(new Date(2026, 1, 17, 12));
    intlFmt = p.find(x => x.type === 'month')?.value.includes('正') ? f : null;
  } catch {
    intlFmt = null;
  }
  return intlFmt;
}

function monthNum(name: string): number {
  const n = name.replace(/^闰/, '').replace(/月$/, '');
  if (MONTH_ALIASES[n]) return MONTH_ALIASES[n];
  return MONTH_NAMES.indexOf(n) + 1;
}

const cache = new Map<string, ReturnType<typeof lunarCompute>>();
function lunarCompute(dateStr: string): { month: number; day: number; leap: boolean; monthName: string; dayName: string } | null {
  const [y, m, d] = dateStr.split('-').map(Number);
  const f = chineseFmt();
  if (f) {
    try {
      const parts = f.formatToParts(new Date(y, m - 1, d, 12));
      const mStr = parts.find(x => x.type === 'month')?.value ?? '';
      const day = Number(parts.find(x => x.type === 'day')?.value);
      const month = monthNum(mStr);
      const leap = mStr.startsWith('闰');
      if (month >= 1 && day >= 1 && day <= 30) {
        return { month, day, leap, monthName: `${leap ? '闰' : ''}${MONTH_NAMES[month - 1]}月`, dayName: DAY_NAMES[day - 1] };
      }
    } catch {}
  }
  // 兜底：旧的查表算法
  try {
    const l = solarToLunar(dateStr) as { month: string; day: string; isLeap: boolean } | null;
    if (!l) return null;
    const mName = String(l.month).replace(/^闰/, '');
    const month = MONTH_NAMES.indexOf(mName) + 1;
    const day = DAY_NAMES.indexOf(l.day) + 1;
    if (month < 1 || day < 1) return null;
    return { month, day, leap: !!l.isLeap, monthName: `${l.isLeap ? '闰' : ''}${mName}月`, dayName: l.day };
  } catch {
    return null;
  }
}

/** 农历日期（数字）；算不出来返回 null */
export function lunarOf(dateStr: string) {
  if (!cache.has(dateStr)) {
    if (cache.size > 2000) cache.clear();
    cache.set(dateStr, lunarCompute(dateStr));
  }
  return cache.get(dateStr) ?? null;
}

// 二十四节气：每个公历月两个，[名字, 21 世纪常数 C]
const TERMS: [string, number][][] = [
  [['小寒', 5.4055], ['大寒', 20.12]],
  [['立春', 3.87], ['雨水', 18.73]],
  [['惊蛰', 5.63], ['春分', 20.646]],
  [['清明', 4.81], ['谷雨', 20.1]],
  [['立夏', 5.52], ['小满', 21.04]],
  [['芒种', 5.678], ['夏至', 21.37]],
  [['小暑', 7.108], ['大暑', 22.83]],
  [['立秋', 7.5], ['处暑', 23.13]],
  [['白露', 7.646], ['秋分', 23.042]],
  [['寒露', 8.318], ['霜降', 23.438]],
  [['立冬', 7.438], ['小雪', 22.36]],
  [['大雪', 7.18], ['冬至', 21.94]],
];
/** 公式算出来和实际差一天的年份（年-节气 → 修正天数） */
const TERM_FIX: Record<string, number> = {
  '2026-雨水': -1,
  '2084-春分': 1,
  '2008-小满': 1,
  '2016-小暑': 1,
  '2002-立秋': 1,
  '2089-霜降': 1,
  '2089-立冬': 1,
  '2019-小寒': -1,
  '2082-大寒': 1,
  '2021-冬至': -1,
};

/** 某年某月（1–12）的两个节气：[{日, 名字}] */
export function termsOfMonth(year: number, month: number): { day: number; name: string }[] {
  const y = year % 100;
  return TERMS[month - 1].map(([name, c]) => {
    // 一月、二月的节气用上一年的闰年数
    const leaps = month <= 2 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
    let day = Math.floor(y * 0.2422 + c) - leaps;
    day += TERM_FIX[`${year}-${name}`] ?? 0;
    return { day, name };
  });
}

function nthWeekday(year: number, month: number, nth: number, wd: number): number {
  const first = new Date(year, month - 1, 1).getDay();
  return 1 + ((wd - first + 7) % 7) + (nth - 1) * 7;
}

/** 这一天的节日 / 节气（按重要程度排：农历节日 → 公历节日 → 节气） */
export function festivalsOn(dateStr: string): Festival[] {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return [];
  const out: Festival[] = [];
  const l = lunarOf(dateStr);
  if (l && !l.leap) {
    const name = LUNAR[`${l.month}-${l.day}`];
    if (name) out.push({ name, kind: 'lunar' });
    // 除夕：腊月的最后一天（明天就是正月初一）
    if (l.month === 12) {
      const next = new Date(y, m - 1, d + 1);
      const nl = lunarOf(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`);
      if (nl && nl.month === 1 && nl.day === 1) out.push({ name: '除夕', kind: 'lunar' });
    }
  }
  const md = dateStr.slice(5);
  if (SOLAR[md]) out.push({ name: SOLAR[md], kind: 'solar' });
  for (const [mm, nth, wd, name] of NTH_WEEKDAY) if (mm === m && nthWeekday(y, m, nth, wd) === d) out.push({ name, kind: 'solar' });
  for (const t of termsOfMonth(y, m)) if (t.day === d) out.push({ name: t.name, kind: 'term' });
  return out;
}

/** 日历格子里农历那一行显示什么：有节日 / 节气就显示它，初一显示「冬月」这样的月份，其余显示农历日 */
export function lunarLine(dateStr: string): { text: string; special: Festival['kind'] | null } {
  const f = festivalsOn(dateStr);
  if (f.length) return { text: f.map(x => x.name).slice(0, 2).join('·'), special: f[0].kind };
  const l = lunarOf(dateStr);
  if (!l) return { text: '', special: null };
  return { text: l.day === 1 ? l.monthName : l.dayName, special: null };
}
