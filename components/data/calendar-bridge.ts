/**
 * 「日历进度」和统一任务数据之间的桥：
 * - 日历格子里的每个事项 = 一个有截止日的任务（截止日就是它所在的那一天）
 * - 文字颜色、加粗、同一天里的顺序这些「样式」单独保存，不影响任务本身
 * 这样日历的样子和用法完全不变，而在日历里加 / 改 / 勾 / 删，任务列表、排程、AI 都会同步。
 */
import { KEYS, loadJSON, saveJSON } from '@/app/utils/planning';
import { SMART_PREFIX, type CalendarItem as LegacyItem } from '@/components/data/migrate';
import { PlanState, allTasks } from '@/components/assistant/plan-store';

export type CalendarStyle = { textColor?: string; bold?: boolean; order?: number };
export const CAL_STYLE_KEY = '@myplan_calendar_styles';
const CAL_STYLE_INIT_KEY = '@myplan__calendar_styles_v1';

export type CalendarItem = {
  id: string; // = 任务 id
  title: string;
  date: string;
  completed: boolean;
  parentTaskId?: string;
  textColor?: string;
  bold?: boolean;
  order?: number;
};

export async function loadCalendarStyles(state: PlanState): Promise<Record<string, CalendarStyle>> {
  const styles = await loadJSON<Record<string, CalendarStyle>>(CAL_STYLE_KEY, {});
  if (await loadJSON<string | null>(CAL_STYLE_INIT_KEY, null)) return styles;
  // 第一次：把旧日历事项上的颜色 / 加粗 / 顺序搬到对应的任务上
  const legacy = await loadJSON<(LegacyItem & CalendarStyle)[]>(KEYS.calendar, []);
  const refs = allTasks(state.goals);
  for (const it of legacy) {
    if (it.textColor === undefined && it.bold === undefined && it.order === undefined) continue;
    const hit =
      refs.find(r => r.task.id === `cal_${it.id}`) ??
      (it.parentTaskId ? refs.find(r => r.goal.id === SMART_PREFIX + it.parentTaskId && r.task.title === it.title) : undefined) ??
      refs.find(r => r.task.title === it.title && r.task.due === it.date);
    if (hit && !styles[hit.task.id]) styles[hit.task.id] = { textColor: it.textColor, bold: it.bold, order: it.order };
  }
  await saveJSON(CAL_STYLE_KEY, styles);
  await saveJSON(CAL_STYLE_INIT_KEY, new Date().toISOString());
  return styles;
}

export async function saveCalendarStyles(styles: Record<string, CalendarStyle>) {
  await saveJSON(CAL_STYLE_KEY, styles);
}

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 统一任务 → 日历事项：
 * - 带截止日的任务出现在截止日那天；
 * - 没有截止日的任务，只要做完了（不管在今天页、任务页、计时、复盘还是跟 AI 说的），
 *   就出现在完成的那一天，并且划掉。
 */
export function tasksToCalendarItems(state: PlanState, styles: Record<string, CalendarStyle>): CalendarItem[] {
  return allTasks(state.goals)
    // 被拆开的父任务不在日历里重复显示，它的子任务各自出现在自己那天
    .filter(r => !r.task.split && (!!r.task.due || (r.task.done && !!r.task.doneAt)))
    .map(r => ({
      id: r.task.id,
      title: r.task.title,
      date: (r.task.due ?? localDay(r.task.doneAt as string)) as string,
      completed: r.task.done,
      parentTaskId: r.goal.id,
      ...styles[r.task.id],
    }));
}
