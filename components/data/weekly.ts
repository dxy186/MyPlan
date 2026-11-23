/**
 * 每周小结：周日晚上（或下周一、二补看）给一张卡片。
 */
import { Goal, TimeLog, addDays, loadJSON, saveJSON, todayStr, weekdayOf } from '@/app/utils/planning';

export const WEEKLY_KEY = '@myplan_weekly';
export type WeeklySummary = {
  weekStart: string; // 周一
  weekEnd: string; // 周日
  done: number;
  focusMin: number;
  activeDays: number;
  bestDay: { date: string; done: number; focusMin: number } | null;
  overdue: number;
  nextWeek: string[]; // 下周截止的任务
  comment?: string; // AI 点评
  commentBy?: string; // 写点评时用的人设
  seenAt?: string;
};

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 给定日期所在周的周一 */
export function mondayOf(date: string) {
  const wd = weekdayOf(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

/** 现在该看哪一周的小结：周日 18 点后看本周；周一、周二看上周；其他时间没有 */
export function weekToReview(now = new Date()): string | null {
  const today = todayStr();
  const wd = weekdayOf(today);
  if (wd === 0 && now.getHours() >= 18) return mondayOf(today);
  if (wd === 1 || wd === 2) return mondayOf(addDays(today, -7));
  return null;
}

export function buildWeekly(goals: Goal[], logs: TimeLog[], weekStart: string): WeeklySummary {
  const weekEnd = addDays(weekStart, 6);
  const inWeek = (d: string) => d >= weekStart && d <= weekEnd;
  const tasks = goals.flatMap(g => g.milestones.flatMap(m => m.tasks)).filter(t => !t.split);
  const perDay = new Map<string, { done: number; focusMin: number }>();
  const bump = (d: string, k: 'done' | 'focusMin', n: number) => {
    const cur = perDay.get(d) ?? { done: 0, focusMin: 0 };
    cur[k] += n;
    perDay.set(d, cur);
  };
  for (const t of tasks) if (t.done && t.doneAt && inWeek(localDay(t.doneAt))) bump(localDay(t.doneAt), 'done', 1);
  for (const l of logs) if (l.category === '任务' && l.startAt && inWeek(localDay(l.startAt))) bump(localDay(l.startAt), 'focusMin', l.minutes);
  let bestDay: WeeklySummary['bestDay'] = null;
  for (const [date, v] of perDay) {
    if (!bestDay || v.done * 60 + v.focusMin > bestDay.done * 60 + bestDay.focusMin) bestDay = { date, ...v };
  }
  const nextStart = addDays(weekEnd, 1);
  const nextEnd = addDays(nextStart, 6);
  return {
    weekStart,
    weekEnd,
    done: [...perDay.values()].reduce((s, v) => s + v.done, 0),
    focusMin: [...perDay.values()].reduce((s, v) => s + v.focusMin, 0),
    activeDays: [...perDay.values()].filter(v => v.done > 0 || v.focusMin > 0).length,
    bestDay,
    overdue: tasks.filter(t => !t.done && t.due && t.due <= weekEnd).length,
    nextWeek: tasks.filter(t => !t.done && t.due && t.due >= nextStart && t.due <= nextEnd).map(t => t.title).slice(0, 8),
  };
}

export async function loadWeeklies() {
  return loadJSON<WeeklySummary[]>(WEEKLY_KEY, []);
}
export async function saveWeekly(w: WeeklySummary) {
  const all = (await loadWeeklies()).filter(x => x.weekStart !== w.weekStart);
  await saveJSON(WEEKLY_KEY, [...all, w].slice(-30));
}
