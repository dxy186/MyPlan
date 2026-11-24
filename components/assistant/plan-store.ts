/**
 * 统一的数据层（全应用共用）：
 * 1. 读写唯一一份任务数据（目标库：目标 → 里程碑 → 任务）、固定日程、偏好
 * 2. 把 AI 返回的操作（新增/修改/完成任务、固定日程）应用到数据上，先预览、确认后再保存
 * 3. 按共用的作息设置，从「现在」开始重新排程
 */
import { setMany } from '@/components/storage-batch';

import {
  EnergyCost,
  EnergyLog,
  FixedEvent,
  Goal,
  KEYS,
  PlanTask,
  TaskWindow,
  TimeLog,
  addDays,
  goldenSlots,
  hmToMinutes,
  loadJSON,
  minutesToHM,
  normalizeDate,
  predictCurve,
  randomId,
  saveJSON,
  slotLabel,
  speedFactor,
  todayStr,
  weekdayOf,
} from '@/app/utils/planning';
import { ScheduleResult, generateSchedule } from '@/app/utils/scheduler';

import { MEMORIES_KEY, Memory, categoryFactors, categoryRatio, loadMemories } from './habits';

import { DAILY_GOAL_ID, dailyGoal, ensureMigrated } from '@/components/data/migrate';
import { ScheduleSettings, loadScheduleSettings, toScheduleOptions } from '@/components/data/settings';

export { DAILY_GOAL_ID };

export type PlanState = {
  goals: Goal[];
  fixed: FixedEvent[];
  energyLogs: EnergyLog[];
  timeLogs: TimeLog[];
  /** 用户亲口说过的长期偏好 */
  memories: Memory[];
  /** 作息与排程设置 */
  settings: ScheduleSettings;
};

export type TaskRef = { task: PlanTask; goal: Goal; milestoneIdx: number };

