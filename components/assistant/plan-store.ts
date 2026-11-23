/**
 * AI 秘书的数据层：
 * 1. 合并两套任务数据：把「SMART 任务记录」里的任务同步成目标库里的镜像目标，
 *    这样排程和 AI 看到的是同一份完整进度。
 * 2. 把 AI 返回的操作（新增/修改/完成任务、固定日程）应用到数据上，先预览、确认后再保存。
 * 3. 从「现在」开始重新排程。
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
import { DEFAULT_SCHEDULE_OPTIONS, ScheduleResult, generateSchedule } from '@/app/utils/scheduler';

import { MEMORIES_KEY, Memory, categoryFactors, categoryRatio, loadMemories } from './habits';

// ---------------------------------------------------------------------------
// 旧版 SMART 任务（app/goals.tsx 里的结构）
// ---------------------------------------------------------------------------
type SmartSubtask = { id: string; title: string; completed: boolean; scheduledDate?: string };
type SmartTask = {
  id: string;
  title: string;
  dueDate: string;
  subtasks: SmartSubtask[];
  specific?: string;
  measurable?: string;
  relevant?: string;
  createdAt: string;
  updatedAt?: string;
  [k: string]: unknown;
};
type CalendarItem = { id: string; title: string; date: string; completed: boolean; parentTaskId?: string };

export const SMART_PREFIX = 'smart_';
export const DAILY_GOAL_ID = 'ai_daily';
const MAIN_SUB = 'main';

export type PlanState = {
  goals: Goal[];
  fixed: FixedEvent[];
  energyLogs: EnergyLog[];
  timeLogs: TimeLog[];
  smartTasks: SmartTask[];
  calendar: CalendarItem[];
  /** 用户亲口说过的长期偏好 */
  memories: Memory[];
};

export type TaskRef = { task: PlanTask; goal: Goal; milestoneIdx: number };

export function isMirrorGoal(g: Goal) {
  return g.id.startsWith(SMART_PREFIX);
}

