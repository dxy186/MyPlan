/**
 * AI 教练的一两句话：每晚复盘后的「今日回顾」、每周小结的点评。
 * 没配 AI Key 时返回 null，界面上只显示数字。
 */
import { callChat, getAiConfig } from '@/app/utils/ai';
import { loadJSON, minutesToHM, saveJSON, todayStr } from '@/app/utils/planning';

import type { WeeklySummary } from '@/components/data/weekly';

// ---------- 点评的语气（人设）----------
export const PERSONA_KEY = '@myplan_coach_persona';
export type PersonaId = 'coach' | 'elysia' | 'custom';
export type PersonaSetting = { id: PersonaId; custom?: string; customName?: string };

const BASE_RULES = '用中文，不用 markdown，不要列表。数字和事实必须和给你的数据一致，不要编造。建议要具体、小、明天就能做。';

/**
 * 内置人设只描述说话风格，用我们自己的话写成，
 * 不包含、也不要求模型复述任何游戏原台词。
 */
export const PERSONAS: Record<Exclude<PersonaId, 'custom'>, { name: string; icon: string; desc: string; prompt: string }> = {
  coach: {
    name: '效率教练',
    icon: '💬',
    desc: '温暖、具体、不说空话',
    prompt: '你是用户的私人效率教练，说话温暖、具体、不说空话。',
  },
  elysia: {
    name: '爱莉希雅风',
    icon: '🌸',
    desc: '甜美俏皮、话有点多、爱反问和自夸可爱；先具体夸你，没做完的事温柔地说「不用太在意」，最后约好明天的小目标',
    prompt: [
      '请用《崩坏3》角色爱莉希雅的说话风格来写。句子必须是你自己原创的：不要引用、拼接或改写游戏里的任何原台词和经典语句。',
      '【语气】甜美、元气、轻快，像在和很亲近的朋友聊天；句尾常带「呀」「呢」「噢」「嘛」，偶尔用「～♪」收尾（全段最多两次）。',
      '【说话习惯】',
      '- 爱用反问和小小的设问把对方拉进对话，比如问对方是不是也这么觉得、猜不猜得到；',
      '- 对自己的可爱、漂亮很有自信，会顺带自夸一句或把对方的好表现和「可爱的女孩子」联系起来，但点到为止；',
      '- 话有点多、也承认自己话多，并且表现出是认真为对方准备了这些话；',
      '- 偶尔用第三人称自称「爱莉希雅」，比如以她的名义给一条贴心的小提示；',
      '- 喜欢用花朵、星星、阳光、粉色这类浪漫意象，把小事说得闪闪发光。',
      '【对待对方】',
      '- 真心欣赏对方，先具体地夸做到的事（要提到真实的数字或任务名）；',
      '- 没做完的事绝不批评，而是安慰「不用太在意」，提醒保持从容优雅、别被焦虑追着跑，再把明天的建议说成一个轻松的小约定；',
      '- 让对方感到被陪伴：她再忙也会给对方留时间，期待下次再见。',
      '【分寸】亲昵但不暧昧，不说恋爱、表白之类的话；不提游戏剧情。',
      '每周小结的最后一句可以是一句诗意的祝福（用你自己的话，比如祝下周的路上有花有光）。',
    ].join('\n'),
  },
};

export async function loadPersona(): Promise<PersonaSetting> {
  return loadJSON<PersonaSetting>(PERSONA_KEY, { id: 'coach' });
}
export async function savePersona(p: PersonaSetting) {
  await saveJSON(PERSONA_KEY, p);
}

/** 点评前面显示的称呼，比如「🌸 爱莉希雅」 */
export function personaLabel(p: PersonaSetting) {
  if (p.id === 'custom') return `💬 ${p.customName?.trim() || '自定义'}`;
  return p.id === 'elysia' ? '🌸 爱莉希雅' : '💬 今日点评';
}

function personaPrompt(p: PersonaSetting) {
  const body = p.id === 'custom' && p.custom?.trim() ? p.custom.trim() : PERSONAS[p.id === 'custom' ? 'coach' : p.id].prompt;
  return `${body}\n${BASE_RULES}`;
}

async function ask(prompt: string, persona?: PersonaSetting): Promise<string | null> {
  try {
    const cfg = await getAiConfig();
    if (!cfg.apiKey) return null;
    const p = persona ?? (await loadPersona());
    const r = await callChat(
      [
        { role: 'system', content: personaPrompt(p) },
        { role: 'user', content: prompt },
      ],
      { temperature: p.id === 'coach' ? 0.7 : 0.9, maxTokens: 300 }
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

/** 设置页「试一句」：用假数据让当前人设说一句，看看语气 */
export async function samplePersona(p: PersonaSetting): Promise<string | null> {
  return ask(
    '今天完成：背单词、写实验报告第一部分。没完成：整理笔记（太累了）。今天计时专注 95 分钟，已连续打卡 4 天。\n\n请用 1–2 句话点评今天：先具体肯定一件做到的事，再给明天一个很小、很具体的建议。',
    p
  );
}
