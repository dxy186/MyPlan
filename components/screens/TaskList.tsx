/**
 * 📋 全部任务：唯一的一份任务列表（按目标分组），可以筛选、勾完成、改时长耗能、开始计时、加任务。
 * 所有改动都会从现在起重新排程，今天页 / 日历 / AI 看到的都是同一份。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  EnergyCost,
  Goal,
  KEYS,
  PlanTask,
  QUADRANTS,
  Quadrant,
  TaskWindow,
  addDays,
  loadJSON,
  minutesToHM,
  todayStr,
} from '@/app/utils/planning';
import { ScheduleResult } from '@/app/utils/scheduler';
import { DATA_CHANGED_EVENT, openBreakdown } from '@/components/assistant/breakdown';
import { startTaskTimer } from '@/components/assistant/gap';
import {
  AssistantAction,
  DAILY_GOAL_ID,
  PlanState,
  applyActions,
  commitState,
  loadPlanState,
  celebrate,
  markGoalCompletion,
  setChildrenDone,
  spentByTask,
} from '@/components/assistant/plan-store';
import { confirmAsync } from '@/components/ui/confirm';
import { PRI, PriDot, priOf } from '@/components/data/priority';
import { TAG_PALETTE, TaskTag, loadTags, saveTags, tagColor } from '@/components/data/tags';

type View_ = 'today' | 'week' | 'all' | 'done';
const VIEWS: { key: View_; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'week', label: '7 天内' },
  { key: 'all', label: '全部未完成' },
  { key: 'done', label: '已完成' },
];
const COST: { key: EnergyCost; label: string; color: string }[] = [
  { key: 'high', label: '高', color: '#D84315' },
  { key: 'medium', label: '中', color: '#F9A825' },
  { key: 'low', label: '低', color: '#2E7D32' },
];
const WINDOWS: { key: TaskWindow | null; label: string }[] = [
  { key: null, label: '不限' },
  { key: 'morning', label: '上午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '晚上' },
];
const COST_ICON: Record<EnergyCost, string> = { high: '🔴', medium: '🟡', low: '🟢' };

function confirmBox(text: string) {
  return confirmAsync(text);
}

function dueLabel(due?: string) {
  if (!due) return '';
  const today = todayStr();
  if (due < today) return `⚠️ 已过期 ${due.slice(5)}`;
  if (due === today) return '今天截止';
  if (due === addDays(today, 1)) return '明天截止';
  return `${due.slice(5)} 截止`;
}

function QuadrantTag({ q, onPick }: { q?: Quadrant; onPick: (q: Quadrant | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const info = QUADRANTS.find(x => x.key === q);
  return (
    <View>
      <TouchableOpacity
        style={[styles.qTag, info && { backgroundColor: info.color, borderColor: info.color }]}
        onPress={() => setOpen(!open)}
      >
        <Text style={[styles.qTagText, info && { color: '#fff' }]}>{info ? info.short : '设四象限'}</Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.qMenu}>
          {QUADRANTS.map(x => (
            <TouchableOpacity
              key={x.key}
              onPress={() => {
                setOpen(false);
                onPick(x.key);
              }}
            >
              <Text style={[styles.qMenuItem, { color: x.color }]}>{x.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => {
              setOpen(false);
              onPick(undefined);
            }}
          >
            <Text style={styles.qMenuItem}>不设</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/** 「11-30」「11/30」「11月30日」「2026-11-30」→ 2026-11-30；空 → ''；无效 → null */