function safeDate(s?: string) {
  if (!s) return undefined;
  const d = normalizeDate(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

export async function loadPlanState(): Promise<PlanState> {
  await ensureMigrated();
  const [goals, fixed, energyLogs, timeLogs, memories, settings] = await Promise.all([
    loadJSON<Goal[]>(KEYS.goals, []),
    loadJSON<FixedEvent[]>(KEYS.fixedEvents, []),
    loadJSON<EnergyLog[]>(KEYS.energyLogs, []),
    loadJSON<TimeLog[]>(KEYS.timeLogs, []),
    loadMemories(),
    loadScheduleSettings(),
  ]);
  return { goals, fixed, energyLogs, timeLogs, memories, settings };
}

export function allTasks(goals: Goal[]): TaskRef[] {
  const out: TaskRef[] = [];
  goals.forEach(goal =>
    goal.milestones.forEach((m, milestoneIdx) => m.tasks.forEach(task => out.push({ task, goal, milestoneIdx })))
  );
  return out;
}

/** 每个任务已投入的分钟数（来自时间记录） */
export function spentByTask(logs: TimeLog[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of logs) if (l.taskId) m.set(l.taskId, (m.get(l.taskId) ?? 0) + (l.minutes || 0));
  return m;
}

// ---------------------------------------------------------------------------
// 排程：从现在开始，只排剩余工作量
// ---------------------------------------------------------------------------
function nowMinuteRounded(d = new Date()) {
  return Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5;
}

export function replan(state: PlanState, now = new Date()): ScheduleResult {
  const spent = spentByTask(state.timeLogs);
  const sf = speedFactor(state.timeLogs, allTasks(state.goals).map(r => r.task));
  // 习惯档案：某类任务比平均更容易低估 / 高估时，单独再校准一下
  const cats = categoryFactors(state.timeLogs, state.goals);
  const pending = allTasks(state.goals)
    .filter(r => !r.task.done && !r.task.split)
    .map(r => ({
      ...r.task,
      // 已经做过一部分的任务，只排剩下的（至少留 15 分钟收尾）
      estimateMin: Math.max(
        15,
        Math.round((r.task.estimateMin - (spent.get(r.task.id) ?? 0)) * categoryRatio(r.task, cats, sf))
      ),
    }));
  return generateSchedule(pending, state.energyLogs, state.fixed, {
    ...toScheduleOptions(state.settings),
    startDate: todayStr(),
    notBeforeMin: nowMinuteRounded(now),
    speedFactor: sf,
  });
}

// ---------------------------------------------------------------------------
// AI 操作
// ---------------------------------------------------------------------------
export type AssistantAction =
  | {
      type: 'add_task';
      title: string;
      estimateMin?: number;
      energyCost?: EnergyCost;
      due?: string;
      notBefore?: string;
      window?: TaskWindow;
      goal?: string;
      note?: string;
    }
  | {
      type: 'update_task';
      taskId: string;
      title?: string;
      estimateMin?: number;
      energyCost?: EnergyCost;
      due?: string | null;
      notBefore?: string | null;
      window?: TaskWindow | null;
    }
  | { type: 'complete_task'; taskId: string }
  | { type: 'delete_task'; taskId: string }
  | {
      type: 'add_fixed_event';
      title: string;
      date?: string;
      weekday?: number;
      start: string;
      end: string;
      kind?: FixedEvent['kind'];
    }
  | { type: 'delete_fixed_event'; eventId: string }
  | { type: 'remember'; text: string }
  | { type: 'forget'; memoryId: string };

export type AppliedChange = { action: AssistantAction; summary: string; ok: boolean };

const COST_CN: Record<EnergyCost, string> = { high: '高耗能', medium: '中耗能', low: '低耗能' };
const WINDOW_CN: Record<TaskWindow, string> = { morning: '上午', afternoon: '下午', evening: '晚上' };
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const COSTS: EnergyCost[] = ['high', 'medium', 'low'];
const WINDOWS: TaskWindow[] = ['morning', 'afternoon', 'evening'];

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function validMin(n: unknown) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 5 && v <= 60 * 40 ? v : undefined;
}

function findGoalForAdd(goals: Goal[], name?: string): Goal {
  const q = (name || '').trim();
  if (q) {
    const hit =
      goals.find(g => g.title === q) || goals.find(g => g.title.includes(q) || q.includes(g.title));
    if (hit && hit.milestones.length > 0) return hit;
    // 新目标：AI 拆解出来的一组任务归到同名目标下
    if (q !== '日常安排' && q !== '日常') {
      const g: Goal = {
        ...dailyGoal(),
        id: randomId(),
        title: q,
        specific: '',
        milestones: [{ id: randomId(), title: q, tasks: [] }],
        source: 'ai',
      };
      goals.push(g);
      return g;
    }
  }
  let daily = goals.find(g => g.id === DAILY_GOAL_ID);
  if (!daily) {
    daily = dailyGoal();
    goals.push(daily);
  }
  return daily;
}

function describeTask(t: Partial<PlanTask>) {
  const bits: string[] = [];
  if (t.estimateMin) bits.push(`约 ${t.estimateMin} 分钟`);
  if (t.energyCost) bits.push(COST_CN[t.energyCost]);
  if (t.due) bits.push(`截止 ${t.due}`);
  if (t.notBefore) bits.push(`${t.notBefore} 起`);
  if (t.window) bits.push(`偏好${WINDOW_CN[t.window]}`);
  return bits.join('，');
}

/** 在副本上应用操作，返回新状态和每条操作的说明（不保存） */
export function applyActions(
  state: PlanState,
  actions: AssistantAction[]
): { next: PlanState; changes: AppliedChange[] } {
  const next = clone(state);
  const changes: AppliedChange[] = [];
  const find = (id: string) => allTasks(next.goals).find(r => r.task.id === id);

  for (const a of actions) {
    try {
      switch (a.type) {
        case 'add_task': {
          const title = String(a.title || '').trim();
          if (!title) throw new Error('缺少任务名');
          const goal = findGoalForAdd(next.goals, a.goal);
          const task: PlanTask = {
            id: randomId(),
            title,
            estimateMin: validMin(a.estimateMin) ?? 60,
            energyCost: COSTS.includes(a.energyCost as EnergyCost) ? (a.energyCost as EnergyCost) : 'medium',
            due: safeDate(a.due),
            notBefore: safeDate(a.notBefore),
            window: WINDOWS.includes(a.window as TaskWindow) ? a.window : undefined,
            note: a.note ? String(a.note) : undefined,
            deps: [],
            done: false,
            createdAt: new Date().toISOString(),
          };
          goal.milestones[0].tasks.push(task);
          changes.push({ action: a, ok: true, summary: `➕ 新增「${title}」（${describeTask(task)}）→ ${goal.title}` });
          break;
        }
        case 'update_task': {
          const ref = find(a.taskId);
          if (!ref) throw new Error('找不到这个任务');
          const t = ref.task;
          const before = t.title;
          if (a.title && String(a.title).trim()) t.title = String(a.title).trim();
          const est = validMin(a.estimateMin);
          if (est && est !== t.estimateMin) {
            // 第一次追加时间时记下原始预估，速率系数要用它
            if (t.originalEstimateMin === undefined) t.originalEstimateMin = t.estimateMin;
            t.estimateMin = est;
          }
          if (a.energyCost && COSTS.includes(a.energyCost)) t.energyCost = a.energyCost;
          if (a.due !== undefined) t.due = a.due === null ? undefined : safeDate(a.due) ?? t.due;
          if (a.notBefore !== undefined) t.notBefore = a.notBefore === null ? undefined : safeDate(a.notBefore);
          if (a.window !== undefined) t.window = a.window && WINDOWS.includes(a.window) ? a.window : undefined;
          changes.push({
            action: a,
            ok: true,
            summary: `✏️ 调整「${before}」${before !== t.title ? ` → 「${t.title}」` : ''}（${describeTask(t)}）`,
          });
          break;
        }
        case 'complete_task': {
          const ref = find(a.taskId);
          if (!ref) throw new Error('找不到这个任务');
          ref.task.done = true;
          ref.task.doneAt = new Date().toISOString();
          setChildrenDone(next.goals, ref.task.id, true);
          markGoalCompletion(ref.goal);
          changes.push({ action: a, ok: true, summary: `✅ 完成「${ref.task.title}」` });
          break;
        }
        case 'delete_task': {
          const ref = find(a.taskId);
          if (!ref) throw new Error('找不到这个任务');
          const m = ref.goal.milestones[ref.milestoneIdx];
          const kill = new Set([ref.task.id, ...descendantIds(next.goals, ref.task.id)]);
          m.tasks = m.tasks.filter(t => !kill.has(t.id));
          changes.push({ action: a, ok: true, summary: `🗑️ 删除「${ref.task.title}」` });
          break;
        }
        case 'add_fixed_event': {
          const title = String(a.title || '').trim();
          const startMin = hmToMinutes(String(a.start || ''));
          const endMin = hmToMinutes(String(a.end || ''));
          if (!title) throw new Error('缺少日程名');
          const hm = /^\d{1,2}:\d{2}$/;
          if (!hm.test(String(a.start || '').trim()) || !hm.test(String(a.end || '').trim()) || !(endMin > startMin)) {
            throw new Error('时间不对');
          }
          const date = safeDate(a.date);
          const weekday = date ? undefined : Number.isInteger(a.weekday) ? Number(a.weekday) % 7 : undefined;
          if (!date && weekday === undefined) throw new Error('缺少日期');
          const kind: FixedEvent['kind'] = ['course', 'meeting', 'ticket', 'other'].includes(a.kind as string)
            ? (a.kind as FixedEvent['kind'])
            : 'other';
          next.fixed.push({ id: randomId(), title, date, weekday, startMin, endMin, kind });
          const when = date ? date : `每${WEEKDAY_CN[weekday as number]}`;
          changes.push({
            action: a,
            ok: true,
            summary: `📌 固定日程「${title}」${when} ${minutesToHM(startMin)}–${minutesToHM(endMin)}`,
          });
          break;
        }
        case 'delete_fixed_event': {
          const ev = next.fixed.find(e => e.id === a.eventId);
          if (!ev) throw new Error('找不到这个固定日程');
          next.fixed = next.fixed.filter(e => e.id !== a.eventId);
          changes.push({ action: a, ok: true, summary: `🗑️ 删除固定日程「${ev.title}」` });
          break;
        }
        case 'remember': {
          const text = String(a.text || '').trim();
          if (!text) throw new Error('要记住的内容是空的');
          next.memories = [...(next.memories ?? []), { id: randomId(), text, createdAt: new Date().toISOString() }];
          changes.push({ action: a, ok: true, summary: `🧠 记住：${text}` });
          break;
        }
        case 'forget': {
          const mem = (next.memories ?? []).find(m => m.id === a.memoryId);
          if (!mem) throw new Error('找不到这条偏好');
          next.memories = (next.memories ?? []).filter(m => m.id !== a.memoryId);
          changes.push({ action: a, ok: true, summary: `🧹 不再记住：${mem.text}` });
          break;
        }
        default:
          throw new Error('不认识的操作');
      }
    } catch (e: any) {
      changes.push({ action: a, ok: false, summary: `⚠️ 跳过：${e?.message || e}` });
    }
  }
  return { next, changes };
}

/** 所有任务都完成时记下目标完成时间；重新打开任务时清掉 */
export function markGoalCompletion(goal: Goal) {
  const ts = goal.milestones.flatMap(m => m.tasks);
  if (ts.length > 0 && ts.every(t => t.done)) goal.completedAt = goal.completedAt ?? new Date().toISOString();
  else delete goal.completedAt;
}

/** 某任务的所有后代（子任务、子任务的子任务…） */
export function descendantIds(goals: Goal[], id: string): string[] {
  const all = allTasks(goals).map(r => r.task);
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const t of all) if (t.parentId === pid && !out.includes(t.id)) {
      out.push(t.id);
      walk(t.id);
    }
  };
  walk(id);
  return out;
}

