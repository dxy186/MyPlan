/**
 * 持续跟进：
 * - 正在做 / 下一项
 * - 到点提醒（系统通知）
 * - 自动补排：错过的任务块从现在起重新排，并告诉你挪到了哪里
 * - 早上确认今日计划、晚上 1 分钟复盘
 */
import {
  KEYS,
  TimeLog,
  addDays,
  loadJSON,
  minutesToHM,
  saveJSON,
  todayStr,
} from '@/app/utils/planning';
import { ScheduleItem, ScheduleResult } from '@/app/utils/scheduler';

import { PlanState, allTasks, spentByTask } from './plan-store';

export function minuteNow(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

function fmtDay(date: string, today = todayStr()) {
  if (date === today) return '今天';
  if (date === addDays(today, 1)) return '明天';
  if (date === addDays(today, 2)) return '后天';
  return date.slice(5);
}

export function fmtWhen(it: Pick<ScheduleItem, 'date' | 'startMin'>) {
  return `${fmtDay(it.date)} ${minutesToHM(it.startMin)}`;
}

// ---------------------------------------------------------------------------
// 正在做 / 下一项
// ---------------------------------------------------------------------------
const NOW_TYPES = new Set(['task', 'fixed', 'play', 'chore']);

export function nowAndNext(schedule: ScheduleResult | null, now = new Date()) {
  const today = todayStr();
  const cur = minuteNow(now);
  const items = (schedule?.items ?? [])
    .filter(i => NOW_TYPES.has(i.type))
    .filter(i => i.date > today || (i.date === today && i.endMin > cur))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
  const current = items.find(i => i.date === today && i.startMin <= cur && i.endMin > cur) ?? null;
  const next = items.find(i => i !== current && (i.date > today || i.startMin >= cur)) ?? null;
  return { current, next };
}

// ---------------------------------------------------------------------------
// 自动补排：找出「已经过去、但没开始做」的任务块
// ---------------------------------------------------------------------------
export type MissedBlock = { item: ScheduleItem; movedTo: ScheduleItem | null };

function workedDuring(logs: TimeLog[], taskId: string, date: string, startMin: number, endMin: number) {
  return logs.some(l => {
    if (l.taskId !== taskId) return false;
    const s = new Date(l.startAt);
    const e = new Date(l.endAt || l.startAt);
    const day = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
    if (day !== date) return false;
    const ls = s.getHours() * 60 + s.getMinutes();
    const le = e.getHours() * 60 + e.getMinutes();
    // 时间段有重叠（前后各放宽 30 分钟）
    return ls < endMin + 30 && le > startMin - 30;
  });
}

/** 旧排程里今天已经结束、却没有计时也没完成的任务块 */
export function findMissed(old: ScheduleResult | null, state: PlanState, now = new Date()): ScheduleItem[] {
  if (!old) return [];
  const today = todayStr();
  const cur = minuteNow(now);
  const done = new Set(allTasks(state.goals).filter(r => r.task.done).map(r => r.task.id));
  const exists = new Set(allTasks(state.goals).map(r => r.task.id));
  return old.items.filter(
    i =>
      i.type === 'task' &&
      i.taskId &&
      i.date === today &&
      i.endMin <= cur &&
      exists.has(i.taskId) &&
      !done.has(i.taskId) &&
      !workedDuring(state.timeLogs, i.taskId, i.date, i.startMin, i.endMin)
  );
}

/** 把错过的块和新排程对应起来：挪到了哪里 */
export function matchMoved(missed: ScheduleItem[], fresh: ScheduleResult): MissedBlock[] {
  const today = todayStr();
  const seen = new Set<string>();
  const out: MissedBlock[] = [];
  for (const m of missed) {
    if (!m.taskId || seen.has(m.taskId)) continue;
    seen.add(m.taskId);
    const movedTo =
      fresh.items
        .filter(i => i.taskId === m.taskId && (i.date > today || i.endMin > m.endMin))
        .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)[0] ?? null;
    out.push({ item: m, movedTo });
  }
  return out;
}