function normDate(v: string): string | null {
  const t = v.trim();
  if (!t) return '';
  let m = t.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) {
    const today = todayStr();
    let y = Number(today.slice(0, 4));
    const d = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (d < addDays(today, -30)) y += 1; // 已经过去很久的日期 → 明年
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}
/** 「9:30」「9：30」「930」「9点半」「14点」→ 9:30；空 → ''；无效 → null */
function normTime(v: string): string | null {
  const t = v.trim().replace('：', ':');
  if (!t) return '';
  let m = t.match(/^(\d{1,2}):(\d{2})$/) || t.match(/^(\d{1,2})(\d{2})$/);
  if (!m) {
    const k = t.match(/^(\d{1,2})点(半|(\d{1,2})分?)?$/);
    if (k) m = [t, k[1], k[2] === '半' ? '30' : k[3] ?? '00'] as unknown as RegExpMatchArray;
  }
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** 「哪天做 · 几点开始」：快捷选今天 / 明天 / 后天，也可以手填 */
function StartPicker({ date, time, onDate, onTime }: { date: string; time: string; onDate: (v: string) => void; onTime: (v: string) => void }) {
  const today = todayStr();
  const quick = [
    { label: '今天', v: today },
    { label: '明天', v: addDays(today, 1) },
    { label: '后天', v: addDays(today, 2) },
  ];
  const dBad = normDate(date) === null;
  const tBad = normTime(time) === null;
  return (
    <View style={styles.row}>
      <Text style={styles.lbl}>开始</Text>
      {quick.map(q => (
        <TouchableOpacity key={q.label} style={[styles.chip, normDate(date) === q.v && styles.chipBlue]} onPress={() => onDate(normDate(date) === q.v ? '' : q.v)}>
          <Text style={[styles.chipText, normDate(date) === q.v && styles.chipTextOn]}>{q.label}</Text>
        </TouchableOpacity>
      ))}
      <TextInput
        style={[styles.input, styles.dateInput, dBad && styles.inputBad]}
        value={date}
        onChangeText={onDate}
        placeholder="哪天 11-30，可空"
        placeholderTextColor="#aaa"
      />
      <TextInput
        style={[styles.input, { width: 92 }, tBad && styles.inputBad]}
        value={time}
        onChangeText={onTime}
        placeholder="几点 14:00"
        placeholderTextColor="#aaa"
      />
    </View>
  );
}

function TaskEditor({
  task,
  onSave,
  onDelete,
  onClose,
}: {
  task: PlanTask;
  onSave: (a: AssistantAction) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [minutes, setMinutes] = useState(String(task.estimateMin));
  const [cost, setCost] = useState<EnergyCost>(task.energyCost);
  const [due, setDue] = useState(task.due ?? '');
  const [win, setWin] = useState<TaskWindow | null>(task.window ?? null);
  const [startDate, setStartDate] = useState(task.notBefore ?? '');
  const [startTime, setStartTime] = useState(task.startMin !== undefined ? minutesToHM(task.startMin) : '');
  const dueOk = normDate(due) !== null;
  const startOk = normDate(startDate) !== null && normTime(startTime) !== null;
  return (
    <View style={styles.editor}>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} />
      <View style={styles.row}>
        <Text style={styles.lbl}>时长</Text>
        <TextInput
          style={[styles.input, styles.small]}
          value={minutes}
          onChangeText={t => setMinutes(t.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
        />
        <Text style={styles.lbl}>分钟　耗能</Text>
        {COST.map(c => (
          <TouchableOpacity
            key={c.key}
            style={[styles.chip, cost === c.key && { backgroundColor: c.color, borderColor: c.color }]}
            onPress={() => setCost(c.key)}
          >
            <Text style={[styles.chipText, cost === c.key && styles.chipTextOn]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.row}>
        <Text style={styles.lbl}>截止</Text>
        <TextInput
          style={[styles.input, styles.dateInput, !dueOk && styles.inputBad]}
          value={due}
          onChangeText={setDue}
          placeholder="11-30，可空"
          placeholderTextColor="#aaa"
        />
        <Text style={styles.lbl}>时段</Text>
        {WINDOWS.map(w => (
          <TouchableOpacity key={w.label} style={[styles.chip, win === w.key && styles.chipBlue]} onPress={() => setWin(w.key)}>
            <Text style={[styles.chipText, win === w.key && styles.chipTextOn]}>{w.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <StartPicker date={startDate} time={startTime} onDate={setStartDate} onTime={setStartTime} />
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.btn, (!title.trim() || Number(minutes) < 5 || !dueOk || !startOk) && styles.disabled]}
          disabled={!title.trim() || Number(minutes) < 5 || !dueOk || !startOk}
          onPress={() => {
            const nd = normDate(due) || null;
            const sd = normDate(startDate) || null;
            const st = normTime(startTime) || null;
            onSave({
              type: 'update_task',
              taskId: task.id,
              title: title.trim(),
              estimateMin: Number(minutes),
              energyCost: cost,
              due: nd,
              notBefore: sd ?? (st ? todayStr() : null),
              startTime: st,
              window: win,
            });
          }}
        >
          <Text style={styles.btnText}>保存并重排</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnGhost} onPress={onDelete}>
          <Text style={styles.delText}>删除任务</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function TaskList() {
  const [state, setState] = useState<PlanState | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [view, setView] = useState<View_>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // 拆开的父任务默认展开，点 ▾ 收起
  const [foldedParents, setFoldedParents] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // 快速添加
  const [newTitle, setNewTitle] = useState('');
  const [newGoal, setNewGoal] = useState<string>(DAILY_GOAL_ID);
  const [newDue, setNewDue] = useState('');
  const [newStart, setNewStart] = useState('');
  const [newTime, setNewTime] = useState('');
  // 新目标
  const [goalForm, setGoalForm] = useState(false);
  const [gTitle, setGTitle] = useState('');
  const [gDue, setGDue] = useState('');
  const [gQuad, setGQuad] = useState<Quadrant | undefined>('important_not_urgent');

  const load = useCallback(async () => {
    const s = await loadPlanState();
    setState(s);
    setSchedule(await loadJSON<ScheduleResult | null>(KEYS.schedule, null));
  }, []);
  // 分类
  const [tags, setTags] = useState<TaskTag[]>([]);
  const [tagFilter, setTagFilter] = useState<string>('all'); // all / none / 分类名
  const [newTag, setNewTag] = useState<string>('');
  const [tagForm, setTagForm] = useState(false);
  const [tagName, setTagName] = useState('');
  const [pickTagFor, setPickTagFor] = useState<string | null>(null);
  const [pickPriFor, setPickPriFor] = useState<string | null>(null);
  const [newPri, setNewPri] = useState<Quadrant | ''>('');
  const [priFilter, setPriFilter] = useState<Quadrant | 'all' | 'none'>('all');
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => {
    loadTags().then(setTags);
  }, []);
  const addTagDef = async () => {
    const name = tagName.trim().slice(0, 12);
    if (!name) return;
    if (tags.some(t => t.name === name)) {
      setMsg(`「${name}」已经有了`);
      return;
    }
    const next = [...tags, { name, color: TAG_PALETTE[tags.length % TAG_PALETTE.length] }];
    setTags(next);
    await saveTags(next);
    setTagName('');
    setMsg(`🏷 已添加分类「${name}」`);
  };
  const removeTagDef = async (name: string) => {
    if (!(await confirmAsync(`删除分类「${name}」？用了这个分类的任务会变成「未分类」。`))) return;
    const next = tags.filter(t => t.name !== name);
    setTags(next);
    await saveTags(next);
    if (tagFilter === name) setTagFilter('all');
    await mutate(st => {
      for (const g of st.goals) for (const m of g.milestones) for (const t of m.tasks) if (t.tag === name) t.tag = undefined;
      return `🗑️ 已删除分类「${name}」`;
    });
  };

  useEffect(() => {
    load();
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener(DATA_CHANGED_EVENT, load);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, load);
  }, [load]);

  /** 改数据 → 保存 → 从现在起重排 */
  const mutate = async (fn: (s: PlanState) => string | void) => {
    setBusy(true);
    try {
      const fresh = await loadPlanState();
      const note = fn(fresh);
      const sch = await commitState(fresh);
      setState(fresh);
      setSchedule(sch);
      if (note) setMsg(note);
    } catch (e: any) {
      setMsg('操作失败：' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const runAction = (a: AssistantAction) =>
    mutate(s => {
      const { next, changes } = applyActions(s, [a]);
      if (!changes[0]?.ok) throw new Error(changes[0]?.summary);
      Object.assign(s, next);
      setEditing(null);
      return changes[0].summary;
    });

  const toggleDone = (task: PlanTask, goal: Goal) =>
    mutate(s => {
      const g = s.goals.find(x => x.id === goal.id);
      const t = g?.milestones.flatMap(m => m.tasks).find(x => x.id === task.id);
      if (!g || !t) return;
      t.done = !t.done;
      if (t.done) t.doneAt = new Date().toISOString();
      else delete t.doneAt;
      if (t.split) setChildrenDone(s.goals, t.id, t.done);
      markGoalCompletion(g);
      if (t.done) setTimeout(() => celebrate(t.title), 50);
      return t.done ? `✅ 完成「${t.title}」` : `↩️ 「${t.title}」改回未完成`;
    });

  const setGoalQuadrant = (goalId: string, q: Quadrant | undefined) =>
    mutate(s => {
      const g = s.goals.find(x => x.id === goalId);
      if (g) g.quadrant = q;
    });

  const deleteGoal = async (goal: Goal) => {
    const n = goal.milestones.reduce((k, m) => k + m.tasks.length, 0);
    if (!(await confirmBox(`删除目标「${goal.title}」和它的 ${n} 个任务？此操作不能撤销（可以先去设置里导出备份）。`))) return;
    mutate(s => {
      s.goals = s.goals.filter(g => g.id !== goal.id);
      return `🗑️ 已删除目标「${goal.title}」`;
    });
  };

  const addTask = () => {
    const goalTitle = state?.goals.find(g => g.id === newGoal)?.title;
    const due = normDate(newDue) || undefined;
    const sd = normDate(newStart) || undefined;
    const st = normTime(newTime) || undefined;
    runAction({
      type: 'add_task',
      title: newTitle.trim(),
      estimateMin: 30,
      energyCost: 'medium',
      due,
      notBefore: sd,
      startTime: st,
      tag: newTag || undefined,
      quadrant: newPri || undefined,
      goal: newGoal === DAILY_GOAL_ID ? undefined : goalTitle,
    }).then(() => {
      setNewTitle('');
      setNewDue('');
      setNewStart('');
      setNewTime('');
    });
  };

  const addGoal = () =>
    mutate(s => {
      const now = new Date().toISOString();
      s.goals.unshift({
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        title: gTitle.trim(),
        specific: '',
        measurable: '',
        achievable: '',
        relevant: '',
        due: /^\d{4}-\d{2}-\d{2}$/.test(gDue) ? gDue : '',
        feasibility: 70,
        difficulty: 2,
        strategy: '',
        milestones: [{ id: Math.random().toString(36).slice(2, 10), title: '任务', tasks: [] }],
        createdAt: now,
        quadrant: gQuad,
        source: 'decompose',
      });
      setGoalForm(false);
      setGTitle('');
      setGDue('');
      return `🎯 新目标「${gTitle.trim()}」已建好，在下面给它加任务，或者到「今天」让 AI 帮你拆解。`;
    });

  const today = todayStr();
  const scheduledOn = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of schedule?.items ?? []) {
      if (i.type === 'task' && i.taskId && (!m.has(i.taskId) || (m.get(i.taskId) as string) > i.date)) m.set(i.taskId, i.date);
    }
    return m;
  }, [schedule]);
  const spent = useMemo(() => spentByTask(state?.timeLogs ?? []), [state]);

  const matchView = (t: PlanTask) => {
    const first = scheduledOn.get(t.id);
    switch (view) {
      case 'done':
        return t.done;
      case 'today':
        return !t.done && ((!!t.due && t.due <= today) || first === today);
      case 'week': {
        const end = addDays(today, 7);
        return !t.done && ((!!t.due && t.due <= end) || (!!first && first <= end));
      }
      default:
        return !t.done;
    }
  };

  const groups = useMemo(() => {
    if (!state) return [];
    const qOrder = (g: Goal) => (g.quadrant ? QUADRANTS.findIndex(x => x.key === g.quadrant) : 9);
    return state.goals
      .map(g => {
        const all = g.milestones.flatMap(m => m.tasks);
        const kidsOf = (id: string) => all.filter(t => t.parentId === id);
        const matchTag = (t: PlanTask) => tagFilter === 'all' || (tagFilter === 'none' ? !t.tag : t.tag === tagFilter);
        const effPri = (t: PlanTask): Quadrant | undefined => t.quadrant ?? (t.parentId ? all.find(p => p.id === t.parentId)?.quadrant : undefined) ?? g.quadrant;
        const matchPri = (t: PlanTask) => priFilter === 'all' || (priFilter === 'none' ? !effPri(t) : effPri(t) === priFilter);
        const anyMatch = (t: PlanTask): boolean => (matchView(t) && matchTag(t) && matchPri(t)) || kidsOf(t.id).some(anyMatch);
        return { goal: g, tasks: all.filter(anyMatch) };
      })
      .filter(x => x.tasks.length > 0 || (view === 'all' && x.goal.milestones.flatMap(m => m.tasks).every(t => !t.done) && x.goal.id !== DAILY_GOAL_ID))
      .sort(
        (a, b) =>
          (a.goal.id === DAILY_GOAL_ID ? 1 : 0) - (b.goal.id === DAILY_GOAL_ID ? 1 : 0) ||
          qOrder(a.goal) - qOrder(b.goal) ||
          (a.goal.due || '9999').localeCompare(b.goal.due || '9999')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, view, tagFilter, priFilter, scheduledOn]);

  if (!state) return <ActivityIndicator style={{ marginTop: 40 }} />;
  const activeGoals = state.goals.filter(g => !g.completedAt);
  const totalShown = groups.reduce((k, g) => k + g.tasks.length, 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 60 }}>
      {msg ? (
        <TouchableOpacity onPress={() => setMsg('')}>
          <Text style={styles.msg}>{msg}</Text>
        </TouchableOpacity>
      ) : null}

      {/* 快速添加 */}
      <View style={styles.card}>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, minWidth: 200 }]}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="＋ 快速加一个任务，比如：交实验报告"
            placeholderTextColor="#9AA4B2"
            onSubmitEditing={() => newTitle.trim() && addTask()}
          />
          <TextInput
            style={[styles.input, styles.dateInput]}
            value={newDue}
            onChangeText={setNewDue}
            placeholder="截止 11-30，可空"
            placeholderTextColor="#9AA4B2"
          />
          <TouchableOpacity
            style={[styles.btn, (!newTitle.trim() || busy || normDate(newDue) === null || normDate(newStart) === null || normTime(newTime) === null) && styles.disabled]}
            disabled={!newTitle.trim() || busy || normDate(newDue) === null || normDate(newStart) === null || normTime(newTime) === null}
            onPress={addTask}
          >
            <Text style={styles.btnText}>添加</Text>
          </TouchableOpacity>
        </View>
        <StartPicker date={newStart} time={newTime} onDate={setNewStart} onTime={setNewTime} />
        <View style={styles.row}>
          <Text style={styles.lbl}>优先级</Text>
          {PRI.map(p => (
            <TouchableOpacity
              key={p.key}
              style={[styles.chip, newPri === p.key && { backgroundColor: p.color, borderColor: p.color }]}
              onPress={() => setNewPri(newPri === p.key ? '' : p.key)}
            >
              <Text style={[styles.chipText, newPri === p.key ? styles.chipTextOn : { color: p.color }]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.row}>
          <Text style={styles.lbl}>分类</Text>
          {tags.map(tg => (
            <TouchableOpacity
              key={tg.name}
              style={[styles.chip, newTag === tg.name && { backgroundColor: tg.color, borderColor: tg.color }]}
              onPress={() => setNewTag(newTag === tg.name ? '' : tg.name)}
            >
              <Text style={[styles.chipText, newTag === tg.name ? styles.chipTextOn : { color: tg.color }]}>{tg.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.chip, !newTag && styles.chipBlue]} onPress={() => setNewTag('')}>
            <Text style={[styles.chipText, !newTag && styles.chipTextOn]}>不分类</Text>
          </TouchableOpacity>
        </View>
        {activeGoals.some(g => g.id !== DAILY_GOAL_ID) && (
        <View style={styles.row}>
          <Text style={styles.lbl}>目标</Text>
          {[{ id: DAILY_GOAL_ID, title: '日常安排' }, ...activeGoals.filter(g => g.id !== DAILY_GOAL_ID).slice(0, 8)].map(g => (
            <TouchableOpacity key={g.id} style={[styles.chip, newGoal === g.id && styles.chipBlue]} onPress={() => setNewGoal(g.id)}>
              <Text style={[styles.chipText, newGoal === g.id && styles.chipTextOn]} numberOfLines={1}>
                {g.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        )}
        <Text style={styles.hint}>想让 AI 帮你拆成几步、估好时间？点任务右边的 🧩，或到「🏠 今天」直接跟它说。</Text>
      </View>

      {/* 筛选 */}
      <View style={styles.row}>
        {VIEWS.map(v => (
          <TouchableOpacity key={v.key} style={[styles.tab, view === v.key && styles.tabOn]} onPress={() => setView(v.key)}>
            <Text style={[styles.tabText, view === v.key && styles.tabTextOn]}>{v.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ width: 12 }} />
        <TouchableOpacity style={[styles.chip, (showFilters || tagFilter !== 'all' || priFilter !== 'all') && styles.chipBlue]} onPress={() => setShowFilters(!showFilters)}>
          <Text style={[styles.chipText, (showFilters || tagFilter !== 'all' || priFilter !== 'all') && styles.chipTextOn]}>
            {showFilters ? '▾ 收起筛选' : '▸ 分类 · 优先级'}
            {!showFilters && (tagFilter !== 'all' || priFilter !== 'all')
              ? `：${[tagFilter === 'all' ? '' : tagFilter === 'none' ? '未分类' : tagFilter, priFilter === 'all' ? '' : priFilter === 'none' ? '没设优先级' : priOf(priFilter)?.label]
                  .filter(Boolean)
                  .join(' · ')}`
              : ''}
          </Text>
        </TouchableOpacity>
        {!showFilters && (tagFilter !== 'all' || priFilter !== 'all') && (
          <TouchableOpacity onPress={() => { setTagFilter('all'); setPriFilter('all'); }}>
            <Text style={styles.link}>清除</Text>
          </TouchableOpacity>
        )}
      </View>
      {showFilters && (
      <View style={styles.row}>
        <Text style={styles.lbl}>分类</Text>
        <TouchableOpacity style={[styles.chip, tagFilter === 'all' && styles.chipBlue]} onPress={() => setTagFilter('all')}>
          <Text style={[styles.chipText, tagFilter === 'all' && styles.chipTextOn]}>全部</Text>
        </TouchableOpacity>
        {tags.map(tg => (
          <TouchableOpacity
            key={tg.name}
            style={[styles.chip, tagFilter === tg.name && { backgroundColor: tg.color, borderColor: tg.color }]}
            onPress={() => setTagFilter(tg.name)}
          >
            <Text style={[styles.chipText, tagFilter === tg.name ? styles.chipTextOn : { color: tg.color }]}>{tg.name}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.chip, tagFilter === 'none' && styles.chipBlue]} onPress={() => setTagFilter('none')}>
          <Text style={[styles.chipText, tagFilter === 'none' && styles.chipTextOn]}>未分类</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.chip, tagForm && styles.chipBlue]} onPress={() => setTagForm(!tagForm)}>
          <Text style={[styles.chipText, tagForm && styles.chipTextOn]}>＋ 自定义</Text>
        </TouchableOpacity>
      </View>
      )}
      {tagForm && (
        <View style={styles.card}>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1, minWidth: 160 }]}
              value={tagName}
              onChangeText={setTagName}
              placeholder="新分类的名字，比如：社团、考研、兴趣"
              placeholderTextColor="#9AA4B2"
              onSubmitEditing={addTagDef}
            />
            <TouchableOpacity style={[styles.btn, !tagName.trim() && styles.disabled]} disabled={!tagName.trim()} onPress={addTagDef}>
              <Text style={styles.btnText}>添加分类</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <Text style={styles.lbl}>现有分类</Text>
            {tags.map(tg => (
              <TouchableOpacity key={tg.name} style={[styles.chip, { borderColor: tg.color }]} onPress={() => removeTagDef(tg.name)}>
                <Text style={[styles.chipText, { color: tg.color }]}>{tg.name} ✕</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>点分类后面的 ✕ 可以删除这个分类（任务本身不会删）。</Text>
        </View>
      )}

      {showFilters && (
      <View style={styles.row}>
        <Text style={styles.lbl}>优先级</Text>
        <TouchableOpacity style={[styles.chip, priFilter === 'all' && styles.chipBlue]} onPress={() => setPriFilter('all')}>
          <Text style={[styles.chipText, priFilter === 'all' && styles.chipTextOn]}>全部</Text>
        </TouchableOpacity>
        {PRI.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.chip, priFilter === p.key && { backgroundColor: p.color, borderColor: p.color }]}
            onPress={() => setPriFilter(p.key)}
          >
            <Text style={[styles.chipText, priFilter === p.key ? styles.chipTextOn : { color: p.color }]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.chip, priFilter === 'none' && styles.chipBlue]} onPress={() => setPriFilter('none')}>
          <Text style={[styles.chipText, priFilter === 'none' && styles.chipTextOn]}>没设优先级</Text>
        </TouchableOpacity>
      </View>
      )}

      <View style={styles.rowBetween}>
        <Text style={styles.count}>共 {totalShown} 个任务</Text>
        <TouchableOpacity onPress={() => setGoalForm(!goalForm)}>
          <Text style={styles.link}>{goalForm ? '取消' : '＋ 新建目标'}</Text>
        </TouchableOpacity>
      </View>
      {goalForm && (
        <View style={styles.card}>
          <View style={styles.row}>
            <TextInput style={[styles.input, { flex: 1, minWidth: 200 }]} value={gTitle} onChangeText={setGTitle} placeholder="目标名，比如：期末论文" placeholderTextColor="#9AA4B2" />
            <TextInput style={[styles.input, styles.dateInput]} value={gDue} onChangeText={setGDue} placeholder="截止 YYYY-MM-DD" placeholderTextColor="#9AA4B2" />
          </View>
          <View style={styles.row}>
            {QUADRANTS.map(q => (
              <TouchableOpacity key={q.key} style={[styles.chip, gQuad === q.key && { backgroundColor: q.color, borderColor: q.color }]} onPress={() => setGQuad(q.key)}>
                <Text style={[styles.chipText, gQuad === q.key && styles.chipTextOn]}>{q.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.btn, (!gTitle.trim() || busy) && styles.disabled]} disabled={!gTitle.trim() || busy} onPress={addGoal}>
              <Text style={styles.btnText}>建好</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {groups.length === 0 && <Text style={styles.empty}>这里没有任务。换个筛选看看，或者在上面加一个。</Text>}

      {groups.map(({ goal, tasks }) => {
        const all = goal.milestones.flatMap(m => m.tasks);
        const doneN = all.filter(t => t.done).length;
        const isCollapsed = collapsed[goal.id];
        return (
          <View key={goal.id} style={styles.goal}>
            <View style={styles.goalHead}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => setCollapsed({ ...collapsed, [goal.id]: !isCollapsed })}>
                <Text style={styles.goalTitle}>
                  {isCollapsed ? '▸ ' : '▾ '}
                  {goal.title}
                  <Text style={styles.goalMeta}>
                    {'  '}
                    {doneN}/{all.length} 完成{goal.due ? ` · ${dueLabel(goal.due)}` : ''}
                    {goal.source === 'smart' ? ' · 来自 SMART' : ''}
                  </Text>
                </Text>
              </TouchableOpacity>
              {goal.id !== DAILY_GOAL_ID && <QuadrantTag q={goal.quadrant} onPick={q => setGoalQuadrant(goal.id, q)} />}
              {goal.id !== DAILY_GOAL_ID && (
                <TouchableOpacity onPress={() => deleteGoal(goal)}>
                  <Text style={styles.goalDel}>删除</Text>
                </TouchableOpacity>
              )}
            </View>
            {all.length > 0 && (
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.round((doneN / all.length) * 100)}%` as unknown as number }]} />
              </View>
            )}
            {!isCollapsed &&
              (() => {
                const shown = new Set(tasks.map(t => t.id));
                const kidsOf = (id: string) => tasks.filter(t => t.parentId === id);
                const tops = tasks.filter(t => !t.parentId || !shown.has(t.parentId));
                const allInGoal = goal.milestones.flatMap(m => m.tasks);
                const effQuad = (t: PlanTask) =>
                  t.quadrant ?? (t.parentId ? allInGoal.find(p => p.id === t.parentId)?.quadrant : undefined) ?? goal.quadrant;
                const renderTask = (t: PlanTask, depth: number): React.ReactNode => {
                  const used = spent.get(t.id) ?? 0;
                  const first = scheduledOn.get(t.id);
                  const kids = kidsOf(t.id);
                  const allKids = all.filter(k => k.parentId === t.id);
                  const kidsDone = allKids.filter(k => k.done).length;
                  const folded = !!foldedParents[t.id];
                  return (
                    <View key={t.id}>
                      <View style={[styles.taskRow, depth > 0 && { marginLeft: depth * 26, borderTopColor: '#F7F8FA' }]}>
                        {t.split ? (
                          <TouchableOpacity onPress={() => setFoldedParents({ ...foldedParents, [t.id]: !folded })}>
                            <Text style={styles.fold}>{folded ? '▸' : '▾'}</Text>
                          </TouchableOpacity>
                        ) : depth > 0 ? (
                          <Text style={styles.branch}>└</Text>
                        ) : null}
                        <TouchableOpacity onPress={() => toggleDone(t, goal)} disabled={busy}>
                          <Text style={styles.check}>{t.done ? '✅' : '⬜'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ flex: 1 }} onPress={() => setEditing(editing === t.id ? null : t.id)}>
                          <Text style={[styles.taskTitle, t.split && styles.parentTitle, t.done && styles.taskDone]}>
                            {!t.done && <PriDot q={effQuad(t)} size={13} />}
                            {t.title}
                          </Text>
                          <Text style={styles.taskMeta}>
                            {t.split ? (
                              <>
                                🧩 已拆成 {allKids.length} 步 · 完成 {kidsDone}/{allKids.length} · 共约 {t.estimateMin} 分钟
                                {t.due ? ` · ${dueLabel(t.due)}` : ''}
                              </>
                            ) : (
                              <>
                                {COST_ICON[t.energyCost]} {t.estimateMin} 分钟
                                {used ? ` · 已做 ${used} 分钟` : ''}
                                {t.due ? ` · ${depth > 0 && t.notBefore === t.due ? `${t.due.slice(5)} 做` : dueLabel(t.due)}` : ''}
                                {!t.done && t.notBefore && t.notBefore >= today && !(depth > 0 && t.notBefore === t.due)
                                  ? ` · ${t.notBefore === today ? '今天' : t.notBefore.slice(5)}${t.startMin !== undefined ? ` ${minutesToHM(t.startMin)}` : ''} 开始`
                                  : ''}
                                {!t.done && first ? ` · 排在 ${first === today ? '今天' : first.slice(5)}` : ''}
                                {t.done && t.doneAt ? ` · ${t.doneAt.slice(5, 10)} 完成` : ''}
                              </>
                            )}
                          </Text>
                          {!t.split && !t.done && depth === 0 && t.title.startsWith('迈出第一步') && (
                            <TouchableOpacity onPress={() => openBreakdown(t.id)}>
                              <Text style={{ fontSize: 12, color: '#1976D2', marginTop: 3 }}>👉 还没拆成具体步骤，点这里让 AI 拆成子任务</Text>
                            </TouchableOpacity>
                          )}
                          {t.split && allKids.length > 0 && (
                            <View style={styles.miniBar}>
                              <View style={[styles.miniBarFill, { width: `${Math.round((kidsDone / allKids.length) * 100)}%` as unknown as number }]} />
                            </View>
                          )}
                        </TouchableOpacity>
                        {depth === 0 && (
                          <TouchableOpacity
                            style={[styles.tagPill, priOf(t.quadrant) ? { borderStyle: 'solid', borderColor: priOf(t.quadrant)!.color, backgroundColor: priOf(t.quadrant)!.color } : null]}
                            onPress={() => {
                              setPickTagFor(null);
                              setPickPriFor(pickPriFor === t.id ? null : t.id);
                            }}
                          >
                            <Text style={[styles.tagPillText, priOf(t.quadrant) ? { color: '#fff', fontWeight: '600' } : null]}>
                              {priOf(t.quadrant)?.label ?? '＋ 优先级'}
                            </Text>
                          </TouchableOpacity>
                        )}
                        {depth === 0 && (
                          <TouchableOpacity
                            style={[styles.tagPill, t.tag ? { borderColor: tagColor(tags, t.tag), backgroundColor: tagColor(tags, t.tag) + '1A' } : null]}
                            onPress={() => {
                              setPickPriFor(null);
                              setPickTagFor(pickTagFor === t.id ? null : t.id);
                            }}
                          >
                            <Text style={[styles.tagPillText, t.tag ? { color: tagColor(tags, t.tag) } : null]}>{t.tag ? `🏷 ${t.tag}` : '＋ 分类'}</Text>
                          </TouchableOpacity>
                        )}
                        {!t.done && (
                          <TouchableOpacity style={styles.play} onPress={() => openBreakdown(t.id)}>
                            <Text style={styles.playText}>🧩</Text>
                          </TouchableOpacity>
                        )}
                        {!t.done && !t.split && (
                          <TouchableOpacity
                            style={styles.play}
                            onPress={async () => {
                              await startTaskTimer(t);
                              setMsg(`⏱ 已开始计时「${t.title}」，在「🏠 今天」最上面能看到计时和结束按钮。`);
                            }}
                          >
                            <Text style={styles.playText}>▶</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {pickPriFor === t.id && (
                        <View style={[styles.row, { paddingLeft: 36, marginTop: 0 }]}>
                          <Text style={styles.lbl}>优先级</Text>
                          {PRI.map(p => (
                            <TouchableOpacity
                              key={p.key}
                              style={[styles.chip, t.quadrant === p.key && { backgroundColor: p.color, borderColor: p.color }]}
                              onPress={() => {
                                setPickPriFor(null);
                                runAction({ type: 'update_task', taskId: t.id, quadrant: p.key });
                              }}
                            >
                              <Text style={[styles.chipText, t.quadrant === p.key ? styles.chipTextOn : { color: p.color }]}>{p.label}</Text>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity
                            style={[styles.chip, !t.quadrant && styles.chipBlue]}
                            onPress={() => {
                              setPickPriFor(null);
                              runAction({ type: 'update_task', taskId: t.id, quadrant: null });
                            }}
                          >
                            <Text style={[styles.chipText, !t.quadrant && styles.chipTextOn]}>不设</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {pickTagFor === t.id && (
                        <View style={[styles.row, { paddingLeft: 36, marginTop: 0 }]}>
                          <Text style={styles.lbl}>换成</Text>
                          {tags.map(tg => (
                            <TouchableOpacity
                              key={tg.name}
                              style={[styles.chip, t.tag === tg.name && { backgroundColor: tg.color, borderColor: tg.color }]}
                              onPress={() => {
                                setPickTagFor(null);
                                runAction({ type: 'update_task', taskId: t.id, tag: tg.name });
                              }}
                            >
                              <Text style={[styles.chipText, t.tag === tg.name ? styles.chipTextOn : { color: tg.color }]}>{tg.name}</Text>
                            </TouchableOpacity>
                          ))}
                          <TouchableOpacity
                            style={[styles.chip, !t.tag && styles.chipBlue]}
                            onPress={() => {
                              setPickTagFor(null);
                              runAction({ type: 'update_task', taskId: t.id, tag: null });
                            }}
                          >
                            <Text style={[styles.chipText, !t.tag && styles.chipTextOn]}>不分类</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setPickTagFor(null); setTagForm(true); }}>
                            <Text style={styles.link}>＋ 新分类</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {editing === t.id && (
                        <TaskEditor
                          task={t}
                          onClose={() => setEditing(null)}
                          onSave={runAction}
                          onDelete={() => {
                            const msgText = t.split
                              ? `删除「${t.title}」和它的 ${allKids.length} 个子任务？`
                              : `删除任务「${t.title}」？`;
                            confirmBox(msgText).then(ok => ok && runAction({ type: 'delete_task', taskId: t.id }));
                          }}
                        />
                      )}
                      {t.split && !folded && kids.map(k => renderTask(k, depth + 1))}
                    </View>
                  );
                };
                return tops.map(t => renderTask(t, 0));
              })()}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tagPill: { borderWidth: 1, borderColor: '#CFD8DC', borderStyle: 'dashed', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 8, marginRight: 6 },
  tagPillText: { fontSize: 12, color: '#90A4AE' },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', padding: 12, marginBottom: 12, maxWidth: 900 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', maxWidth: 900, marginVertical: 6 },
  input: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, fontSize: 14, backgroundColor: '#fff', marginRight: 8, marginBottom: 4 },
  inputBad: { borderColor: '#E57373' },
  small: { width: 70 },
  dateInput: { width: 150 },
  lbl: { fontSize: 13, color: '#666', marginRight: 6 },
  hint: { fontSize: 12, color: '#9AA4B2', marginTop: 2 },
  chip: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 4, backgroundColor: '#fff', maxWidth: 180 },
  chipBlue: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  chipText: { fontSize: 13, color: '#455A64' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, marginRight: 6, marginBottom: 4, backgroundColor: '#EEF1F5' },
  tabOn: { backgroundColor: '#1a1a2e' },
  tabText: { fontSize: 14, color: '#455A64' },
  tabTextOn: { color: '#fff', fontWeight: '600' },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginBottom: 4 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnGhost: { paddingVertical: 8, paddingHorizontal: 10, marginBottom: 4 },
  btnGhostText: { color: '#555', fontSize: 14 },
  delText: { color: '#C62828', fontSize: 14 },
  disabled: { opacity: 0.45 },
  msg: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 14, maxWidth: 900 },
  count: { fontSize: 13, color: '#888' },
  link: { color: '#1976D2', fontSize: 14, fontWeight: '600' },
  empty: { color: '#999', fontSize: 14, marginTop: 20 },
  goal: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', padding: 12, marginBottom: 12, maxWidth: 900 },
  goalHead: { flexDirection: 'row', alignItems: 'center' },
  goalTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e' },
  goalMeta: { fontSize: 12, fontWeight: '400', color: '#888' },
  goalDel: { color: '#C62828', fontSize: 13, marginLeft: 10 },
  bar: { height: 4, backgroundColor: '#EEF1F5', borderRadius: 2, marginVertical: 8, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: '#43A047' },
  qTag: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 12, paddingVertical: 2, paddingHorizontal: 8 },
  qTagText: { fontSize: 12, color: '#78909C' },
  qMenu: { position: 'absolute', top: 26, right: 0, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E5E9F0', padding: 6, zIndex: 50, width: 120 },
  qMenuItem: { fontSize: 13, paddingVertical: 5, color: '#555' },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderTopWidth: 1, borderTopColor: '#F2F4F7' },
  check: { fontSize: 18, marginRight: 10 },
  taskTitle: { fontSize: 15, color: '#1a1a2e' },
  taskDone: { color: '#9E9E9E', textDecorationLine: 'line-through' },
  parentTitle: { fontWeight: '700' },
  fold: { fontSize: 14, color: '#1976D2', width: 18 },
  branch: { fontSize: 13, color: '#B0BEC5', width: 18 },
  miniBar: { height: 3, backgroundColor: '#EEF1F5', borderRadius: 2, marginTop: 4, overflow: 'hidden', maxWidth: 220 },
  miniBarFill: { height: 3, backgroundColor: '#43A047' },
  taskMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  play: { backgroundColor: '#E8F1FC', borderRadius: 14, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  playText: { color: '#1976D2', fontSize: 13 },
  editor: { backgroundColor: '#F7FAFF', borderRadius: 8, borderWidth: 1, borderColor: '#C9DCF5', padding: 10, marginBottom: 8 },
});
