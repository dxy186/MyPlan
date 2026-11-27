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
  Quadrant,
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

const PACK_MIGRATION_KEY = '@myplan__migration_pack_subtasks';
/** 一次性：以前拆出来的子任务每步钉在一天（notBefore = due = 那天），改成只按顺序、截止跟父任务 */
async function unpinSubtasks() {
  if (await loadJSON<boolean>(PACK_MIGRATION_KEY, false)) return;
  const goals = await loadJSON<Goal[]>(KEYS.goals, []);
  const today = todayStr();
  let changed = false;
  for (const g of goals)
    for (const m of g.milestones) {
      const parents = new Map(m.tasks.filter(t => t.split).map(t => [t.id, t]));
      for (const p of parents.values()) {
        const kids = m.tasks.filter(t => t.parentId === p.id && !t.done);
        if (!kids.length) continue;
        const first = kids.map(k => k.notBefore).filter(Boolean).sort()[0];
        for (const k of kids) {
          if (k.due && k.due === k.notBefore) {
            if (!p.due || k.due > p.due) p.due = k.due;
            k.due = undefined;
            k.notBefore = first && first > today ? first : undefined;
            changed = true;
          }
        }
      }
    }
  if (changed) await saveJSON(KEYS.goals, goals);
  await saveJSON(PACK_MIGRATION_KEY, true);
}

