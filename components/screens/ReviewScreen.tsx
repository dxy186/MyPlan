/**
 * 📊 复盘：看自己做得怎么样。
 * - 概览：最近 7 天的数字 + 勋章（根据真实数据点亮）
 * - 时间记录：计时、琐事、碎片时间、速率
 * - 精力：精力打卡和曲线
 * - 已完成：所有完成的任务（按完成日期）
 * - 习惯档案：AI 总结的规律和你让它记住的偏好
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, todayStr } from '@/app/utils/planning';
import HabitsCard from '@/components/assistant/HabitsCard';
import { loadDailyPlans, loadReviews } from '@/components/assistant/followup';
import { PlanState, allTasks, loadPlanState } from '@/components/assistant/plan-store';
import { BadgeInput, computeBadges, weekStats } from '@/components/data/badges';
import EnergyPanel from '@/components/secretary/EnergyPanel';
import DiaryPanel from './DiaryPanel';
import SubTabBar from '@/components/secretary/SubTabBar';
import TimeLogPanel from '@/components/secretary/TimeLogPanel';

const TABS = [
  { key: 'diary', label: '📔 日记' },
  { key: 'overview', label: '📊 概览 · 勋章' },
  { key: 'time', label: '⏱ 时间记录' },
  { key: 'energy', label: '⚡ 精力' },
  { key: 'done', label: '✅ 已完成' },
  { key: 'habits', label: '🧠 习惯档案' },
];

function fmtH(min: number) {
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60 ? `${min % 60} 分` : ''}`;
}

function Overview({ state, extra }: { state: PlanState; extra: Pick<BadgeInput, 'reviewDates' | 'planDates'> }) {
  const input: BadgeInput = { goals: state.goals, timeLogs: state.timeLogs, memories: state.memories.length, ...extra };
  const w = weekStats(input);
  const badges = computeBadges(input);
  const earned = badges.filter(b => b.earned).length;
  const stats = [
    { label: '7 天内完成', value: `${w.doneWeek} 个任务` },
    { label: '7 天专注时间', value: fmtH(w.focusMin) },
    { label: '有计时的天数', value: `${w.days} / 7 天` },
    { label: '晚上复盘', value: `${w.reviews} / 7 天` },
    { label: '还没完成', value: `${w.pending} 个` },
    { label: '已过截止', value: `${w.overdue} 个` },
  ];
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.stats}>
        {stats.map(s => (
          <View key={s.label} style={styles.stat}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.section}>
        🏆 勋章 <Text style={styles.muted}>已获得 {earned} / {badges.length}</Text>
      </Text>
      <View style={styles.badges}>
        {badges.map(b => (
          <View key={b.id} style={[styles.badge, !b.earned && styles.badgeLocked]}>
            <Text style={[styles.badgeIcon, !b.earned && styles.badgeIconLocked]}>{b.icon}</Text>
            <Text style={styles.badgeName}>{b.name}</Text>
            <Text style={styles.badgeDesc}>{b.desc}</Text>
            <Text style={[styles.badgeProg, b.earned && styles.badgeDone]}>{b.progress}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function DoneList({ state }: { state: PlanState }) {
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; goal: string }[]>();
    for (const { task, goal } of allTasks(state.goals)) {
      if (!task.done) continue;
      const d = task.doneAt ? task.doneAt.slice(0, 10) : '更早';
      m.set(d, [...(m.get(d) ?? []), { title: task.title, goal: goal.title }]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === '更早' ? 1 : b[0] === '更早' ? -1 : b[0].localeCompare(a[0])));
  }, [state]);
  const today = todayStr();
  if (groups.length === 0) return <Text style={styles.muted}>还没有完成的任务。</Text>;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      {groups.map(([d, items]) => (
        <View key={d} style={styles.card}>
          <Text style={styles.cardTitle}>
            {d === today ? '今天' : d === addDays(today, -1) ? '昨天' : d}
            <Text style={styles.muted}>　{items.length} 项</Text>
          </Text>
          {items.map((it, i) => (
            <Text key={i} style={styles.doneLine}>
              ✅ {it.title}
              <Text style={styles.muted}>　{it.goal}</Text>
            </Text>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

export default function ReviewScreen() {
  const [tab, setTab] = useState('overview');
  const [state, setState] = useState<PlanState | null>(null);
  const [extra, setExtra] = useState<Pick<BadgeInput, 'reviewDates' | 'planDates'>>({ reviewDates: [], planDates: [] });

  useEffect(() => {
    (async () => {
      const [s, reviews, plans] = await Promise.all([loadPlanState(), loadReviews(), loadDailyPlans()]);
      setState(s);
      setExtra({ reviewDates: reviews.map(r => r.date), planDates: plans.map(p => p.date) });
    })();
  }, [tab]);

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.title}>📊 复盘</Text>
      <SubTabBar tabs={TABS} active={tab} onChange={setTab} />
      <View style={{ flex: 1 }}>
        {!state ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : tab === 'overview' ? (
          <Overview state={state} extra={extra} />
        ) : tab === 'time' ? (
          <TimeLogPanel />
        ) : tab === 'diary' ? (
          <DiaryPanel />
        ) : tab === 'energy' ? (
          <EnergyPanel />
        ) : tab === 'done' ? (
          <DoneList state={state} />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
            <HabitsCard state={state} defaultOpen onMemoriesChanged={m => setState({ ...state, memories: m })} />
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: 900, marginBottom: 8 },
  stat: { width: 140, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', padding: 12, marginRight: 10, marginBottom: 10 },
  statValue: { fontSize: 18, fontWeight: '700', color: '#1a1a2e' },
  statLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  section: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginTop: 8, marginBottom: 8 },
  muted: { fontSize: 13, fontWeight: '400', color: '#999' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', maxWidth: 900 },
  badge: { width: 160, backgroundColor: '#FFFBEA', borderRadius: 12, borderWidth: 1, borderColor: '#FFE082', padding: 12, marginRight: 10, marginBottom: 10, alignItems: 'center' },
  badgeLocked: { backgroundColor: '#F7F8FA', borderColor: '#E5E9F0' },
  badgeIcon: { fontSize: 30 },
  badgeIconLocked: { opacity: 0.3 },
  badgeName: { fontSize: 14, fontWeight: '700', color: '#1a1a2e', marginTop: 4 },
  badgeDesc: { fontSize: 12, color: '#777', textAlign: 'center', marginTop: 2 },
  badgeProg: { fontSize: 12, color: '#999', marginTop: 6 },
  badgeDone: { color: '#2E7D32', fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', padding: 12, marginBottom: 10, maxWidth: 900 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  doneLine: { fontSize: 14, color: '#333', marginBottom: 3 },
});
