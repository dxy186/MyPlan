/**
 * MyPlan · 双轨排程引擎
 *
 * 进度轨（硬约束）：DDL 倒推、依赖拓扑、关键路径、项目缓冲
 * 精力轨（软约束）：精力曲线匹配耗能、时间盒、强制恢复/玩的时间
 *
 * 纯函数实现，不依赖网络与 UI，便于测试与复用。
 */

import {
  EnergyCost,
  EnergySlotKey,
  ENERGY_SLOTS,
  FixedEvent,
  PlanTask,
  addDays,
  calibrateEstimate,
  diffDays,
  energyLevel,
  hmToMinutes,
  minutesToHM,
  parseDate,
  predictCurve,
  EnergyLog,
  weekdayOf,
} from './planning';

export type ScheduleItemType = 'task' | 'fixed' | 'play' | 'rest' | 'buffer' | 'chore';

export type ScheduleItem = {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  title: string;
  type: ScheduleItemType;
  taskId?: string;
  energyCost?: EnergyCost;
  slotKey?: EnergySlotKey;
  note?: string;
};

export type RiskLevel = 'low' | 'medium' | 'high';

export type ScheduleResult = {
  items: ScheduleItem[];
  unscheduled: PlanTask[];
  criticalPath: string[]; // PlanTask.id（关键链）
  risk: { probability: number; level: RiskLevel; message: string };
  bufferMin: number;
  capacityMin: number;
  requiredMin: number;
  golden: EnergySlotKey[];
  low: EnergySlotKey[];
  generatedAt: string;
};

export type ScheduleOptions = {
  startDate: string; // YYYY-MM-DD
  days: number;
  dayStartMin: number; // 例如 8*60
  dayEndMin: number; // 例如 23*60
  bufferRatio: number; // 项目缓冲比例，推荐 0.2-0.3
  maxFocusMin: number; // 时间盒上限，推荐 90
  minFocusMin: number; // 时间盒下限，推荐 45
  breakMin: number; // 时间盒之间的休息，推荐 10
  playMinPerDay: number; // 每天强制"玩"的分钟数
  restDayWeekday?: number; // 每周缓冲日（0-6），当天不排任务
  speedFactor: number; // 速率校准系数（来自时间记录）
};

export const DEFAULT_SCHEDULE_OPTIONS: ScheduleOptions = {
  startDate: '',
  days: 7,
  dayStartMin: 8 * 60,
  dayEndMin: 23 * 60,
  bufferRatio: 0.25,
  maxFocusMin: 90,
  minFocusMin: 45,
  breakMin: 10,
  playMinPerDay: 120,
  restDayWeekday: 0,
  speedFactor: 1,
};

type Interval = { start: number; end: number };

function subtract(base: Interval[], busy: Interval[]): Interval[] {
  let free = base.slice();
  for (const b of busy) {
    const next: Interval[] = [];
    for (const f of free) {
      if (b.end <= f.start || b.start >= f.end) {
        next.push(f);
        continue;
      }
      if (b.start > f.start) next.push({ start: f.start, end: Math.min(b.start, f.end) });
      if (b.end < f.end) next.push({ start: Math.max(b.end, f.start), end: f.end });
    }
    free = next;
  }
  return free.filter(f => f.end - f.start > 0);
}

function slotKeyOfMinute(minute: number): EnergySlotKey {
  const hour = minute / 60;
  let best: EnergySlotKey = 'morning';
  let bestDist = Infinity;
  for (const s of ENERGY_SLOTS) {
    const h = s.key === 'late' ? hour < 6 ? hour + 24 : hour : hour;
    const target = s.key === 'late' ? 25 : s.hour;
    const dist = Math.abs(h - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = s.key;
    }
  }
  return best;
}

/** 拓扑排序：依赖在前；有环时退化为按原顺序 */
export function topoSort(tasks: PlanTask[]): PlanTask[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set<string>();
  const out: PlanTask[] = [];
  const visit = (t: PlanTask, stack: Set<string>) => {
    if (visited.has(t.id) || stack.has(t.id)) return;
    stack.add(t.id);
    for (const d of t.deps) {
      const dep = byId.get(d);
      if (dep) visit(dep, stack);
    }
    stack.delete(t.id);
    if (!visited.has(t.id)) {
      visited.add(t.id);
      out.push(t);
    }
  };
  tasks.forEach(t => visit(t, new Set()));
  return out;
}

