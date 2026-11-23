/** 📅 每周小结：周日 18 点后看本周，周一、周二补看上周 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { computeStreak } from '@/components/data/streak';
import { WeeklySummary, buildWeekly, loadWeeklies, saveWeekly, weekToReview } from '@/components/data/weekly';

import { weeklyComment } from './coach';
import { loadReviews } from './followup';
import { PlanState } from './plan-store';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function useWeeklyPending() {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const ws = weekToReview();
    if (!ws) return;
    loadWeeklies().then(all => setPending(!all.find(w => w.weekStart === ws)?.seenAt));
  }, []);
  return pending;
}

export default function WeeklyCard({ state, force }: { state: PlanState; force?: boolean }) {
  const [w, setW] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const ws = weekToReview();
    if (!ws) return;
    (async () => {
      const all = await loadWeeklies();
      const saved = all.find(x => x.weekStart === ws);
      if (saved?.seenAt && !force) return;
      const fresh = { ...buildWeekly(state.goals, state.timeLogs, ws), comment: saved?.comment };
      const st = computeStreak(state.goals, (await loadReviews()).map(r => r.date)).current;
      setStreak(st);
      setW(fresh);
      if (!fresh.comment) {
        setLoading(true);
        const c = await weeklyComment(fresh, st);
        setLoading(false);
        if (c) {
          const withC = { ...fresh, comment: c };
          setW(withC);
          await saveWeekly(withC);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [force]);

  if (!w || hidden) return null;
  const bd = w.bestDay ? new Date(w.bestDay.date + 'T12:00:00') : null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        📅 本周小结 <Text style={styles.range}>{w.weekStart.slice(5)} – {w.weekEnd.slice(5)}</Text>
      </Text>
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.v}>{w.done}</Text>
          <Text style={styles.l}>完成任务</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.v}>
            {Math.floor(w.focusMin / 60)}h{w.focusMin % 60 ? `${w.focusMin % 60}m` : ''}
          </Text>
          <Text style={styles.l}>专注时间</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.v}>{w.activeDays}/7</Text>
          <Text style={styles.l}>有记录的天</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.v}>🔥{streak}</Text>
          <Text style={styles.l}>连续打卡</Text>
        </View>
      </View>
      {bd && w.bestDay ? (
        <Text style={styles.line}>
          🏆 最好的一天：{w.bestDay.date.slice(5)}（周{WEEK[bd.getDay()]}），完成 {w.bestDay.done} 项、专注 {w.bestDay.focusMin} 分钟
        </Text>
      ) : null}
      {w.overdue > 0 && <Text style={styles.line}>⚠️ 截止在本周（或更早）还没完成的任务：{w.overdue} 个</Text>}
      {w.nextWeek.length > 0 && <Text style={styles.line}>➡️ 下周截止：{w.nextWeek.join('、')}</Text>}
      {loading ? (
        <View style={styles.row}>
          <ActivityIndicator size="small" />
          <Text style={styles.muted}>　AI 正在写小结…</Text>
        </View>
      ) : w.comment ? (
        <Text style={styles.comment}>💬 {w.comment}</Text>
      ) : null}
      <TouchableOpacity
        style={styles.btn}
        onPress={async () => {
          await saveWeekly({ ...w, seenAt: new Date().toISOString() });
          setHidden(true);
        }}
      >
        <Text style={styles.btnText}>看完了，下周继续</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#F3F8FF', borderRadius: 12, borderWidth: 1, borderColor: '#BBDEFB', padding: 14, marginBottom: 14, maxWidth: 820 },
  title: { fontSize: 17, fontWeight: '700', color: '#0D47A1', marginBottom: 8 },
  range: { fontSize: 13, fontWeight: '400', color: '#607D8B' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  stat: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginRight: 8, marginBottom: 6, minWidth: 84, alignItems: 'center' },
  v: { fontSize: 18, fontWeight: '700', color: '#1a1a2e' },
  l: { fontSize: 12, color: '#888', marginTop: 2 },
  line: { fontSize: 14, color: '#37474F', marginTop: 4 },
  comment: { fontSize: 14, color: '#1a1a2e', lineHeight: 21, marginTop: 8, backgroundColor: '#fff', borderRadius: 8, padding: 10 },
  muted: { fontSize: 13, color: '#888' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignSelf: 'flex-start', marginTop: 10 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