/** 勾选 / 取消父任务时，子任务一起变 */
export function setChildrenDone(goals: Goal[], parentId: string, done: boolean) {
  const ids = new Set(descendantIds(goals, parentId));
  const now = new Date().toISOString();
  for (const r of allTasks(goals)) {
    if (!ids.has(r.task.id)) continue;
    if (done && !r.task.done) {
      r.task.done = true;
      r.task.doneAt = now;
    } else if (!done && r.task.done) {
      r.task.done = false;
      delete r.task.doneAt;
    }
  }
}

/** 父任务的完成状态跟随子任务；子任务全删掉了就变回普通任务 */
export function syncParentTasks(goals: Goal[]) {
  const all = allTasks(goals).map(r => r.task);
  // 从最深的父任务往上算
  const parents = all.filter(t => t.split);
  for (let pass = 0; pass < 3; pass++) {
    for (const p of parents) {
      const kids = all.filter(t => t.parentId === p.id);
      if (kids.length === 0) {
        p.split = false;
        continue;
      }
      const done = kids.every(k => k.done);
      if (done && !p.done) {
        p.done = true;
        p.doneAt = kids.map(k => k.doneAt || '').sort().pop() || new Date().toISOString();
      } else if (!done && p.done) {
        p.done = false;
        delete p.doneAt;
      }
      p.estimateMin = kids.reduce((s, k) => s + k.estimateMin, 0);
    }
  }
  goals.forEach(markGoalCompletion);
}

