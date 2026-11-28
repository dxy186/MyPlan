/**
 * 习惯档案：从你的计时、精力、排程执行情况和复盘里总结规律，交给排程和 AI 参考。
 * - 不同类型任务各自的速率（写作总是低估？刷题比预估快？）
 * - 一天里哪个时段最常真正开工、哪个时段排了也常常没开始
 * - 你亲口告诉 AI 的偏好（「记住：周末上午不想学习」）
 *
 * 这个文件只依赖 planning，避免和 plan-store 循环引用。
 */
import {
  ENERGY_SLOTS,
  EnergySlotKey,
  Goal,
  PlanTask,
  TimeLog,
  loadJSON,
  saveJSON,
  speedFactor,
  speedSamples,
  weekdayOf,
} from '@/app/utils/planning';

// ---------------------------------------------------------------------------
// 任务类型
// ---------------------------------------------------------------------------
export type TaskCategory = '写作' | '编程' | '复习背诵' | '阅读' | '作业练习' | '整理杂事' | '其他';

const CATEGORY_RULES: [TaskCategory, RegExp][] = [
  ['编程', /代码|编程|程序|debug|调试|开发|实现|bug|接口|脚本|部署/i],
  ['写作', /写|报告|论文|作文|文章|初稿|改稿|润色|总结|大纲|PPT|ppt|演讲稿/],
  ['复习背诵', /复习|背|记忆|单词|默写|考前|错题/],
  ['阅读', /读|阅读|文献|看书|看论文|看课|网课|听课|预习/],
  ['作业练习', /作业|习题|练习|刷题|题目|做题|实验/],
  ['整理杂事', /整理|收拾|回复|邮件|消息|买|取|交|打印|报名|缴费|洗|打扫/],
];

export function categoryOf(title: string): TaskCategory {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  return '其他';
}

function flatTasks(goals: Goal[]): PlanTask[] {
  return goals.flatMap(g => g.milestones.flatMap(m => m.tasks));
}

export type CategoryStat = { category: TaskCategory; factor: number; samples: number };

/** 各类任务的速率（实际 ÷ 原始预估的中位数），样本少于 minSamples 的不算 */
export function categoryFactors(logs: TimeLog[], goals: Goal[], minSamples = 3): CategoryStat[] {
  const tasks = flatTasks(goals);
  const byCat = new Map<TaskCategory, PlanTask[]>();
  for (const t of tasks) {
    const c = categoryOf(t.title);
    byCat.set(c, [...(byCat.get(c) ?? []), t]);
  }
  const out: CategoryStat[] = [];
  for (const [category, ts] of byCat) {
    const ids = new Set(ts.map(t => t.id));
    const catLogs = logs.filter(l => l.taskId && ids.has(l.taskId));
    const samples = speedSamples(catLogs, ts).length;
    if (samples >= minSamples) out.push({ category, factor: speedFactor(catLogs, ts, 1), samples });
  }
  return out.sort((a, b) => b.factor - a.factor);
}

/**
 * 某个任务相对于整体速率要再乘的系数。
 * 排程整体已经乘了全局速率，这里只补「这一类比平均更慢 / 更快」的那部分，并限制在 0.6–1.8 倍。
 */
export function categoryRatio(task: PlanTask, stats: CategoryStat[], globalFactor: number): number {
  const s = stats.find(x => x.category === categoryOf(task.title));
  if (!s || globalFactor <= 0) return 1;
  return Math.min(1.8, Math.max(0.6, s.factor / globalFactor));
}

// ---------------------------------------------------------------------------
// 排程执行情况：每个任务块有没有按时开始
// ---------------------------------------------------------------------------
export const BLOCK_LOG_KEY = '@myplan_block_log';
export type BlockRecord = { id: string; date: string; startMin: number; endMin: number; title: string; started: boolean };

export async function loadBlockLog() {
  return loadJSON<BlockRecord[]>(BLOCK_LOG_KEY, []);
}

/** 记录已经过去的任务块（同一个块只记一次），只保留最近 400 条 */
export async function appendBlockLog(records: BlockRecord[]) {
  if (records.length === 0) return;
  const all = await loadBlockLog();
  const seen = new Set(all.map(r => r.id));
  const fresh = records.filter(r => !seen.has(r.id));
  if (fresh.length === 0) return;
  await saveJSON(BLOCK_LOG_KEY, [...all, ...fresh].slice(-400));
}

function slotOf(min: number): EnergySlotKey {
  const h = min / 60;
  if (h >= 6 && h < 8) return 'dawn';
  if (h >= 8 && h < 11) return 'morning';
  if (h >= 11 && h < 13) return 'noon';
  if (h >= 13 && h < 17) return 'afternoon';
  if (h >= 17 && h < 19) return 'evening';
  if (h >= 19 && h < 23) return 'night';
  return 'late';
}

const SLOT_LABEL: Record<string, string> = Object.fromEntries(ENERGY_SLOTS.map(s => [s.key, s.label]));

export type SlotStat = { slot: EnergySlotKey; label: string; planned: number; started: number; rate: number };

