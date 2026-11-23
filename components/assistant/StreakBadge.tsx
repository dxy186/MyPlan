/** 🔥 连续打卡：日历顶部和今天页都显示 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { StreakInfo, computeStreak } from '@/components/data/streak';

import { DATA_CHANGED_EVENT } from './breakdown';
import { loadReviews } from './followup';
import { CELEBRATE_EVENT, loadPlanState } from './plan-store';

export function useStreak() {
  const [info, setInfo] = useState<StreakInfo | null>(null);
  const load = useCallback(async () => {
    const [st, reviews] = await Promise.all([loadPlanState(), loadReviews()]);
    setInfo(computeStreak(st.goals, reviews.map(r => r.date)));
  }, []);
  useEffect(() => {
    load();
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const later = () => setTimeout(load, 300);
    window.addEventListener(CELEBRATE_EVENT, later);
    window.addEventListener(DATA_CHANGED_EVENT, later);
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, later);
      window.removeEventListener(DATA_CHANGED_EVENT, later);
    };
  }, [load]);
  return info;
}

export default function StreakBadge({ compact }: { compact?: boolean }) {
  const s = useStreak();
  if (!s) return null;
  const hint = s.todayDone
    ? '今天已打卡'
    : s.canRescue
    ? '昨天断了，今天勾掉一项就能接上'
    : s.current > 0
    ? '今天勾掉一项或复盘就能 +1'
    : '勾掉一项任务，开始连续打卡';
  return (
    <View style={[styles.wrap, s.todayDone ? styles.on : s.canRescue ? styles.warn : styles.off]}>
      <Text style={styles.fire}>{s.current > 0 || s.todayDone ? '🔥' : '🌱'}</Text>
      <Text style={styles.text}>
        {s.current > 0 ? `连续 ${s.current} 天` : '还没开始'}
        {!compact || !s.todayDone ? <Text style={styles.hint}>　{hint}</Text> : null}
        {!compact && s.best > s.current ? <Text style={styles.hint}>　最长 {s.best} 天</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, alignSelf: 'flex-start' },
  on: { backgroundColor: '#FFF3E0' },
  warn: { backgroundColor: '#FFEBEE' },
  off: { backgroundColor: '#F1F8E9' },
  fire: { fontSize: 15, marginRight: 4 },
  text: { fontSize: 13, fontWeight: '700', color: '#BF360C' },
  hint: { fontSize: 12, fontWeight: '400', color: '#8D6E63' },
});
