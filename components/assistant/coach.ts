/**
 * AI 教练的一两句话：每晚复盘后的「今日回顾」、每周小结的点评。
 * 没配 AI Key 时返回 null，界面上只显示数字。
 */
import { callChat, getAiConfig } from '@/app/utils/ai';
import { minutesToHM, todayStr } from '@/app/utils/planning';

import type { WeeklySummary } from '@/components/data/weekly';

const STYLE = '你是用户的私人效率教练，说话温暖、具体、不说空话。用中文，不用 markdown，不要列表。';

async function ask(prompt: string): Promise<string | null> {
  try {
    const cfg = await getAiConfig();
    if (!cfg.apiKey) return null;
    const r = await callChat(
      [
        { role: 'system', content: STYLE },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.7, maxTokens: 300 }
    );
    return String(r).trim() || null;
  } catch {
    return null;
  }
}

export async function dailyComment(input: {
  done: string[];
  notDone: { title: string; reason?: string }[];
  focusMin: number;
  streak: number;
}): Promise<string | null> {
  const lines = [
    `今天（${todayStr()}）`,
    `完成：${input.done.length ? input.done.join('、') : '无'}`,
    `没完成：${input.notDone.length ? input.notDone.map(x => x.title + (x.reason ? `（${x.reason}）` : '')).join('、') : '无'}`,
    `今天计时专注：${input.focusMin} 分钟`,
    `已连续打卡：${input.streak} 天`,
  ];
  return ask(`${lines.join('\n')}\n\n请用 1–2 句话点评今天：先具体肯定一件做到的事，再给明天一个很小、很具体的建议。`);
}

export async function weeklyComment(w: WeeklySummary, streak: number): Promise<string | null> {
  const lines = [
    `本周（${w.weekStart} 到 ${w.weekEnd}）`,
    `完成任务：${w.done} 个，专注 ${Math.round(w.focusMin / 60)} 小时 ${w.focusMin % 60} 分，有记录的天数 ${w.activeDays}/7`,
    w.bestDay ? `最好的一天：${w.bestDay.date}（完成 ${w.bestDay.done} 个，专注 ${w.bestDay.focusMin} 分钟）` : '',
    `到周末还没完成的过期任务：${w.overdue} 个`,
    `下周截止：${w.nextWeek.length ? w.nextWeek.join('、') : '暂无'}`,
    `连续打卡：${streak} 天`,
  ].filter(Boolean);
  return ask(
    `${lines.join('\n')}\n\n请用 2–3 句话写本周小结：肯定一个进步，指出一个可以改进的地方，再给出下周最该先做的 1–2 件事。现在是 ${minutesToHM(new Date().getHours() * 60 + new Date().getMinutes())}。`
  );
}
