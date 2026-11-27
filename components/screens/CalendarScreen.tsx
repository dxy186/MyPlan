import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { getHolidayData } from '@/app/utils/holidays';
import { solarToLunar } from '@/app/utils/lunar';
import { applyActions, commitState, loadPlanState, saveState, setTaskDone } from '@/components/assistant/plan-store';
import {
  CalendarItem,
  CalendarStyle,
  loadCalendarStyles,
  saveCalendarStyles,
  tasksToCalendarItems,
} from '@/components/data/calendar-bridge';
import { useTodayStr } from '@/hooks/use-today';

import { FixedEvent, KEYS, PlanTask, Quadrant, addDays, loadJSON, minutesToHM, saveJSON, weekdayOf } from '@/app/utils/planning';
import { ScheduleItem, ScheduleResult } from '@/app/utils/scheduler';
import { askAi } from '@/components/assistant/ask-bridge';
import { loadReminderSettings } from '@/components/assistant/followup';
import { quickParse } from '@/components/data/quick-parse';
import { DATA_CHANGED_EVENT, openBreakdown } from '@/components/assistant/breakdown';
import { startTaskTimer } from '@/components/assistant/gap';
import { allTasks } from '@/components/assistant/plan-store';

import CalendarTopBar, { SCHEDULE_UPDATED_EVENT } from './CalendarTopBar';
import HabitStrip from './HabitStrip';
import { EVENTS_CHANGED_EVENT, ImportantEvent, addEvent, deleteEvent, eventsOn, loadEvents, yearsSince } from '@/components/data/events';
import QuickSyntaxGuide from '@/components/data/QuickSyntaxGuide';
import { PriDot } from '@/components/data/priority';
import { OPEN_TODAY_MODAL_EVENT, takePendingOpenToday } from '@/components/assistant/nav-bridge';
import { confirmAsync } from '@/components/ui/confirm';

// ---------- 数据 ----------
// 日历里的事项就是统一任务列表里带截止日的任务（见 components/data/calendar-bridge.ts），
// 在这里加 / 改 / 勾 / 删，任务页、排程和 AI 都会同步。颜色、加粗、顺序单独保存。

/** 日历配色：DDL 红字，固定日程绿字 */
const DDL_RED = '#D32F2F';
const MANUAL_DAYS_KEY = '@myplan_calendar_manual_days';
const FIXED_GREEN = '#2E7D32';
const DATE_BGCOLOR_KEY = '@myplan_datebgcolor'; // 仅存储背景色

// ---------- 24色 + 黑白 ----------
const ALL_COLORS = [
  '#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#8B00FF',
  '#FF1493', '#FF4500', '#FFD700', '#7FFF00', '#00CED1', '#4169E1',
  '#DC143C', '#FF8C00', '#ADFF2F', '#32CD32', '#1E90FF', '#9370DB',
  '#FF69B4', '#FF6347', '#FFD700', '#7CFC00', '#00BFFF', '#6A5ACD',
  '#000000', '#FFFFFF',
];

// ---------- 工具函数 ----------
function getNowDateString(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString().slice(-5);
}

function nowMinute() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// 列表已按「未完成在前」排序，同完成状态的事项是连续的一段
function isFirstInStatus(list: CalendarItem[], index: number): boolean {
  return index === 0 || list[index - 1].completed !== list[index].completed;
}

function isLastInStatus(list: CalendarItem[], index: number): boolean {
  return index === list.length - 1 || list[index + 1].completed !== list[index].completed;
}

