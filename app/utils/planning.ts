/**
 * MyPlan · AI 科学计划秘书 —— 领域类型 / 存储层 / 时间与精力算法
 *
 * 本文件只做「纯逻辑 + 本地持久化」，不依赖任何 UI 或第三方库，
 * 复用于 inbox / decompose / energy / schedule / timelog 等页面。
 * 对应软件方案四层架构中的「数据存储层 + 核心算法层」。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// 一、存储键（全部沿用 @myplan_ 前缀；旧键保持不变，保证原有数据不丢）
// ---------------------------------------------------------------------------
export const KEYS = {
  // —— 原有键（不要更改，历史数据靠它）——
  tasks: '@myplan_tasks',
  calendar: '@myplan_calendar',
  completed: '@myplan_completed_tasks',
  woops: '@myplan_woops',
  aiHistory: '@myplan_ai_history',
  dateBgColor: '@myplan_datebgcolor',
  // —— 新增键（新框架）——
  goals: '@myplan_goals', // 目标库（Goal → Milestone → PlanTask）
  inbox: '@myplan_inbox', // 任务池（Canvas / 手动导入）
  energyLogs: '@myplan_energy_logs', // 精力日志
  timeLogs: '@myplan_time_logs', // 时间记录
  fixedEvents: '@myplan_fixed_events', // 硬约束（课程/会议/已购票活动）
  choreTemplates: '@myplan_chore_templates', // 生活琐事标准时间库
  schedule: '@myplan_schedule', // 最近一次生成的排程
  fragmentLogs: '@myplan_fragment_logs', // 碎片时间日志
  aiConfig: '@myplan_ai_config', // AI Key 等配置（不硬编码）
  diary: '@myplan_diary', // 日记（每天一条，可翻看历史）
} as const;

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJSON<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 与现有页面一致：静默失败，不打断用户操作
  }
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString().slice(-5);
}

// ---------------------------------------------------------------------------
// 二、时间工具
// ---------------------------------------------------------------------------

/** 今天，YYYY-MM-DD */
export function todayStr(): string {
  return toDateStr(new Date());
}

