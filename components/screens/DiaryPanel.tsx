/** 📔 复盘 → 日记：按天倒序；可以自己写、改、删；AI 的每日总结和每周小结会自动归档进来 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { addDays, todayStr, weekdayOf } from '@/app/utils/planning';
import { DIARY_CHANGED_EVENT, DiaryEntry, SOURCE_LABEL, addDiary, deleteDiary, loadDiary, updateDiary } from '@/components/data/diary';
import { confirmAsync } from '@/components/ui/confirm';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function dayLabel(d: string) {
  const t = todayStr();
  if (d === t) return '今天';
  if (d === addDays(t, -1)) return '昨天';
  return `${d.slice(5).replace('-', '月')}日`;
}

export default function DiaryPanel() {
  const [list, setList] = useState<DiaryEntry[]>([]);
  const [text, setText] = useState('');
  const [date, setDate] = useState(todayStr());
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => setList(await loadDiary()), []);
  useEffect(() => {
    load();
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener(DIARY_CHANGED_EVENT, load);
    return () => window.removeEventListener(DIARY_CHANGED_EVENT, load);
  }, [load]);

  const byDay = useMemo(() => {
    const kw = q.trim();
    const m = new Map<string, DiaryEntry[]>();
    for (const e of list) {
      if (kw && !e.text.includes(kw)) continue;
      m.set(e.date, [...(m.get(e.date) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, es]) => [d, es.sort((a, b) => a.at.localeCompare(b.at))] as const);
  }, [list, q]);

  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>📔 写日记</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          multiline
          placeholder="今天发生了什么、心情怎么样、学到了什么…（也可以在「今天」页跟 AI 说「把 xxx 记进日记」）"
          placeholderTextColor="#9AA4B2"
        />
        <View style={styles.row}>
          <Text style={styles.muted}>日期</Text>
          <TextInput style={[styles.dateInput, !dateOk && styles.bad]} value={date} onChangeText={setDate} />
          <TouchableOpacity
            style={[styles.btn, (!text.trim() || !dateOk) && styles.disabled]}
            disabled={!text.trim() || !dateOk}
            onPress={async () => {
              await addDiary(text, 'me', date);
              setText('');
            }}
          >
            <Text style={styles.btnText}>保存</Text>
          </TouchableOpacity>
          <TextInput style={[styles.dateInput, { width: 150, marginLeft: 'auto' as any }]} value={q} onChangeText={setQ} placeholder="🔍 搜日记" placeholderTextColor="#9AA4B2" />
        </View>
        <Text style={styles.hint}>晚上复盘后 AI 的总结、每周小结会自动归档到这里。</Text>
      </View>

      {byDay.length === 0 && <Text style={styles.empty}>{q ? '没有找到' : '还没有日记。写下第一篇吧。'}</Text>}
      {byDay.map(([d, es]) => (
        <View key={d} style={styles.day}>
          <Text style={styles.dayTitle}>
            {dayLabel(d)} <Text style={styles.dayMeta}>{d} · 周{WEEK[weekdayOf(d)]}</Text>
          </Text>
          {es.map(e => (
            <View key={e.id} style={[styles.entry, e.source !== 'me' && styles.entryAi]}>
              <View style={styles.entryHead}>
                <Text style={styles.src}>
                  {SOURCE_LABEL[e.source]} · {new Date(e.at).toTimeString().slice(0, 5)}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setEditing(editing === e.id ? null : e.id);
                    setEditText(e.text);
                  }}
                >
                  <Text style={styles.link}>{editing === e.id ? '取消' : '编辑'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (await confirmAsync('删除这条日记？')) deleteDiary(e.id);
                  }}
                >
                  <Text style={styles.del}>删除</Text>
                </TouchableOpacity>
              </View>
              {editing === e.id ? (
                <>
                  <TextInput style={styles.input} value={editText} onChangeText={setEditText} multiline />
                  <TouchableOpacity
                    style={[styles.btn, { alignSelf: 'flex-start' }]}
                    onPress={async () => {
                      await updateDiary(e.id, editText.trim());
                      setEditing(null);
                    }}
                  >
                    <Text style={styles.btnText}>保存修改</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.text}>{e.text}</Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E3E8EF', marginBottom: 14, maxWidth: 820 },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, padding: 10, minHeight: 80, fontSize: 15, color: '#1a1a2e', backgroundColor: '#FBFCFE', textAlignVertical: 'top', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  muted: { fontSize: 13, color: '#78909C' },
  dateInput: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 14, width: 120, backgroundColor: '#fff' },
  bad: { borderColor: '#E53935' },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 16 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  hint: { fontSize: 12, color: '#90A4AE', marginTop: 8 },
  empty: { color: '#B0BEC5', textAlign: 'center', marginTop: 20 },
  day: { maxWidth: 820, marginBottom: 14 },
  dayTitle: { fontSize: 16, fontWeight: '700', color: '#37474F', marginBottom: 6 },
  dayMeta: { fontSize: 12, fontWeight: '400', color: '#90A4AE' },
  entry: { backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E3E8EF', marginBottom: 8 },
  entryAi: { backgroundColor: '#FAF7FF', borderColor: '#E1D5F5' },
  entryHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 12 },
  src: { flex: 1, fontSize: 12, color: '#7E57C2' },
  link: { fontSize: 12, color: '#1976D2' },
  del: { fontSize: 12, color: '#E53935' },
  text: { fontSize: 15, color: '#263238', lineHeight: 23 },
});