/** 各时段：排了多少块、按时开始了多少 */
export function slotFollowThrough(blocks: BlockRecord[], minBlocks = 4): SlotStat[] {
  const m = new Map<EnergySlotKey, { planned: number; started: number }>();
  for (const b of blocks) {
    const s = slotOf(b.startMin);
    const cur = m.get(s) ?? { planned: 0, started: 0 };
    cur.planned++;
    if (b.started) cur.started++;
    m.set(s, cur);
  }
  return [...m.entries()]
    .filter(([, v]) => v.planned >= minBlocks)
    .map(([slot, v]) => ({ slot, label: SLOT_LABEL[slot], ...v, rate: v.started / v.planned }))
    .sort((a, b) => b.rate - a.rate);
}

/** 实际做事的分钟数按时段分布 */
export function workBySlot(logs: TimeLog[]): { slot: EnergySlotKey; label: string; minutes: number }[] {
  const m = new Map<EnergySlotKey, number>();
  for (const l of logs) {
    if (l.category !== '任务' || !l.startAt) continue;
    const d = new Date(l.startAt);
    const s = slotOf(d.getHours() * 60 + d.getMinutes());
    m.set(s, (m.get(s) ?? 0) + l.minutes);
  }
  return [...m.entries()].map(([slot, minutes]) => ({ slot, label: SLOT_LABEL[slot], minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** 工作日 / 周末平均每天做多少分钟任务 */
export function weekdayVsWeekend(logs: TimeLog[]) {
  const perDay = new Map<string, number>();
  for (const l of logs) {
    if (l.category !== '任务' || !l.startAt) continue;
    const d = new Date(l.startAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    perDay.set(key, (perDay.get(key) ?? 0) + l.minutes);
  }
  const wk: number[] = [];
  const we: number[] = [];
  for (const [day, min] of perDay) (weekdayOf(day) % 6 === 0 ? we : wk).push(min);
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
  return { weekday: avg(wk), weekend: avg(we), weekdayDays: wk.length, weekendDays: we.length };
}

// ---------------------------------------------------------------------------
// 用户亲口说的偏好
// ---------------------------------------------------------------------------
export const MEMORIES_KEY = '@myplan_memories';
export type Memory = { id: string; text: string; createdAt: string };

export async function loadMemories() {
  return loadJSON<Memory[]>(MEMORIES_KEY, []);
}
export async function saveMemories(m: Memory[]) {
  await saveJSON(MEMORIES_KEY, m);
}

// ---------------------------------------------------------------------------
// 汇总：给人看的洞察 + 给 AI 的文字
// ---------------------------------------------------------------------------
export type HabitInsight = { icon: string; text: string };

export function buildInsights(
  logs: TimeLog[],
  goals: Goal[],
  blocks: BlockRecord[],
  reasonLine = ''
): HabitInsight[] {
  const out: HabitInsight[] = [];
  const g = speedFactor(logs, flatTasks(goals));
  const samples = speedSamples(logs, flatTasks(goals)).length;
  if (samples >= 3) {
    out.push({
      icon: '⏱',
      text:
        g > 1.15
          ? `整体上你实际花的时间约是预估的 ${g} 倍，排程已自动放宽。`
          : g < 0.85
          ? `整体上你比预估快，实际约是预估的 ${g} 倍。`
          : `你的预估整体挺准（实际 ≈ 预估 × ${g}）。`,
    });
  }
  for (const c of categoryFactors(logs, goals)) {
    const ratio = g > 0 ? c.factor / g : 1;
    if (ratio >= 1.2) out.push({ icon: '🐢', text: `「${c.category}」类任务比你平时更容易低估：实际约是预估的 ${c.factor} 倍（${c.samples} 个样本），会给这类多留时间。` });
    else if (ratio <= 0.8) out.push({ icon: '🐇', text: `「${c.category}」类任务你做得比预估快：实际约是预估的 ${c.factor} 倍（${c.samples} 个样本）。` });
  }
  const slots = slotFollowThrough(blocks);
  if (slots.length >= 2) {
    const best = slots[0];
    const worst = slots[slots.length - 1];
    if (best.rate - worst.rate >= 0.25) {
      out.push({ icon: '✅', text: `${best.label} 排的任务你最常按时开始（${Math.round(best.rate * 100)}%）。` });
      out.push({ icon: '⚠️', text: `${worst.label} 排的任务只有 ${Math.round(worst.rate * 100)}% 按时开始，AI 会少往这里排重要的事。` });
    }
  }
  const work = workBySlot(logs);
  const total = work.reduce((s, w) => s + w.minutes, 0);
  if (total >= 300 && work[0]) {
    out.push({ icon: '📈', text: `你真正做事的时间里，${Math.round((work[0].minutes / total) * 100)}% 集中在${work[0].label}。` });
  }
  const wv = weekdayVsWeekend(logs);
  if (wv.weekday !== null && wv.weekend !== null && wv.weekdayDays >= 3 && wv.weekendDays >= 2) {
    out.push({ icon: '📅', text: `工作日平均每天做 ${wv.weekday} 分钟，周末平均 ${wv.weekend} 分钟。` });
  }
  if (reasonLine) out.push({ icon: '🌙', text: reasonLine });
  return out;
}

export function habitsForAi(insights: HabitInsight[], memories: Memory[]): string {
  const lines: string[] = [];
  if (memories.length) {
    lines.push('## 用户亲口说过的偏好（必须遵守；id | 内容）');
    memories.forEach(m => lines.push(`${m.id} | ${m.text}`));
  }
  if (insights.length) {
    lines.push('## 从历史数据总结的习惯（规划时参考）');
    insights.forEach(i => lines.push(`- ${i.text}`));
  }
  return lines.join('\n');
}

