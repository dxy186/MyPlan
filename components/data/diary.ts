/**
 * 日记：和「复盘 → 今日记录」里的「今日日记 / 日记簿」是同一份数据（@myplan_diary，每天一篇）。
 * - 自己写的正文、心情、天气：在今日记录页里写
 * - AI 每日总结（晚上复盘后）→ summary；每周小结 → weekly（记在那周的周日）
 * - 跟 AI 说「记进日记：…」→ 追加到那天正文的末尾
 */
import { DiaryEntry, KEYS, loadJSON, randomId, saveJSON } from '@/app/utils/planning';

export const DIARY_CHANGED_EVENT = 'myplan:diary-changed';

type Legacy = { id?: string; date: string; text?: string; source?: string; at?: string };

/** 读日记，并把旧格式（一天多条的 text/source）合并成每天一篇 */
export async function loadDiaryDays(): Promise<DiaryEntry[]> {
  const loaded = await loadJSON<(DiaryEntry & Legacy)[]>(KEYS.diary, []);
  const raw = Array.isArray(loaded) ? loaded : [];
  const byDate = new Map<string, DiaryEntry>();
  let changed = false;
  const now = new Date().toISOString();
  for (const r of raw) {
    if (!r || !r.date) continue;
    let e = byDate.get(r.date);
    if (!e) {
      e = { id: r.id || randomId(), date: r.date, content: '', createdAt: r.createdAt || r.at || now, updatedAt: r.updatedAt || r.at || now };
      byDate.set(r.date, e);
    }
    if (r.text !== undefined && r.source !== undefined) {
      changed = true;
      const t = String(r.text).trim();
      if (r.source === 'daily') e.summary = t;
      else if (r.source === 'weekly') e.weekly = t;
      else e.content = e.content ? `${e.content}\n${t}` : t;
      continue;
    }
    if (r.content !== undefined && typeof r.content !== 'string') r.content = String(r.content);
    e.id = r.id || e.id;
    e.content = [e.content, r.content].filter(Boolean).join(e.content && r.content ? '\n' : '');
    if (r.mood) e.mood = String(r.mood);
    if (r.weather) e.weather = String(r.weather);
    if (r.summary) e.summary = r.summary;
    if (r.weekly) e.weekly = r.weekly;
    e.createdAt = r.createdAt || e.createdAt;
    e.updatedAt = r.updatedAt || e.updatedAt;
  }
  const list = [...byDate.values()];
  if (changed || list.length !== raw.length) await saveJSON(KEYS.diary, list);
  return list;
}

export async function saveDiaryDays(list: DiaryEntry[]) {
  await saveJSON(KEYS.diary, list);
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event(DIARY_CHANGED_EVENT));
}

async function patchDay(date: string, fn: (e: DiaryEntry) => void) {
  const list = await loadDiaryDays();
  const now = new Date().toISOString();
  let e = list.find(x => x.date === date);
  if (!e) {
    e = { id: randomId(), date, content: '', createdAt: now, updatedAt: now };
    list.push(e);
  }
  fn(e);
  e.updatedAt = now;
  await saveDiaryDays(list);
}

/** 跟 AI 说「记进日记」：追加到那天正文末尾 */
export async function appendDiaryText(date: string, text: string) {
  const t = text.trim();
  if (!t) return;
  await patchDay(date, e => {
    e.content = e.content ? `${e.content}\n${t}` : t;
  });
}
/** 晚上复盘后的 AI 每日总结（同一天再复盘会覆盖） */
export async function setDiarySummary(date: string, text: string) {
  await patchDay(date, e => {
    e.summary = text.trim();
  });
}
/** 每周小结 */
export async function setDiaryWeekly(date: string, text: string) {
  await patchDay(date, e => {
    e.weekly = text.trim();
  });
}
