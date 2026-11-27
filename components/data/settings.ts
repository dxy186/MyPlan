/**
 * 作息与排程设置：保存在本地，全应用共用（今天页、AI、日历、提醒都按这一份来排）。
 */
import { KEYS, loadJSON, saveJSON } from '@/app/utils/planning';
import { DEFAULT_SCHEDULE_OPTIONS, ScheduleOptions } from '@/app/utils/scheduler';

export type ScheduleSettings = {
  dayStartMin: number;
  dayEndMin: number;
  /** 每天留给「玩」的分钟数（排在一天最后），0 = 不留 */
  playMinPerDay: number;
  /** 每周不排任务的一天（0 = 周日 … 6 = 周六），null = 不设 */
  restDayWeekday: number | null;
  maxFocusMin: number;
  minFocusMin: number;
  breakMin: number;
  /** 往后排几天 */
  days: number;
  /** 手动设的速率系数（实际 ≈ 预估 × 它）；不设 = 按时间记录自动算 */
  speedOverride?: number;
};

export const DEFAULT_SETTINGS: ScheduleSettings = {
  dayStartMin: DEFAULT_SCHEDULE_OPTIONS.dayStartMin,
  dayEndMin: DEFAULT_SCHEDULE_OPTIONS.dayEndMin,
  playMinPerDay: DEFAULT_SCHEDULE_OPTIONS.playMinPerDay,
  restDayWeekday: DEFAULT_SCHEDULE_OPTIONS.restDayWeekday ?? null,
  maxFocusMin: DEFAULT_SCHEDULE_OPTIONS.maxFocusMin,
  minFocusMin: DEFAULT_SCHEDULE_OPTIONS.minFocusMin,
  breakMin: DEFAULT_SCHEDULE_OPTIONS.breakMin,
  days: 14,
};

export async function loadScheduleSettings(): Promise<ScheduleSettings> {
  const saved = await loadJSON<Partial<ScheduleSettings>>(KEYS.scheduleSettings, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveScheduleSettings(s: ScheduleSettings): Promise<void> {
  await saveJSON(KEYS.scheduleSettings, s);
}

export function toScheduleOptions(s: ScheduleSettings): Omit<ScheduleOptions, 'startDate' | 'speedFactor'> {
  return {
    ...DEFAULT_SCHEDULE_OPTIONS,
    dayStartMin: s.dayStartMin,
    dayEndMin: s.dayEndMin,
    playMinPerDay: s.playMinPerDay,
    restDayWeekday: s.restDayWeekday === null ? undefined : s.restDayWeekday,
    maxFocusMin: s.maxFocusMin,
    minFocusMin: Math.min(s.minFocusMin, s.maxFocusMin),
    breakMin: s.breakMin,
    days: s.days,
  };
}