function safeDate(s?: string) {
  if (!s) return undefined;
  const d = normalizeDate(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

/** 把 SMART 任务同步成目标库里的镜像目标（保留 AI/用户在镜像上改过的预估时长、耗能等） */
export function syncSmartIntoGoals(goals: Goal[], smart: SmartTask[]): Goal[] {
  const others = goals.filter(g => !isMirrorGoal(g));
  const prevById = new Map(goals.filter(isMirrorGoal).map(g => [g.id, g]));
  const mirrors: Goal[] = smart.map(t => {
    const gid = SMART_PREFIX + t.id;
    const prev = prevById.get(gid);
    const prevTasks = new Map<string, PlanTask>();
    prev?.milestones.forEach(m => m.tasks.forEach(pt => prevTasks.set(pt.id, pt)));
    const subs: SmartSubtask[] =
      t.subtasks && t.subtasks.length > 0 ? t.subtasks : [{ id: MAIN_SUB, title: t.title, completed: false }];
    const tasks: PlanTask[] = subs.map(s => {
      const id = `${gid}_${s.id}`;
      const p = prevTasks.get(id);
      return {
        ...p,
        id,
        title: s.title,
        estimateMin: p?.estimateMin ?? 60,
        energyCost: p?.energyCost ?? 'medium',
        due: safeDate(s.scheduledDate) ?? safeDate(t.dueDate),
        deps: p?.deps ?? [],
        // 有子任务时以 SMART 页面的勾选为准；没有子任务时以镜像为准
        done: s.id === MAIN_SUB ? !!p?.done : !!s.completed,
        createdAt: p?.createdAt ?? t.createdAt ?? new Date().toISOString(),
      };
    });
    return {
      id: gid,
      title: t.title,
      specific: t.specific || '',
      measurable: t.measurable || '',
      achievable: '',
      relevant: t.relevant || '',
      due: safeDate(t.dueDate) || '',
      feasibility: prev?.feasibility ?? 70,
      difficulty: prev?.difficulty ?? 2,
      strategy: '来自「SMART任务记录」（自动同步）',
      milestones: [{ id: `${gid}_m`, title: '子任务', tasks }],
      createdAt: t.createdAt || new Date().toISOString(),
    };
  });
  return [...others, ...mirrors];
}

export async function loadPlanState(): Promise<PlanState> {
  const [goals, fixed, energyLogs, timeLogs, smartTasks, calendar, memories] = await Promise.all([
    loadJSON<Goal[]>(KEYS.goals, []),
    loadJSON<FixedEvent[]>(KEYS.fixedEvents, []),
    loadJSON<EnergyLog[]>(KEYS.energyLogs, []),
    loadJSON<TimeLog[]>(KEYS.timeLogs, []),
    loadJSON<SmartTask[]>(KEYS.tasks, []),
    loadJSON<CalendarItem[]>(KEYS.calendar, []),
    loadMemories(),
  ]);
  const synced = syncSmartIntoGoals(goals, smartTasks);
  if (JSON.stringify(synced) !== JSON.stringify(goals)) await saveJSON(KEYS.goals, synced);
  return { goals: synced, fixed, energyLogs, timeLogs, smartTasks, calendar, memories };
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
    .filter(r => !r.task.done)
    .map(r => ({
      ...r.task,
      // 已经做过一部分的任务，只排剩下的（至少留 15 分钟收尾）
      estimateMin: Math.max(
        15,
        Math.round((r.task.estimateMin - (spent.get(r.task.id) ?? 0)) * categoryRatio(r.task, cats, sf))
      ),
    }));
  return generateSchedule(pending, state.energyLogs, state.fixed, {
    ...DEFAULT_SCHEDULE_OPTIONS,
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
  }
  let daily = goals.find(g => g.id === DAILY_GOAL_ID);
  if (!daily) {
    daily = {
      id: DAILY_GOAL_ID,
      title: '日常安排',
      specific: '通过 AI 秘书添加的任务',
      measurable: '',
      achievable: '',
      relevant: '',
      due: '',
      feasibility: 80,
      difficulty: 1,
      strategy: 'AI 秘书',
      milestones: [{ id: `${DAILY_GOAL_ID}_m`, title: 'AI 秘书添加', tasks: [] }],
      createdAt: new Date().toISOString(),
    };
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

/** SMART 镜像任务 → 原 SMART 任务 id 与子任务 id */
function mirrorIds(taskId: string): { smartId: string; subId: string } | null {
  if (!taskId.startsWith(SMART_PREFIX)) return null;
  const rest = taskId.slice(SMART_PREFIX.length);
  // 镜像 id 形如 smart_<smartId>_<subId>；smartId 本身可能含下划线，按已知任务匹配
  const i = rest.lastIndexOf('_');
  if (i <= 0) return null;
  return { smartId: rest.slice(0, i), subId: rest.slice(i + 1) };
}

function resolveMirror(state: PlanState, taskId: string) {
  for (const t of state.smartTasks) {
    const prefix = `${SMART_PREFIX}${t.id}_`;
    if (taskId.startsWith(prefix)) return { smart: t, subId: taskId.slice(prefix.length) };
  }
  const ids = mirrorIds(taskId);
  if (!ids) return null;
  const smart = state.smartTasks.find(t => t.id === ids.smartId);
  return smart ? { smart, subId: ids.subId } : null;
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
          const mirror = isMirrorGoal(ref.goal) ? resolveMirror(next, t.id) : null;
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
          // 镜像任务的标题、日期写回 SMART 原任务
          if (mirror) {
            const { smart, subId } = mirror;
            if (subId === MAIN_SUB) {
              smart.title = t.title;
              if (t.due) smart.dueDate = t.due;
            } else {
              const sub = smart.subtasks.find(s => s.id === subId);
              if (sub) {
                if (sub.title !== t.title) {
                  next.calendar = next.calendar.map(c =>
                    c.parentTaskId === smart.id && c.title === sub.title ? { ...c, title: t.title } : c
                  );
                }
                sub.title = t.title;
                if (a.due !== undefined) sub.scheduledDate = t.due;
              }
            }
            smart.updatedAt = new Date().toISOString();
          }
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
          const mirror = isMirrorGoal(ref.goal) ? resolveMirror(next, ref.task.id) : null;
          if (mirror && mirror.subId !== MAIN_SUB) {
            const sub = mirror.smart.subtasks.find(s => s.id === mirror.subId);
            if (sub) {
              sub.completed = true;
              next.calendar = next.calendar.map(c =>
                c.parentTaskId === mirror.smart.id && c.title === sub.title ? { ...c, completed: true } : c
              );
            }
          }
          changes.push({ action: a, ok: true, summary: `✅ 完成「${ref.task.title}」` });
          break;
        }
        case 'delete_task': {
          const ref = find(a.taskId);
          if (!ref) throw new Error('找不到这个任务');
          if (isMirrorGoal(ref.goal)) throw new Error(`「${ref.task.title}」来自 SMART 任务记录，请到那里删除`);
          const m = ref.goal.milestones[ref.milestoneIdx];
          m.tasks = m.tasks.filter(t => t.id !== ref.task.id);
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

/** 只保存数据，不重新排程 */
export async function saveState(state: PlanState): Promise<void> {
  await setMany([
    [KEYS.goals, JSON.stringify(state.goals)],
    [KEYS.fixedEvents, JSON.stringify(state.fixed)],
    [KEYS.tasks, JSON.stringify(state.smartTasks)],
    [KEYS.calendar, JSON.stringify(state.calendar)],
    [MEMORIES_KEY, JSON.stringify(state.memories ?? [])],
  ]);
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
    .filter(r => !r.task.done)
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

/** 设置任务完成 / 未完成；SMART 镜像任务会同步写回 SMART 任务和日历 */
export async function setTaskDone(taskId: string, done: boolean): Promise<PlanState> {
  const state = await loadPlanState();
  const ref = allTasks(state.goals).find(r => r.task.id === taskId);
  if (!ref) return state;
  ref.task.done = done;
  const mirror = isMirrorGoal(ref.goal) ? resolveMirror(state, taskId) : null;
  if (mirror && mirror.subId !== MAIN_SUB) {
    const sub = mirror.smart.subtasks.find(x => x.id === mirror.subId);
    if (sub) {
      sub.completed = done;
      state.calendar = state.calendar.map(c =>
        c.parentTaskId === mirror.smart.id && c.title === sub.title ? { ...c, completed: done } : c
      );
    }
  }
  await saveState(state);
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
  const pending = refs.filter(r => !r.task.done);
  pending
    .sort((a, b) => (a.task.due || '9999').localeCompare(b.task.due || '9999'))
    .slice(0, 80)
    .forEach(({ task: t, goal }) => {
      const extra = [t.notBefore ? `${t.notBefore} 起` : '', t.window ? `偏好${WINDOW_CN[t.window]}` : '']
        .filter(Boolean)
        .join(' ');
      lines.push(
        `${t.id} | ${t.title} | ${goal.title} | ${t.estimateMin} | ${spent.get(t.id) ?? 0} | ${t.energyCost} | ${t.due || '无'} | ${extra}`
      );
    });
  if (pending.length === 0) lines.push('（没有）');

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

export const SYSTEM_PROMPT = `你是用户的私人计划秘书，帮他把要做的事安排进日程，并根据真实进度持续调整。

用户会用一句话告诉你要做什么、做完了什么、或者想怎么调整。你要结合「当前数据」，返回需要执行的操作。系统会根据操作自动重新排程（从现在开始，见缝插针地把任务塞进空档，避开固定日程，按精力匹配耗能）。

只输出一个 JSON 对象，不要输出别的文字：
{
  "reply": "用 2-4 句中文告诉用户你做了什么安排、为什么；有风险（排不下、太赶）要直说",
  "actions": [ ...操作... ]
}

可用操作：
- {"type":"add_task","title":"任务名（动词开头，具体）","estimateMin":分钟,"energyCost":"high|medium|low","due":"YYYY-MM-DD","notBefore":"YYYY-MM-DD","window":"morning|afternoon|evening","goal":"归属的目标名，可省略","note":"背景，可省略"}
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
8. 信息不够、无法安排时，actions 留空，在 reply 里问一个最关键的问题。
9. 不要重复添加已存在的任务——是否存在只看「当前数据」。
10. 对话历史里你说过的安排不一定生效了（用户可能没点确认）。一切以「当前数据」为准：用户要做的事如果当前数据里没有，就重新添加，不要说「已经加过了」。
11. 如果数据里有「近 N 天复盘」：常见「估少了」就把预估再放宽；常见「太累了」就少排高耗能、多留休息；常见「被打断」就把任务切得更小。
12. 用户说「记住…」「以后…」「我一般…」「我不喜欢…」这类长期偏好 → 用 remember 记下来；如果偏好是某个固定时间段不想做事（如「周末上午不想学习」「每晚 10 点后别排」），同时用 add_fixed_event 加每周重复的占位日程（标题以「🚫 不排任务：」开头，kind 用 other，每个相关的 weekday 各加一条），这样排程会自动避开。
13. 「用户亲口说过的偏好」必须遵守；「从历史数据总结的习惯」用来调整预估和时段（例如某类任务常低估就多估一点，某时段常常没开始就别把重要的事排在那里，必要时用 window 指定时段）。
14. 用户说「忘掉…」「不用再…」→ 用 forget 删掉对应偏好，并用 delete_fixed_event 删掉对应的占位日程。`;
