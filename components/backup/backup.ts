/**
 * 数据备份：把所有 `@myplan_` 开头的本地数据导出成一个 JSON 文件，或从文件导入。
 *
 * - 节假日缓存（@holiday_cache_*）不导出，联网会自动重新获取。
 * - AI 配置（含 API Key）默认不导出，需要手动勾选。
 * - 导入前会把当前数据存一份快照，可在页面里「撤销上次导入」。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getMany, removeMany, setMany } from '@/components/storage-batch';

export const DATA_PREFIX = '@myplan_';
/** 内部用的键（双下划线），不参与导出 / 导入 */
const INTERNAL_PREFIX = '@myplan__';
export const UNDO_SNAPSHOT_KEY = '@myplan__undo_snapshot';
export const AI_CONFIG_KEY = '@myplan_ai_config';

export const BACKUP_APP_ID = 'MyPlan';
export const BACKUP_FORMAT_VERSION = 1;

export const KEY_LABELS: Record<string, string> = {
  '@myplan_tasks': 'SMART 任务',
  '@myplan_completed_tasks': '已完成任务',
  '@myplan_calendar': '日历标记',
  '@myplan_datebgcolor': '日期背景色',
  '@myplan_woops': 'WOOP 计划',
  '@myplan_ai_history': 'AI 对话记录',
  '@myplan_goals': '目标库',
  '@myplan_inbox': '任务池',
  '@myplan_energy_logs': '精力记录',
  '@myplan_time_logs': '时间记录',
  '@myplan_fixed_events': '固定日程（课程/会议）',
  '@myplan_chore_templates': '琐事标准时间',
  '@myplan_schedule': '最近一次排程',
  '@myplan_fragment_logs': '碎片时间记录',
  '@myplan_diary': '日记',
  '@myplan_assistant_history': 'AI 秘书对话',
  '@myplan_daily_plans': '每日计划',
  '@myplan_reviews': '每日复盘',
  '@myplan_reminder_settings': '提醒设置',
  '@myplan_memories': '记住的偏好',
  '@myplan_block_log': '排程执行记录',
  '@myplan_ai_config': 'AI 设置（含 API Key）',
};

export type BackupFile = {
  app: string;
  formatVersion: number;
  exportedAt: string;
  /** 键 → AsyncStorage 里存的原始字符串 */
  data: Record<string, string>;
};

export type KeySummary = { key: string; label: string; count: number };

export type UndoSnapshot = { savedAt: string; data: Record<string, string> };

function isDataKey(k: string) {
  return k.startsWith(DATA_PREFIX) && !k.startsWith(INTERNAL_PREFIX);
}

/** 读出当前所有业务数据 */
export async function readAllData(): Promise<Record<string, string>> {
  const keys = (await AsyncStorage.getAllKeys()).filter(isDataKey);
  const pairs = await getMany(keys);
  const out: Record<string, string> = {};
  for (const [k, v] of pairs) if (v != null) out[k] = v;
  return out;
}

/** 每个键里大概有多少条记录（数组按长度，对象按键数） */
export function summarize(data: Record<string, string>): KeySummary[] {
  return Object.keys(data)
    .sort((a, b) => (KEY_LABELS[a] ? 0 : 1) - (KEY_LABELS[b] ? 0 : 1) || a.localeCompare(b))
    .map((key) => {
      let count = 1;
      try {
        const v = JSON.parse(data[key]);
        if (Array.isArray(v)) count = v.length;
        else if (v && typeof v === 'object') count = Object.keys(v).length;
      } catch {}
      return { key, label: KEY_LABELS[key] || key.slice(DATA_PREFIX.length), count };
    });
}

export async function buildBackup(includeAiConfig: boolean): Promise<BackupFile> {
  const data = await readAllData();
  if (!includeAiConfig) delete data[AI_CONFIG_KEY];
  return {
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function backupFileName(d = new Date()) {
  return `MyPlan-备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/** 校验并解析备份文件文本，不合法时抛出带中文说明的错误 */
export function parseBackup(text: string): BackupFile {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('这不是有效的 JSON 文件');
  }
  if (!obj || obj.app !== BACKUP_APP_ID || typeof obj.data !== 'object' || obj.data === null) {
    throw new Error('这不是 MyPlan 导出的备份文件');
  }
  if (typeof obj.formatVersion !== 'number' || obj.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error('备份文件来自更新版本的 MyPlan，请先升级应用');
  }
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj.data)) {
    if (isDataKey(k) && typeof v === 'string') data[k] = v;
  }
  if (Object.keys(data).length === 0) throw new Error('备份文件里没有任何数据');
  return { app: obj.app, formatVersion: obj.formatVersion, exportedAt: String(obj.exportedAt || ''), data };
}

/**
 * 用备份覆盖当前数据。
 * 备份里没有 AI 设置时，保留当前的 AI 设置（不会把 Key 清掉）。
 */
export async function applyBackup(backup: BackupFile): Promise<void> {
  const current = await readAllData();
  const snapshot: UndoSnapshot = { savedAt: new Date().toISOString(), data: current };
  await AsyncStorage.setItem(UNDO_SNAPSHOT_KEY, JSON.stringify(snapshot));

  const keepAi = !(AI_CONFIG_KEY in backup.data);
  const toRemove = Object.keys(current).filter((k) => !(keepAi && k === AI_CONFIG_KEY));
  await removeMany(toRemove);
  await setMany(Object.entries(backup.data));
}

export async function readUndoSnapshot(): Promise<UndoSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(UNDO_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as UndoSnapshot) : null;
  } catch {
    return null;
  }
}

/** 恢复到最近一次导入之前的状态 */
export async function undoLastImport(): Promise<boolean> {
  const snap = await readUndoSnapshot();
  if (!snap) return false;
  const current = await readAllData();
  await removeMany(Object.keys(current));
  await setMany(Object.entries(snap.data));
  await AsyncStorage.removeItem(UNDO_SNAPSHOT_KEY);
  return true;
}

// ---------------- 仅网页 / 桌面版：下载与选择文件 ----------------

export function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 弹出系统选择文件窗口，返回文件文本；用户取消时返回 null */
export function pickTextFile(accept = '.json,application/json'): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    input.onchange = () => {
      settled = true;
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return resolve(null);
      file.text().then(resolve, reject);
    };
    input.addEventListener('cancel', () => {
      if (!settled) {
        settled = true;
        input.remove();
        resolve(null);
      }
    });
    // 旧浏览器没有 cancel 事件：窗口重新获得焦点后仍没选文件，视为取消
    window.addEventListener(
      'focus',
      () => setTimeout(() => {
        if (!settled) {
          input.remove();
          resolve(null);
        }
      }, 500),
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}
