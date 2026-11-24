/** 任务分类（标签）：每个任务可以有一个分类，分类列表可以自定义 */
import { loadJSON, saveJSON } from '@/app/utils/planning';

export const TAGS_KEY = '@myplan_task_tags';
export type TaskTag = { name: string; color: string };

export const TAG_PALETTE = ['#1976D2', '#F57C00', '#2E7D32', '#D81B60', '#7B1FA2', '#00897B', '#5D4037', '#C0CA33', '#546E7A', '#E53935'];

export const DEFAULT_TAGS: TaskTag[] = [
  { name: '学习', color: '#1976D2' },
  { name: '工作', color: '#F57C00' },
  { name: '生活', color: '#2E7D32' },
  { name: '健康', color: '#D81B60' },
];

export async function loadTags(): Promise<TaskTag[]> {
  return loadJSON<TaskTag[]>(TAGS_KEY, DEFAULT_TAGS);
}
export async function saveTags(tags: TaskTag[]) {
  await saveJSON(TAGS_KEY, tags);
}
export function tagColor(tags: TaskTag[], name?: string) {
  return tags.find(t => t.name === name)?.color ?? '#90A4AE';
}