/** 只保存数据，不重新排程 */
export async function saveState(state: PlanState): Promise<void> {
  syncParentTasks(state.goals);
  await setMany([
    [KEYS.goals, JSON.stringify(state.goals)],
    [KEYS.fixedEvents, JSON.stringify(state.fixed)],
    [MEMORIES_KEY, JSON.stringify(state.memories ?? [])],
  ]);
  // 任何地方改了任务（勾完成、AI 调整、复盘…）都通知日历刷新，做完的马上划掉
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    setTimeout(() => window.dispatchEvent(new Event('myplan:data-changed')), 0);
  }
}

/** 保存应用后的状态，并从现在起重新排程 */
export async function commitState(state: PlanState): Promise<ScheduleResult> {
  const schedule = replan(state);
  await saveState(state);
  await setMany([[KEYS.schedule, JSON.stringify(schedule)]]);
  return schedule;
}

// ---------------------------------------------------------------------------
// 超时跟进
// ---------------------------------------------------------------------------
export type OverrunInfo = { task: PlanTask; goal: Goal; spent: number; over: number };

/** 已投入时间达到或超过预估、但还没完成的任务 */
export function overrunTasks(state: PlanState): OverrunInfo[] {
  const spent = spentByTask(state.timeLogs);
  return allTasks(state.goals)
    .filter(r => !r.task.done && !r.task.split)
    .map(r => ({ task: r.task, goal: r.goal, spent: spent.get(r.task.id) ?? 0 }))
    .filter(x => x.spent > 0 && x.spent >= x.task.estimateMin)
    .map(x => ({ ...x, over: x.spent - x.task.estimateMin }));
}

