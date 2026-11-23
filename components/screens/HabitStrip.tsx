/** 日历顶部的一行：🔥 连续打卡 + 到点后的「复盘今天」「本周小结」入口 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { todayStr } from '@/app/utils/planning';
import { loadReminderSettings, loadReviews, minuteNow, openTarget } from '@/components/assistant/followup';
import StreakBadge from '@/components/assistant/StreakBadge';
import { useWeeklyPending } from '@/components/assistant/WeeklyCard';

export default function HabitStrip() {
  const weekly = useWeeklyPending();
  const [needReview, setNeedReview] = useState(false);
  useEffect(() => {
    const check = async () => {
      const [s, reviews] = await Promise.all([loadReminderSettings(), loadReviews()]);
      setNeedReview(minuteNow() >= s.eveningReviewAt && !reviews.some(r => r.date === todayStr()));
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.row}>
      <StreakBadge compact />
      {needReview && (
        <TouchableOpacity style={[styles.chip, styles.review]} onPress={() => openTarget('review')}>
          <Text style={styles.chipText}>🌙 1 分钟复盘今天</Text>
        </TouchableOpacity>
      )}
      {weekly && (
        <TouchableOpacity style={[styles.chip, styles.weekly]} onPress={() => openTarget('weekly')}>
          <Text style={styles.chipText}>📅 本周小结出来了</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 6, gap: 8 },
  chip: { borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10 },
  review: { backgroundColor: '#EDE7F6' },
  weekly: { backgroundColor: '#E3F2FD' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#37474F' },
});
