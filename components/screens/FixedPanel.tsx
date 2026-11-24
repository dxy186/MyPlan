/**
 * 📌 固定日程：课程、会议这类时间定死的安排，一览、添加、编辑、删除。
 * 和日历、今天页、AI 用的是同一份数据：在这里改，日历和排程马上跟着变；
 * 跟 AI 说「每周二、四 8:15-9:30 音乐课」确认后，也会出现在这里。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { FixedEvent, hmToMinutes, minutesToHM, randomId, todayStr } from '@/app/utils/planning';
import { DATA_CHANGED_EVENT } from '@/components/assistant/breakdown';
import { commitState, loadPlanState } from '@/components/assistant/plan-store';
import { confirmAsync } from '@/components/ui/confirm';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const KIND: { key: FixedEvent['kind']; label: string }[] = [
  { key: 'course', label: '📚 课程' },
  { key: 'meeting', label: '👥 会议' },
  { key: 'ticket', label: '🎫 活动' },
  { key: 'other', label: '📌 其他' },
];
const KIND_ICON: Record<FixedEvent['kind'], string> = { course: '📚', meeting: '👥', ticket: '🎫', other: '📌' };

type Draft = {
  id?: string; // 有 id = 编辑
  title: string;
  start: string;
  end: string;
  kind: FixedEvent['kind'];
  weekly: boolean;
  weekdays: number[];
  date: string;
};

const EMPTY: Draft = { title: '', start: '', end: '', kind: 'course', weekly: true, weekdays: [], date: todayStr() };
const HM = /^\d{1,2}[:：]\d{2}$/;
const norm = (s: string) => s.trim().replace('：', ':');

function confirmDel(msg: string) {
  return confirmAsync(msg);
}

export default function FixedPanel() {
  const [fixed, setFixed] = useState<FixedEvent[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState('');
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    const st = await loadPlanState();
    setFixed(st.fixed);
  }, []);
  useEffect(() => {
    load();
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener(DATA_CHANGED_EVENT, load);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, load);
  }, [load]);

  const save = async (fn: (list: FixedEvent[]) => FixedEvent[], note: string) => {
    const st = await loadPlanState();
    st.fixed = fn(st.fixed);
    await commitState(st);
    setFixed(st.fixed);
    setMsg(note);
  };

  const submit = async () => {
    if (!draft) return;
    const title = draft.title.trim();
    const s = norm(draft.start);
    const e = norm(draft.end);
    if (!title) return setMsg('❌ 写一个名称');
    if (!HM.test(s) || !HM.test(e) || hmToMinutes(e) <= hmToMinutes(s)) return setMsg('❌ 时间写成 08:15 到 09:30 这样，结束要晚于开始');
    if (draft.weekly && draft.weekdays.length === 0) return setMsg('❌ 选一下每周哪几天');
    if (!draft.weekly && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date.trim())) return setMsg('❌ 日期写成 2026-11-30 这样');
    const base = { title, startMin: hmToMinutes(s), endMin: hmToMinutes(e), kind: draft.kind };
    const made: FixedEvent[] = draft.weekly
      ? draft.weekdays.map(w => ({ id: randomId(), ...base, weekday: w }))
      : [{ id: randomId(), ...base, date: draft.date.trim() }];
    if (draft.id) {
      // 编辑：原来那条换成新的（选了多天就变成多条）
      made[0].id = draft.id;
      await save(list => list.flatMap(x => (x.id === draft.id ? made : [x])), `✅ 已更新「${title}」`);
    } else {
      await save(list => [...list, ...made], `✅ 已添加「${title}」，排程会自动避开`);
    }
    setDraft(null);
  };

  const remove = async (ev: FixedEvent) => {
    if (!(await confirmDel(`删除固定日程「${ev.title}」（${when(ev)}）？`))) return;
    await save(list => list.filter(x => x.id !== ev.id), `🗑️ 已删除「${ev.title}」`);
  };

  const removeGroup = async (evs: FixedEvent[]) => {
    if (!(await confirmDel(`删除「${evs[0].title}」的全部 ${evs.length} 个每周时段？`))) return;
    const ids = new Set(evs.map(e => e.id));
    await save(list => list.filter(x => !ids.has(x.id)), `🗑️ 已删除「${evs[0].title}」`);
  };

  if (!fixed) return null;

  const today = todayStr();
  const weekly = fixed
    .filter(e => !e.date && e.weekday !== undefined)
    .sort((a, b) => WEEK_ORDER.indexOf(a.weekday!) - WEEK_ORDER.indexOf(b.weekday!) || a.startMin - b.startMin);
  // 同名、同时间的每周日程合成一行显示：「每周二、四 08:15–09:30 音乐课」
  const groups = new Map<string, FixedEvent[]>();
  for (const e of weekly) {
    const k = `${e.title}|${e.startMin}|${e.endMin}|${e.kind}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const once = fixed.filter(e => !!e.date).sort((a, b) => a.date!.localeCompare(b.date!) || a.startMin - b.startMin);
  const upcoming = once.filter(e => e.date! >= today);
  const past = once.filter(e => e.date! < today);

  const editRow = (e: FixedEvent) =>
    setDraft({
      id: e.id,
      title: e.title,
      start: minutesToHM(e.startMin),
      end: minutesToHM(e.endMin),
      kind: e.kind,
      weekly: !e.date,
      weekdays: e.date ? [] : [e.weekday!],
      date: e.date ?? today,
    });

  const Row = ({ e, label }: { e: FixedEvent; label: string }) => (
    <View style={styles.row}>
      <Text style={styles.rowText} numberOfLines={1}>
        <Text style={styles.when}>{label}　</Text>
        {minutesToHM(e.startMin)}–{minutesToHM(e.endMin)}　{KIND_ICON[e.kind]} {e.title}
      </Text>
      <TouchableOpacity onPress={() => editRow(e)} style={styles.act}>
        <Text style={styles.edit}>编辑</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => remove(e)} style={styles.act}>
        <Text style={styles.del}>删除</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.cardTitle}>📌 固定日程</Text>
          {!draft && (
            <TouchableOpacity style={styles.btn} onPress={() => setDraft({ ...EMPTY, date: todayStr() })}>
              <Text style={styles.btnText}>＋ 添加</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.muted}>
          上课、开会这类时间定死的安排。排任务时会自动避开，日历里显示为绿字。也可以在「🏠 今天」跟 AI 说「每周二、四 8:15-9:30 音乐课」，点「应用」后会出现在这里。
        </Text>
        {msg ? <Text style={msg.startsWith('❌') ? styles.err : styles.ok}>{msg}</Text> : null}

        {draft && (
          <View style={styles.form}>
            <Text style={styles.formTitle}>{draft.id ? '✏️ 编辑固定日程' : '＋ 新的固定日程'}</Text>
            <View style={styles.formRow}>
              <TextInput
                style={[styles.input, { flex: 1, minWidth: 160 }]}
                value={draft.title}
                onChangeText={v => setDraft({ ...draft, title: v })}
                placeholder="名称，比如：音乐课"
                placeholderTextColor="#9AA4B2"
              />
              <TextInput style={[styles.input, styles.time]} value={draft.start} onChangeText={v => setDraft({ ...draft, start: v })} placeholder="08:15" placeholderTextColor="#9AA4B2" />
              <Text style={styles.muted}>到</Text>
              <TextInput style={[styles.input, styles.time]} value={draft.end} onChangeText={v => setDraft({ ...draft, end: v })} placeholder="09:30" placeholderTextColor="#9AA4B2" />
            </View>
            <View style={styles.formRow}>
              {KIND.map(k => (
                <TouchableOpacity key={k.key} style={[styles.chip, draft.kind === k.key && styles.chipOn]} onPress={() => setDraft({ ...draft, kind: k.key })}>
                  <Text style={[styles.chipText, draft.kind === k.key && styles.chipTextOn]}>{k.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.formRow}>
              <TouchableOpacity style={[styles.chip, draft.weekly && styles.chipOn]} onPress={() => setDraft({ ...draft, weekly: true })}>
                <Text style={[styles.chipText, draft.weekly && styles.chipTextOn]}>🔁 每周重复</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.chip, !draft.weekly && styles.chipOn]} onPress={() => setDraft({ ...draft, weekly: false })}>
                <Text style={[styles.chipText, !draft.weekly && styles.chipTextOn]}>📅 只有某一天</Text>
              </TouchableOpacity>
            </View>
            {draft.weekly ? (
              <View style={styles.formRow}>
                <Text style={styles.muted}>每周：</Text>
                {WEEK_ORDER.map(w => {
                  const on = draft.weekdays.includes(w);
                  return (
                    <TouchableOpacity
                      key={w}
                      style={[styles.day, on && styles.chipOn]}
                      onPress={() => setDraft({ ...draft, weekdays: on ? draft.weekdays.filter(x => x !== w) : [...draft.weekdays, w] })}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{WEEK[w]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.formRow}>
                <Text style={styles.muted}>日期：</Text>
                <TextInput style={[styles.input, { width: 130 }]} value={draft.date} onChangeText={v => setDraft({ ...draft, date: v })} placeholder="2026-11-30" placeholderTextColor="#9AA4B2" />
              </View>
            )}
            <View style={styles.formRow}>
              <TouchableOpacity style={styles.btn} onPress={submit}>
                <Text style={styles.btnText}>{draft.id ? '保存' : '添加'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ghost} onPress={() => setDraft(null)}>
                <Text style={styles.edit}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <Text style={styles.section}>🔁 每周重复（{groups.size}）</Text>
        {groups.size === 0 && <Text style={styles.empty}>还没有</Text>}
        {[...groups.values()].map(evs => (
          <View key={evs[0].id}>
            {evs.length === 1 ? (
              <Row e={evs[0]} label={`每周${WEEK[evs[0].weekday!]}`} />
            ) : (
              <View>
                <View style={styles.row}>
                  <Text style={styles.rowText} numberOfLines={1}>
                    <Text style={styles.when}>每周{evs.map(e => WEEK[e.weekday!]).join('、')}　</Text>
                    {minutesToHM(evs[0].startMin)}–{minutesToHM(evs[0].endMin)}　{KIND_ICON[evs[0].kind]} {evs[0].title}
                  </Text>
                  <TouchableOpacity onPress={() => removeGroup(evs)} style={styles.act}>
                    <Text style={styles.del}>全部删除</Text>
                  </TouchableOpacity>
                </View>
                {evs.map(e => (
                  <View key={e.id} style={{ paddingLeft: 18 }}>
                    <Row e={e} label={`└ 周${WEEK[e.weekday!]}`} />
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}

        <Text style={styles.section}>📅 单次（{upcoming.length}）</Text>
        {upcoming.length === 0 && <Text style={styles.empty}>还没有</Text>}
        {upcoming.map(e => (
          <Row key={e.id} e={e} label={e.date === today ? '今天' : e.date!.slice(5).replace('-', '/')} />
        ))}
        {past.length > 0 && (
          <TouchableOpacity onPress={() => setShowPast(!showPast)}>
            <Text style={styles.link}>{showPast ? '▾ 收起' : `▸ 已经过去的 ${past.length} 个`}</Text>
          </TouchableOpacity>
        )}
        {showPast && past.map(e => <Row key={e.id} e={e} label={e.date!.slice(5).replace('-', '/')} />)}
      </View>
    </ScrollView>
  );
}

function when(e: FixedEvent) {
  return e.date ? e.date : `每周${WEEK[e.weekday ?? 0]}`;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E3E8EF', maxWidth: 820 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e' },
  muted: { fontSize: 13, color: '#78909C', marginRight: 6 },
  ok: { color: '#2E7D32', fontSize: 13, marginTop: 6 },
  err: { color: '#C62828', fontSize: 13, marginTop: 6 },
  section: { fontSize: 15, fontWeight: '700', color: '#2E7D32', marginTop: 16, marginBottom: 4 },
  empty: { fontSize: 13, color: '#B0BEC5', paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F1F4F8' },
  rowText: { flex: 1, fontSize: 14, color: '#2E7D32' },
  when: { color: '#455A64', fontWeight: '600' },
  act: { paddingHorizontal: 8, paddingVertical: 2 },
  edit: { color: '#1976D2', fontSize: 13, fontWeight: '600' },
  del: { color: '#E53935', fontSize: 13 },
  link: { color: '#1976D2', fontSize: 13, marginTop: 8 },
  form: { backgroundColor: '#F6FAF6', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#C8E6C9' },
  formTitle: { fontSize: 14, fontWeight: '700', color: '#2E7D32', marginBottom: 6 },
  formRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 6 },
  input: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 14, backgroundColor: '#fff', marginRight: 6 },
  time: { width: 72, textAlign: 'center' },
  chip: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 4, backgroundColor: '#fff' },
  day: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 14, width: 32, height: 28, alignItems: 'center', justifyContent: 'center', marginRight: 4, marginBottom: 4, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  chipText: { fontSize: 13, color: '#455A64' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  btn: { backgroundColor: '#2E7D32', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  ghost: { paddingVertical: 7, paddingHorizontal: 12 },
});
