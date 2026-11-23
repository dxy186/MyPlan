/**
 * 连续打卡：某一天「至少勾掉一项任务」或「完成了晚上复盘」就算打卡。
 * 规则是「断一天没关系，别连断两天」：昨天断了，今天打卡就提示「接上了」。
 */
import { Goal, addDays, todayStr } from '@/app/utils/planning';

export type StreakInfo = {
  /** 当前连续天数（今天已打卡就算到今天，没打卡就算到昨天） */
  current: number;
  /** 今天打卡了没有 */
  todayDone: boolean;
  /** 历史最长 */
  best: number;
  /** 昨天断了、但前天有打卡：今天打卡能「接上」 */
  canRescue: boolean;
  /** 打过卡的日期 */
  days: Set<string>;
};

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function checkinDays(goals: Goal[], reviewDates: string[]): Set<string> {
  const days = new Set<string>(reviewDates);
  for (const g of goals) for (const m of g.milestones) for (const t of m.tasks) if (t.done && t.doneAt && !t.split) days.add(localDay(t.doneAt));
  return days;
}

export function computeStreak(goals: Goal[], reviewDates: string[], today = todayStr()): StreakInfo {
  const days = checkinDays(goals, reviewDates);
  const todayDone = days.has(today);
  let current = 0;
  for (let d = todayDone ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current++;
  let best = 0;
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue;
    let n = 1;
    while (days.has(addDays(d, n))) n++;
    best = Math.max(best, n);
  }
  const yesterday = addDays(today, -1);
  const canRescue = !todayDone && !days.has(yesterday) && days.has(addDays(today, -2));
  return { current, todayDone, best, canRescue, days };
}