/** 关键链：依赖链上总耗时最长的一条 */
export function criticalPath(tasks: PlanTask[]): string[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const memo = new Map<string, { len: number; path: string[] }>();
  const solve = (t: PlanTask): { len: number; path: string[] } => {
    if (memo.has(t.id)) return memo.get(t.id) as { len: number; path: string[] };
    let best = { len: 0, path: [] as string[] };
    for (const d of t.deps) {
      const dep = byId.get(d);
      if (!dep) continue;
      const sub = solve(dep);
      if (sub.len > best.len) best = sub;
    }
    const res = { len: best.len + t.estimateMin, path: [...best.path, t.id] };
    memo.set(t.id, res);
    return res;
  };
  let overall = { len: 0, path: [] as string[] };
  tasks.forEach(t => {
    const r = solve(t);
    if (r.len > overall.len) overall = r;
  });
  return overall.path;
}

/** 精力匹配评分：任务耗能越接近时段精力越好 */
function matchScore(cost: EnergyCost, energy: number): number {
  const want = cost === 'high' ? 9 : cost === 'low' ? 2 : 5.5;
  return -Math.abs(energy - want);
}

function findGaps(
  date: string,
  opts: ScheduleOptions,
  fixed: FixedEvent[],
  extraBusy: Interval[],
  restDay: boolean
): Interval[] {
  const base: Interval[] = [{ start: opts.dayStartMin, end: opts.dayEndMin }];
  const busy: Interval[] = [];
  const wd = weekdayOf(date);
  for (const e of fixed) {
    const matches = e.date ? e.date === date : e.weekday === wd;
    if (matches) busy.push({ start: e.startMin, end: e.endMin });
  }
  busy.push(...extraBusy);
  if (restDay) return [];
  const gaps = subtract(base, busy);
  // 强制恢复期：每天晚上留出"玩"的固定时间，禁止侵占
  if (opts.playMinPerDay > 0) {
    const playStart = Math.max(opts.dayStartMin, opts.dayEndMin - opts.playMinPerDay);
    for (const g of subtract(gaps, [{ start: playStart, end: opts.dayEndMin }])) {
      // 保留
      void g;
    }
    return subtract(gaps, [{ start: playStart, end: opts.dayEndMin }]);
  }
  return gaps;
}

