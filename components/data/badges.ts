/**
 * 勋章：全部根据真实数据点亮，没有手动领取。
 */
import { Goal, TimeLog, addDays, todayStr } from '@/app/utils/planning';

export type BadgeInput = {
  goals: Goal[];
  timeLogs: TimeLog[];
  reviewDates: string[];
  planDates: string[];
  memories: number;
};

export type Badge = { id: string; icon: string; name: string; desc: string; earned: boolean; progress: string };

function streak(dates: string[]): number {
  const set = new Set(dates);
  let best = 0;
  for (const d of set) {
    if (set.has(addDays(d, -1))) continue; // 只从连续段的第一天开始数
    let n = 1;
    while (set.has(addDays(d, n))) n++;
    best = Math.max(best, n);
  }
  return best;
}

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeBadges(x: BadgeInput): Badge[] {
  const tasks = x.goals.flatMap(g => g.milestones.flatMap(m => m.tasks));
  const done = tasks.filter(t => t.done).length;
  const taskLogs = x.timeLogs.filter(l => l.category === '任务');
  const focusMin = taskLogs.reduce((s, l) => s + l.minutes, 0);
  const gapChunks = x.timeLogs.filter(l => l.source === 'gap').length;
  const onTimeGoals = x.goals.filter(g => g.completedAt && g.due && localDay(g.completedAt) <= g.due).length;
  const logStreak = streak([...new Set(taskLogs.map(l => localDay(l.startAt)))]);
  const reviewStreak = streak(x.reviewDates);
  const h = (m: number) => `${Math.floor(m / 60)} 小时`;

  const b = (id: string, icon: string, name: string, desc: string, cur: number, target: number, fmt = (n: number) => `${n}`) => ({
    id,
    icon,
    name,
    desc,
    earned: cur >= target,
    progress: cur >= target ? '已获得' : `${fmt(cur)} / ${fmt(target)}`,
  });

  return [
    b('first', '🌱', '第一步', '完成第 1 个任务', done, 1),
    b('ten', '🔟', '渐入佳境', '累计完成 10 个任务', done, 10),
    b('hundred', '💯', '百炼成钢', '累计完成 100 个任务', done, 100),
    b('focus10', '⏱', '专注 10 小时', '计时记录累计 10 小时', focusMin, 600, h),
    b('focus50', '🏔', '专注 50 小时', '计时记录累计 50 小时', focusMin, 3000, h),
    b('streak7', '🔥', '连续一周', '连续 7 天都有计时记录', logStreak, 7, n => `${n} 天`),
    b('review3', '🌙', '复盘新手', '连续 3 天晚上复盘', reviewStreak, 3, n => `${n} 天`),
    b('review7', '🌕', '复盘达人', '连续 7 天晚上复盘', reviewStreak, 7, n => `${n} 天`),
    b('plan5', '☀️', '有备而来', '早上确认今日计划 5 次', x.planDates.length, 5, n => `${n} 次`),
    b('ontime1', '🎯', '按时交付', '有截止日的目标在截止前全部完成', onTimeGoals, 1),
    b('ontime5', '🏅', '说到做到', '5 个目标在截止前完成', onTimeGoals, 5),
    b('gap5', '⚡', '见缝插针', '用「我现在有空」完成 5 段', gapChunks, 5, n => `${n} 段`),
    b('self3', '🧠', '了解自己', '让 AI 记住 3 条偏好', x.memories, 3, n => `${n} 条`),
  ];
}

/** 最近 7 天的概况 */
export function weekStats(x: BadgeInput) {
  const since = addDays(todayStr(), -6);
  const tasks = x.goals.flatMap(g => g.milestones.flatMap(m => m.tasks));
  const doneWeek = tasks.filter(t => t.done && t.doneAt && localDay(t.doneAt) >= since).length;
  const logs = x.timeLogs.filter(l => l.category === '任务' && localDay(l.startAt) >= since);
  const focusMin = logs.reduce((s, l) => s + l.minutes, 0);
  const days = new Set(logs.map(l => localDay(l.startAt))).size;
  const reviews = x.reviewDates.filter(d => d >= since).length;
  const pending = tasks.filter(t => !t.done).length;
  const overdue = tasks.filter(t => !t.done && t.due && t.due < todayStr()).length;
  return { doneWeek, focusMin, days, reviews, pending, overdue };
}
