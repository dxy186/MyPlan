/** 任务 → ⭐ 重要事件：生日、纪念日、考试日、出发…只在日历上标出来，不当任务 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { addDays, todayStr, weekdayOf } from '@/app/utils/planning';
import { EVENTS_CHANGED_EVENT, ImportantEvent, addEvent, deleteEvent, eventsOn, loadEvents, looksYearly, updateEvent, yearsSince } from '@/components/data/events';
import { applyActions, commitState, loadPlanState } from '@/components/assistant/plan-store';
import { confirmAsync } from '@/components/ui/confirm';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function normDate(v: string): string | null {
  const t = v.trim();
  let m = t.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return `${todayStr().slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

export default function EventsPanel() {
  const [list, setList] = useState<ImportantEvent[]>([]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [yearly, setYearly] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const load = () => loadEvents().then(setList);
    load();
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener(EVENTS_CHANGED_EVENT, load);
    return () => window.removeEventListener(EVENTS_CHANGED_EVENT, load);
  }, []);

  // 接下来一年会遇到的（每年重复的按下一次算）
  const upcoming = useMemo(() => {
    const t = todayStr();
    const out: { d: string; e: ImportantEvent }[] = [];
    for (let k = 0; k < 366; k++) {
      const d = addDays(t, k);
      for (const e of eventsOn(list, d)) out.push({ d, e });
    }
    return out;
  }, [list]);
  const past = list.filter(e => !e.yearly && e.date < todayStr()).sort((a, b) => b.date.localeCompare(a.date));

  const isYearly = yearly ?? looksYearly(title);
  const d0 = normDate(date);
  const timeOk = !time.trim() || /^\d{1,2}[:：]\d{2}$/.test(time.trim());

  const reset = () => {
    setTitle('');
    setDate('');
    setTime('');
    setYearly(null);
    setEditing(null);
  };
  const submit = async () => {
    if (!title.trim() || !d0 || !timeOk) return;
    const tm = time.trim() ? time.trim().replace('：', ':').padStart(5, '0') : undefined;
    if (editing) {
      await updateEvent(editing, { title: title.trim(), date: d0, time: tm, yearly: isYearly });
      setMsg(`✅ 已更新「${title.trim()}」`);
    } else {
      await addEvent({ title: title.trim(), date: d0, time: tm, yearly: isYearly });
      setMsg(`⭐ 已添加「${title.trim()}」${isYearly ? '（每年）' : ''}`);
    }
    reset();
  };

  /** 记错成重要事件的 DDL：改成任务（截止日 = 这天），并删掉这个事件 */
  const toTask = async (e: ImportantEvent) => {
    const st = await loadPlanState();
    const { next, changes } = applyActions(st, [{ type: 'add_task', title: e.title, due: e.date, estimateMin: 30, energyCost: 'medium' }]);
    if (!changes[0]?.ok) return setMsg('❌ ' + (changes[0]?.summary || '没改成'));
    await commitState(next);
    await deleteEvent(e.id);
    setMsg(`✅ 「${e.title}」已改成 ${e.date.slice(5)} 截止的 DDL 任务`);
  };

  const Row = ({ d, e }: { d: string; e: ImportantEvent }) => {
    const days = Math.round((new Date(d + 'T12:00:00').getTime() - new Date(todayStr() + 'T12:00:00').getTime()) / 86400000);
    return (
      <View style={styles.row}>
        <Text style={styles.when}>
          {d.slice(5).replace('-', '/')} 周{WEEK[weekdayOf(d)]}
          <Text style={styles.days}>{days === 0 ? '　今天' : days === 1 ? '　明天' : days > 0 ? `　还有 ${days} 天` : ''}</Text>
        </Text>
        <Text style={styles.title} numberOfLines={1}>
          ⭐ {e.time ? `${e.time} ` : ''}
          {e.title}
          {e.yearly ? <Text style={styles.tag}>　每年{yearsSince(e, d) > 0 ? ` · 第 ${yearsSince(e, d)} 年` : ''}</Text> : null}
        </Text>
        <TouchableOpacity
          onPress={() => {
            setEditing(e.id);
            setTitle(e.title);
            setDate(e.date);
            setTime(e.time ?? '');
            setYearly(!!e.yearly);
          }}
        >
          <Text style={styles.link}>编辑</Text>
        </TouchableOpacity>
        {!e.yearly && (
          <TouchableOpacity onPress={() => toTask(e)}>
            <Text style={styles.link}>改成 DDL 任务</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={async () => {
            if (await confirmAsync(`删除重要事件「${e.title}」${e.yearly ? '（每年的都会删掉）' : ''}？`)) deleteEvent(e.id);
          }}
        >
          <Text style={styles.del}>删除</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.cardTitle}>⭐ 重要事件</Text>
        <Text style={styles.muted}>
          某天「发生」、需要记住的日子：生日、纪念日、考试当天、出发、节日、面试…只在日历上用 ⭐ 紫字标出来，不当任务、不勾完成、不占排程时间。也可以在日历添加框里写「*妈妈生日」，或跟 AI 说「记一下 12 月 3 号是妈妈生日」。
        </Text>
        <View style={styles.form}>
          <TextInput style={[styles.input, { flex: 1, minWidth: 160 }]} value={title} onChangeText={setTitle} placeholder="比如：妈妈生日" placeholderTextColor="#9AA4B2" />
          <TextInput style={[styles.input, { width: 120 }, date && !d0 && styles.bad]} value={date} onChangeText={setDate} placeholder="日期 12-03" placeholderTextColor="#9AA4B2" />
          <TextInput style={[styles.input, { width: 90 }, !timeOk && styles.bad]} value={time} onChangeText={setTime} placeholder="几点（可空）" placeholderTextColor="#9AA4B2" />
        </View>
        <View style={styles.form}>
          <TouchableOpacity style={[styles.chip, isYearly && styles.chipOn]} onPress={() => setYearly(!isYearly)}>
            <Text style={[styles.chipText, isYearly && styles.chipTextOn]}>{isYearly ? '✓ ' : ''}每年重复</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, (!title.trim() || !d0 || !timeOk) && { opacity: 0.45 }]} disabled={!title.trim() || !d0 || !timeOk} onPress={submit}>
            <Text style={styles.btnText}>{editing ? '保存' : '添加'}</Text>
          </TouchableOpacity>
          {editing && (
            <TouchableOpacity onPress={reset}>
              <Text style={styles.link}>取消编辑</Text>
            </TouchableOpacity>
          )}
        </View>
        {msg ? <Text style={styles.msg}>{msg}</Text> : null}

        <Text style={styles.section}>📅 接下来（一年内）</Text>
        {upcoming.length === 0 ? <Text style={styles.empty}>还没有</Text> : upcoming.slice(0, 60).map(({ d, e }) => <Row key={e.id + d} d={d} e={e} />)}
        {past.length > 0 && (
          <>
            <Text style={styles.section}>🕰 已经过去的</Text>
            {past.slice(0, 30).map(e => (
              <Row key={e.id} d={e.date} e={e} />
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E3E8EF', maxWidth: 820 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  muted: { fontSize: 13, color: '#78909C', lineHeight: 19 },
  form: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, fontSize: 14, backgroundColor: '#fff' },
  bad: { borderColor: '#E53935' },
  chip: { borderWidth: 1, borderColor: '#CE93D8', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#8E24AA', borderColor: '#8E24AA' },
  chipText: { fontSize: 13, color: '#8E24AA' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  btn: { backgroundColor: '#8E24AA', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 16 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  msg: { fontSize: 13, color: '#6A1B9A', marginTop: 8 },
  section: { fontSize: 15, fontWeight: '700', color: '#6A1B9A', marginTop: 16, marginBottom: 4 },
  empty: { fontSize: 13, color: '#B0BEC5' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F3EEF8' },
  when: { width: 150, fontSize: 13, color: '#455A64', fontWeight: '600' },
  days: { fontSize: 12, color: '#9575CD', fontWeight: '400' },
  title: { flex: 1, fontSize: 14, color: '#4A148C' },
  tag: { fontSize: 12, color: '#9575CD' },
  link: { fontSize: 13, color: '#1976D2' },
  del: { fontSize: 13, color: '#E53935' },
});