export async function loadPlanState(): Promise<PlanState> {
  await ensureMigrated();
  await unpinSubtasks();
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

/**
 * 只是一个截止日（DDL）、不需要自动排时间的任务：
 * 有截止日，没指定「哪天做 / 几点开始」，没拆成子任务，也不是别人的子任务；
 * 或者名字里就写着 DDL / 截止（比如「ESquiz DDL」）。
 * 这类任务只在日历的截止日上显示（红字），不排进日程。要给它留时间，就拆分（🧩）或设开始日期。
 */
export function isDeadlineOnly(t: PlanTask): boolean {
  if (t.split || t.parentId || !t.due) return false;
  if (/ddl|deadline|截止/i.test(t.title)) return true;
  return !t.notBefore && t.startMin === undefined;
}

/**
 * 用户真正设过的「开始」：开始日和截止日不同，或者写了几点开始。
 * 在日历某天直接加的事项 notBefore 会等于截止日——对拆过的 DDL 来说那只是截止，不是开始，
 * 子任务不受它限制，从现在起在截止前排。
 */
export function explicitStart(t: PlanTask): string | undefined {
  if (!t.notBefore) return undefined;
  if (t.startMin !== undefined) return t.notBefore;
  if (t.due && t.notBefore === t.due && (t.split || /ddl|deadline|截止/i.test(t.title))) return undefined;
  return t.notBefore;
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

/** 实际用来排程的速率系数：手动设了就用手动的，否则按时间记录自动算 */
export function effectiveSpeed(state: Pick<PlanState, 'timeLogs' | 'goals' | 'settings'>): number {
  const o = state.settings?.speedOverride;
  if (typeof o === 'number' && o > 0) return o;
  return speedFactor(state.timeLogs, allTasks(state.goals).map(r => r.task));
}

export function replan(state: PlanState, now = new Date()): ScheduleResult {
  const spent = spentByTask(state.timeLogs);
  const sf = effectiveSpeed(state);
  // 习惯档案：某类任务比平均更容易低估 / 高估时，单独再校准一下（手动设了系数就完全按手动的来）
  const cats = state.settings?.speedOverride ? [] : categoryFactors(state.timeLogs, state.goals);
  const quadById = new Map(allTasks(state.goals).map(r => [r.task.id, r.task.quadrant]));
  const dueById = new Map(allTasks(state.goals).map(r => [r.task.id, r.task.due]));
  const taskById = new Map(allTasks(state.goals).map(r => [r.task.id, r.task]));
  const pending = allTasks(state.goals)
    // DDL（只有截止日、没拆）不自动排程
    .filter(r => !r.task.done && !r.task.split && !isDeadlineOnly(r.task))
    .map(r => ({
      ...r.task,
      // 优先级：任务自己的 → 父任务的 → 目标的
      quadrant: r.task.quadrant ?? (r.task.parentId ? quadById.get(r.task.parentId) : undefined) ?? r.goal.quadrant,
      // 子任务没单独设截止时，用父任务的截止
      due: r.task.due ?? (r.task.parentId ? dueById.get(r.task.parentId) : undefined),
      // 父任务设了「开始」：子任务不早于那天；第一步还要不早于那个时间
      ...(() => {
        const p = r.task.parentId ? taskById.get(r.task.parentId) : undefined;
        const ps = p ? explicitStart(p) : undefined;
        if (!p || !ps) return {};
        const nb = !r.task.notBefore || r.task.notBefore < ps ? ps : r.task.notBefore;
        const isFirst = !r.task.deps.some(d => taskById.get(d)?.parentId === p.id);
        return {
          notBefore: nb,
          startMin: r.task.startMin ?? (isFirst && nb === ps ? p.startMin : undefined),
        };
      })(),
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
      /** 那天几点开始 HH:MM（配合 notBefore） */
      startTime?: string;
      window?: TaskWindow;
      tag?: string;
      quadrant?: Quadrant;
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
      startTime?: string | null;
      window?: TaskWindow | null;
      tag?: string | null;
      quadrant?: Quadrant | null;
    }
  | {
      type: 'split_task';
      /** 拆已有任务时填 id；拆一个新的大任务时不填 id，填 title 等字段 */
      taskId?: string;
      title?: string;
      due?: string;
      /** 从哪天开始做（第一步不早于这天） */
      notBefore?: string;
      startTime?: string;
      tag?: string;
      quadrant?: Quadrant;
      goal?: string;
      steps: { title: string; estimateMin?: number; energyCost?: EnergyCost; date?: string; note?: string }[];
    }
  | { type: 'add_diary'; text: string; date?: string }
  | { type: 'add_event'; title: string; date: string; yearly?: boolean; time?: string }
  | { type: 'complete_task'; taskId: string }
  | { type: 'delete_task'; taskId: string }
  | {
      type: 'add_subtask';
      /** 父任务 id：还没拆过的任务会变成父任务 */
      parentId: string;
      title: string;
      estimateMin?: number;
      energyCost?: EnergyCost;
      /** 这一步哪天做（可省略） */
      date?: string;
      startTime?: string;
    }
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

/** "14:30" / "14：30" → 870；无效返回 undefined */
export type SplitStep = { title: string; estimateMin: number; energyCost: EnergyCost; date: string; note?: string };

/**
 * 把一个任务拆成子任务（就地修改 goals）：原任务留着当「父任务」（split=true，不单独排程，
 * 完成状态跟随子任务），步骤作为子任务紧跟在它下面，按顺序依赖，每一步固定在分到的那天做。
 * 🧩 拆解和 AI 的 split_task 都用这一个函数，所以格式完全一样。
 */
export function splitTaskInGoals(goals: Goal[], taskId: string, steps: SplitStep[]): PlanTask[] {
  const ref = allTasks(goals).find(r => r.task.id === taskId);
  if (!ref) throw new Error('找不到这个任务');
  if (steps.length === 0) throw new Error('没有步骤');
  const original = ref.task;
  const now = new Date().toISOString();
  // 子任务不再一步钉一天：只按先后顺序、在父任务截止前尽量往前排，时间够的话一天可以做好几步。
  // 第一步的日期如果在以后，就作为整组最早开始的日子。
  // 原任务设过「开始」的，子任务不早于那天（以及那个时间）
  // 日历上直接加的 DDL（开始 = 截止）不算开始，子任务从现在起排
  const ownStart = original.due && original.notBefore === original.due && original.startMin === undefined ? undefined : original.notBefore;
  const earliest = [steps[0].date, ownStart ?? ''].sort().pop() as string;
  const startDay = earliest > todayStr() ? earliest : ownStart && original.startMin !== undefined ? ownStart : undefined;
  let prevId: string | undefined;
  const newTasks: PlanTask[] = steps.map(st => {
    const id = randomId();
    const t: PlanTask = {
      id,
      title: st.title,
      estimateMin: st.estimateMin,
      energyCost: st.energyCost,
      notBefore: startDay,
      deps: prevId ? [prevId] : [],
      done: false,
      note: st.note || undefined,
      createdAt: now,
      parentId: original.id,
    };
    prevId = id;
    return t;
  });
  newTasks[0].deps = [...original.deps];
  if (original.startMin !== undefined && startDay === ownStart) newTasks[0].startMin = original.startMin;
  const lastId = newTasks[newTasks.length - 1].id;
  for (const r of allTasks(goals)) {
    if (r.task.id !== original.id) r.task.deps = r.task.deps.map(d => (d === original.id ? lastId : d));
  }
  const old = new Set(descendantIds(goals, original.id));
  const milestone = ref.goal.milestones[ref.milestoneIdx];
  milestone.tasks = milestone.tasks.filter(t => !old.has(t.id));
  const idx = milestone.tasks.findIndex(t => t.id === original.id);
  original.split = true;
  original.done = false;
  delete original.doneAt;
  original.estimateMin = steps.reduce((k, x) => k + x.estimateMin, 0);
  if (!original.due) original.due = steps[steps.length - 1].date;
  milestone.tasks.splice(idx + 1, 0, ...newTasks);
  return newTasks;
}

/** 清洗 AI 给的步骤：标题必填，时长 5–240，日期不早于今天且后一步不早于前一步 */
export function cleanSteps(raw: unknown): SplitStep[] {
  const today = todayStr();
  const list = Array.isArray(raw) ? raw : [];
  const out: SplitStep[] = list
    .filter((x: any) => x && String(x.title || '').trim())
    .slice(0, 12)
    .map((x: any) => {
      const d = safeDate(x.date);
      return {
        title: String(x.title).trim(),
        estimateMin: Math.max(5, Math.min(240, Math.round(Number(x.estimateMin) || 30))),
        energyCost: (['high', 'medium', 'low'] as EnergyCost[]).includes(x.energyCost) ? x.energyCost : 'medium',
        date: d && d >= today ? d : today,
        note: x.note ? String(x.note) : undefined,
      };
    });
  for (let k = 1; k < out.length; k++) if (out[k].date < out[k - 1].date) out[k].date = out[k - 1].date;
  return out;
}

/** 手动定了几点的任务和固定日程冲突时的提示（以任务为主，照样排在那个时间） */
export function clashNote(fixed: FixedEvent[], t: PlanTask): string {
  if (t.startMin === undefined || !t.notBefore) return '';
  const end = t.startMin + t.estimateMin;
  const wd = weekdayOf(t.notBefore);
  const hit = fixed.filter(e => (e.date ? e.date === t.notBefore : e.weekday === wd) && e.startMin < end && e.endMin > (t.startMin as number));
  return hit.length
    ? `\n⚠️ 注意：${t.notBefore.slice(5)} ${minutesToHM(t.startMin)}–${minutesToHM(end)} 和固定日程「${hit.map(e => `${e.title} ${minutesToHM(e.startMin)}–${minutesToHM(e.endMin)}`).join('、')}」冲突，按你定的时间排`
    : '';
}

const QUADS: Quadrant[] = ['important_urgent', 'not_important_urgent', 'important_not_urgent', 'not_important_not_urgent'];
const QUAD_CN: Record<Quadrant, string> = {
  important_urgent: '重要紧急',
  not_important_urgent: '不重要紧急',
  important_not_urgent: '重要不紧急',
  not_important_not_urgent: '不重要不紧急',
};

export function parseHM(v: unknown): number | undefined {
  const m = String(v ?? '').trim().replace('：', ':').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return undefined;
  return h * 60 + mi;
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
  if (t.notBefore) bits.push(`${t.notBefore}${t.startMin !== undefined ? ` ${minutesToHM(t.startMin)}` : ''} 起`);
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
            notBefore: safeDate(a.notBefore) ?? (parseHM(a.startTime) !== undefined ? todayStr() : undefined),
            startMin: parseHM(a.startTime),
            tag: a.tag && String(a.tag).trim() ? String(a.tag).trim().slice(0, 12) : undefined,
            quadrant: QUADS.includes(a.quadrant as Quadrant) ? (a.quadrant as Quadrant) : undefined,
            window: WINDOWS.includes(a.window as TaskWindow) ? a.window : undefined,
            note: a.note ? String(a.note) : undefined,
            deps: [],
            done: false,
            createdAt: new Date().toISOString(),
          };
          goal.milestones[0].tasks.push(task);
          changes.push({ action: a, ok: true, summary: `➕ 新增「${title}」（${describeTask(task)}）→ ${goal.title}${clashNote(next.fixed, task)}` });
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
          if (a.quadrant !== undefined) t.quadrant = QUADS.includes(a.quadrant as Quadrant) ? (a.quadrant as Quadrant) : undefined;
          if (a.tag !== undefined) t.tag = a.tag && String(a.tag).trim() ? String(a.tag).trim().slice(0, 12) : undefined;
          if (a.startTime !== undefined) {
            t.startMin = a.startTime === null ? undefined : parseHM(a.startTime);
            if (t.startMin !== undefined && !t.notBefore) t.notBefore = todayStr();
          }
          if (a.window !== undefined) t.window = a.window && WINDOWS.includes(a.window) ? a.window : undefined;
          changes.push({
            action: a,
            ok: true,
            summary: `✏️ 调整「${before}」${before !== t.title ? ` → 「${t.title}」` : ''}（${describeTask(t)}）${clashNote(next.fixed, t)}`,
          });
          break;
        }
        case 'split_task': {
          const steps = cleanSteps(a.steps);
          if (steps.length < 2) throw new Error('至少要拆成 2 步');
          let id = a.taskId;
          if (id) {
            if (!find(id)) throw new Error('找不到这个任务');
          } else {
            const title = String(a.title || '').trim();
            if (!title) throw new Error('缺少任务名');
            const goal = findGoalForAdd(next.goals, a.goal);
            id = randomId();
            goal.milestones[0].tasks.push({
              id,
              title,
              estimateMin: steps.reduce((k, x) => k + x.estimateMin, 0),
              energyCost: 'medium',
              due: safeDate(a.due),
              notBefore: safeDate(a.notBefore),
              startMin: safeDate(a.notBefore) ? parseHM(a.startTime) : undefined,
              tag: a.tag && String(a.tag).trim() ? String(a.tag).trim().slice(0, 12) : undefined,
              quadrant: QUADS.includes(a.quadrant as Quadrant) ? (a.quadrant as Quadrant) : undefined,
              deps: [],
              done: false,
              createdAt: new Date().toISOString(),
            });
          }
          const parent = find(id)!.task;
          // 拆已有任务时也可以顺便设开始日期（「12/8 开始做」）
          if (a.taskId && safeDate(a.notBefore)) {
            parent.notBefore = safeDate(a.notBefore);
            if (a.startTime !== undefined) parent.startMin = parseHM(a.startTime);
          }
          splitTaskInGoals(next.goals, id, steps);
          changes.push({
            action: a,
            ok: true,
            summary: `🧩 把「${parent.title}」拆成 ${steps.length} 步：${steps.map(x => `${x.date.slice(5)} ${x.title}（${x.estimateMin} 分）`).join('；')}`,
          });
          break;
        }
        case 'add_event': {
          // 重要事件单独存（components/data/events.ts），这里只检查；真正写入在界面里
          const title = String(a.title || '').trim();
          const d = safeDate(a.date);
          if (!title || !d) throw new Error('重要事件要有名字和日期');
          changes.push({
            action: a,
            ok: true,
            summary: `⭐ 重要事件：${d.slice(5)}${a.time ? ' ' + a.time : ''} ${title}${a.yearly ? '（每年）' : ''}`,
          });
          break;
        }
        case 'add_diary': {
          // 日记单独存（components/data/diary.ts），这里只检查内容、生成说明；真正写入在界面里
          const text = String(a.text || '').trim();
          if (!text) throw new Error('日记内容是空的');
          const d = safeDate(a.date) ?? todayStr();
          changes.push({ action: a, ok: true, summary: `📔 写进 ${d.slice(5)} 的日记：${text.length > 40 ? text.slice(0, 40) + '…' : text}` });
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
        case 'add_subtask': {
          const ref = find(a.parentId);
          if (!ref) throw new Error('找不到父任务');
          if (ref.task.parentId) throw new Error('子任务下面不能再加子任务');
          const title = String(a.title || '').trim();
          if (!title) throw new Error('缺少子任务名');
          const est = Math.max(5, Math.min(480, Math.round(Number(a.estimateMin) || 30)));
          const cost: EnergyCost = (['high', 'medium', 'low'] as EnergyCost[]).includes(a.energyCost as EnergyCost)
            ? (a.energyCost as EnergyCost)
            : ref.task.energyCost || 'medium';
          const date = safeDate(a.date);
          const sm = a.startTime ? parseHM(String(a.startTime)) : undefined;
          const parent = ref.task;
          let child: PlanTask;
          if (!parent.split) {
            // 第一次手动加子任务：原任务变成父任务，这一步是它的第一个子任务
            child = splitTaskInGoals(next.goals, parent.id, [{ title, estimateMin: est, energyCost: cost, date: date || todayStr() }])[0];
          } else {
            const kids = allTasks(next.goals).filter(r => r.task.parentId === parent.id).map(r => r.task);
            const last = kids[kids.length - 1];
            child = {
              id: randomId(),
              title,
              estimateMin: est,
              energyCost: cost,
              notBefore: last?.notBefore,
              deps: last ? [last.id] : [...parent.deps],
              done: false,
              createdAt: new Date().toISOString(),
              parentId: parent.id,
            };
            // 原来排在最后一步之后的任务，改成排在新的这步之后
            if (last) {
              for (const r of allTasks(next.goals)) {
                if (r.task.parentId !== parent.id && r.task.deps.includes(last.id)) {
                  r.task.deps = r.task.deps.map(d => (d === last.id ? child.id : d));
                }
              }
            }
            const m = ref.goal.milestones[ref.milestoneIdx];
            const lastIdx = Math.max(m.tasks.findIndex(t => t.id === parent.id), ...kids.map(k => m.tasks.findIndex(t => t.id === k.id)));
            m.tasks.splice(lastIdx + 1, 0, child);
            parent.estimateMin = kids.reduce((k, t) => k + t.estimateMin, 0) + est;
            if (parent.done) {
              parent.done = false;
              delete parent.doneAt;
            }
          }
          if (date) child.notBefore = date;
          if (sm !== undefined && child.notBefore) child.startMin = sm;
          else if (date) delete child.startMin;
          changes.push({
            action: a,
            ok: true,
            summary: `➕ 给「${parent.title}」加了子任务「${title}」（${est} 分钟${date ? `，${date.slice(5)} 起` : ''}）`,
          });
          break;
        }
        case 'delete_task': {
          const ref = find(a.taskId);
          if (!ref) throw new Error('找不到这个任务');
          const m = ref.goal.milestones[ref.milestoneIdx];
          const kill = new Set([ref.task.id, ...descendantIds(next.goals, ref.task.id)]);
          m.tasks = m.tasks.filter(t => !kill.has(t.id));
          // 删掉链条中间的一步：后面依赖它的，改成依赖它前面的那步，顺序不断
          const parentRef = ref.task.parentId ? find(ref.task.parentId) : undefined;
          const lastChild = !!parentRef && !allTasks(next.goals).some(r => r.task.parentId === parentRef.task.id);
          // 子任务全删光了：原来接在它后面的任务改回接在父任务后面
          const inherit = lastChild ? [parentRef!.task.id] : ref.task.deps.filter(d => !kill.has(d));
          for (const r of allTasks(next.goals)) {
            if (r.task.deps.some(d => kill.has(d))) {
              r.task.deps = [...new Set([...r.task.deps.filter(d => !kill.has(d)), ...inherit])];
            }
          }
          // 删的是子任务：父任务的总时长跟着变；子任务删光了，父任务变回普通任务
          const parent = parentRef;
          if (parent) {
            const left = allTasks(next.goals).filter(r => r.task.parentId === parent.task.id).map(r => r.task);
            if (left.length === 0) {
              delete parent.task.split;
              parent.task.estimateMin = Math.max(5, ref.task.estimateMin);
            } else {
              parent.task.estimateMin = left.reduce((k, t) => k + t.estimateMin, 0);
              if (left.every(t => t.done) && !parent.task.done) {
                parent.task.done = true;
                parent.task.doneAt = new Date().toISOString();
              }
            }
          }
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
  const sf = effectiveSpeed(state);
  lines.push(`速率系数：${sf}（实际耗时 ≈ 预估 × ${sf}，${state.settings?.speedOverride ? '用户手动设定' : '来自历史时间记录'}）`);
  if (habits) lines.push(habits);
  const gold = goldenSlots(predictCurve(state.energyLogs, today)).map(slotLabel);
  if (gold.length) lines.push(`精力最好的时段：${gold.join('、')}`);

  lines.push('（以下是此刻的真实数据：用户可能在日历 / 任务页手动增删改过，和对话历史对不上时以这里为准）');
  lines.push('', '## 未完成任务（id | 任务 | 所属目标 | 预估分钟 | 已投入分钟 | 耗能 | 截止 | 其他）');
  const refs = allTasks(state.goals);
  const pending = refs.filter(r => !r.task.done && !r.task.split);
  const titleById = new Map(refs.map(r => [r.task.id, r.task.title]));
  const dueOf = new Map(refs.map(r => [r.task.id, r.task.due]));
  pending
    .sort((a, b) => (a.task.due || '9999').localeCompare(b.task.due || '9999'))
    .slice(0, 80)
    .forEach(({ task: t, goal }) => {
      const extra = [t.quadrant ? QUAD_CN[t.quadrant] : '', t.tag ? `#${t.tag}` : '', t.notBefore ? `${t.notBefore}${t.startMin !== undefined ? ` ${minutesToHM(t.startMin)}` : ''} 起` : '', t.window ? `偏好${WINDOW_CN[t.window]}` : '']
        .filter(Boolean)
        .join(' ');
      lines.push(
        `${t.id} | ${t.title}${t.parentId && titleById.has(t.parentId) ? `（「${titleById.get(t.parentId)}」的子任务）` : ''} | ${goal.title} | ${t.estimateMin} | ${spent.get(t.id) ?? 0} | ${t.energyCost} | ${t.due || (t.parentId && dueOf.get(t.parentId) ? `${dueOf.get(t.parentId)}（跟父任务）` : '无')} | ${extra}`
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
- {"type":"add_task","title":"任务名（动词开头，具体）","estimateMin":分钟,"energyCost":"high|medium|low","due":"YYYY-MM-DD","notBefore":"YYYY-MM-DD","startTime":"HH:MM（用户说了几点开始才填）","window":"morning|afternoon|evening","tag":"分类，如 学习/工作/生活/健康，沿用用户任务里已有的分类，可省略","quadrant":"important_urgent|not_important_urgent|important_not_urgent|not_important_not_urgent（用户说了重要/紧急才填）","goal":"已有的目标名；拆解新目标时填新目标名；零散小事省略（会放进「日常安排」）","note":"背景，可省略"}
- {"type":"update_task","taskId":"已有任务 id","title":...,"estimateMin":...,"energyCost":...,"due":"YYYY-MM-DD 或 null","notBefore":"YYYY-MM-DD 或 null","startTime":"HH:MM 或 null","window":"... 或 null","tag":"分类 或 null","quadrant":"四象限 或 null"}  （只写要改的字段）
- {"type":"split_task","taskId":"已有任务 id（拆新的大任务时省略，改填 title/due/tag/quadrant/goal）","notBefore":"YYYY-MM-DD 从哪天开始做（用户说了才填）","startTime":"HH:MM（可省略）","steps":[{"title":"具体步骤（动词开头）","estimateMin":分钟,"energyCost":"high|medium|low","date":"YYYY-MM-DD 这一步哪天做","note":"可省略"}]}  （拆成父任务 + 子任务，和 🧩 拆解的格式一样）
- {"type":"add_event","title":"妈妈生日","date":"YYYY-MM-DD","yearly":true,"time":"HH:MM（可省略）"}  （重要事件：只在日历上标出来）
- {"type":"add_diary","text":"要写进日记的内容","date":"YYYY-MM-DD（默认今天，用户说了哪天才填）"}
- {"type":"complete_task","taskId":"已有任务 id"}
- {"type":"delete_task","taskId":"已有任务 id"}
- {"type":"add_subtask","parentId":"已有任务 id","title":"新的一步","estimateMin":分钟,"energyCost":"high|medium|low","date":"YYYY-MM-DD（可省略）"}  （给已有任务加一个子任务，加在最后一步后面；还没拆过的任务会变成父任务。删子任务用 delete_task）
- {"type":"add_fixed_event","title":"名称","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","kind":"course|meeting|ticket|other"}  （每周重复的用 "weekday":0-6 代替 date，0 是周日）
- {"type":"delete_fixed_event","eventId":"已有固定日程 id"}
- {"type":"remember","text":"一句话的长期偏好，如：周末上午不安排学习"}
- {"type":"forget","memoryId":"已有偏好 id"}

规则：
1. taskId / eventId 必须从当前数据里原样复制，不能编造。
2. 有明确时间点的事（上课、开会、聚会、看病）用 add_fixed_event；需要花时间去做、时间可以灵活安排的用 add_task。
3. 大任务（预估超过 2 小时、或明显要分几次做：写论文、准备考试、做项目…）一律用 split_task 拆成 2-6 个具体步骤，每步 25-120 分钟，按「可用时间」分到不同日子，最后一步不晚于截止日；预估时要乘上速率系数，宁可多估一点。用户新加这种大任务时，不用等他要求，直接用 split_task 拆好（他可以在方案里取消）。小任务照常 add_task。
4. 用户说某事做完了 → complete_task；说做了一部分 → 用 update_task 把 estimateMin 改成「已投入 + 剩余」的总量。
5. 用户说「3 点开始写报告」「明天 9 点复习」这种做事的开始时间 → add_task/update_task 填 notBefore（那天）+ startTime；不要当成固定日程。用户说「放到上午/下午/晚上」→ window；「下周再做」「X 号以后」→ notBefore；「推迟」→ 改 due 或 notBefore。
6. 要动脑的（写作、编程、复习难点）标 high；一般学习/整理标 medium；跑腿、回消息、杂事标 low。
7. 日期用 YYYY-MM-DD，根据「现在」推算「明天」「周五」等。
7.1 分清「哪天做」和「哪天前完成」——这一点非常重要，否则任务会被排到今天：
   - 「周五写报告」「明天去取快递」「下周一复习」「25 号整理笔记」= 指定那天做 → notBefore 和 due 都填那一天。
   - 「周五前交报告」「月底截止」「XX DDL」= 截止日 → 只填 due。注意：只有截止日、没拆分的任务（DDL）不会被自动排进日程，只在日历上红字提醒。
   - 截止前确实需要花时间做的（写报告、复习考试、做项目）：用 split_task 拆成步骤（子任务会在截止前自动排时间）；或者用户说了哪天开始，就填 notBefore。考试这类 due 填考试前一天。
   - 「12/13 截止，12/8 开始做」= 开始 + 截止都有 → notBefore 填 12/8、due 填 12/13。要拆的话 split_task 同时填 notBefore 和 due（第一步的 date 也写 12/8），所有步骤都会从 12/8 起排、12/13 前做完；不拆就 add_task 填这两个字段。
   - 拿不准时按「那天做」处理，并在 reply 里说明你是怎么理解的。
8. 信息不够、无法安排时，actions 留空，在 reply 里问一个最关键的问题。
8.1 用户只是提问、不需要改数据时，actions 留空。让你拆解目标或任务时，用 split_task（已有任务填 taskId，新的填 title），不要用一串 add_task，在 reply 里讲清拆解思路。
9. 不要重复添加已存在的任务——是否存在只看「当前数据」。
10. 对话历史里你说过的安排不一定生效了（用户可能没点确认）。一切以「当前数据」为准：用户要做的事如果当前数据里没有，就重新添加，不要说「已经加过了」。
11. 你给出的操作要等用户点「应用」才生效，所以 reply 里不要说「已经加好了 / 已把…加为」，要说「给你拟好了…」「准备把…加为…」。
11. 如果数据里有「近 N 天复盘」：常见「估少了」就把预估再放宽；常见「太累了」就少排高耗能、多留休息；常见「被打断」就把任务切得更小。
12. 用户说「记住…」「以后…」「我一般…」「我不喜欢…」这类长期偏好 → 用 remember 记下来；如果偏好是某个固定时间段不想做事（如「周末上午不想学习」「每晚 10 点后别排」），同时用 add_fixed_event 加每周重复的占位日程（标题以「🚫 不排任务：」开头，kind 用 other，每个相关的 weekday 各加一条），这样排程会自动避开。
13. 「用户亲口说过的偏好」必须遵守；「从历史数据总结的习惯」用来调整预估和时段（例如某类任务常低估就多估一点，某时段常常没开始就别把重要的事排在那里，必要时用 window 指定时段）。
14. 用户说「忘掉…」「不用再…」→ 用 forget 删掉对应偏好，并用 delete_fixed_event 删掉对应的占位日程。
13. 无论用户怎么说（口语、错别字、一句话里好几件事、只是闲聊或抱怨），都要猜出他最可能的意图并照做；只有真的无法判断时才在 reply 里追问一句。永远只输出一个 JSON 对象 {"reply": "...", "actions": [...]}，不要在 JSON 外面写任何文字，不要用 markdown 代码块。reply 永远不能为空、也不能只写「好的」：要做改动就说清楚改了什么；觉得不用改（比如已经有了），也要说明当前数据里对应的是哪一条、在哪天，并问用户要不要再改。
14. 用户说「写进日记 / 加入日记 / 记到日记里 / 记一下今天…」这类话 → 用 add_diary。text 用用户自己的原话（只去掉「帮我写进日记」这类指令词、改掉明显错别字，不要改写成别的语气，不要加评论）；同一句里如果还有别的安排要求，照常输出其他操作。reply 简短确认即可。
15. 分清三种东西：要「做」的事 → 任务（add_task / split_task）；时间定死、要占时间的课和会 → 固定日程（add_fixed_event）；某天「发生」、不需要用户完成什么、只是要记住的日子（生日、纪念日、节日、出发 / 回国、发工资）→ 重要事件 add_event（生日、纪念日 yearly=true）。
   - 凡是 DDL / 截止 / due / 交 / 提交 / 作业 / pre / presentation / quiz / 考试 / 测验 / 报告 / 论文这类「到那天要交出东西或要完成」的，一律是任务（DDL：add_task 只填 due），绝不能记成重要事件。
   - 只有用户明确说「记成重要事件 / 加个 ⭐ / 只是提醒我这天」时，才把这类记成 add_event。
16. 用户明确说「把 X 排在某天几点」（哪怕那时有课 / 固定日程）→ 以任务为主：add_task / update_task 填 notBefore + startTime，系统会照这个时间排，并提示冲突；不要擅自改时间，可以在 reply 里提醒一句和哪个固定日程冲突。没说具体时间的，系统自动排时会避开固定日程。
17. 「当前数据」永远是准的，对话历史只是过去说过的话。历史里提到的任务 / DDL / 重要事件 / 固定日程，如果在当前数据里找不到，说明用户已经在日历或任务页删掉或改掉了：不要说它「已经在日历上」「还在」，也不要拿它来问用户（比如问「7 号和 8 号是不是重复」）；用户这次又提到它，就当作新的，照常添加。判断某天有没有某件事，只看当前数据。
18. 用户消息里以 # 开头的一句是 DDL：一律用 add_task 只写 due（截止日），绝不记成重要事件或固定日程；以 * 开头的是重要事件（add_event）。`;