// ---------- 主组件 ----------
function CalendarMain() {
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  // ⭐ 重要事件（生日、考试日、出发…）
  const [events, setEvents] = useState<ImportantEvent[]>([]);
  useEffect(() => {
    const load = () => loadEvents().then(setEvents);
    load();
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener(EVENTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(EVENTS_CHANGED_EVENT, load);
  }, []);
  // 任务 id → 截止日（给自动排进来的任务显示「x 号截止」）
  const [scheduledDue, setScheduledDue] = useState<Map<string, string>>(new Map());
  const [itemStyles, setItemStyles] = useState<Record<string, CalendarStyle>>({});
  // 自动排进各天的任务块（浅灰斜体显示，和自己写的事项区分）
  const [scheduled, setScheduled] = useState<ScheduleItem[]>([]);
  // 用 ▲▼ 手动调过顺序的日子（其余日子按时间排）
  const [manualDays, setManualDays] = useState<Set<string>>(new Set());
  useEffect(() => {
    loadJSON<string[]>(MANUAL_DAYS_KEY, []).then(d => setManualDays(new Set(d)));
  }, []);
  // 完整排程（含玩的时间、休息日等块）和每天完成的任务
  const [allBlocks, setAllBlocks] = useState<ScheduleItem[]>([]);
  const [doneByDay, setDoneByDay] = useState<Record<string, string[]>>({});
  const [showTimeline, setShowTimeline] = useState(false);
  const [unscheduledIds, setUnscheduledIds] = useState<Set<string>>(new Set());
  const [fixedEvents, setFixedEvents] = useState<FixedEvent[]>([]);
  const [reviewAt, setReviewAt] = useState(21 * 60);
  const [aiText, setAiText] = useState('');
  const [addHint, setAddHint] = useState('');
  const [showSyntax, setShowSyntax] = useState(false);
  const [dateBgColors, setDateBgColors] = useState<Record<string, string | null>>({}); // null 表示透明
  const [modalVisible, setModalVisible] = useState(false);
  const [bgColorSettingsVisible, setBgColorSettingsVisible] = useState(false); // 背景色调色盘
  const [itemEditVisible, setItemEditVisible] = useState(false); // 单个事项编辑
  const [addText, setAddText] = useState('');
  const [showDatePickerFor, setShowDatePickerFor] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(getNowDateString());
  // 日历格子的高度：按可用空间撑满（这个月几行就分几份），最矮 110
  const [cellH, setCellH] = useState(110);
  const availH = React.useRef(0);
  const calH = React.useRef(0);
  const weeksOf = (ym: string) => {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    return Math.ceil((first + days) / 7);
  };
  const fitCells = () => {
    if (!availH.current || !calH.current) return;
    const weeks = weeksOf(currentMonth);
    setCellH(h => {
      const next = Math.max(110, Math.floor(h + (availH.current - calH.current - 2) / weeks));
      return Math.abs(next - h) >= 2 ? next : h;
    });
  };
  // 自己量高度（react-native-web 的 onLayout 在这里不总是触发）：窗口大小变了、换月份、格子高度变了都重新量
  const outerRef = useRef<View>(null);
  const innerRef = useRef<View>(null);
  useEffect(() => {
    const outer = outerRef.current as unknown as HTMLElement | null;
    const inner = innerRef.current as unknown as HTMLElement | null;
    if (!outer?.getBoundingClientRect || !inner?.getBoundingClientRect) return;
    const measure = () => {
      availH.current = outer.getBoundingClientRect().height;
      calH.current = inner.getBoundingClientRect().height;
      fitCells();
    };
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(outer);
    ro?.observe(inner);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, cellH]);
  const [holidayMap, setHolidayMap] = useState<Record<string, 'holiday' | 'workday'>>({});

  // 「今天」跟着真实时间走：跳天时自动重渲染
  const todayStr = useTodayStr();
  const prevTodayRef = useRef(todayStr);
  useEffect(() => {
    const prev = prevTodayRef.current;
    if (prev === todayStr) return;
    prevTodayRef.current = todayStr;
    // 跳天时如果正看着「今天」所在的月份，日历跟着跳到新月份
    setCurrentMonth(m => (m.slice(0, 7) === prev.slice(0, 7) ? todayStr : m));
  }, [todayStr]);

  const [currentEditDate, setCurrentEditDate] = useState<string>('');
  // 点开早上提醒：直接打开今天的弹窗
  useEffect(() => {
    const open = () => {
      if (!takePendingOpenToday()) return;
      setCurrentMonth(todayStr);
      setCurrentEditDate(todayStr);
      setModalVisible(true);
    };
    open();
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener(OPEN_TODAY_MODAL_EVENT, open);
    return () => window.removeEventListener(OPEN_TODAY_MODAL_EVENT, open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [currentEditItemId, setCurrentEditItemId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null); // 正在编辑的事项

  // 背景色临时状态
  const [tempBgColor, setTempBgColor] = useState<string | null>(null);

  // 新建事项时的临时颜色和加粗
  const [newItemColor, setNewItemColor] = useState<string>('#333');
  const [newItemBold, setNewItemBold] = useState<boolean>(false);

  // 事项重命名（列表内联编辑）
  const [showRenameFor, setShowRenameFor] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const lastTapRef = useRef<number>(0);
  const lastItemTapRef = useRef<number>(0);

  // ---------- 数据加载 ----------
  const loadCalendarItems = async () => {
    try {
      const st = await loadPlanState();
      const styles = await loadCalendarStyles(st);
      setItemStyles(styles);
      setCalendarItems(tasksToCalendarItems(st, styles));
      {
        const refs = allTasks(st.goals);
        const byId = new Map(refs.map(r => [r.task.id, r.task]));
        // 子任务没设截止日的，跟父任务的截止日
        const eff = (t: PlanTask) => t.due ?? (t.parentId ? byId.get(t.parentId)?.due : undefined);
        setScheduledDue(new Map(refs.filter(r => !!eff(r.task)).map(r => [r.task.id, eff(r.task) as string])));
      }
      const sch = await loadJSON<ScheduleResult | null>(KEYS.schedule, null);
      setScheduled((sch?.items ?? []).filter(i => i.type === 'task' && !!i.taskId));
      setAllBlocks((sch?.items ?? []).filter(i => i.type !== 'buffer'));
      const done: Record<string, string[]> = {};
      for (const r of allTasks(st.goals)) {
        if (!r.task.done || !r.task.doneAt || r.task.split) continue;
        const d = new Date(r.task.doneAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        (done[key] = done[key] || []).push(r.task.title);
      }
      setDoneByDay(done);
      setUnscheduledIds(new Set((sch?.unscheduled ?? []).map(t => t.id)));
      setFixedEvents(st.fixed);
      setReviewAt((await loadReminderSettings()).eveningReviewAt);
      if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event(SCHEDULE_UPDATED_EVENT));
    } catch {}
  };

  /** 某天自动排进来的任务（同一任务一天里的几段合并成一行），排除已经作为事项显示在这天的 */
  const scheduledFor = (dateStr: string, shownIds: Set<string>) => {
    const byTask = new Map<string, { taskId: string; title: string; start: number; end: number; minutes: number; quadrant?: Quadrant }>();
    for (const i of scheduled) {
      if (i.date !== dateStr || !i.taskId || shownIds.has(i.taskId)) continue;
      const prev = byTask.get(i.taskId);
      if (prev) {
        prev.minutes += i.endMin - i.startMin;
        prev.end = Math.max(prev.end, i.endMin);
      } else byTask.set(i.taskId, { taskId: i.taskId, title: i.title, start: i.startMin, end: i.endMin, minutes: i.endMin - i.startMin, quadrant: i.quadrant });
    }
    return [...byTask.values()].sort((a, b) => a.start - b.start);
  };

  /** 某天的固定日程（单日 + 每周重复） */
  const fixedFor = (dateStr: string) => {
    const wd = weekdayOf(dateStr);
    return fixedEvents.filter(e => (e.date ? e.date === dateStr : e.weekday === wd)).sort((a, b) => a.startMin - b.startMin);
  };

  /** 任务排在哪天几点（第一段） */
  const firstBlock = (taskId: string) =>
    scheduled
      .filter(i => i.taskId === taskId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)[0];

  /** 自动排进来的任务（没有截止日、不在「我的事项」里的）直接勾完成 */
  const completeTask = async (taskId: string) => {
    setModalVisible(false);
    const st = await setTaskDone(taskId, true);
    await commitState(st);
    await loadCalendarItems();
  };

  const deleteFixed = async (ev: FixedEvent) => {
    if (ev.weekday !== undefined && !(await confirmAsync(`「${ev.title}」是每周重复的，删除后每周都没有了，确定吗？`))) return;
    const st = await loadPlanState();
    st.fixed = st.fixed.filter(x => x.id !== ev.id);
    await commitState(st);
    await loadCalendarItems();
  };

  /** 晚上复盘 / 过期事项：挪到别的日子 */
  const moveItemTo = async (itemId: string, date: string) => {
    await updateItem(itemId, { date });
    await loadCalendarItems();
  };

  /** 弹窗里点 ▶：给这个任务开始计时，日历顶部会显示计时 */
  const startTimerFor = async (taskId: string, plannedMin?: number) => {
    const st = await loadPlanState();
    const ref = allTasks(st.goals).find(r => r.task.id === taskId);
    if (!ref || ref.task.done) return;
    await startTaskTimer(ref.task, plannedMin);
    setModalVisible(false);
  };

  const sendToAi = () => {
    const text = aiText.trim();
    if (!text) return;
    setAiText('');
    setModalVisible(false);
    askAi(`关于 ${currentEditDate} 这天：${text}`);
  };

  /** 改任务 → 保存 → 从现在起重排 → 刷新日历 */
  const runTaskAction = async (action: Parameters<typeof applyActions>[1][number]) => {
    const st = await loadPlanState();
    const { next, changes } = applyActions(st, [action]);
    if (!changes[0]?.ok) return null;
    await commitState(next);
    await loadCalendarItems();
    return next;
  };

  const saveStyle = async (itemId: string, patch: CalendarStyle) => {
    const next = { ...itemStyles, [itemId]: { ...itemStyles[itemId], ...patch } };
    setItemStyles(next);
    await saveCalendarStyles(next);
  };

  const loadDateBgColors = async () => {
    try {
      const data = await AsyncStorage.getItem(DATE_BGCOLOR_KEY);
      if (data) setDateBgColors(JSON.parse(data));
      else setDateBgColors({});
    } catch {}
  };

  const loadHolidays = async (year: number) => {
    try {
      const data = await getHolidayData(year);
      if (data) {
        const map: Record<string, 'holiday' | 'workday'> = {};
        data.days.forEach((d: any) => {
          map[d.date] = d.isOffDay ? 'holiday' : 'workday';
        });
        setHolidayMap(prev => ({ ...prev, ...map }));
      }
    } catch {}
  };

  // 拆解等其他地方改了数据：刷新日历
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onChange = () => loadCalendarItems();
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCalendarItems();
    loadDateBgColors();
    const currentYear = new Date().getFullYear();
    loadHolidays(currentYear - 1);
    loadHolidays(currentYear);
    loadHolidays(currentYear + 1);
  }, []);

  // ---------- 数据持久化 ----------
  const saveDateBgColors = async (newColors: Record<string, string | null>) => {
    setDateBgColors(newColors);
    await AsyncStorage.setItem(DATE_BGCOLOR_KEY, JSON.stringify(newColors));
  };

  const updateItem = async (itemId: string, updates: Partial<CalendarItem>) => {
    // 先在界面上立刻显示
    setCalendarItems(items => items.map(item => (item.id === itemId ? { ...item, ...updates } : item)));
    const style: CalendarStyle = {};
    if (updates.textColor !== undefined) style.textColor = updates.textColor;
    if (updates.bold !== undefined) style.bold = updates.bold;
    if (updates.order !== undefined) style.order = updates.order;
    if (Object.keys(style).length) await saveStyle(itemId, style);
    if (updates.completed !== undefined) {
      // 没截止日、靠「完成日」显示的事项被取消完成：把截止日定在这天，免得它从日历上消失
      const cur = calendarItems.find(i => i.id === itemId);
      if (!updates.completed && cur) {
        const before = await loadPlanState();
        const t = allTasks(before.goals).find(r => r.task.id === itemId)?.task;
        if (t && !t.due) {
          t.due = cur.date;
          await saveState(before);
        }
      }
      const st = await setTaskDone(itemId, updates.completed);
      await commitState(st);
    }
    if (updates.title !== undefined || updates.date !== undefined) {
      // 「那天做」的事项挪到另一天时，开始日期跟着一起挪
      let moveStart = false;
      if (updates.date !== undefined) {
        const st = await loadPlanState();
        const t = allTasks(st.goals).find(r => r.task.id === itemId)?.task;
        moveStart = !!t?.notBefore;
      }
      await runTaskAction({
        type: 'update_task',
        taskId: itemId,
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.date !== undefined ? { due: updates.date } : {}),
        ...(updates.date !== undefined && moveStart ? { notBefore: updates.date } : {}),
      });
    }
  };

  // ---------- 事件处理 ----------
  const handleMonthChange = (month: any) => {
    setCurrentMonth(month.dateString);
    const year = parseInt(month.dateString.slice(0, 4), 10);
    loadHolidays(year);
  };

  // 排序：未完成在前；默认按排程里的开始时间先后（这天的时段优先，没排上的放后面）；
  // 用 ▲▼ 手动调过这一天的顺序后（这天每项都有 order），就按手动顺序
  const timeKey = (it: CalendarItem) => {
    const blocks = scheduled.filter(i => i.taskId === it.id);
    const sameDay = blocks.filter(b => b.date === it.date).sort((a, b) => a.startMin - b.startMin)[0];
    const first = sameDay ?? blocks.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)[0];
    return first ? `${first.date === it.date ? '0' : '1'} ${first.date} ${String(first.startMin).padStart(4, '0')}` : '9';
  };
  const sortItems = (items: CalendarItem[]) => {
    const manual = items.length > 0 && manualDays.has(items[0].date) && items.every(i => i.order !== undefined);
    return items.slice().sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (manual) return (a.order ?? 0) - (b.order ?? 0);
      return timeKey(a).localeCompare(timeKey(b)) || (a.order ?? 0) - (b.order ?? 0);
    });
  };

  const toggleItemCompleted = async (item: CalendarItem) => {
    // 勾完成时先关掉弹窗，庆祝才不会被挡住
    if (!item.completed) setModalVisible(false);
    await updateItem(item.id, { completed: !item.completed });
  };

  const handleAdd = async () => {
    if (!addText.trim()) return;
    if (!currentEditDate) {
      alert('请先选择一个日期');
      return;
    }
    const parsed = quickParse(addText);
    const date = currentEditDate;
    setAddText('');
    if (parsed.kind === 'event') {
      await addEvent({ date, title: parsed.title, yearly: parsed.yearly, time: parsed.time });
      setAddHint(`⭐ 已记为重要事件：${parsed.time ? parsed.time + ' ' : ''}${parsed.title}${parsed.yearly ? '（每年这天都会显示）' : ''}`);
      return;
    }
    const st = await loadPlanState();
    if (parsed.kind === 'fixed') {
      // 「15:00-17:00 开组会」→ 这天的固定日程；「每周二、四 8:00-10:00 高数课」→ 每周重复
      const weekly = parsed.weekdays && parsed.weekdays.length > 0;
      const { next, changes } = applyActions(
        st,
        weekly
          ? (parsed.weekdays as number[]).map(w => ({
              type: 'add_fixed_event' as const,
              title: parsed.title,
              weekday: w,
              start: parsed.start,
              end: parsed.end,
              kind: 'other' as const,
            }))
          : [{ type: 'add_fixed_event', title: parsed.title, date, start: parsed.start, end: parsed.end, kind: 'other' }]
      );
      if (!changes.every(c => c.ok)) {
        setAddHint(changes.find(c => !c.ok)?.summary || '没加上');
        return;
      }
      await commitState(next);
      await loadCalendarItems();
      const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
      setAddHint(
        weekly
          ? `📌 已作为每周${(parsed.weekdays as number[]).map(w => WEEK_CN[w]).join('、')}的固定日程：${parsed.start}–${parsed.end} ${parsed.title}`
          : `📌 已作为固定日程：${parsed.start}–${parsed.end} ${parsed.title}`
      );
      return;
    }
    const title = parsed.title;
    const before = new Set(st.goals.flatMap(g => g.milestones.flatMap(m => m.tasks.map(t => t.id))));
    const { next, changes } = applyActions(st, [
      // 写在哪天就是哪天做：不早于、也不晚于这一天
      // 名字里写了 DDL / 截止的：这天是截止日，不是「这天做」
      (parsed.kind === 'task' && parsed.ddl) || /ddl|deadline|截止/i.test(title)
        ? { type: 'add_task', title, due: date, estimateMin: parsed.estimateMin, energyCost: parsed.energyCost }
        : { type: 'add_task', title, due: date, notBefore: date, estimateMin: parsed.estimateMin, energyCost: parsed.energyCost },
    ]);
    if (!changes[0]?.ok) return;
    const isDdlAdd = (parsed.kind === 'task' && parsed.ddl) || /ddl|deadline|截止/i.test(title);
    setAddHint(
      isDdlAdd
        ? `🔴 已加成 DDL：${title}（${date.slice(5)} 截止，不自动排时间；要拆步骤到任务页点它，或写的时候用 #?）`
        : `📝 已加入：${title}（${parsed.estimateMin} 分钟${parsed.energyCost === 'high' ? '，高耗能' : ''}）——下面会显示排在几点`
    );
    const added = next.goals.flatMap(g => g.milestones.flatMap(m => m.tasks)).find(t => !before.has(t.id));
    if (added) await saveStyle(added.id, { textColor: newItemColor, bold: newItemBold });
    await commitState(next);
    await loadCalendarItems();
    // 「?写期末论文」：加进去后马上让 AI 拆
    if (parsed.breakdown && added) {
      setModalVisible(false);
      openBreakdown(added.id);
      return;
    }
  };

  const editItemDate = async (itemId: string, newDate: string) => {
    await updateItem(itemId, { date: newDate });
    setShowDatePickerFor(null);
  };

  const handleDeleteItem = async (itemId: string) => {
    const item = calendarItems.find(ci => ci.id === itemId);
    if (!item) return;
    setCalendarItems(items => items.filter(ci => ci.id !== itemId));
    await runTaskAction({ type: 'delete_task', taskId: itemId });
  };

  // ---------- 调整顺序 / 重命名 ----------
  // 打开重命名（列表内联输入框）
  const openRename = (item: CalendarItem) => {
    setRenameText(item.title);
    setShowRenameFor(item.id);
  };

  // 单击事项名称不做任何事；双击 → 进入文本框重命名
  const handleItemTitlePress = (item: CalendarItem) => {
    const now = Date.now();
    const gap = now - lastItemTapRef.current;
    lastItemTapRef.current = now;
    if (gap < 300) {
      lastItemTapRef.current = 0;
      openRename(item);
    }
  };

  // 保存重命名（onSubmitEditing 与 onBlur 双触发也安全）
  const saveRename = async (itemId: string) => {
    const item = calendarItems.find(ci => ci.id === itemId);
    setShowRenameFor(null);
    if (!item) return;
    const next = renameText.trim();
    if (!next || next === item.title) return;
    await updateItem(itemId, { title: next });
  };

  // 上移 / 下移：只在「同一完成状态」的相邻事项之间交换，避免与未完成置顶规则冲突
  const moveItem = async (itemId: string, dir: -1 | 1) => {
    const dayItems = sortItems(calendarItems.filter(ci => ci.date === currentEditDate));
    const idx = dayItems.findIndex(ci => ci.id === itemId);
    if (idx < 0) return;
    let j = idx + dir;
    while (j >= 0 && j < dayItems.length && dayItems[j].completed !== dayItems[idx].completed) {
      j += dir;
    }
    if (j < 0 || j >= dayItems.length) return;
    if (!manualDays.has(currentEditDate)) {
      const nd = new Set(manualDays).add(currentEditDate);
      setManualDays(nd);
      saveJSON(MANUAL_DAYS_KEY, [...nd].slice(-200));
    }
    const reordered = dayItems.slice();
    const tmp = reordered[idx];
    reordered[idx] = reordered[j];
    reordered[j] = tmp;
    const orderMap: Record<string, number> = {};
    reordered.forEach((it, i) => { orderMap[it.id] = i; });
    const newItems = calendarItems.map(it =>
      orderMap[it.id] !== undefined ? { ...it, order: orderMap[it.id] } : it
    );
    setCalendarItems(newItems);
    const nextStyles = { ...itemStyles };
    for (const [id, order] of Object.entries(orderMap)) nextStyles[id] = { ...nextStyles[id], order };
    setItemStyles(nextStyles);
    await saveCalendarStyles(nextStyles);
  };

  // 打开事项编辑面板
  const openItemEdit = (item: CalendarItem) => {
    setEditingItem(item);
    setItemEditVisible(true);
  };

  // 保存事项编辑
  const saveItemEdit = async () => {
    if (!editingItem) return;
    await updateItem(editingItem.id, {
      textColor: editingItem.textColor,
      bold: editingItem.bold,
    });
    setItemEditVisible(false);
    setEditingItem(null);
  };

  // ---------- 渲染日期格子 ----------
  const renderDay = (dayProps: any) => {
    const { date } = dayProps;
    if (!date) {
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          style={[styles.dayCell, { backgroundColor: 'transparent', minHeight: cellH, maxHeight: cellH }]}
          onPress={() => {}}
        >
          <View style={{ height: cellH }} />
        </TouchableOpacity>
      );
    }

    const dateStr = date.dateString;
    const isToday = dateStr === todayStr;
    const itemsToday = sortItems(calendarItems.filter(ci => ci.date === dateStr));
    // 没做完的、固定日程、自动排的在前；划掉的（做完的）沉到最后，格子放不下时先省略它们
    const eventLines = eventsOn(events, dateStr).slice(0, 2);
    const itemLines = itemsToday.filter(i => !i.completed).slice(0, 5 - eventLines.length);
    // 固定日程（每天的课、会）不在格子里显示，点开这一天的弹窗里还能看到
    const fixedLines: ReturnType<typeof fixedFor> = [];
    const autoLines = scheduledFor(dateStr, new Set(itemsToday.map(i => i.id))).slice(
      0,
      Math.max(0, 5 - eventLines.length - itemLines.length - fixedLines.length)
    );
    const doneLines = itemsToday
      .filter(i => i.completed)
      .slice(0, Math.max(0, 5 - eventLines.length - itemLines.length - fixedLines.length - autoLines.length));

    const currentMonthPrefix = currentMonth.slice(0, 7);
    const dateMonthPrefix = dateStr.slice(0, 7);
    const isCurrentMonth = dateMonthPrefix === currentMonthPrefix;

    const dayNumberColor = isCurrentMonth ? '#111' : '#ccc';
    const lunarColor = isCurrentMonth ? '#888' : '#ccc';

    let lunarStr = '';
    try {
      const lunar = solarToLunar(dateStr);
      if (lunar && lunar.day) lunarStr = lunar.day;
    } catch {}

    const holidayType = holidayMap[dateStr];
    const showHoliday = holidayType === 'holiday';
    const showWorkday = holidayType === 'workday';

    // 获取日期背景色
    const bgColor = dateBgColors[dateStr] ?? 'transparent';

    const handlePress = () => {
      const now = Date.now();
      const gap = now - lastTapRef.current;
      lastTapRef.current = now;
      if (gap < 300) {
        setCurrentEditDate(dateStr);
        // 重置新事项的颜色/加粗为默认（或上次记忆）
        setNewItemColor('#333');
        setNewItemBold(false);
        setAddHint('');
        setModalVisible(true);
      }
    };

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handlePress}
        style={[styles.dayCell, { backgroundColor: bgColor, minHeight: cellH, maxHeight: cellH }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' }}>
          <View style={[isToday && { backgroundColor: '#E5E5E5', borderRadius: 14, minWidth: 26, minHeight: 26, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ 
              color: isToday ? '#111' : dayNumberColor, 
              fontWeight: isToday ? 'bold' : 'normal', 
              fontSize: 14
            }}>{date.day}</Text>
          </View>
          {showHoliday && <Text style={styles.holidayBadge}>休</Text>}
          {showWorkday && <Text style={styles.workdayBadge}>班</Text>}
        </View>
        <Text style={[styles.lunarText, { color: lunarColor }]}>{lunarStr}</Text>
        <View style={{ width: '100%', alignItems: 'flex-start' }}>
          {eventLines.map(ev => (
            <Text
              key={`ev-${ev.id}`}
              numberOfLines={1}
              style={[styles.itemText, { color: '#8E24AA', fontWeight: '700', opacity: isCurrentMonth ? 1 : 0.5 }]}
            >
              ⭐ {ev.title}
            </Text>
          ))}
          {itemLines.map(item => (
            <Text
              key={item.id}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.itemText,
                {
                  color: item.ddl ? DDL_RED : item.textColor || '#333',
                  fontWeight: item.bold ? 'bold' : '400',
                  textDecorationLine: item.completed ? 'line-through' : 'none',
                  opacity: isCurrentMonth ? 1 : 0.5,
                }
              ]}
            >
              <PriDot q={item.quadrant} size={8} />
              {item.title}
            </Text>
          ))}
          {fixedLines.map(f => (
            <Text
              key={`fixed-${f.id}`}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.itemText, styles.fixedItemText, { opacity: isCurrentMonth ? 1 : 0.5 }]}
            >
              {minutesToHM(f.startMin)} {f.title}
            </Text>
          ))}
          {autoLines.map(a => (
            <Text
              key={`auto-${a.taskId}`}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.itemText, styles.autoItemText, { opacity: isCurrentMonth ? 1 : 0.5 }]}
            >
              <PriDot q={a.quadrant} size={8} />
              {a.title}
            </Text>
          ))}
          {doneLines.map(item => (
            <Text
              key={item.id}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.itemText,
                { color: '#b0b0b0', fontWeight: '400', textDecorationLine: 'line-through', opacity: isCurrentMonth ? 1 : 0.5 },
              ]}
            >
              {item.title}
            </Text>
          ))}
        </View>
      </TouchableOpacity>
    );
  };

  // ---------- 颜色选择器组件（用于背景色） ----------
  const ColorPicker = ({ selectedColor, onSelectColor, title, includeNone = false }) => {
    return (
      <View style={styles.colorPickerContainer}>
        <Text style={styles.colorPickerTitle}>{title}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.colorScroll}>
          {includeNone && (
            <TouchableOpacity
              style={[styles.colorCircle, { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccc' }]}
              onPress={() => onSelectColor(null)}
            >
              <Text style={{ fontSize: 10, color: '#888' }}>无</Text>
            </TouchableOpacity>
          )}
          {ALL_COLORS.map(color => (
            <TouchableOpacity
              key={color}
              style={[
                styles.colorCircle,
                { backgroundColor: color },
                selectedColor === color && styles.colorCircleSelected,
                color === '#FFFFFF' && { borderWidth: 1, borderColor: '#ccc' },
              ]}
              onPress={() => onSelectColor(color)}
            />
          ))}
        </ScrollView>
      </View>
    );
  };

  // ---------- 主渲染 ----------
  const todayItems = calendarItems.filter(item => item.date === todayStr);
  const totalToday = todayItems.length;
  const completedToday = todayItems.filter(item => item.completed).length;
  const progressItems = totalToday > 0 ? [
    {
      id: 'today-progress',
      title: '今日事项',
      subtasks: todayItems.map(item => ({ id: item.id, title: item.title, completed: item.completed })),
    }
  ] : [];

  const itemsForSelectedDay = sortItems(calendarItems.filter(item => item.date === currentEditDate));
  // 「这天的事项」= 这天的事项（截止 / 指定在这天）+ 自动排进这天的任务，合成一个列表：
  // 没做完的事项 → 自动排进来的（按时间）→ 做完的事项
  const autosForSelectedDay = currentEditDate ? scheduledFor(currentEditDate, new Set(itemsForSelectedDay.map(i => i.id))) : [];
  type DayEntry =
    | { kind: 'item'; item: CalendarItem; idx: number }
    | { kind: 'auto'; a: (typeof autosForSelectedDay)[number] };
  const dayEntries: DayEntry[] = [
    ...itemsForSelectedDay.map((item, idx) => ({ kind: 'item' as const, item, idx })).filter(e => !e.item.completed),
    ...autosForSelectedDay.map(a => ({ kind: 'auto' as const, a })),
    ...itemsForSelectedDay.map((item, idx) => ({ kind: 'item' as const, item, idx })).filter(e => e.item.completed),
  ];

  return (
    <View style={styles.container}>
      {/* 进度条 */}
      {progressItems.length > 0 && (
        <ScrollView horizontal style={styles.progressScroll} showsHorizontalScrollIndicator={false}>
          {progressItems.map(task => {
            const total = task.subtasks.length;
            const finished = task.subtasks.filter(st => st.completed).length;
            const percent = total > 0 ? finished / total : 0;
            return (
              <View key={task.id} style={styles.progressCard}>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${Math.round(percent * 100)}%` }]} />
                </View>
                <Text style={styles.progressTitle}>{task.title}</Text>
                <Text style={styles.progressStats}>{finished}/{total}</Text>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View ref={outerRef} style={{ flex: 1, minHeight: 0 }}>
      <View ref={innerRef}>
      <Calendar
        // 格子高度变了要整个重画（日历内部会缓存每个格子）
        key={`cal-h-${cellH}`}
        current={currentMonth}
        onDayPress={() => {}}
        onMonthChange={handleMonthChange}
        markingType={'custom'}
        dayComponent={renderDay}
        theme={{ 
          calendarBackground: '#F8FAFC', 
          monthTextColor: '#383838', 
          textSectionTitleColor: '#7b8ba2', 
          todayTextColor: '#111',
          dayTextColor: '#2d4150',
          textDisabledColor: '#d9e1e8',
          arrowColor: '#1976D2',
          monthTextColor: '#1976D2',
          textMonthFontWeight: 'bold',
          textDayFontSize: 14,
          textMonthFontSize: 18,
          textDayHeaderFontSize: 13,
        }}
        style={{ marginHorizontal: 0, borderRadius: 13 }}
      />
      </View>
      </View>

      {/* 主模态框：我的事项 */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.noteCard}>
                <View style={styles.noteHeader}>
                  <Text style={styles.noteDate}>{currentEditDate}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {/* 背景色调色盘按钮 */}
                    <TouchableOpacity onPress={() => {
                      setTempBgColor(dateBgColors[currentEditDate] ?? null);
                      setBgColorSettingsVisible(true);
                    }} style={{ marginRight: 16 }}>
                      <Text style={{ fontSize: 22 }}>🎨</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setModalVisible(false)}>
                      <Text style={styles.closeText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {currentEditDate === todayStr &&
                  (() => {
                    const cur = nowMinute();
                    const nextBlock = scheduled
                      .filter(i => i.date === todayStr && i.endMin > cur)
                      .sort((a, b) => a.startMin - b.startMin)[0];
                    if (!nextBlock || !nextBlock.taskId) return null;
                    return (
                      <TouchableOpacity
                        style={styles.startNextBtn}
                        onPress={() => startTimerFor(nextBlock.taskId as string, nextBlock.endMin - nextBlock.startMin)}
                      >
                        <Text style={styles.startNextText}>
                          ▶ 开始下一项：{nextBlock.title}
                          <Text style={styles.startNextMeta}>（{minutesToHM(nextBlock.startMin)}–{minutesToHM(nextBlock.endMin)}）</Text>
                        </Text>
                      </TouchableOpacity>
                    );
                  })()}
                {eventsOn(events, currentEditDate).length > 0 && (
                  <View style={{ marginBottom: 6 }}>
                    <Text style={styles.sectionTitle}>⭐ 重要事件</Text>
                    {eventsOn(events, currentEditDate).map(ev => (
                      <View key={ev.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                        <Text style={{ flex: 1, fontSize: 15, color: '#6A1B9A', fontWeight: '600' }}>
                          {ev.time ? `${ev.time}　` : ''}⭐ {ev.title}
                          {ev.yearly ? (
                            <Text style={{ fontSize: 12, color: '#9575CD', fontWeight: '400' }}>
                              {'　'}每年{yearsSince(ev, currentEditDate) > 0 ? ` · 第 ${yearsSince(ev, currentEditDate)} 年` : ''}
                            </Text>
                          ) : null}
                        </Text>
                        {!ev.yearly && (
                          <TouchableOpacity
                            onPress={async () => {
                              const st = await loadPlanState();
                              const { next, changes } = applyActions(st, [
                                { type: 'add_task', title: ev.title, due: ev.date, estimateMin: 30, energyCost: 'medium' },
                              ]);
                              if (!changes[0]?.ok) return;
                              await commitState(next);
                              await deleteEvent(ev.id);
                              setAddHint(`✅ 「${ev.title}」已改成截止 ${ev.date.slice(5)} 的 DDL 任务`);
                            }}
                            style={{ paddingHorizontal: 6 }}
                          >
                            <Text style={{ color: '#1976D2', fontSize: 12 }}>改成 DDL 任务</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={async () => {
                            if (await confirmAsync(`删除重要事件「${ev.title}」${ev.yearly ? '（每年的都会删掉）' : ''}？`)) deleteEvent(ev.id);
                          }}
                          style={{ paddingHorizontal: 6 }}
                        >
                          <Text style={{ color: '#E53935', fontSize: 16 }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
                <Text style={styles.sectionTitle}>📝 这天的事项</Text>
                <ScrollView style={styles.noteList}>
                  {dayEntries.length === 0 ? (
                    <Text style={{ color: '#bbb', textAlign: 'center', marginTop: 20 }}>暂无事项</Text>
                  ) : (
                    dayEntries.map(entry => entry.kind === 'auto' ? (
                      <View key={`auto-${entry.a.taskId}`} style={styles.noteItemRow}>
                        <TouchableOpacity onPress={() => completeTask(entry.a.taskId)} style={styles.checkbox} />
                        <View style={[styles.noteTextBox, { flex: 1 }]}>
                          <Text style={[styles.noteItemText, { color: '#222' }]}>
                            <PriDot q={entry.a.quadrant} size={11} />
                            {entry.a.title}
                          </Text>
                          <Text style={styles.noteItemDate}>
                            🗓 自动排在 {minutesToHM(entry.a.start)}–{minutesToHM(entry.a.end)} · {entry.a.minutes} 分钟
                            {(() => {
                              const due = scheduledDue.get(entry.a.taskId);
                              return due ? ` · ${due.slice(5)} 截止` : ' · 没有截止日';
                            })()}
                          </Text>
                        </View>
                        <TouchableOpacity onPress={() => startTimerFor(entry.a.taskId, entry.a.minutes)} style={styles.rowBtn}>
                          <Text style={styles.playText}>▶</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            setModalVisible(false);
                            openBreakdown(entry.a.taskId);
                          }}
                          style={styles.rowBtn}
                        >
                          <Text style={{ fontSize: 15 }}>🧩</Text>
                        </TouchableOpacity>
                      </View>
                    ) : ((item: CalendarItem, idx: number) => (
                      <View key={item.id}>
                      <View style={styles.noteItemRow}>
                        <TouchableOpacity onPress={() => toggleItemCompleted(item)} style={[styles.checkbox, item.completed && { backgroundColor: '#1976D2', borderColor: '#1976D2' }]}>
                          {item.completed && <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text>}
                        </TouchableOpacity>
                        {showRenameFor === item.id ? (
                          /* 双击进入后的文本框：多行，可随意输入任意文字 */
                          <View style={{ flex: 1 }}>
                            <TextInput
                              autoFocus
                              multiline
                              placeholder="输入事项内容（可换行）"
                              placeholderTextColor="#b9c2cf"
                              textAlignVertical="top"
                              style={styles.noteTextBoxEditing}
                              value={renameText}
                              onChangeText={setRenameText}
                              onBlur={() => saveRename(item.id)}
                            />
                            <View style={styles.editActions}>
                              <TouchableOpacity
                                style={styles.renameDoneBtn}
                                onPressIn={() => saveRename(item.id)}
                                onPress={() => saveRename(item.id)}
                              >
                                <Text style={styles.renameDoneText}>✓ 保存</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[styles.noteTextBox, { flex: 1 }]}
                            activeOpacity={0.7}
                            onPress={() => handleItemTitlePress(item)}
                          >
                            <Text style={[styles.noteItemText, { color: item.ddl ? DDL_RED : item.textColor || '#222', fontWeight: item.bold ? 'bold' : '400' }, item.completed && { textDecorationLine: 'line-through', color: '#b0b0b0' }]}>
                              {!item.completed && <PriDot q={item.quadrant} size={11} />}
                              {item.title}
                            </Text>
                            <Text style={styles.noteItemDate}>
                              [{item.date}]
                              {!item.completed &&
                                (() => {
                                  const b = firstBlock(item.id);
                                  if (b) return <Text style={styles.slotText}>{`  🕐 ${b.date === item.date ? '' : b.date.slice(5) + ' '}${minutesToHM(b.startMin)}–${minutesToHM(b.endMin)}`}</Text>;
                                  if (unscheduledIds.has(item.id)) return <Text style={styles.slotWarn}>  ⚠️ 这天排不下</Text>;
                                  return null;
                                })()}
                            </Text>
                          </TouchableOpacity>
                        )}
                        {/* 调整顺序：上移 / 下移（仅在同一天内） */}
                        <View style={styles.orderCol}>
                          <TouchableOpacity
                            onPress={() => moveItem(item.id, -1)}
                            disabled={isFirstInStatus(itemsForSelectedDay, idx)}
                          >
                            <Text style={[styles.arrowText, isFirstInStatus(itemsForSelectedDay, idx) && styles.arrowDisabled]}>▲</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => moveItem(item.id, 1)}
                            disabled={isLastInStatus(itemsForSelectedDay, idx)}
                          >
                            <Text style={[styles.arrowText, isLastInStatus(itemsForSelectedDay, idx) && styles.arrowDisabled]}>▼</Text>
                          </TouchableOpacity>
                        </View>
                        {/* 开始计时 */}
                        {!item.completed && (
                          <TouchableOpacity onPress={() => startTimerFor(item.id)} style={styles.rowBtn}>
                            <Text style={styles.playText}>▶</Text>
                          </TouchableOpacity>
                        )}
                        {/* 让 AI 拆成小步骤 */}
                        {!item.completed && (
                          <TouchableOpacity
                            onPress={() => {
                              setModalVisible(false);
                              openBreakdown(item.id);
                            }}
                            style={styles.rowBtn}
                          >
                            <Text style={{ fontSize: 15 }}>🧩</Text>
                          </TouchableOpacity>
                        )}
                        {/* 事项调色盘按钮 - 编辑该事项的颜色/加粗 */}
                        <TouchableOpacity onPress={() => openItemEdit(item)} style={styles.rowBtn}>
                          <Text style={{ fontSize: 17 }}>🎨</Text>
                        </TouchableOpacity>
                        {showDatePickerFor === item.id && (
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <TextInput
                              placeholder="YYYY-MM-DD"
                              autoFocus
                              style={styles.dateInput}
                              value={item.date}
                              onChangeText={text => editItemDate(item.id, text)}
                              onBlur={() => setShowDatePickerFor(null)}
                            />
                            <TouchableOpacity onPress={() => setShowDatePickerFor(null)}>
                              <Text style={{ color: '#bbb', marginLeft: 6 }}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                        <TouchableOpacity onPress={() => handleDeleteItem(item.id)} style={{ padding: 4, marginLeft: 4 }}>
                          <Text style={{ color: '#E53935', fontSize: 17, fontWeight: 'bold' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                      {/* 晚上复盘 / 过期没做完：一键顺延 */}
                      {!item.completed &&
                        (item.date < todayStr || (item.date === todayStr && nowMinute() >= reviewAt)) && (
                          <View style={styles.reviewRow}>
                            <Text style={styles.reviewLabel}>{item.date < todayStr ? '过期没做完：' : '今天没做完？'}</Text>
                            {item.date < todayStr && (
                              <TouchableOpacity style={styles.reviewChip} onPress={() => moveItemTo(item.id, todayStr)}>
                                <Text style={styles.reviewChipText}>挪到今天</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity style={styles.reviewChip} onPress={() => moveItemTo(item.id, addDays(todayStr, 1))}>
                              <Text style={styles.reviewChipText}>明天继续</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.reviewChip} onPress={() => moveItemTo(item.id, addDays(todayStr, 3))}>
                              <Text style={styles.reviewChipText}>放一放（3 天后）</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    ))(entry.item, entry.idx))
                  )}
                  {/* 完整时间轴（含玩的时间、休息日；排在截止后的标 ⚠️） */}
                  {allBlocks.some(b => b.date === currentEditDate) && (
                    <View style={styles.autoSection}>
                      <TouchableOpacity onPress={() => setShowTimeline(!showTimeline)}>
                        <Text style={styles.autoTitle}>
                          {showTimeline ? '▾' : '▸'} 🕘 这天的完整时间轴
                        </Text>
                      </TouchableOpacity>
                      {showTimeline &&
                        allBlocks
                          .filter(b => b.date === currentEditDate)
                          .sort((a, b) => a.startMin - b.startMin)
                          .map(b => (
                            <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                              {b.type === 'task' && b.taskId ? (
                                <TouchableOpacity onPress={() => completeTask(b.taskId as string)} style={{ paddingRight: 6 }}>
                                  <Text style={{ fontSize: 15 }}>⬜</Text>
                                </TouchableOpacity>
                              ) : null}
                              <Text style={[styles.timelineLine, { flex: 1 }]} numberOfLines={2}>
                                {minutesToHM(b.startMin)}–{minutesToHM(b.endMin)}　
                                {b.type === 'task' ? '📝' : b.type === 'fixed' ? '📌' : b.type === 'play' ? '🎮' : b.type === 'rest' ? '🛌' : '·'} {b.title}
                                {b.note ? <Text style={styles.slotWarn}>　⚠️ {b.note}</Text> : null}
                              </Text>
                            </View>
                          ))}
                    </View>
                  )}
                  {/* 这天完成的（包括截止日在别的日子、但这天做完的） */}
                  {(doneByDay[currentEditDate] ?? []).length > 0 && (
                    <View style={styles.autoSection}>
                      <Text style={styles.autoTitle}>✅ 这天完成的</Text>
                      {(doneByDay[currentEditDate] ?? []).map((t, i) => (
                        <Text key={i} style={styles.doneLine} numberOfLines={1}>
                          ✓ {t}
                        </Text>
                      ))}
                    </View>
                  )}
                  {/* 这天的固定日程 */}
                  {fixedFor(currentEditDate).length > 0 && (
                    <View style={styles.autoSection}>
                      <Text style={styles.autoTitle}>📌 固定日程（排程会避开）</Text>
                      {fixedFor(currentEditDate).map(f => (
                        <View key={f.id} style={styles.autoRow}>
                          <Text style={[styles.fixedRowText, { color: FIXED_GREEN }]} numberOfLines={1}>
                            {minutesToHM(f.startMin)}–{minutesToHM(f.endMin)}　{f.title}
                            {f.weekday !== undefined ? <Text style={styles.autoMeta}>　每周</Text> : null}
                          </Text>
                          <TouchableOpacity onPress={() => deleteFixed(f)} style={{ padding: 4, marginLeft: 4 }}>
                            <Text style={{ color: '#E53935', fontSize: 15 }}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </ScrollView>

                {/* 添加事项区域 */}
                <View style={styles.addContainer}>
                  <View style={styles.addRow}>
                    <TextInput
                      placeholder="添加：写报告 2小时 / #ES pre（DDL）/ *妈妈生日（重要事件）/ ?写论文（AI 帮拆）/ 15:00-17:00 开组会"
                      value={addText}
                      style={[styles.addInput, { flex: 1 }]}
                      onChangeText={setAddText}
                      onSubmitEditing={handleAdd}
                    />
                    <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                      <Text style={{ color: '#fff', fontSize: 15 }}>添加</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => setShowSyntax(!showSyntax)}>
                    <Text style={styles.addHint}>{showSyntax ? '▾ 收起写法说明' : '▸ 快捷写法？（! 高耗能、? AI 拆、几点开始、每周重复…）'}</Text>
                  </TouchableOpacity>
                  {showSyntax && (
                    <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                      <QuickSyntaxGuide compact />
                    </ScrollView>
                  )}
                  {addHint ? <Text style={styles.addHint}>{addHint}</Text> : null}
                  {/* 跟 AI 说这天的安排（会跳到「今天」页处理，方案确认后生效） */}
                  <View style={[styles.addRow, { marginTop: 8 }]}>
                    <TextInput
                      placeholder="🤖 跟 AI 说这天的安排，比如：这天下午要开会，把作业挪到晚上"
                      value={aiText}
                      style={[styles.addInput, styles.aiInput, { flex: 1 }]}
                      onChangeText={setAiText}
                      onSubmitEditing={sendToAi}
                    />
                    <TouchableOpacity style={[styles.addBtn, styles.aiBtn]} onPress={sendToAi}>
                      <Text style={{ color: '#fff', fontSize: 15 }}>问 AI</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* 背景色设置模态框 */}
      <Modal visible={bgColorSettingsVisible} transparent animationType="slide" onRequestClose={() => setBgColorSettingsVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setBgColorSettingsVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={[styles.noteCard, { maxHeight: '70%' }]}>
                <View style={styles.noteHeader}>
                  <Text style={styles.noteDate}>🎨 格子背景色 - {currentEditDate}</Text>
                  <TouchableOpacity onPress={() => setBgColorSettingsVisible(false)}>
                    <Text style={styles.closeText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <ColorPicker
                  title="选择背景色"
                  selectedColor={tempBgColor}
                  onSelectColor={setTempBgColor}
                  includeNone={true}
                />
                <TouchableOpacity style={styles.saveBtn} onPress={() => {
                  const newColors = { ...dateBgColors };
                  if (tempBgColor !== undefined) {
                    if (tempBgColor === null) {
                      delete newColors[currentEditDate];
                    } else {
                      newColors[currentEditDate] = tempBgColor;
                    }
                    saveDateBgColors(newColors);
                  }
                  setBgColorSettingsVisible(false);
                }}>
                  <Text style={styles.saveBtnText}>保存背景色</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* 单个事项编辑模态框 */}
      <Modal visible={itemEditVisible} transparent animationType="slide" onRequestClose={() => setItemEditVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setItemEditVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={[styles.noteCard, { maxHeight: '70%' }]}>
                <View style={styles.noteHeader}>
                  <Text style={styles.noteDate}>✏️ 编辑事项</Text>
                  <TouchableOpacity onPress={() => setItemEditVisible(false)}>
                    <Text style={styles.closeText}>✕</Text>
                  </TouchableOpacity>
                </View>
                {editingItem && (
                  <>
                    <Text style={{ fontSize: 16, marginBottom: 10 }}>{editingItem.title}</Text>
                    <ColorPicker
                      title="文字颜色"
                      selectedColor={editingItem.textColor || '#333'}
                      onSelectColor={(color) => setEditingItem({ ...editingItem, textColor: color || '#333' })}
                      includeNone={false}
                    />
                    <View style={styles.boldRow}>
                      <Text style={styles.boldLabel}>字体加粗</Text>
                      <Switch
                        value={editingItem.bold || false}
                        onValueChange={(value) => setEditingItem({ ...editingItem, bold: value })}
                        trackColor={{ false: '#ccc', true: '#1976D2' }}
                        thumbColor={editingItem.bold ? '#fff' : '#f4f3f4'}
                      />
                    </View>
                    <TouchableOpacity style={styles.saveBtn} onPress={saveItemEdit}>
                      <Text style={styles.saveBtnText}>保存事项样式</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

// ---------- 样式 ----------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 5 },
  progressScroll: { marginVertical: 18, paddingLeft: 10, maxHeight: 64 },
  progressCard: { width: 215, backgroundColor: '#fff', borderRadius: 13, marginRight: 13, shadowColor: '#9EB4D0', shadowOpacity: 0.1, shadowOffset: { width: 0, height: 2 }, shadowRadius: 12, padding: 13, justifyContent: 'center', elevation: 2 },
  progressBarBg: { height: 9, backgroundColor: '#e4ecf2', borderRadius: 5, overflow: 'hidden', marginBottom: 8 },
  progressBarFill: { backgroundColor: '#1976D2', height: '100%', borderRadius: 5 },
  progressTitle: { fontSize: 15, color: '#1976D2', fontWeight: '600', marginBottom: 3 },
  progressStats: { fontSize: 12, color: '#5776A5', marginTop: 2 },
  dayCell: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    minHeight: 110,
    maxHeight: 110,
    paddingTop: 4,
    paddingBottom: 2,
    borderRadius: 6,
    overflow: 'hidden',
    width: '100%',
  },
  holidayBadge: {
    fontSize: 10,
    color: '#E53935',
    fontWeight: 'bold',
    marginLeft: 2,
    paddingHorizontal: 3,
    backgroundColor: '#ffebee',
    borderRadius: 3,
  },
  workdayBadge: {
    fontSize: 10,
    color: '#1976D2',
    fontWeight: 'bold',
    marginLeft: 2,
    paddingHorizontal: 3,
    backgroundColor: '#e3f2fd',
    borderRadius: 3,
  },
  lunarText: { fontSize: 10, marginTop: 1, marginBottom: 1, textAlign: 'left' },
  itemText: { fontSize: 10, marginTop: 1, fontWeight: '400', flexShrink: 1 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  noteCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    width: '90%',
    maxWidth: 450,
    maxHeight: '90%',
    shadowColor: '#1976d2',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 13,
    elevation: 7,
  },
  noteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  noteDate: { fontSize: 18, fontWeight: '700', color: '#222' },
  closeText: { fontSize: 20, color: '#E53935', fontWeight: 'bold' },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 8 },
  noteList: { maxHeight: 200 },
  noteItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.6, borderColor: '#e6e6ed' },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.4, borderColor: '#bbb', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  noteItemText: { fontSize: 15, color: '#222' },
  // 我的事项：文本框外观（显示态）
  noteTextBox: {
    borderWidth: 1,
    borderColor: '#e4e9f1',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  // 双击进入后的可编辑文本框
  noteTextBoxEditing: {
    width: '100%',
    minHeight: 46,
    borderWidth: 1.4,
    borderColor: '#1976D2',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
    fontSize: 15,
    color: '#222',
  },
  noteItemDate: { fontSize: 11, color: '#888', marginTop: 2 },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  renameDoneBtn: { backgroundColor: '#1976D2', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  renameDoneText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  dateInput: { borderBottomWidth: 1, borderColor: '#1976D2', fontSize: 13, minWidth: 90, marginLeft: 4, marginRight: 4, padding: 0, color: '#1976D2' },
  addContainer: { marginTop: 10 },
  addRow: { flexDirection: 'row', alignItems: 'center' },
  autoItemText: { color: '#333', fontWeight: '400' },
  fixedItemText: { color: FIXED_GREEN, fontWeight: '400' },
  fixedRowText: { flex: 1, fontSize: 14, color: '#455A64' },
  slotText: { color: '#1976D2', fontSize: 12 },
  slotWarn: { color: '#D84315', fontSize: 12 },
  reviewRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingLeft: 32, paddingBottom: 6 },
  reviewLabel: { fontSize: 12, color: '#7E57C2', marginRight: 6 },
  reviewChip: { borderWidth: 1, borderColor: '#B39DDB', borderRadius: 12, paddingVertical: 2, paddingHorizontal: 8, marginRight: 6, marginTop: 2 },
  reviewChipText: { fontSize: 12, color: '#5E35B1' },
  startNextBtn: { backgroundColor: '#2E7D32', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 10 },
  startNextText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  startNextMeta: { color: '#C8E6C9', fontSize: 13, fontWeight: '400' },
  addHint: { fontSize: 12, color: '#2E7D32', marginTop: 6 },
  timelineLine: { fontSize: 13, color: '#455A64', paddingVertical: 2, fontVariant: ['tabular-nums'] },
  doneLine: { fontSize: 13, color: '#2E7D32', paddingVertical: 2 },
  playText: { color: '#1976D2', fontSize: 15 },
  autoSection: { marginTop: 10, paddingTop: 8, borderTopWidth: 0.6, borderColor: '#e6e6ed' },
  autoTitle: { fontSize: 13, color: '#888', marginBottom: 4 },
  autoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  autoRowText: { flex: 1, fontSize: 14, color: '#222' },
  autoMeta: { fontSize: 12, color: '#888' },
  aiInput: { borderColor: '#B39DDB' },
  aiBtn: { backgroundColor: '#7E57C2' },
  addInput: { flex: 1, padding: 8, borderWidth: 1, borderColor: '#e4e9f1', borderRadius: 8, fontSize: 15, backgroundColor: '#fff' },
  addBtn: { backgroundColor: '#1976D2', borderRadius: 17, marginLeft: 9, paddingHorizontal: 16, paddingVertical: 8 },
  newItemOptions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  optionLabel: { fontSize: 13, color: '#555', marginRight: 6 },
  // 列表行内操作：重命名输入框、上下移动箭头、小按钮
  renameInput: {
    borderBottomWidth: 1,
    borderColor: '#1976D2',
    fontSize: 15,
    padding: 0,
    paddingBottom: 2,
    color: '#222',
    minWidth: 80,
  },
  orderCol: {
    marginLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { fontSize: 12, color: '#1976D2', lineHeight: 15 },
  arrowDisabled: { color: '#cfd8e3' },
  rowBtn: { paddingHorizontal: 4, paddingVertical: 2, marginLeft: 2 },
  boldSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  // 颜色选择器
  colorPickerContainer: { marginBottom: 14 },
  colorPickerTitle: { fontSize: 14, fontWeight: '500', color: '#444', marginBottom: 6 },
  colorScroll: { flexDirection: 'row', maxHeight: 44 },
  colorCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorCircleSelected: { borderColor: '#000', borderWidth: 3 },
  boldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 10 },
  boldLabel: { fontSize: 16, color: '#333' },
  saveBtn: { backgroundColor: '#1976D2', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

// ---------- 页面入口：日历（已包含排程和固定日程）；精力打卡在「复盘 → 精力」----------
export default function CalendarPage() {
  return (
    <View style={{ flex: 1 }}>
      <HabitStrip />
      <CalendarTopBar />
      <CalendarMain />
    </View>
  );
}
