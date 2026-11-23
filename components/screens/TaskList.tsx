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
  todayStr,
} from '@/app/utils/planning';
import { ScheduleResult } from '@/app/utils/scheduler';
import { startTaskTimer } from '@/components/assistant/gap';
import {
  AssistantAction,
  DAILY_GOAL_ID,
  PlanState,
  applyActions,
  commitState,
  loadPlanState,
  markGoalCompletion,
  spentByTask,
} from '@/components/assistant/plan-store';

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
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.confirm) return window.confirm(text);
  return true;
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
  const dueOk = !due || /^\d{4}-\d{2}-\d{2}$/.test(due);
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
          placeholder="YYYY-MM-DD，可空"
          placeholderTextColor="#aaa"
        />
        <Text style={styles.lbl}>时段</Text>
        {WINDOWS.map(w => (
          <TouchableOpacity key={w.label} style={[styles.chip, win === w.key && styles.chipBlue]} onPress={() => setWin(w.key)}>
            <Text style={[styles.chipText, win === w.key && styles.chipTextOn]}>{w.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.btn, (!title.trim() || Number(minutes) < 5 || !dueOk) && styles.disabled]}
          disabled={!title.trim() || Number(minutes) < 5 || !dueOk}
          onPress={() =>
            onSave({
              type: 'update_task',
              taskId: task.id,
              title: title.trim(),
              estimateMin: Number(minutes),
              energyCost: cost,
              due: due ? due : null,
              window: win,
            })
          }
        >
          <Text style={styles.btnText}>保存并重排</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnGhost} onPress={onClose}>
          <Text style={styles.btnGhostText}>收起</Text>
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
  const [quad, setQuad] = useState<Quadrant | 'all' | 'none'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // 快速添加
  const [newTitle, setNewTitle] = useState('');
  const [newGoal, setNewGoal] = useState<string>(DAILY_GOAL_ID);
  const [newDue, setNewDue] = useState('');
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
  useEffect(() => {
    load();
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
      markGoalCompletion(g);
      return t.done ? `✅ 完成「${t.title}」` : `↩️ 「${t.title}」改回未完成`;
    });

  const setGoalQuadrant = (goalId: string, q: Quadrant | undefined) =>
    mutate(s => {
      const g = s.goals.find(x => x.id === goalId);
      if (g) g.quadrant = q;
    });

  const deleteGoal = (goal: Goal) => {
    const n = goal.milestones.reduce((k, m) => k + m.tasks.length, 0);
    if (!confirmBox(`删除目标「${goal.title}」和它的 ${n} 个任务？此操作不能撤销（可以先去设置里导出备份）。`)) return;
    mutate(s => {
      s.goals = s.goals.filter(g => g.id !== goal.id);
      return `🗑️ 已删除目标「${goal.title}」`;
    });
  };

  const addTask = () => {
    const goalTitle = state?.goals.find(g => g.id === newGoal)?.title;
    const due = /^\d{4}-\d{2}-\d{2}$/.test(newDue) ? newDue : undefined;
    runAction({
      type: 'add_task',
      title: newTitle.trim(),
      estimateMin: 30,
      energyCost: 'medium',
      due,
      goal: newGoal === DAILY_GOAL_ID ? undefined : goalTitle,
    }).then(() => {
      setNewTitle('');
      setNewDue('');
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
  const matchQuad = (g: Goal) => quad === 'all' || (quad === 'none' ? !g.quadrant : g.quadrant === quad);

  const groups = useMemo(() => {
    if (!state) return [];
    const qOrder = (g: Goal) => (g.quadrant ? QUADRANTS.findIndex(x => x.key === g.quadrant) : 9);
    return state.goals
      .filter(matchQuad)
      .map(g => ({ goal: g, tasks: g.milestones.flatMap(m => m.tasks).filter(matchView) }))
      .filter(x => x.tasks.length > 0 || (view === 'all' && x.goal.milestones.flatMap(m => m.tasks).every(t => !t.done) && x.goal.id !== DAILY_GOAL_ID))
      .sort(
        (a, b) =>
          (a.goal.id === DAILY_GOAL_ID ? 1 : 0) - (b.goal.id === DAILY_GOAL_ID ? 1 : 0) ||
          qOrder(a.goal) - qOrder(b.goal) ||
          (a.goal.due || '9999').localeCompare(b.goal.due || '9999')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, view, quad, scheduledOn]);

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
            placeholder="截止 YYYY-MM-DD"
            placeholderTextColor="#9AA4B2"
          />
          <TouchableOpacity style={[styles.btn, (!newTitle.trim() || busy) && styles.disabled]} disabled={!newTitle.trim() || busy} onPress={addTask}>
            <Text style={styles.btnText}>添加</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <Text style={styles.lbl}>放到</Text>
          {[{ id: DAILY_GOAL_ID, title: '日常安排' }, ...activeGoals.filter(g => g.id !== DAILY_GOAL_ID).slice(0, 8)].map(g => (
            <TouchableOpacity key={g.id} style={[styles.chip, newGoal === g.id && styles.chipBlue]} onPress={() => setNewGoal(g.id)}>
              <Text style={[styles.chipText, newGoal === g.id && styles.chipTextOn]} numberOfLines={1}>
                {g.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>想让 AI 帮你拆成几步、估好时间？到「🏠 今天」直接跟它说，或用上面的「🧩 新目标 · 拆解」。</Text>
      </View>

      {/* 筛选 */}
      <View style={styles.row}>
        {VIEWS.map(v => (
          <TouchableOpacity key={v.key} style={[styles.tab, view === v.key && styles.tabOn]} onPress={() => setView(v.key)}>
            <Text style={[styles.tabText, view === v.key && styles.tabTextOn]}>{v.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ width: 12 }} />
        <TouchableOpacity style={[styles.chip, quad === 'all' && styles.chipBlue]} onPress={() => setQuad('all')}>
          <Text style={[styles.chipText, quad === 'all' && styles.chipTextOn]}>全部象限</Text>
        </TouchableOpacity>
        {QUADRANTS.map(q => (
          <TouchableOpacity
            key={q.key}
            style={[styles.chip, quad === q.key && { backgroundColor: q.color, borderColor: q.color }]}
            onPress={() => setQuad(q.key)}
          >
            <Text style={[styles.chipText, quad === q.key && styles.chipTextOn]}>{q.short}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.chip, quad === 'none' && styles.chipBlue]} onPress={() => setQuad('none')}>
          <Text style={[styles.chipText, quad === 'none' && styles.chipTextOn]}>未分类</Text>
        </TouchableOpacity>
      </View>

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
              tasks.map(t => {
                const used = spent.get(t.id) ?? 0;
                const first = scheduledOn.get(t.id);
                return (
                  <View key={t.id}>
                    <View style={styles.taskRow}>
                      <TouchableOpacity onPress={() => toggleDone(t, goal)} disabled={busy}>
                        <Text style={styles.check}>{t.done ? '✅' : '⬜'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={{ flex: 1 }} onPress={() => setEditing(editing === t.id ? null : t.id)}>
                        <Text style={[styles.taskTitle, t.done && styles.taskDone]}>{t.title}</Text>
                        <Text style={styles.taskMeta}>
                          {COST_ICON[t.energyCost]} {t.estimateMin} 分钟
                          {used ? ` · 已做 ${used} 分钟` : ''}
                          {t.due ? ` · ${dueLabel(t.due)}` : ''}
                          {!t.done && first ? ` · 排在 ${first === today ? '今天' : first.slice(5)}` : ''}
                          {t.done && t.doneAt ? ` · ${t.doneAt.slice(5, 10)} 完成` : ''}
                        </Text>
                      </TouchableOpacity>
                      {!t.done && (
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
                    {editing === t.id && (
                      <TaskEditor
                        task={t}
                        onClose={() => setEditing(null)}
                        onSave={runAction}
                        onDelete={() => {
                          if (confirmBox(`删除任务「${t.title}」？`)) runAction({ type: 'delete_task', taskId: t.id });
                        }}
                      />
                    )}
                  </View>
                );
              })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  taskMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  play: { backgroundColor: '#E8F1FC', borderRadius: 14, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  playText: { color: '#1976D2', fontSize: 13 },
  editor: { backgroundColor: '#F7FAFF', borderRadius: 8, borderWidth: 1, borderColor: '#C9DCF5', padding: 10, marginBottom: 8 },
});
