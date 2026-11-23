/**
 * 一次性数据迁移（v2）：把旧的「SMART 任务记录」和日历里的事项合并进统一的目标库。
 *
 * - 进行中的 SMART 任务 → 目标（id 仍是 smart_<原id>，和之前自动同步出的镜像一致，
 *   所以计时记录、AI 对话里引用的任务 id 都还能对上），带上重要/紧急四象限
 * - 已完成的 SMART 任务 → 已完成的目标（复盘页「已完成」里能看到）
 * - 日历里手动加的单独事项（不属于任何 SMART 任务）→「日常安排」里的任务，截止日 = 那一天
 *
 * 旧的存储键原样保留不删，万一有问题还能从备份恢复。
 */
import { Goal, KEYS, PlanTask, Quadrant, loadJSON, normalizeDate, randomId, saveJSON } from '@/app/utils/planning';

export const MIGRATION_KEY = '@myplan__migration_v2';
export const SMART_PREFIX = 'smart_';
export const DAILY_GOAL_ID = 'ai_daily';
const MAIN_SUB = 'main';

type SmartSubtask = { id: string; title: string; completed: boolean; scheduledDate?: string };
export type SmartTask = {
  id: string;
  title: string;
  dueDate: string;
  quadrant?: string;
  subtasks: SmartSubtask[];
  specific?: string;
  measurable?: string;
  relevant?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  [k: string]: unknown;
};
export type CalendarItem = { id: string; title: string; date: string; completed: boolean; parentTaskId?: string };

const QUADRANT_KEYS: Quadrant[] = ['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent'];

function safeDate(s?: string) {
  if (!s) return undefined;
  const d = normalizeDate(s);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

export function dailyGoal(): Goal {
  return {
    id: DAILY_GOAL_ID,
    title: '日常安排',
    specific: '零散的小任务',
    measurable: '',
    achievable: '',
    relevant: '',
    due: '',
    feasibility: 80,
    difficulty: 1,
    strategy: '',
    milestones: [{ id: `${DAILY_GOAL_ID}_m`, title: '日常', tasks: [] }],
    createdAt: new Date().toISOString(),
    source: 'ai',
  };
}

/** SMART 任务 → 目标（保留之前同步出的镜像上改过的预估、耗能等） */
export function smartToGoal(t: SmartTask, prev: Goal | undefined, completed: boolean): Goal {
  const gid = SMART_PREFIX + t.id;
  const prevTasks = new Map<string, PlanTask>();
  prev?.milestones.forEach(m => m.tasks.forEach(pt => prevTasks.set(pt.id, pt)));
  const subs: SmartSubtask[] =
    t.subtasks && t.subtasks.length > 0 ? t.subtasks : [{ id: MAIN_SUB, title: t.title, completed }];
  const doneAt = completed ? t.completedAt || t.updatedAt || new Date().toISOString() : undefined;
  const tasks: PlanTask[] = subs.map(s => {
    const id = `${gid}_${s.id}`;
    const p = prevTasks.get(id);
    const done = completed || !!s.completed || !!p?.done;
    return {
      ...p,
      id,
      title: s.title,
      estimateMin: p?.estimateMin ?? 60,
      energyCost: p?.energyCost ?? 'medium',
      due: safeDate(s.scheduledDate) ?? safeDate(t.dueDate),
      deps: p?.deps ?? [],
      done,
      doneAt: done ? p?.doneAt ?? doneAt ?? t.updatedAt ?? new Date().toISOString() : undefined,
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
    strategy: '',
    milestones: [{ id: `${gid}_m`, title: '子任务', tasks }],
    createdAt: t.createdAt || new Date().toISOString(),
    quadrant: QUADRANT_KEYS.includes(t.quadrant as Quadrant) ? (t.quadrant as Quadrant) : undefined,
    source: 'smart',
    completedAt: completed ? doneAt : undefined,
  };
}

/** 纯函数：给出迁移后的目标库（方便测试） */
export function migrateGoals(goals: Goal[], smart: SmartTask[], completedSmart: SmartTask[], calendar: CalendarItem[]): Goal[] {
  const byId = new Map(goals.map(g => [g.id, g]));
  const out: Goal[] = goals.filter(g => !g.id.startsWith(SMART_PREFIX));
  for (const t of smart) out.push(smartToGoal(t, byId.get(SMART_PREFIX + t.id), false));
  for (const t of completedSmart) {
    if (smart.some(x => x.id === t.id)) continue;
    out.push(smartToGoal(t, byId.get(SMART_PREFIX + t.id), true));
  }
  // 日历里单独加的事项
  const smartIds = new Set([...smart, ...completedSmart].map(t => t.id));
  const allTitles = new Set(out.flatMap(g => g.milestones.flatMap(m => m.tasks.map(t => t.title))));
  const loose = calendar.filter(c => (!c.parentTaskId || !smartIds.has(c.parentTaskId)) && !allTitles.has(c.title));
  if (loose.length) {
    let daily = out.find(g => g.id === DAILY_GOAL_ID);
    if (!daily) {
      daily = dailyGoal();
      out.push(daily);
    }
    for (const c of loose) {
      const due = safeDate(c.date);
      daily.milestones[0].tasks.push({
        id: `cal_${c.id || randomId()}`,
        title: c.title,
        estimateMin: 30,
        energyCost: 'low',
        due,
        notBefore: due,
        deps: [],
        done: !!c.completed,
        doneAt: c.completed ? (due ? `${due}T12:00:00` : new Date().toISOString()) : undefined,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return out;
}

/** 启动时调用：没迁移过就迁移一次 */
export async function ensureMigrated(): Promise<boolean> {
  const done = await loadJSON<string | null>(MIGRATION_KEY, null);
  if (done) return false;
  const [goals, smart, completedSmart, calendar] = await Promise.all([
    loadJSON<Goal[]>(KEYS.goals, []),
    loadJSON<SmartTask[]>(KEYS.tasks, []),
    loadJSON<SmartTask[]>(KEYS.completed, []),
    loadJSON<CalendarItem[]>(KEYS.calendar, []),
  ]);
  const next = migrateGoals(goals, smart, completedSmart, calendar);
  await saveJSON(KEYS.goals, next);
  await saveJSON(MIGRATION_KEY, new Date().toISOString());
  return true;
}