export type OverrunChoice = { addMin: number; tomorrow?: boolean } | { done: true };

export const OVERRUN_OPTIONS: { label: string; choice: OverrunChoice }[] = [
  { label: '还要 15 分钟', choice: { addMin: 15 } },
  { label: '30 分钟', choice: { addMin: 30 } },
  { label: '1 小时', choice: { addMin: 60 } },
  { label: '2 小时', choice: { addMin: 120 } },
  { label: '明天继续（约 1 小时）', choice: { addMin: 60, tomorrow: true } },
  { label: '✅ 已完成', choice: { done: true } },
];

/**
 * 回答「还要多久」：把预估改成「已投入 + 还要的时间」（或标记完成），
 * 保存并从现在起重新排程。extraSpentMin 是正在计时、还没保存的分钟数。
 */
export async function resolveOverrun(
  taskId: string,
  choice: OverrunChoice,
  extraSpentMin = 0
): Promise<{ state: PlanState; schedule: ScheduleResult; summary: string }> {
  const state = await loadPlanState();
  let action: AssistantAction;
  if ('done' in choice) {
    action = { type: 'complete_task', taskId };
  } else {
    const spent = (spentByTask(state.timeLogs).get(taskId) ?? 0) + extraSpentMin;
    action = {
      type: 'update_task',
      taskId,
      estimateMin: spent + choice.addMin,
      ...(choice.tomorrow ? { notBefore: addDays(todayStr(), 1) } : {}),
    };
  }
  const { next, changes } = applyActions(state, [action]);
  if (!changes[0]?.ok) throw new Error(changes[0]?.summary || '操作失败');
  const schedule = await commitState(next);
  return { state: next, schedule, summary: changes[0].summary };
}

/** 完成任务时广播，CelebrationHost 会显示庆祝 */
export const CELEBRATE_EVENT = 'myplan:celebrate';
export function celebrate(title: string) {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: { title } }));
  }
}

/** 设置任务完成 / 未完成 */
export async function setTaskDone(taskId: string, done: boolean): Promise<PlanState> {
  const state = await loadPlanState();
  const ref = allTasks(state.goals).find(r => r.task.id === taskId);
  if (!ref) return state;
  ref.task.done = done;
  if (done) ref.task.doneAt = new Date().toISOString();
  else delete ref.task.doneAt;
  if (ref.task.split) setChildrenDone(state.goals, taskId, done);
  markGoalCompletion(ref.goal);
  await saveState(state);
  if (done) celebrate(ref.task.title);
  return state;
}

// ---------------------------------------------------------------------------
// 给 AI 的上下文
// ---------------------------------------------------------------------------
function refsAll(state: PlanState) {
  return allTasks(state.goals).map(r => r.task);
}

