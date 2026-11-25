/**
 * ⭐ 重要事件：某天「发生」的事，而不是要「做」的事——生日、纪念日、考试日、出发、节日、面试…
 * 只在日历上标出来提醒你，不当任务、不勾完成、不占排程时间。可以每年重复（生日、纪念日）。
 */
import { loadJSON, randomId, saveJSON } from '@/app/utils/planning';

export const EVENTS_KEY = '@myplan_events';
export const EVENTS_CHANGED_EVENT = 'myplan:events-changed';
export type ImportantEvent = { id: string; date: string; title: string; yearly?: boolean; time?: string; note?: string; createdAt: string };

export async function loadEvents(): Promise<ImportantEvent[]> {
  const raw = await loadJSON<ImportantEvent[]>(EVENTS_KEY, []);
  return Array.isArray(raw) ? raw.filter(e => e && e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) : [];
}
export async function saveEvents(list: ImportantEvent[]) {
  await saveJSON(EVENTS_KEY, list);
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event(EVENTS_CHANGED_EVENT));
}
export async function addEvent(e: { date: string; title: string; yearly?: boolean; time?: string; note?: string }) {
  const list = await loadEvents();
  const ev: ImportantEvent = { id: randomId(), createdAt: new Date().toISOString(), ...e, title: e.title.trim() };
  await saveEvents([...list, ev]);
  return ev;
}
export async function deleteEvent(id: string) {
  await saveEvents((await loadEvents()).filter(e => e.id !== id));
}
export async function updateEvent(id: string, patch: Partial<ImportantEvent>) {
  await saveEvents((await loadEvents()).map(e => (e.id === id ? { ...e, ...patch } : e)));
}

/** 这一天有哪些事件（每年重复的按月-日匹配，只从设定那年起算） */
export function eventsOn(list: ImportantEvent[], date: string): ImportantEvent[] {
  return list
    .filter(e => e.date === date || (e.yearly && e.date.slice(5) === date.slice(5) && e.date <= date))
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
}

/** 生日 / 纪念日 这类默认每年重复 */
export function looksYearly(title: string) {
  return /生日|纪念日|周年|忌日/.test(title);
}

/** 第几年（生日、纪念日显示「第 N 年」用） */
export function yearsSince(e: ImportantEvent, date: string) {
  return Number(date.slice(0, 4)) - Number(e.date.slice(0, 4));
}