/** 已经提示过的错过块，避免重复提示 */
const MISSED_SEEN_KEY = '@myplan__missed_seen';
export async function filterUnseenMissed(missed: ScheduleItem[]): Promise<ScheduleItem[]> {
  const seen = await loadJSON<string[]>(MISSED_SEEN_KEY, []);
  return missed.filter(m => !seen.includes(m.id));
}
export async function markMissedSeen(ids: string[]) {
  const seen = await loadJSON<string[]>(MISSED_SEEN_KEY, []);
  await saveJSON(MISSED_SEEN_KEY, [...seen, ...ids].slice(-200));
}

// ---------------------------------------------------------------------------
// 早上：今日计划；晚上：复盘
// ---------------------------------------------------------------------------
export const DAILY_PLAN_KEY = '@myplan_daily_plans';
export const REVIEWS_KEY = '@myplan_reviews';

export type DailyPlan = { date: string; confirmedAt: string; taskIds: string[]; titles: string[]; totalMin: number };

export type ReviewReason = '太累了' | '被打断' | '估少了' | '不想做' | '临时有事' | '其他';
export const REVIEW_REASONS: ReviewReason[] = ['太累了', '被打断', '估少了', '不想做', '临时有事', '其他'];

export type ReviewItem = {
  taskId: string;
  title: string;
  status: 'done' | 'tomorrow' | 'later';
  reason?: ReviewReason;
};
export type DailyReview = { date: string; at: string; items: ReviewItem[]; note?: string };

export async function loadDailyPlans() {
  return loadJSON<DailyPlan[]>(DAILY_PLAN_KEY, []);
}
export async function saveDailyPlan(p: DailyPlan) {
  const all = (await loadDailyPlans()).filter(x => x.date !== p.date);
  await saveJSON(DAILY_PLAN_KEY, [...all, p].slice(-60));
}
export async function loadReviews() {
  return loadJSON<DailyReview[]>(REVIEWS_KEY, []);
}
export async function saveReview(r: DailyReview) {
  const all = (await loadReviews()).filter(x => x.date !== r.date);
  await saveJSON(REVIEWS_KEY, [...all, r].slice(-90));
}

/** 今天排程里的任务（去重），用于早上的计划 */
export function todayTasks(schedule: ScheduleResult | null) {
  const today = todayStr();
  const byTask = new Map<string, { taskId: string; title: string; minutes: number; first: number }>();
  for (const i of schedule?.items ?? []) {
    if (i.type !== 'task' || !i.taskId || i.date !== today) continue;
    const prev = byTask.get(i.taskId);
    const minutes = i.endMin - i.startMin;
    if (prev) prev.minutes += minutes;
    else byTask.set(i.taskId, { taskId: i.taskId, title: i.title.replace(/（\d+\/\d+）$/, ''), minutes, first: i.startMin });
  }
  return [...byTask.values()].sort((a, b) => a.first - b.first);
}