export function generateSchedule(
  tasks: PlanTask[],
  logs: EnergyLog[],
  fixed: FixedEvent[],
  options: ScheduleOptions
): ScheduleResult {
  const opts: ScheduleOptions = { ...DEFAULT_SCHEDULE_OPTIONS, ...options };
  const start = opts.startDate || new Date().toISOString().slice(0, 10);
  const days: string[] = [];
  for (let i = 0; i < opts.days; i++) days.push(addDays(start, i));

  const pending = tasks.filter(t => !t.done);
  const requiredMin = pending.reduce(
    (s, t) => s + calibrateEstimate(t.estimateMin, opts.speedFactor),
    0
  );
  const bufferMin = Math.round(requiredMin * opts.bufferRatio);

  const ordered = topoSort(pending).sort((a, b) => {
    const da = a.due ? diffDays(start, a.due) : 999;
    const db = b.due ? diffDays(start, b.due) : 999;
    if (da !== db) return da - db;
    const costRank = (c: EnergyCost) => (c === 'high' ? 0 : c === 'medium' ? 1 : 2);
    if (costRank(a.energyCost) !== costRank(b.energyCost)) return costRank(a.energyCost) - costRank(b.energyCost);
    return b.estimateMin - a.estimateMin;
  });

  const items: ScheduleItem[] = [];
  const unscheduled: PlanTask[] = [];

  // 每天剩余的可用空档（缓存）
  const dayGaps = new Map<string, Interval[]>();
  const curves = new Map<string, Record<EnergySlotKey, number>>();
  for (const d of days) curves.set(d, predictCurve(logs, d));

  const restBusy = new Map<string, Interval[]>();

  const gapsFor = (d: string): Interval[] => {
    if (!dayGaps.has(d)) {
      const isRest = opts.restDayWeekday !== undefined && weekdayOf(d) === opts.restDayWeekday;
      const extra = restBusy.get(d) ?? [];
      const gaps = findGaps(d, opts, fixed, extra, isRest);
      dayGaps.set(d, gaps);
      if (isRest) {
        items.push({
          id: `rest-${d}`,
          date: d,
          startMin: opts.dayStartMin,
          endMin: opts.dayEndMin,
          title: '缓冲日 / 玩（强制恢复期）',
          type: 'rest',
        });
      }
    }
    return dayGaps.get(d) as Interval[];
  };

  // 先把硬约束写进时间表
  for (const d of days) {
    const wd = weekdayOf(d);
    for (const e of fixed) {
      const matches = e.date ? e.date === d : e.weekday === wd;
      if (matches) {
        items.push({
          id: `fixed-${e.id}-${d}`,
          date: d,
          startMin: e.startMin,
          endMin: e.endMin,
          title: e.title,
          type: 'fixed',
        });
      }
    }
    // 恢复期写进时间表
    if (opts.playMinPerDay > 0) {
      const playStart = Math.max(opts.dayStartMin, opts.dayEndMin - opts.playMinPerDay);
      items.push({
        id: `play-${d}`,
        date: d,
        startMin: playStart,
        endMin: opts.dayEndMin,
        title: '玩的时间（不可侵犯）',
        type: 'play',
      });
    }
  }

  const consume = (d: string, chosen: Interval, need: number): Interval | null => {
    const gaps = gapsFor(d);
    const idx = gaps.indexOf(chosen);
    if (idx === -1) return null;
    const take = Math.min(need, chosen.end - chosen.start);
    const used: Interval = { start: chosen.start, end: chosen.start + take };
    const rest = chosen.end - used.end;
    const remaining: Interval[] = [];
    if (rest > 0) remaining.push({ start: used.end, end: chosen.end });
    const next = gaps.slice();
    next.splice(idx, 1, ...remaining);
    dayGaps.set(d, next);
    return used;
  };

  for (const task of ordered) {
    let remaining = calibrateEstimate(task.estimateMin, opts.speedFactor);
    // 找候选日：不晚于 DDL
    const candidates = days.filter(d => {
      if (!task.due) return true;
      const due = parseDate(task.due);
      const dd = parseDate(d);
      if (!due || !dd) return true;
      return dd.getTime() <= due.getTime();
    });
    const searchDays = candidates.length > 0 ? candidates : days;

    let guard = 0;
    while (remaining > 0 && guard++ < 64) {
      const box = remaining > opts.maxFocusMin ? opts.maxFocusMin : Math.max(opts.minFocusMin, remaining);
      let best: { day: string; gap: Interval; score: number } | null = null;
      for (const d of searchDays) {
        const curve = curves.get(d) as Record<EnergySlotKey, number>;
        for (const g of gapsFor(d)) {
          const length = g.end - g.start;
          if (length < Math.min(box, opts.minFocusMin)) continue;
          const slot = slotKeyOfMinute(g.start);
          const score = matchScore(task.energyCost, curve[slot]);
          // 越早越好：轻微惩罚靠后的日期
          const dayPenalty = -diffDays(start, d) * 0.25;
          if (!best || score + dayPenalty > best.score) {
            best = { day: d, gap: g, score: score + dayPenalty };
          }
        }
      }
      if (!best) break;
      const used = consume(best.day, best.gap, box);
      if (!used) break;
      const slot = slotKeyOfMinute(used.start);
      items.push({
        id: `task-${task.id}-${used.start}-${used.end}-${best.day}`,
        date: best.day,
        startMin: used.start,
        endMin: used.end,
        title: task.title,
        type: 'task',
        taskId: task.id,
        energyCost: task.energyCost,
        slotKey: slot,
      });
      // 时间盒之间强制休息
      const gaps = gapsFor(best.day);
      const idx = gaps.findIndex(g => g.start === used.end);
      if (idx !== -1 && opts.breakMin > 0) {
        gaps[idx] = { start: gaps[idx].start + Math.min(opts.breakMin, gaps[idx].end - gaps[idx].start), end: gaps[idx].end };
        if (gaps[idx].end - gaps[idx].start <= 0) gaps.splice(idx, 1);
        dayGaps.set(best.day, gaps);
      }
      remaining -= used.end - used.start;
    }
    if (remaining > 0) unscheduled.push(task);
  }

  // 项目缓冲：在最后一个有 DDL 的日子留出缓冲块（可视化）
  const lastDay = days[days.length - 1];
  if (bufferMin > 0) {
    const gaps = gapsFor(lastDay);
    let left = bufferMin;
    for (const g of gaps) {
      if (left <= 0) break;
      const take = Math.min(left, g.end - g.start);
      items.push({
        id: `buffer-${g.start}-${lastDay}`,
        date: lastDay,
        startMin: g.start,
        endMin: g.start + take,
        title: '项目缓冲（吸收低能量日延误）',
        type: 'buffer',
      });
      left -= take;
    }
  }

  // 容量与风险
  let capacityMin = 0;
  for (const d of days) {
    const isRest = opts.restDayWeekday !== undefined && weekdayOf(d) === opts.restDayWeekday;
    if (isRest) continue;
    const wd = weekdayOf(d);
    let busy = opts.playMinPerDay;
    for (const e of fixed) {
      const matches = e.date ? e.date === d : e.weekday === wd;
      if (matches) busy += Math.max(0, e.endMin - e.startMin);
    }
    capacityMin += Math.max(0, opts.dayEndMin - opts.dayStartMin - busy);
  }
  const effective = Math.max(0, capacityMin - bufferMin);
  const ratio = requiredMin / Math.max(1, effective);
  let probability = Math.max(0.05, Math.min(0.98, 1.15 - ratio * 0.55));
  if (unscheduled.length > 0) probability = Math.min(probability, 0.35);
  probability = Math.round(probability * 100) / 100;
  const level: RiskLevel = probability >= 0.8 ? 'low' : probability >= 0.6 ? 'medium' : 'high';
  const message =
    unscheduled.length > 0
      ? `有 ${unscheduled.length} 个任务在 DDL 前排不下，建议压缩质量等级或启用缓冲日。`
      : level === 'low'
      ? '进度健康，按计划执行即可，注意保护恢复期。'
      : level === 'medium'
      ? '有一定风险：优先做关键链任务，低优先任务可降到青铜档。'
      : '风险偏高：建议减少并行、把非关键任务后移，或使用缓冲日。';

  items.sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : a.date < b.date ? -1 : 1));

  const curveToday = curves.get(days[0]) as Record<EnergySlotKey, number>;
  const sortedSlots = ENERGY_SLOTS.map(s => ({ k: s.key, v: curveToday[s.key] })).sort((a, b) => b.v - a.v);

  return {
    items,
    unscheduled,
    criticalPath: criticalPath(pending),
    risk: { probability, level, message },
    bufferMin,
    capacityMin,
    requiredMin,
    golden: sortedSlots.slice(0, 2).map(s => s.k),
    low: sortedSlots.slice(-2).map(s => s.k),
    generatedAt: new Date().toISOString(),
  };
}

/** 质量弹性：根据剩余时间占比给出建议完成等级 */
export function qualityTierFor(remainingMin: number, availableMin: number): 'gold' | 'silver' | 'bronze' {
  if (availableMin <= 0) return 'bronze';
  const r = remainingMin / availableMin;
  if (r <= 0.6) return 'gold';
  if (r <= 0.9) return 'silver';
  return 'bronze';
}

export function fmtRange(startMin: number, endMin: number): string {
  return `${minutesToHM(startMin)}-${minutesToHM(endMin)}`;
}

export { hmToMinutes, minutesToHM, energyLevel };
