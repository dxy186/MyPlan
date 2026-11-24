/**
 * 🧩 帮我拆：让 AI 把一个不知道怎么下手的任务拆成几个小步骤，
 * 按你的真实速度估时，并在截止前把每一步分到合适的日子。
 *
 * 流程：requestBreakdown → （信息不够时先问 1–2 个问题）→ 预览可编辑 → applyBreakdown 替换原任务
 */
import { callChatJSON } from '@/app/utils/ai';
import { EnergyCost, KEYS, PlanTask, addDays, diffDays, loadJSON, minutesToHM, randomId, speedFactor, todayStr, weekdayOf } from '@/app/utils/planning';
import { ScheduleResult } from '@/app/utils/scheduler';

import { loadReviews, reasonSummary } from './followup';
import { buildInsights, categoryFactors, categoryOf, habitsForAi, loadBlockLog } from './habits';
import { PlanState, allTasks, commitState, loadPlanState, spentByTask, splitTaskInGoals } from './plan-store';

export const BREAKDOWN_EVENT = 'myplan:breakdown';
export const DATA_CHANGED_EVENT = 'myplan:data-changed';

/** 从任何页面打开「帮我拆」弹窗 */
export function openBreakdown(taskId: string) {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(BREAKDOWN_EVENT, { detail: { taskId } }));
  }
}

