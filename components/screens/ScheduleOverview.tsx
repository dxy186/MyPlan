/**
 * 日历 → 双轨排程：月视图，把排好的任务（弹性轨）和固定日程（固定轨）、截止日期、完成记录放在一起看；
 * 点某一天可以看当天的完整排程、管理固定日程（课程 / 会议 / 每周重复）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { getHolidayData } from '@/app/utils/holidays';
import { solarToLunar } from '@/app/utils/lunar';
import { FixedEvent, KEYS, PlanTask, hmToMinutes, loadJSON, minutesToHM, randomId, todayStr, weekdayOf } from '@/app/utils/planning';
import { ScheduleItem, ScheduleResult } from '@/app/utils/scheduler';
import { PlanState, allTasks, commitState, loadPlanState } from '@/components/assistant/plan-store';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const KIND: { key: FixedEvent['kind']; label: string }[] = [
  { key: 'course', label: '📚 课程' },
  { key: 'meeting', label: '👥 会议' },
  { key: 'ticket', label: '🎫 活动' },
  { key: 'other', label: '📌 其他' },
];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function eventsOn(fixed: FixedEvent[], date: string) {
  const wd = weekdayOf(date);
  return fixed.filter(e => (e.date ? e.date === date : e.weekday === wd)).sort((a, b) => a.startMin - b.startMin);
}

type DayInfo = { scheduled: ScheduleItem[]; due: PlanTask[]; done: PlanTask[]; fixed: FixedEvent[] };

export default function ScheduleOverview() {
  const [state, setState] = useState<PlanState | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState(todayStr());
  const [holidays, setHolidays] = useState<Record<string, { name: string; off: boolean }>>({});
  const [msg, setMsg] = useState('');
  // 新固定日程
  const [fTitle, setFTitle] = useState('');
  const [fStart, setFStart] = useState('09:00');
  const [fEnd, setFEnd] = useState('10:00');
  const [fKind, setFKind] = useState<FixedEvent['kind']>('course');
  const [fWeekly, setFWeekly] = useState(false);

  const load = useCallback(async () => {
    setState(await loadPlanState());
    setSchedule(await loadJSON<ScheduleResult | null>(KEYS.schedule, null));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const y = month.getFullYear();
    (async () => {
      const map: Record<string, { name: string; off: boolean }> = {};
      for (const yr of [y - 1, y, y + 1]) {
        try {
          const data = await getHolidayData(yr);
          data?.days.forEach(d => (map[d.date] = { name: d.name, off: d.isOffDay }));
        } catch {}
      }
      setHolidays(map);
    })();
  }, [month]);

  const byDay = useMemo(() => {
    const m = new Map<string, DayInfo>();
    const get = (d: string) => {
      if (!m.has(d)) m.set(d, { scheduled: [], due: [], done: [], fixed: [] });
      return m.get(d) as DayInfo;
    };
    for (const i of schedule?.items ?? []) if (i.type === 'task') get(i.date).scheduled.push(i);
    for (const { task } of state ? allTasks(state.goals) : []) {
      if (task.due && !task.done) get(task.due).due.push(task);
      if (task.done && task.doneAt) get(task.doneAt.slice(0, 10)).done.push(task);
    }
    return m;
  }, [schedule, state]);

  const cells = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  if (!state) return <ActivityIndicator style={{ marginTop: 40 }} />;

  const today = todayStr();
  const info = byDay.get(selected) ?? { scheduled: [], due: [], done: [], fixed: [] };
  const dayFixed = eventsOn(state.fixed, selected);
  const daySchedule = (schedule?.items ?? [])
    .filter(i => i.date === selected && i.type !== 'buffer')
    .sort((a, b) => a.startMin - b.startMin);

  const addFixed = async () => {
    const s = hmToMinutes(fStart);
    const e = hmToMinutes(fEnd);
    if (!fTitle.trim() || !(e > s)) {
      setMsg('请填好名称，结束时间要晚于开始时间');
      return;
    }
    const st = await loadPlanState();
    st.fixed.push({
      id: randomId(),
      title: fTitle.trim(),
      date: fWeekly ? undefined : selected,
      weekday: fWeekly ? weekdayOf(selected) : undefined,
      startMin: s,
      endMin: e,
      kind: fKind,
    });
    const sch = await commitState(st);
    setState(st);
    setSchedule(sch);
    setFTitle('');
    setMsg(`📌 已添加「${fTitle.trim()}」，排程已避开这段时间`);
  };

  const removeFixed = async (ev: FixedEvent) => {
    if (Platform.OS === 'web' && !window.confirm(`删除固定日程「${ev.title}」${ev.weekday !== undefined ? '（每周重复的全部删除）' : ''}？`)) return;
    const st = await loadPlanState();
    st.fixed = st.fixed.filter(x => x.id !== ev.id);
    const sch = await commitState(st);
    setState(st);
    setSchedule(sch);
  };

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => shift(-1)}>
          <Text style={styles.nav}>‹ 上月</Text>
        </TouchableOpacity>
        <Text style={styles.month}>
          {month.getFullYear()} 年 {month.getMonth() + 1} 月
        </Text>
        <TouchableOpacity onPress={() => shift(1)}>
          <Text style={styles.nav}>下月 ›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            const d = new Date();
            setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
            setSelected(todayStr());
          }}
        >
          <Text style={styles.nav}>回到今天</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendItem}>🔵 已排任务</Text>
        <Text style={styles.legendItem}>🔴 截止</Text>
        <Text style={styles.legendItem}>📌 固定日程</Text>
        <Text style={styles.legendItem}>✅ 完成</Text>
      </View>

      <View style={styles.grid}>
        {WEEK.map(w => (
          <Text key={w} style={styles.weekHead}>
            {w}
          </Text>
        ))}
        {cells.map(d => {
          const key = ymd(d);
          const inMonth = d.getMonth() === month.getMonth();
          const di = byDay.get(key);
          const fx = eventsOn(state.fixed, key).length;
          const hol = holidays[key];
          let lunar = '';
          try {
            lunar = (solarToLunar(key) as { day?: string })?.day ?? '';
          } catch {}
          const isSel = key === selected;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.cell, !inMonth && styles.cellOut, key === today && styles.cellToday, isSel && styles.cellSel]}
              onPress={() => setSelected(key)}
            >
              <View style={styles.cellTop}>
                <Text style={[styles.dayNum, (d.getDay() === 0 || d.getDay() === 6 || hol?.off) && styles.dayWeekend]}>{d.getDate()}</Text>
                {hol ? <Text style={[styles.hol, !hol.off && styles.holWork]}>{hol.off ? '休' : '班'}</Text> : null}
              </View>
              <Text style={styles.lunar} numberOfLines={1}>
                {hol?.off && hol.name ? hol.name : lunar}
              </Text>
              <View style={styles.marks}>
                {di?.scheduled.length ? <Text style={styles.mark}>🔵{new Set(di.scheduled.map(s => s.taskId)).size}</Text> : null}
                {di?.due.length ? <Text style={styles.mark}>🔴{di.due.length}</Text> : null}
                {fx ? <Text style={styles.mark}>📌{fx}</Text> : null}
                {di?.done.length ? <Text style={styles.mark}>✅{di.done.length}</Text> : null}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 选中那天 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {selected}（周{WEEK[weekdayOf(selected)]}）{selected === today ? ' · 今天' : ''}
          {holidays[selected]?.name ? ` · ${holidays[selected].name}` : ''}
        </Text>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}

        <Text style={styles.section}>当天安排</Text>
        {daySchedule.length === 0 ? (
          <Text style={styles.muted}>{selected < today ? '（过去的日子不显示排程）' : '（没有排程，或超出了排程天数）'}</Text>
        ) : (
          daySchedule.map(i => (
            <Text key={i.id} style={styles.line}>
              {minutesToHM(i.startMin)}–{minutesToHM(i.endMin)}　{i.type === 'task' ? '📝' : i.type === 'fixed' ? '📌' : i.type === 'play' ? '🎮' : i.type === 'rest' ? '🛌' : '·'} {i.title}
              {i.note ? <Text style={styles.warn}>　⚠️ {i.note}</Text> : null}
            </Text>
          ))
        )}

        {info.due.length > 0 && (
          <>
            <Text style={styles.section}>这天截止</Text>
            {info.due.map(t => (
              <Text key={t.id} style={styles.line}>
                🔴 {t.title}
              </Text>
            ))}
          </>
        )}
        {info.done.length > 0 && (
          <>
            <Text style={styles.section}>这天完成</Text>
            {info.done.map(t => (
              <Text key={t.id} style={styles.line}>
                ✅ {t.title}
              </Text>
            ))}
          </>
        )}

        <Text style={styles.section}>固定日程</Text>
        {dayFixed.length === 0 && <Text style={styles.muted}>（没有）</Text>}
        {dayFixed.map(e => (
          <View key={e.id} style={styles.fixedRow}>
            <Text style={styles.line}>
              📌 {minutesToHM(e.startMin)}–{minutesToHM(e.endMin)}　{e.title}
              <Text style={styles.muted}>{e.weekday !== undefined ? `　每周${WEEK[e.weekday]}` : ''}</Text>
            </Text>
            <TouchableOpacity onPress={() => removeFixed(e)}>
              <Text style={styles.del}>删除</Text>
            </TouchableOpacity>
          </View>
        ))}

        <View style={styles.form}>
          <Text style={styles.formTitle}>＋ 在这天加固定日程（排程会自动避开）</Text>
          <View style={styles.row}>
            <TextInput style={[styles.input, { flex: 1, minWidth: 160 }]} value={fTitle} onChangeText={setFTitle} placeholder="名称，比如：高数课" placeholderTextColor="#9AA4B2" />
            <TextInput style={[styles.input, styles.time]} value={fStart} onChangeText={setFStart} placeholder="09:00" />
            <Text style={styles.muted}>到</Text>
            <TextInput style={[styles.input, styles.time]} value={fEnd} onChangeText={setFEnd} placeholder="10:00" />
          </View>
          <View style={styles.row}>
            {KIND.map(k => (
              <TouchableOpacity key={k.key} style={[styles.chip, fKind === k.key && styles.chipOn]} onPress={() => setFKind(k.key)}>
                <Text style={[styles.chipText, fKind === k.key && styles.chipTextOn]}>{k.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.chip, fWeekly && styles.chipOn]} onPress={() => setFWeekly(!fWeekly)}>
              <Text style={[styles.chipText, fWeekly && styles.chipTextOn]}>{fWeekly ? `✓ 每周${WEEK[weekdayOf(selected)]}重复` : '只这一天'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={addFixed}>
              <Text style={styles.btnText}>添加</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.muted}>也可以直接在「🏠 今天」跟 AI 说：「每周二、四上午 8 点到 10 点上课」。</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' },
  nav: { color: '#1976D2', fontSize: 14, marginRight: 16 },
  month: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginRight: 16 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  legendItem: { fontSize: 12, color: '#888', marginRight: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: 840, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', overflow: 'hidden' },
  weekHead: { width: '14.2857%' as unknown as number, textAlign: 'center', paddingVertical: 6, fontSize: 13, color: '#888', backgroundColor: '#F7F9FC' },
  cell: { width: '14.2857%' as unknown as number, minHeight: 78, padding: 4, borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#F0F2F5' },
  cellOut: { opacity: 0.4 },
  cellToday: { backgroundColor: '#F1F7FF' },
  cellSel: { backgroundColor: '#E3F0FF', borderColor: '#90CAF9' },
  cellTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayNum: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
  dayWeekend: { color: '#D84315' },
  hol: { fontSize: 10, color: '#fff', backgroundColor: '#E53935', borderRadius: 3, paddingHorizontal: 3 },
  holWork: { backgroundColor: '#78909C' },
  lunar: { fontSize: 10, color: '#999' },
  marks: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  mark: { fontSize: 10, marginRight: 3, color: '#555' },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', padding: 14, marginTop: 14, maxWidth: 840 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  section: { fontSize: 14, fontWeight: '700', color: '#455A64', marginTop: 10, marginBottom: 4 },
  line: { fontSize: 14, color: '#333', marginBottom: 3, fontVariant: ['tabular-nums'] },
  warn: { color: '#BF360C', fontSize: 12 },
  muted: { fontSize: 13, color: '#999' },
  msg: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: 8, borderRadius: 8, fontSize: 13, marginBottom: 6 },
  fixedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  del: { color: '#C62828', fontSize: 13, marginLeft: 10 },
  form: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#F0F2F5', paddingTop: 10 },
  formTitle: { fontSize: 14, fontWeight: '600', color: '#1a1a2e', marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, fontSize: 14, marginRight: 6, marginBottom: 4, backgroundColor: '#fff' },
  time: { width: 70, textAlign: 'center' },
  chip: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 4, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  chipText: { fontSize: 13, color: '#455A64' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14, marginBottom: 4 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