export function buildContext(
  state: PlanState,
  schedule: ScheduleResult | null,
  now = new Date(),
  habits = ''
): string {
  const today = todayStr();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const spent = spentByTask(state.timeLogs);
  const lines: string[] = [];
  lines.push(`现在：${today} ${WEEKDAY_CN[weekdayOf(today)]} ${minutesToHM(nowMin)}`);
  const sf = speedFactor(state.timeLogs, refsAll(state));
  lines.push(`速率系数：${sf}（实际耗时 ≈ 预估 × ${sf}，来自历史时间记录）`);
  if (habits) lines.push(habits);
  const gold = goldenSlots(predictCurve(state.energyLogs, today)).map(slotLabel);
  if (gold.length) lines.push(`精力最好的时段：${gold.join('、')}`);

  lines.push('', '## 未完成任务（id | 任务 | 所属目标 | 预估分钟 | 已投入分钟 | 耗能 | 截止 | 其他）');
  const refs = allTasks(state.goals);
  const pending = refs.filter(r => !r.task.done && !r.task.split);
  const titleById = new Map(refs.map(r => [r.task.id, r.task.title]));
  pending
    .sort((a, b) => (a.task.due || '9999').localeCompare(b.task.due || '9999'))
    .slice(0, 80)
    .forEach(({ task: t, goal }) => {
      const extra = [t.notBefore ? `${t.notBefore} 起` : '', t.window ? `偏好${WINDOW_CN[t.window]}` : '']
        .filter(Boolean)
        .join(' ');
      lines.push(
        `${t.id} | ${t.title}${t.parentId && titleById.has(t.parentId) ? `（「${titleById.get(t.parentId)}」的子任务）` : ''} | ${goal.title} | ${t.estimateMin} | ${spent.get(t.id) ?? 0} | ${t.energyCost} | ${t.due || '无'} | ${extra}`
      );
    });
  if (pending.length === 0) lines.push('（没有）');

  // 用户写过 WOOP 的目标：安排、拆分、给建议时要参考他自己写的结果、障碍和应对计划
  const woops = state.goals.filter(g => g.woop && !g.completedAt);
  if (woops.length) {
    lines.push('', '## 用户写过 WOOP 的目标（安排和建议要针对他写的障碍和应对计划）');
    woops.slice(0, 10).forEach(g =>
      lines.push(`${g.title}：想要的结果「${g.woop!.outcome || '-'}」；障碍「${g.woop!.obstacle || '-'}」；应对「${g.woop!.plan || '-'}」`)
    );
  }

  const over = overrunTasks(state);
  if (over.length) {
    lines.push('', '## 已超出预估、还没完成的任务');
    over.forEach(o => lines.push(`${o.task.id} | ${o.task.title} | 预估 ${o.task.estimateMin} | 已投入 ${o.spent}`));
  }

  const goalsProgress = state.goals
    .map(g => {
      const ts = g.milestones.flatMap(m => m.tasks);
      if (ts.length === 0) return '';
      const done = ts.filter(t => t.done).length;
      return `${g.title}：${done}/${ts.length} 完成${g.due ? `，截止 ${g.due}` : ''}`;
    })
    .filter(Boolean);
  if (goalsProgress.length) lines.push('', '## 各目标进度', ...goalsProgress);

  const in7 = addDays(today, 7);
  lines.push('', '## 固定日程（id | 名称 | 时间）');
  const fixedLines = state.fixed
    .filter(e => (e.date ? e.date >= today && e.date <= in7 : true))
    .map(
      e =>
        `${e.id} | ${e.title} | ${e.date ? e.date : `每${WEEKDAY_CN[e.weekday ?? 0]}`} ${minutesToHM(e.startMin)}-${minutesToHM(e.endMin)}`
    );
  lines.push(...(fixedLines.length ? fixedLines : ['（没有）']));

  if (schedule) {
    const upcoming = schedule.items
      .filter(i => i.date > today || (i.date === today && i.endMin > nowMin))
      .filter(i => i.date <= addDays(today, 2))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)
      .map(i => `${i.date} ${minutesToHM(i.startMin)}-${minutesToHM(i.endMin)} ${i.title}`);
    if (upcoming.length) lines.push('', '## 当前排程（今明后三天）', ...upcoming.slice(0, 40));
  }
  return lines.join('\n');
}