/** 晚上要复盘的任务：早上计划的 + 今天计过时的 + 今天还排着的 */
export function reviewCandidates(state: PlanState, schedule: ScheduleResult | null, plan: DailyPlan | null) {
  const today = todayStr();
  const refs = new Map(allTasks(state.goals).map(r => [r.task.id, r.task]));
  const ids = new Set<string>(plan?.taskIds ?? []);
  for (const l of state.timeLogs) {
    if (l.taskId && l.startAt && new Date(l.startAt).toDateString() === new Date().toDateString()) ids.add(l.taskId);
  }
  for (const t of todayTasks(schedule)) ids.add(t.taskId);
  const spent = spentByTask(state.timeLogs.filter(l => new Date(l.startAt).toDateString() === new Date().toDateString()));
  return [...ids]
    .map(id => refs.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map(t => ({ task: t, todayMin: spent.get(t.id) ?? 0, today }));
}

/** 最近几天没完成的原因统计，给 AI 参考 */
export function reasonSummary(reviews: DailyReview[], days = 14): string {
  const since = addDays(todayStr(), -days);
  const counts = new Map<string, number>();
  let done = 0;
  let total = 0;
  for (const r of reviews.filter(x => x.date >= since)) {
    for (const it of r.items) {
      total++;
      if (it.status === 'done') done++;
      else if (it.reason) counts.set(it.reason, (counts.get(it.reason) ?? 0) + 1);
    }
  }
  if (total === 0) return '';
  const reasons = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v} 次`);
  return `近 ${days} 天复盘：计划内任务完成 ${done}/${total}${reasons.length ? `；没完成的原因：${reasons.join('、')}` : ''}`;
}

// ---------------------------------------------------------------------------
// 提醒设置与系统通知
// ---------------------------------------------------------------------------
export const REMINDER_KEY = '@myplan_reminder_settings';
export type ReminderSettings = { enabled: boolean; leadMin: number; eveningReviewAt: number };
export const DEFAULT_REMINDER: ReminderSettings = { enabled: false, leadMin: 0, eveningReviewAt: 21 * 60 };

export async function loadReminderSettings(): Promise<ReminderSettings> {
  return { ...DEFAULT_REMINDER, ...(await loadJSON<Partial<ReminderSettings>>(REMINDER_KEY, {})) };
}
export async function saveReminderSettings(s: ReminderSettings) {
  await saveJSON(REMINDER_KEY, s);
}

export function notificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function notify(title: string, body: string, tag?: string) {
  if (!notificationSupported() || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * 计算这一分钟该发的提醒。
 * - 任务块开始时：「该开始 XX 了」
 * - 固定日程开始前 10 分钟：「XX 10 分钟后开始」
 * - 到了复盘时间：「花 1 分钟复盘今天」
 */
export function dueReminders(
  schedule: ScheduleResult | null,
  settings: ReminderSettings,
  sent: Set<string>,
  reviewedToday: boolean,
  now = new Date()
): { key: string; title: string; body: string }[] {
  const today = todayStr();
  const cur = minuteNow(now);
  const out: { key: string; title: string; body: string }[] = [];
  for (const i of schedule?.items ?? []) {
    if (i.date !== today) continue;
    if (i.type === 'task') {
      const at = i.startMin - settings.leadMin;
      const key = `start:${i.id}`;
      if (cur >= at && cur < Math.min(i.endMin, at + 5) && !sent.has(key)) {
        out.push({
          key,
          title: `⏰ ${minutesToHM(i.startMin)} 该开始了`,
          body: `${i.title}（到 ${minutesToHM(i.endMin)}）。没空的话打开 MyPlan，它会自动顺延。`,
        });
      }
    } else if (i.type === 'fixed') {
      const key = `fixed:${i.id}`;
      if (cur >= i.startMin - 10 && cur < i.startMin && !sent.has(key)) {
        out.push({ key, title: `📌 ${i.startMin - cur} 分钟后：${i.title}`, body: `${minutesToHM(i.startMin)}–${minutesToHM(i.endMin)}` });
      }
    }
  }
  const rk = `review:${today}`;
  if (!reviewedToday && cur >= settings.eveningReviewAt && cur < settings.eveningReviewAt + 60 && !sent.has(rk)) {
    out.push({ key: rk, title: '🌙 花 1 分钟复盘今天', body: '打开 MyPlan，看看今天做完了什么，没做完的帮你顺延。' });
  }
  return out;
}

export const SCHEDULE_STALE_EVENT = 'myplan:schedule-stale';
export const SENT_KEY = '@myplan__reminders_sent';

/** 后台检查一次：发该发的提醒；有任务块刚结束时通知页面刷新排程 */
export async function reminderTick(sent: Set<string>, now = new Date()) {
  const settings = await loadReminderSettings();
  const schedule = await loadJSON<ScheduleResult | null>(KEYS.schedule, null);
  const reviews = await loadReviews();
  const reviewedToday = reviews.some(r => r.date === todayStr());
  if (settings.enabled) {
    for (const r of dueReminders(schedule, settings, sent, reviewedToday, now)) {
      notify(r.title, r.body, r.key);
      sent.add(r.key);
    }
  }
  // 有任务块刚刚结束：让 AI 秘书页检查要不要补排
  const cur = minuteNow(now);
  const today = todayStr();
  const justEnded = (schedule?.items ?? []).some(i => i.type === 'task' && i.date === today && i.endMin === cur);
  if (justEnded && typeof window !== 'undefined') window.dispatchEvent(new Event(SCHEDULE_STALE_EVENT));
}
