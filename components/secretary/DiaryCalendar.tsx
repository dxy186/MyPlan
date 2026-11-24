/**
 * 📔 日记簿（日历样式）：有日记的日子标 📝，有精力打卡的标彩色小点（颜色 = 当天平均精力）。
 * 双击某一天（手机上点一下）打开当天的日记、AI 每日总结、每周小结和精力记录，正文可以直接改。
 */
import React, { useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { ganzhiOf } from '@/app/utils/ganzhi';
import { DiaryEntry, EnergyLog, addDays, randomId, slotLabel } from '@/app/utils/planning';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function energyColor(avg: number) {
  return avg >= 7.5 ? '#2E7D32' : avg >= 5.5 ? '#F9A825' : '#E53935';
}

export default function DiaryCalendar({
  diary,
  logs,
  today,
  onSave,
  onDeleteDiary,
  onDeleteLog,
}: {
  diary: DiaryEntry[];
  logs: EnergyLog[];
  today: string;
  onSave: (e: DiaryEntry) => Promise<void>;
  onDeleteDiary: (id: string) => Promise<void>;
  onDeleteLog: (id: string) => Promise<void>;
}) {
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [selected, setSelected] = useState<string>(today);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState('');
  const lastTap = useRef<{ d: string; t: number }>({ d: '', t: 0 });

  const byDate = useMemo(() => new Map(diary.map(d => [d.date, d])), [diary]);
  const avgByDate = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const l of logs) m.set(l.date, [...(m.get(l.date) ?? []), l.score]);
    return new Map([...m].map(([d, s]) => [d, s.reduce((a, b) => a + b, 0) / s.length]));
  }, [logs]);

  const cells = useMemo(() => {
    const first = new Date(ym.y, ym.m, 1).getDay();
    const days = new Date(ym.y, ym.m + 1, 0).getDate();
    const out: (string | null)[] = Array(first).fill(null);
    for (let d = 1; d <= days; d++) out.push(ymd(ym.y, ym.m, d));
    while (out.length % 7) out.push(null);
    return out;
  }, [ym]);

  const openDay = (d: string) => {
    setOpen(d);
    setEdit(byDate.get(d)?.content ?? '');
  };
  const tap = (d: string) => {
    const now = Date.now();
    const dbl = lastTap.current.d === d && now - lastTap.current.t < 400;
    lastTap.current = { d, t: now };
    setSelected(d);
    // 网页 / 桌面：双击打开；手机：点一下就打开
    if (dbl || Platform.OS !== 'web') openDay(d);
  };

  const shift = (k: number) => setYm(p => {
    const m = p.m + k;
    return { y: p.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });

  const entry = open ? byDate.get(open) : undefined;
  const dayLogs = open ? logs.filter(l => l.date === open).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const writtenDays = diary.filter(d => d.content || d.mood || d.weather || d.summary || d.weekly).length;

  return (
    <View>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => shift(-1)} style={styles.nav}>
          <Text style={styles.navText}>◀</Text>
        </TouchableOpacity>
        <Text style={styles.month}>
          {ym.y} 年 {ym.m + 1} 月
        </Text>
        <TouchableOpacity onPress={() => shift(1)} style={styles.nav}>
          <Text style={styles.navText}>▶</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}
          style={styles.todayBtn}
        >
          <Text style={styles.todayText}>回到今天</Text>
        </TouchableOpacity>
        <Text style={styles.count}>已记 {writtenDays} 天</Text>
      </View>
      <View style={styles.grid}>
        {WEEK.map(w => (
          <Text key={w} style={styles.wd}>
            {w}
          </Text>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`x${i}`} style={styles.cell} />;
          const e = byDate.get(d);
          const avg = avgByDate.get(d);
          const has = !!(e && (e.content || e.mood || e.summary || e.weekly));
          return (
            <TouchableOpacity
              key={d}
              style={[styles.cell, styles.cellDay, d === selected && styles.cellSel, d === today && styles.cellToday]}
              onPress={() => tap(d)}
            >
              <Text style={[styles.dnum, d > today && styles.future]}>
                {Number(d.slice(8))}
                <Text style={styles.gzDay}> {ganzhiOf(d).day.slice(0, 2)}</Text>
              </Text>
              <Text style={styles.gzYm} numberOfLines={1}>
                {ganzhiOf(d).year}
                {ganzhiOf(d).month}
              </Text>
              <Text style={styles.mark} numberOfLines={1}>
                {e?.mood ? e.mood.split(' ')[0] : has ? '📝' : ''}
              </Text>
              {avg !== undefined ? <View style={[styles.dot, { backgroundColor: energyColor(avg) }]} /> : <View style={styles.dotEmpty} />}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>双击日期查看当天的日记和总结。📝 = 写了日记，小圆点 = 精力（绿好 · 黄一般 · 红累）。</Text>

      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={styles.mask}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <TouchableOpacity onPress={() => open && openDay(addDays(open, -1))}>
                <Text style={styles.navText}>◀</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {open} 周{open ? WEEK[new Date(open + 'T12:00:00').getDay()] : ''}
                {open === today ? '（今天）' : ''}
                {open ? (
                  <Text style={styles.gzModal}>
                    {'  '}
                    {ganzhiOf(open).year} {ganzhiOf(open).month} {ganzhiOf(open).day}
                  </Text>
                ) : null}
              </Text>
              <TouchableOpacity onPress={() => open && openDay(addDays(open, 1))}>
                <Text style={styles.navText}>▶</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setOpen(null)} style={{ marginLeft: 'auto' as any }}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 520 }}>
              {entry?.mood || entry?.weather ? <Text style={styles.tags}>{[entry.mood, entry.weather].filter(Boolean).join('　')}</Text> : null}

              <Text style={styles.sec}>✍️ 日记</Text>
              <TextInput
                style={styles.input}
                value={edit}
                onChangeText={setEdit}
                multiline
                placeholder="这天还没写日记，可以补一篇…"
                placeholderTextColor="#b9ac9a"
              />
              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.btn}
                  onPress={async () => {
                    if (!open) return;
                    const now = new Date().toISOString();
                    await onSave(
                      entry
                        ? { ...entry, content: edit.trim(), updatedAt: now }
                        : { id: randomId(), date: open, content: edit.trim(), createdAt: now, updatedAt: now }
                    );
                  }}
                >
                  <Text style={styles.btnText}>保存</Text>
                </TouchableOpacity>
                {entry ? (
                  <TouchableOpacity
                    onPress={async () => {
                      await onDeleteDiary(entry.id);
                      setEdit('');
                    }}
                  >
                    <Text style={styles.del}>删除这天的日记</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {entry?.summary ? (
                <>
                  <Text style={styles.sec}>🌙 AI 每日总结</Text>
                  <Text style={styles.aiBox}>{entry.summary}</Text>
                </>
              ) : null}
              {entry?.weekly ? (
                <>
                  <Text style={styles.sec}>📅 每周小结</Text>
                  <Text style={styles.aiBox}>{entry.weekly}</Text>
                </>
              ) : null}

              <Text style={styles.sec}>⚡ 当天精力</Text>
              {dayLogs.length === 0 ? (
                <Text style={styles.muted}>这天没有精力打卡。</Text>
              ) : (
                dayLogs.map(l => (
                  <View key={l.id} style={styles.logRow}>
                    <Text style={{ flex: 1, fontSize: 13, color: '#37474F' }}>
                      {slotLabel(l.slot)} · {l.score.toFixed(1)}/10
                      <Text style={styles.muted}>
                        　意义{l.meaning} 生理{l.physical} 情绪{l.emotional} 认知{l.cognitive} 睡眠{l.sleepQuality}
                        {l.note ? ` · ${l.note}` : ''}
                      </Text>
                    </Text>
                    <TouchableOpacity onPress={() => onDeleteLog(l.id)}>
                      <Text style={styles.del}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, gap: 8 },
  nav: { paddingHorizontal: 6, paddingVertical: 2 },
  navText: { fontSize: 15, color: '#8D6E63', fontWeight: '700' },
  month: { fontSize: 16, fontWeight: '700', color: '#5D4037' },
  todayBtn: { borderWidth: 1, borderColor: '#D7CCC8', borderRadius: 12, paddingVertical: 2, paddingHorizontal: 8 },
  todayText: { fontSize: 12, color: '#8D6E63' },
  count: { marginLeft: 'auto' as any, fontSize: 12, color: '#A1887F', fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  wd: { width: `${100 / 7}%` as any, textAlign: 'center', fontSize: 12, color: '#A1887F', paddingVertical: 4 },
  cell: { width: `${100 / 7}%` as any, height: 72, padding: 2 },
  cellDay: { alignItems: 'center', justifyContent: 'flex-start', borderRadius: 8, paddingTop: 4 },
  cellSel: { backgroundColor: '#FFF3E0' },
  cellToday: { borderWidth: 1.5, borderColor: '#FFB74D' },
  dnum: { fontSize: 14, color: '#4E342E', fontWeight: '600' },
  gzDay: { fontSize: 11, color: '#8D6E63', fontWeight: '600' },
  gzYm: { fontSize: 9, color: '#BCAAA4', marginTop: 1 },
  gzModal: { fontSize: 12, color: '#A1887F', fontWeight: '400' },
  future: { color: '#BCAAA4' },
  mark: { fontSize: 13, height: 18 },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 2 },
  dotEmpty: { width: 7, height: 7, marginTop: 2 },
  hint: { fontSize: 12, color: '#A1887F', marginTop: 6 },
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { backgroundColor: '#FFFDF8', borderRadius: 16, padding: 18, width: '100%', maxWidth: 560 },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#4E342E' },
  close: { fontSize: 20, color: '#E53935' },
  tags: { fontSize: 15, marginBottom: 4 },
  sec: { fontSize: 14, fontWeight: '700', color: '#6D4C41', marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#E8DCCB', borderRadius: 10, padding: 10, minHeight: 100, fontSize: 15, color: '#3E2723', backgroundColor: '#fff', textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  btn: { backgroundColor: '#8D6E63', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 16 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  del: { fontSize: 13, color: '#E53935' },
  aiBox: { fontSize: 14, color: '#4A148C', lineHeight: 22, backgroundColor: '#F6F0FF', borderRadius: 10, padding: 10 },
  muted: { fontSize: 12, color: '#A1887F' },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F2EBE2' },
});