export function toDateStr(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateStr.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function normalizeDate(dateStr: string): string {
  const d = parseDate(dateStr);
  return d ? toDateStr(d) : dateStr.trim();
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr) ?? new Date();
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** b - a，单位天（按本地零点计算） */
export function diffDays(a: string, b: string): number {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/** 0=周日 … 6=周六 */
export function weekdayOf(dateStr: string): number {
  const d = parseDate(dateStr);
  return d ? d.getDay() : 0;
}

export function minutesToHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hmToMinutes(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 中文自然语言里的相对日期（今天/明天/后天/下周三/12月20日） */
export function parseChineseDate(text: string, from = todayStr()): string | undefined {
  const t = text || '';
  if (/今天/.test(t)) return from;
  if (/明天/.test(t)) return addDays(from, 1);
  if (/后天/.test(t)) return addDays(from, 2);
  if (/大后天/.test(t)) return addDays(from, 3);
  const weekMap: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const wk = /(下{0,1})周([一二三四五六日天])/.exec(t);
  if (wk) {
    const target = weekMap[wk[2]];
    const base = parseDate(from) ?? new Date();
    let delta = (target - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    if (wk[1] === '下') delta += 7;
    return addDays(from, delta);
  }
  const md = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(t);
  if (md) {
    const d = parseDate(from) ?? new Date();
    return toDateStr(new Date(d.getFullYear(), Number(md[1]) - 1, Number(md[2])));
  }
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) return normalizeDate(iso[0]);
  const slash = /(\d{1,2})\/(\d{1,2})/.exec(t);
  if (slash) {
    const d = parseDate(from) ?? new Date();
    return toDateStr(new Date(d.getFullYear(), Number(slash[1]) - 1, Number(slash[2])));
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 三、精力模型（四层金字塔 + 5 维度加权）
// ---------------------------------------------------------------------------

/** 超日节律时段划分（代表小时用于排程） */
export const ENERGY_SLOTS = [
  { key: 'dawn', label: '清晨 06-08', hour: 7 },
  { key: 'morning', label: '上午 08-11', hour: 9 },
  { key: 'noon', label: '中午 11-13', hour: 12 },
  { key: 'afternoon', label: '下午 13-17', hour: 15 },
  { key: 'evening', label: '傍晚 17-19', hour: 18 },
  { key: 'night', label: '晚上 19-23', hour: 21 },
  { key: 'late', label: '深夜 23-06', hour: 1 },
] as const;

export type EnergySlotKey = (typeof ENERGY_SLOTS)[number]['key'];

export type EnergyLog = {
  id: string;
  date: string; // YYYY-MM-DD
  slot: EnergySlotKey; // 本次打卡所处时段
  sleepHours?: number;
  sleepQuality: number; // 睡眠质量 1-10
  physical: number; // 生理精力 1-10
  emotional: number; // 情绪精力 1-10
  cognitive: number; // 认知精力 1-10
  meaning: number; // 意义精力 1-10
  score: number; // 5 维度加权总分 0-10
  note?: string;
  createdAt: string;
};

/** PlanClaw 式 5 维度加权：睡眠 + 生理 + 情绪 + 认知 + 意义 */
export const ENERGY_WEIGHTS = {
  sleep: 0.2,
  physical: 0.22,
  emotional: 0.18,
  cognitive: 0.25,
  meaning: 0.15,
} as const;

export function computeEnergyScore(input: {
  sleepHours?: number;
  sleepQuality: number;
  physical: number;
  emotional: number;
  cognitive: number;
  meaning: number;
}): number {
  const sleep = input.sleepQuality > 0 ? input.sleepQuality : 6;
  const raw =
    sleep * ENERGY_WEIGHTS.sleep +
    input.physical * ENERGY_WEIGHTS.physical +
    input.emotional * ENERGY_WEIGHTS.emotional +
    input.cognitive * ENERGY_WEIGHTS.cognitive +
    input.meaning * ENERGY_WEIGHTS.meaning;
  return Math.round(raw * 10) / 10;
}

const DEFAULT_SLOT_SCORE = 6;

/** 用历史日志预测某天的精力曲线（移动平均，回退到默认值） */
export function predictCurve(
  logs: EnergyLog[],
  date: string,
  fallback = DEFAULT_SLOT_SCORE
): Record<EnergySlotKey, number> {
  const wd = weekdayOf(date);
  const isWeekend = wd === 0 || wd === 6;
  const curve = {} as Record<EnergySlotKey, number>;
  for (const slot of ENERGY_SLOTS) {
    const sameSlot = logs.filter(l => l.slot === slot.key);
    const sameKind = sameSlot.filter(l => {
      const w = weekdayOf(l.date);
      return (w === 0 || w === 6) === isWeekend;
    });
    const pool = sameKind.length >= 2 ? sameKind : sameSlot;
    if (pool.length === 0) {
      curve[slot.key] = fallback;
    } else {
      curve[slot.key] = Math.round((pool.reduce((s, l) => s + l.score, 0) / pool.length) * 10) / 10;
    }
  }
  return curve;
}

export function goldenSlots(curve: Record<EnergySlotKey, number>): EnergySlotKey[] {
  return ENERGY_SLOTS.map(s => ({ key: s.key, v: curve[s.key] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 2)
    .map(e => e.key);
}

export function lowSlots(curve: Record<EnergySlotKey, number>): EnergySlotKey[] {
  return ENERGY_SLOTS.map(s => ({ key: s.key, v: curve[s.key] }))
    .sort((a, b) => a.v - b.v)
    .slice(0, 2)
    .map(e => e.key);
}

export function slotLabel(key: EnergySlotKey): string {
  return ENERGY_SLOTS.find(s => s.key === key)?.label ?? key;
}

/** 把一天中的小时（0-23）映射到超日节律时段 */
export function slotForHour(hour: number): EnergySlotKey {
  if (hour >= 6 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 13) return 'noon';
  if (hour >= 13 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 19) return 'evening';
  if (hour >= 19 && hour < 23) return 'night';
  return 'late'; // 23:00-06:00
}

/** 当前所处的精力时段，用于精力打卡的默认值 */
export function currentSlotKey(d: Date = new Date()): EnergySlotKey {
  return slotForHour(d.getHours());
}

/** 把精力分数映射成 高/中/低 等级，用于排程匹配 */
export function energyLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 7) return 'high';
  if (score >= 4.5) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// 三·二、日记模型（每天一条，可翻看历史；与当天精力值一起供 AI 分析）
// ---------------------------------------------------------------------------

export type DiaryEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  content: string; // 正文
  mood?: string; // 心情（emoji 标签）
  weather?: string; // 天气
  createdAt: string;
  updatedAt: string;
};

/** 按日期汇总当天精力：平均分 / 打卡次数 / 明细（新→旧） */
export function energyForDate(
  logs: EnergyLog[],
  date: string
): { avg: number | null; count: number; logs: EnergyLog[] } {
  const list = logs
    .filter(l => l.date === date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (list.length === 0) return { avg: null, count: 0, logs: [] };
  const avg = Math.round((list.reduce((s, l) => s + l.score, 0) / list.length) * 10) / 10;
  return { avg, count: list.length, logs: list };
}

// ---------------------------------------------------------------------------
// 四、目标 / 任务领域模型（Goal → Milestone → PlanTask）
// ---------------------------------------------------------------------------

export type EnergyCost = 'high' | 'medium' | 'low';
export type QualityTier = 'gold' | 'silver' | 'bronze';

export type ImplementationIntention = {
  triggerIf: string; // 如果[障碍]
  actionThen: string; // 那么我就[行动]
};

export type PlanTask = {
  id: string;
  title: string;
  estimateMin: number; // 预估耗时（分钟）
  energyCost: EnergyCost; // 耗能等级
  due?: string; // 截止日期
  deps: string[]; // 前置依赖（PlanTask.id）
  done: boolean; // 是否完成
  quality?: QualityTier; // 质量弹性等级
  intention?: ImplementationIntention;
  createdAt: string;
};

export type Milestone = {
  id: string;
  title: string;
  outcome?: string; // 预期成果
  basis?: string; // 拆解依据
  tasks: PlanTask[];
};

export type Goal = {
  id: string;
  title: string;
  specific: string;
  measurable: string;
  achievable: string;
  relevant: string;
  due: string;
  feasibility: number; // TELOS 可行性 0-100
  difficulty: 1 | 2 | 3 | 4; // 难度星级
  strategy: string; // 拆解策略
  woop?: { wish: string; outcome: string; obstacle: string; plan: string };
  milestones: Milestone[];
  createdAt: string;
};

/** 拆解策略（资源理性模型） */
export const DECOMPOSE_STRATEGIES = ['时间递进型', '功能分解型', '里程碑型', '混合型'] as const;

/**
 * MECE 检查：里程碑名称重复 + 每个里程碑任务数是否落在 3-7 +
 * 是否为空。返回问题列表，空数组代表通过。
 */
export function checkMECE(milestones: Milestone[]): string[] {
  const issues: string[] = [];
  if (milestones.length === 0) {
    issues.push('还没有里程碑，至少拆出 3-5 个。');
    return issues;
  }
  if (milestones.length < 3) issues.push(`里程碑只有 ${milestones.length} 个，建议 3-5 个（完全穷尽）。`);
  const seen = new Set<string>();
  milestones.forEach(m => {
    const key = m.title.trim();
    if (seen.has(key)) issues.push(`里程碑「${key}」重复，存在交叠（应相互独立）。`);
    seen.add(key);
    if (m.tasks.length < 3) issues.push(`「${key}」只有 ${m.tasks.length} 个任务，建议 3-7 个。`);
    if (m.tasks.length > 7) issues.push(`「${key}」有 ${m.tasks.length} 个任务，过细，建议合并到 3-7 个。`);
  });
  return issues;
}

const PHYSICAL_VERBS = [
  '打开', '写', '列出', '整理', '复制', '粘贴', '查找', '阅读', '做', '画', '算',
  '跑', '打印', '提交', '下载', '安装', '标注', '归纳', '复习', '背', '练',
];

/** 是否是「物理动作」（降低启动摩擦）；心理活动（如“思考/决定”）会被标记 false */
export function isPhysicalAction(title: string): boolean {
  return PHYSICAL_VERBS.some(v => title.includes(v));
}

/** 默认生活琐事标准时间库（时间块法） */
export const DEFAULT_CHORES: { title: string; minutes: number }[] = [
  { title: '洗漱', minutes: 15 },
  { title: '吃早饭', minutes: 20 },
  { title: '吃午饭', minutes: 30 },
  { title: '吃晚饭', minutes: 30 },
  { title: '通勤（单程）', minutes: 30 },
  { title: '午休', minutes: 30 },
  { title: '洗澡', minutes: 20 },
  { title: '整理房间', minutes: 20 },
  { title: '采购日用品', minutes: 40 },
];

export type FixedEvent = {
  id: string;
  title: string;
  /** 指定具体日期；为空则按 weekday 每周重复 */
  date?: string;
  weekday?: number; // 0-6
  startMin: number; // 从 0 点起的分钟
  endMin: number;
  kind: 'course' | 'meeting' | 'ticket' | 'other';
};

/** 时间记录（执行支持 + 速率校准） */
export type TimeLog = {
  id: string;
  title: string;
  taskId?: string;
  category: '任务' | '生活琐事' | '碎片时间';
  startAt: string; // ISO
  endAt: string; // ISO
  minutes: number;
  estimateMin?: number; // 用于 实际 vs 预估
  fragmentType?: '微输入' | '微整理' | '微恢复' | '微充电' | '刷手机';
  note?: string;
  createdAt: string;
};

/** 碎片时间用途分类建议 */
export const FRAGMENT_TYPES = ['微输入', '微整理', '微恢复', '微充电', '刷手机'] as const;

/** 根据精力与下一任务推荐碎片时间用途 */
export function suggestFragment(energyScore: number, nextTaskIsHigh: boolean): string {
  if (energyScore < 4) return '微恢复（闭眼/拉伸/喝水，别硬撑）';
  if (nextTaskIsHigh) return '微充电（走动/远眺/深呼吸，为高耗能任务蓄力）';
  if (energyScore >= 7) return '微输入（听播客/背几个单词/读一段）';
  return '微整理（清空收件箱/记一笔待办/整理桌面）';
}

// ---------------------------------------------------------------------------
// 五、速率校准（规划谬误修正）
// ---------------------------------------------------------------------------

/** 实际/预估 的中位数比值，>1 说明你习惯性低估耗时 */
export function speedFactor(logs: TimeLog[]): number {
  const ratios = logs
    .filter(l => l.estimateMin && l.estimateMin > 0 && l.minutes > 0)
    .map(l => l.minutes / (l.estimateMin as number))
    .sort((a, b) => a - b);
  if (ratios.length === 0) return 1;
  const mid = Math.floor(ratios.length / 2);
  const med = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.round(med * 100) / 100;
}

/** 用速率系数校准预估 */
export function calibrateEstimate(estimateMin: number, factor: number): number {
  return Math.max(5, Math.round(estimateMin * factor));
}
