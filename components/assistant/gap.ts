/**
 * 见缝插针：根据「现在有多少空闲时间 + 当前精力」，从待办里挑出最适合马上做的任务。
 * - 放得下就整个做完；放不下的大任务就推进一段（碎片时间也能推进大任务）
 * - 精力低时不推荐高耗能任务；越紧急越靠前；本来就排在这个时候的优先
 */
import {
  EnergyCost,
  EnergySlotKey,
  Goal,
  KEYS,
  PlanTask,
  TimeLog,
  diffDays,
  loadJSON,
  minutesToHM,
  predictCurve,
  randomId,
  saveJSON,
  speedFactor,
  todayStr,
  weekdayOf,
} from '@/app/utils/planning';
import { ScheduleResult } from '@/app/utils/scheduler';

import { PlanState, allTasks, spentByTask } from './plan-store';

export type EnergyLevel = 'high' | 'medium' | 'low';

export const ENERGY_LEVEL_CN: Record<EnergyLevel, string> = {
  high: '💪 精力好',
  medium: '🙂 一般',
  low: '😴 有点累',
};

const COST_CN: Record<EnergyCost, string> = { high: '高耗能', medium: '中耗能', low: '低耗能' };

export function minuteOfDay(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

export function slotOfMinute(min: number): EnergySlotKey {
  const h = min / 60;
  if (h >= 6 && h < 8) return 'dawn';
  if (h >= 8 && h < 11) return 'morning';
  if (h >= 11 && h < 13) return 'noon';
  if (h >= 13 && h < 17) return 'afternoon';
  if (h >= 17 && h < 19) return 'evening';
  if (h >= 19 && h < 23) return 'night';
  return 'late';
}

export function levelOfScore(score: number): EnergyLevel {
  if (score >= 7) return 'high';
  if (score >= 4.5) return 'medium';
  return 'low';
}

/** 当前精力：3 小时内有打卡就用打卡，否则按历史预测 */
export function currentEnergy(
  state: PlanState,
  now = new Date()
): { level: EnergyLevel; score: number; source: 'log' | 'predict' } {
  const recent = state.energyLogs
    .filter(l => now.getTime() - new Date(l.createdAt).getTime() < 3 * 3600 * 1000)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (recent) return { level: levelOfScore(recent.score), score: recent.score, source: 'log' };
  const score = predictCurve(state.energyLogs, todayStr())[slotOfMinute(minuteOfDay(now))];
  return { level: levelOfScore(score), score, source: 'predict' };
}

export type FreeWindow = {
  /** 从现在到下一个安排的分钟数；0 表示正在固定日程里 */
  minutes: number;
  /** 下一个安排的开始时间 HH:MM */
  until: string;
  /** 下一个安排叫什么 */
  nextTitle: string;
  /** 如果现在正处在某个固定日程里 */
  busyWith?: string;
};

/** 现在到下一个固定日程 / 玩的时间 / 一天结束之间有多少空 */
export function freeWindow(state: PlanState, schedule: ScheduleResult | null, now = new Date()): FreeWindow {
  const today = todayStr();
  const wd = weekdayOf(today);
  const cur = minuteOfDay(now);
  const blocks: { start: number; end: number; title: string }[] = [];
  for (const e of state.fixed) {
    const onToday = e.date ? e.date === today : e.weekday === wd;
    if (onToday) blocks.push({ start: e.startMin, end: e.endMin, title: e.title });
  }
  for (const it of schedule?.items ?? []) {
    if (it.date === today && (it.type === 'fixed' || it.type === 'play')) {
      blocks.push({ start: it.startMin, end: it.endMin, title: it.title });
    }
  }
  const inside = blocks.find(b => b.start <= cur && b.end > cur);
  if (inside) return { minutes: 0, until: minutesToHM(inside.end), nextTitle: inside.title, busyWith: inside.title };
  const next = blocks.filter(b => b.start > cur).sort((a, b) => a.start - b.start)[0];
  const dayEnd = state.settings.dayEndMin;
  if (next) return { minutes: next.start - cur, until: minutesToHM(next.start), nextTitle: next.title };
  return { minutes: Math.max(0, dayEnd - cur), until: minutesToHM(dayEnd), nextTitle: '今天结束' };
}

export type GapSuggestion = {
  task: PlanTask;
  goal: Goal;
  /** 这次建议做多少分钟 */
  minutes: number;
  /** 这次能不能做完 */
  finishes: boolean;
  /** 校准后还剩多少分钟 */
  remaining: number;
  reasons: string[];
  score: number;
};

const ENERGY_FIT: Record<EnergyLevel, Record<EnergyCost, number>> = {
  high: { high: 3, medium: 2, low: 0.5 },
  medium: { high: 1, medium: 3, low: 2 },
  low: { high: -3, medium: 1, low: 3 },
};

const WINDOW_OF_SLOT: Partial<Record<EnergySlotKey, PlanTask['window']>> = {
  dawn: 'morning',
  morning: 'morning',
  noon: 'afternoon',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'evening',
};

export function suggestForGap(
  state: PlanState,
  minutes: number,
  energy: EnergyLevel,
  schedule: ScheduleResult | null,
  now = new Date(),
  limit = 3
): GapSuggestion[] {
  if (minutes < 5) return [];
  const today = todayStr();
  const cur = minuteOfDay(now);
  const refs = allTasks(state.goals);
  const doneIds = new Set(refs.filter(r => r.task.done).map(r => r.task.id));
  const spent = spentByTask(state.timeLogs);
  const sf = speedFactor(state.timeLogs, refs.map(r => r.task));
  const nowWindow = WINDOW_OF_SLOT[slotOfMinute(cur)];

  // 排程里今天最近要做的任务
  const scheduledSoon = new Set(
    (schedule?.items ?? [])
      .filter(i => i.date === today && i.type === 'task' && i.taskId && i.endMin > cur && i.startMin < cur + 120)
      .map(i => i.taskId as string)
  );

  const out: GapSuggestion[] = [];
  for (const { task, goal } of refs) {
    if (task.done) continue;
    if (task.deps.some(d => !doneIds.has(d))) continue;
    if (task.notBefore && diffDays(today, task.notBefore) > 0) continue;

    const used = spent.get(task.id) ?? 0;
    const remaining = Math.max(5, Math.round(task.estimateMin * sf - used));
    const finishes = remaining <= minutes;
    const daysLeft = task.due ? diffDays(today, task.due) : null;
    const overdue = daysLeft !== null && daysLeft < 0;

    // 太短的空档不适合硬啃需要进入状态的任务
    if (!finishes && minutes < 15 && task.energyCost !== 'low') continue;
    // 很累的时候不推荐高耗能，除非已经逾期
    if (energy === 'low' && task.energyCost === 'high' && !overdue) continue;

    const reasons: string[] = [];
    let score = ENERGY_FIT[energy][task.energyCost];
    if (score >= 2.5) reasons.push(`${COST_CN[task.energyCost]}，适合现在的精力`);

    if (daysLeft !== null) {
      if (overdue) {
        score += 4;
        reasons.push(`已逾期 ${-daysLeft} 天`);
      } else if (daysLeft === 0) {
        score += 3;
        reasons.push('今天截止');
      } else if (daysLeft === 1) {
        score += 2;
        reasons.push('明天截止');
      } else if (daysLeft <= 3) {
        score += 1;
        reasons.push(`${daysLeft} 天后截止`);
      }
    }

    if (finishes) {
      score += 2;
      // 刚好能用满空档的更好
      if (remaining >= minutes * 0.5) score += 1;
      reasons.push(`约 ${remaining} 分钟，这段时间能做完`);
    } else {
      score += minutes >= 25 ? 1 : 0;
      reasons.push(`推进 ${minutes} 分钟，还剩约 ${remaining - minutes} 分钟`);
    }

    if (scheduledSoon.has(task.id)) {
      score += 1.5;
      reasons.push('本来就排在这前后');
    }
    if (task.window && task.window === nowWindow) score += 1;
    if (used > 0) {
      score += 0.5;
      reasons.push(`已经做了 ${used} 分钟，趁热继续`);
    }

    out.push({ task, goal, minutes: finishes ? remaining : minutes, finishes, remaining, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------------------
// 见缝插针的计时（存起来，切换页面也不丢）
// ---------------------------------------------------------------------------
export const GAP_TIMER_KEY = '@myplan__gap_timer';
/** 计时器开始 / 结束时广播，今天页的计时卡片会刷新 */
export const TIMER_CHANGED_EVENT = 'myplan:timer-changed';

export type GapTimer = { taskId: string; title: string; startAt: string; plannedMin: number; estimateMin: number };

export async function loadGapTimer(): Promise<GapTimer | null> {
  return loadJSON<GapTimer | null>(GAP_TIMER_KEY, null);
}

export async function saveGapTimer(t: GapTimer | null): Promise<void> {
  await saveJSON(GAP_TIMER_KEY, t);
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event(TIMER_CHANGED_EVENT));
}

/** 从任意页面开始给某个任务计时（全应用只有这一个计时器） */
export async function startTaskTimer(task: PlanTask, plannedMin?: number): Promise<GapTimer> {
  const t: GapTimer = {
    taskId: task.id,
    title: task.title,
    startAt: new Date().toISOString(),
    plannedMin: plannedMin ?? Math.min(task.estimateMin, 90),
    estimateMin: task.estimateMin,
  };
  await saveGapTimer(t);
  return t;
}

/** 把这段计时写进时间记录，返回记录的分钟数 */
export async function recordGapTimer(t: GapTimer, end = new Date()): Promise<number> {
  const minutes = Math.max(1, Math.round((end.getTime() - new Date(t.startAt).getTime()) / 60000));
  const logs = await loadJSON<TimeLog[]>(KEYS.timeLogs, []);
  const log: TimeLog = {
    id: randomId(),
    title: t.title,
    taskId: t.taskId,
    category: '任务',
    startAt: t.startAt,
    endAt: end.toISOString(),
    minutes,
    estimateMin: t.estimateMin,
    source: 'gap',
    createdAt: end.toISOString(),
  };
  await saveJSON(KEYS.timeLogs, [log, ...logs]);
  await saveGapTimer(null);
  return minutes;
}

