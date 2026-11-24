/**
 * 完成任务时随机弹出的鼓励图片：用户自己上传，只存在这台电脑上（不会上传到任何地方）。
 * 存之前压到长边 480px，几十 KB 一张，放几十张也没问题；数据备份会一起导出。
 */
import { loadJSON, saveJSON } from '@/app/utils/planning';

export const CHEER_KEY = '@myplan_cheer_images';
export const MAX_CHEER = 40;
export type CheerImage = { id: string; dataUrl: string };

export async function loadCheerImages(): Promise<CheerImage[]> {
  return loadJSON<CheerImage[]>(CHEER_KEY, []);
}
export async function saveCheerImages(list: CheerImage[]) {
  await saveJSON(CHEER_KEY, list.slice(0, MAX_CHEER));
}

let last = '';
/** 随机挑一张，尽量不和上一次重复 */
export async function randomCheerImage(): Promise<string | null> {
  const list = await loadCheerImages();
  if (list.length === 0) return null;
  const pool = list.length > 1 ? list.filter(x => x.id !== last) : list;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  last = pick.id;
  return pick.dataUrl;
}
