/**
 * 📔 日记：自己写的、AI 每晚的复盘总结、每周小结、跟 AI 说「记进日记」的话，都放在这里。
 */
import { loadJSON, randomId, saveJSON, todayStr } from '@/app/utils/planning';

export const DIARY_KEY = '@myplan_diary';
export type DiarySource = 'me' | 'daily' | 'weekly' | 'ai';
export type DiaryEntry = { id: string; date: string; at: string; text: string; source: DiarySource; key?: string };

export const SOURCE_LABEL: Record<DiarySource, string> = {
  me: '✍️ 我写的',
  daily: '🌙 每日总结',
  weekly: '📅 每周小结',
  ai: '🤖 让 AI 记的',
};
export const DIARY_CHANGED_EVENT = 'myplan:diary-changed';

export async function loadDiary(): Promise<DiaryEntry[]> {
  return loadJSON<DiaryEntry[]>(DIARY_KEY, []);
}
async function save(list: DiaryEntry[]) {
  await saveJSON(DIARY_KEY, list);
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event(DIARY_CHANGED_EVENT));
}

/** 写一条日记。带 key 的（比如某天的每日总结）同一个 key 只保留最新一条，不会重复 */
export async function addDiary(text: string, source: DiarySource, date = todayStr(), key?: string) {
  const t = text.trim();
  if (!t) return;
  const list = await loadDiary();
  const entry: DiaryEntry = { id: randomId(), date, at: new Date().toISOString(), text: t, source, key };
  const next = key ? list.filter(e => e.key !== key) : list;
  await save([...next, entry]);
}
export async function updateDiary(id: string, text: string) {
  const list = await loadDiary();
  await save(list.map(e => (e.id === id ? { ...e, text } : e)));
}
export async function deleteDiary(id: string) {
  const list = await loadDiary();
  await save(list.filter(e => e.id !== id));
}