export function notifyDataChanged() {
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

export type BreakdownStep = { title: string; estimateMin: number; energyCost: EnergyCost; date: string; note?: string };
export type BreakdownResult = { questions?: string[]; steps?: BreakdownStep[]; summary?: string };

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const COSTS: EnergyCost[] = ['high', 'medium', 'low'];

/** 从今天到截止日，每天大概还空多少分钟（扣掉固定日程、玩的时间和已经排了的其他任务） */
export function freeMinutesByDay(state: PlanState, schedule: ScheduleResult | null, excludeTaskId: string, until: string) {
  const today = todayStr();
  const s = state.settings;
  const out: { date: string; free: number; note: string }[] = [];
  const last = diffDays(today, until) < 0 ? today : until;
  for (let d = today; diffDays(d, last) >= 0 && out.length < 21; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (s.restDayWeekday !== null && s.restDayWeekday === wd) {
      out.push({ date: d, free: 0, note: '休息日' });
      continue;
    }
    let total = s.dayEndMin - s.dayStartMin - s.playMinPerDay;
    if (d === today) {
      const now = new Date();
      total = Math.min(total, Math.max(0, s.dayEndMin - s.playMinPerDay - (now.getHours() * 60 + now.getMinutes())));
    }
    const fixed = state.fixed
      .filter(e => (e.date ? e.date === d : e.weekday === wd))
      .reduce((k, e) => k + (e.endMin - e.startMin), 0);
    const busy = (schedule?.items ?? [])
      .filter(i => i.date === d && i.type === 'task' && i.taskId !== excludeTaskId)
      .reduce((k, i) => k + (i.endMin - i.startMin), 0);
    out.push({ date: d, free: Math.max(0, total - fixed - busy), note: '' });
  }
  return out;
}

const PROMPT = `你是用户的学习 / 工作教练，擅长把模糊的大任务拆成马上能动手的小步骤。

只输出一个 JSON 对象，二选一：
1) 信息明显不够、拆出来会很空泛时（比如不知道报告要写多少字、考试考什么范围），先问：
   {"questions": ["最关键的问题1", "问题2"]}   —— 最多 2 个，用户已经回答过就不要再问
2) 否则直接给方案：
   {
     "summary": "2-3 句中文：拆分思路、为什么这样分配时间，以及按用户习惯做了什么调整",
     "steps": [
       {"title": "动词开头、具体到能直接开始的步骤", "estimateMin": 分钟, "energyCost": "high|medium|low", "date": "YYYY-MM-DD", "note": "可选：怎么做 / 做到什么程度算完"}
     ]
   }

拆分规则：
- 3–6 步，按先后顺序排列；第 1 步必须很小（≤15 分钟）、零门槛，比如「打开文档，写下标题和 3 个关键词」，帮用户克服拖延。
- 每步 15–120 分钟；超过 120 分钟的再拆。
- 估时要按用户的真实速度：参考「速率系数」和各类任务的速率，宁可多估一点；总时长要现实。
- 要动脑的（写作、编程、难题）标 high，一般学习 / 整理标 medium，机械性的标 low。
- date：这一步大概哪天做（参考「可用日期」，空闲为 0 的日子不要放）。实际排程只看先后顺序和截止日：时间够的话一天会连着做好几步，所以不用刻意一天一步；第一步的 date 是整组最早开始的日子（一般就是今天）。最后一步最好比截止早一天留缓冲（截止就是今天的除外）。
- 必须遵守用户亲口说过的偏好。`;

function describeTask(task: PlanTask, goalTitle: string, spent: number) {
  return [
    `任务：${task.title}`,
    goalTitle && goalTitle !== '日常安排' ? `所属目标：${goalTitle}` : '',
    task.intention ? `执行意向：如果「${task.intention.triggerIf}」，那么「${task.intention.actionThen}」` : '',
    task.due ? `截止：${task.due}（周${WEEK[weekdayOf(task.due)]}）` : '截止：没有设置（请在 7 天内安排）',
    `用户原来预估：${task.estimateMin} 分钟${spent ? `，已经做了 ${spent} 分钟` : ''}`,
    task.note ? `备注：${task.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function requestBreakdown(taskId: string, answers?: { q: string; a: string }[]): Promise<BreakdownResult> {
  const state = await loadPlanState();
  const ref = allTasks(state.goals).find(r => r.task.id === taskId);
  if (!ref) throw new Error('找不到这个任务，可能已经被删除了');
  const schedule = await loadJSON<ScheduleResult | null>(KEYS.schedule, null);
  const today = todayStr();
  const until = ref.task.due && diffDays(today, ref.task.due) >= 0 ? ref.task.due : addDays(today, 6);
  const free = freeMinutesByDay(state, schedule, taskId, until);
  const sf = speedFactor(state.timeLogs, allTasks(state.goals).map(r => r.task));
  const cat = categoryOf(ref.task.title);
  const catStat = categoryFactors(state.timeLogs, state.goals).find(c => c.category === cat);
  const insights = buildInsights(state.timeLogs, state.goals, await loadBlockLog(), reasonSummary(await loadReviews()));
  const spent = spentByTask(state.timeLogs).get(taskId) ?? 0;

  const ctx = [
    `今天：${today}（周${WEEK[weekdayOf(today)]}），现在 ${minutesToHM(new Date().getHours() * 60 + new Date().getMinutes())}`,
    describeTask(ref.task, ref.goal.title, spent),
    ...(ref.goal.woop
      ? [
          '',
          '## 用户为这个目标写的 WOOP（拆分时必须用上）',
          `愿望 Wish：${ref.goal.woop.wish}`,
          `最好的结果 Outcome：${ref.goal.woop.outcome || '（没写）'}`,
          `最大的障碍 Obstacle：${ref.goal.woop.obstacle || '（没写）'}`,
          `应对计划 Plan：${ref.goal.woop.plan || '（没写）'}`,
          '用法：① 步骤要朝着 Outcome 走，最后一步要让用户能真正用上（比如能在生活里试一次）；② 针对 Obstacle 设计步骤——比如障碍是没时间就把每步切小、能塞进零碎空档，障碍是被别的兴趣拖走就让第一步特别容易开始；③ 把 Plan 的「如果…就…」写进相关步骤的 note 里提醒用户；④ summary 里用一句话说明你是怎么根据他的 WOOP 安排的。',
        ]
      : []),
    '',
    `## 可用日期（${today} 到 ${until}）每天大概还空多少分钟`,
    ...free.map(f => `${f.date} 周${WEEK[weekdayOf(f.date)]}：${f.free} 分钟${f.note ? `（${f.note}）` : ''}`),
    '',
    `## 用户的速度`,
    `整体速率系数：${sf}（实际耗时 ≈ 预估 × ${sf}）`,
    catStat ? `「${cat}」类任务：实际约是预估的 ${catStat.factor} 倍（${catStat.samples} 个样本）` : `「${cat}」类任务：样本还不够`,
    habitsForAi(insights, state.memories ?? []),
  ].join('\n');

  const messages = [
    { role: 'system' as const, content: PROMPT },
    { role: 'user' as const, content: ctx },
  ];
  if (answers && answers.length) {
    messages.push({
      role: 'user',
      content: `我的回答：\n${answers.map(x => `问：${x.q}\n答：${x.a || '（不确定 / 跳过）'}`).join('\n')}\n请直接给出拆分方案，不要再提问。`,
    });
  }
  const raw = await callChatJSON<BreakdownResult>(messages);
  if (raw.questions && raw.questions.length && !(answers && answers.length)) {
    return { questions: raw.questions.slice(0, 2).map(String) };
  }
  const steps = (raw.steps ?? [])
    .filter(s => s && String(s.title || '').trim())
    .map(s => ({
      title: String(s.title).trim(),
      estimateMin: Math.max(5, Math.min(240, Math.round(Number(s.estimateMin) || 30))),
      energyCost: COSTS.includes(s.energyCost) ? s.energyCost : 'medium',
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) && diffDays(today, String(s.date)) >= 0 ? String(s.date) : today,
      note: s.note ? String(s.note) : undefined,
    }));
  if (steps.length === 0) throw new Error('AI 没给出步骤，请再试一次');
  // 步骤有先后：后一步的日期不能早于前一步
  for (let i = 1; i < steps.length; i++) if (steps[i].date < steps[i - 1].date) steps[i].date = steps[i - 1].date;
  return { steps, summary: raw.summary ? String(raw.summary) : undefined };
}

/**
 * 把原任务拆开：原任务留在任务列表里当「父任务」（不再单独排程，完成状态跟随子任务），
 * 拆出来的步骤作为子任务紧跟在它下面。步骤按顺序依赖，每一步固定在它被分到的那天做。
 */
export async function applyBreakdown(taskId: string, steps: BreakdownStep[]): Promise<PlanState> {
  const state = await loadPlanState();
  splitTaskInGoals(state.goals, taskId, steps);
  await commitState(state);
  notifyDataChanged();
  return state;
}