export const SYSTEM_PROMPT = `你是用户的私人计划秘书和效率教练：帮他把要做的事安排进日程，根据真实进度持续调整，也回答他关于计划、效率、拆解目标的问题。

用户会用一句话告诉你要做什么、做完了什么、或者想怎么调整。你要结合「当前数据」，返回需要执行的操作。系统会根据操作自动重新排程（从现在开始，见缝插针地把任务塞进空档，避开固定日程，按精力匹配耗能）。

只输出一个 JSON 对象，不要输出别的文字：
{
  "reply": "用 2-4 句中文告诉用户你做了什么安排、为什么；有风险（排不下、太赶）要直说。如果用户只是提问（今日报告、效率分析、建议、怎么拆解），就基于当前数据认真回答，可以分点、换行，写得详细些",
  "actions": [ ...操作... ]
}

可用操作：
- {"type":"add_task","title":"任务名（动词开头，具体）","estimateMin":分钟,"energyCost":"high|medium|low","due":"YYYY-MM-DD","notBefore":"YYYY-MM-DD","window":"morning|afternoon|evening","goal":"已有的目标名；拆解新目标时填新目标名；零散小事省略（会放进「日常安排」）","note":"背景，可省略"}
- {"type":"update_task","taskId":"已有任务 id","title":...,"estimateMin":...,"energyCost":...,"due":"YYYY-MM-DD 或 null","notBefore":"YYYY-MM-DD 或 null","window":"... 或 null"}  （只写要改的字段）
- {"type":"complete_task","taskId":"已有任务 id"}
- {"type":"delete_task","taskId":"已有任务 id"}
- {"type":"add_fixed_event","title":"名称","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","kind":"course|meeting|ticket|other"}  （每周重复的用 "weekday":0-6 代替 date，0 是周日）
- {"type":"delete_fixed_event","eventId":"已有固定日程 id"}
- {"type":"remember","text":"一句话的长期偏好，如：周末上午不安排学习"}
- {"type":"forget","memoryId":"已有偏好 id"}

规则：
1. taskId / eventId 必须从当前数据里原样复制，不能编造。
2. 有明确时间点的事（上课、开会、聚会、看病）用 add_fixed_event；需要花时间去做、时间可以灵活安排的用 add_task。
3. 大任务拆成 2-6 个具体步骤，每步 25-120 分钟；预估时要乘上速率系数，宁可多估一点。
4. 用户说某事做完了 → complete_task；说做了一部分 → 用 update_task 把 estimateMin 改成「已投入 + 剩余」的总量。
5. 用户说「放到上午/下午/晚上」→ window；「下周再做」「X 号以后」→ notBefore；「推迟」→ 改 due 或 notBefore。
6. 要动脑的（写作、编程、复习难点）标 high；一般学习/整理标 medium；跑腿、回消息、杂事标 low。
7. 日期用 YYYY-MM-DD，根据「现在」推算「明天」「周五」等。
7.1 分清「哪天做」和「哪天前完成」——这一点非常重要，否则任务会被排到今天：
   - 「周五写报告」「明天去取快递」「下周一复习」「25 号整理笔记」= 指定那天做 → notBefore 和 due 都填那一天。
   - 「周五前交报告」「月底截止」「下周三考试，帮我复习」= 截止日 → 只填 due（考试这类，due 填考试前一天），系统会从现在起尽早安排。
   - 拿不准时按「那天做」处理，并在 reply 里说明你是怎么理解的。
8. 信息不够、无法安排时，actions 留空，在 reply 里问一个最关键的问题。
8.1 用户只是提问、不需要改数据时，actions 留空。让你拆解目标时，直接用 add_task 把拆好的步骤加进来（goal 填目标名），在 reply 里讲清拆解思路。
9. 不要重复添加已存在的任务——是否存在只看「当前数据」。
10. 对话历史里你说过的安排不一定生效了（用户可能没点确认）。一切以「当前数据」为准：用户要做的事如果当前数据里没有，就重新添加，不要说「已经加过了」。
11. 你给出的操作要等用户点「应用」才生效，所以 reply 里不要说「已经加好了 / 已把…加为」，要说「给你拟好了…」「准备把…加为…」。
11. 如果数据里有「近 N 天复盘」：常见「估少了」就把预估再放宽；常见「太累了」就少排高耗能、多留休息；常见「被打断」就把任务切得更小。
12. 用户说「记住…」「以后…」「我一般…」「我不喜欢…」这类长期偏好 → 用 remember 记下来；如果偏好是某个固定时间段不想做事（如「周末上午不想学习」「每晚 10 点后别排」），同时用 add_fixed_event 加每周重复的占位日程（标题以「🚫 不排任务：」开头，kind 用 other，每个相关的 weekday 各加一条），这样排程会自动避开。
13. 「用户亲口说过的偏好」必须遵守；「从历史数据总结的习惯」用来调整预估和时段（例如某类任务常低估就多估一点，某时段常常没开始就别把重要的事排在那里，必要时用 window 指定时段）。
14. 用户说「忘掉…」「不用再…」→ 用 forget 删掉对应偏好，并用 delete_fixed_event 删掉对应的占位日程。`;
