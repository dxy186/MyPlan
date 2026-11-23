/**
 * 🧠 我的习惯档案：系统从数据里总结的规律 + 你让 AI 记住的偏好
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { loadReviews, reasonSummary } from './followup';
import { HabitInsight, Memory, buildInsights, loadBlockLog, saveMemories } from './habits';
import { PlanState } from './plan-store';

export default function HabitsCard({
  state,
  onMemoriesChanged,
  onAsk,
  defaultOpen = false,
}: {
  state: PlanState;
  onMemoriesChanged: (m: Memory[]) => void;
  /** 让 AI 处理一句话（不传时「让 AI 忘掉」按钮不显示） */
  onAsk?: (text: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [insights, setInsights] = useState<HabitInsight[] | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [blocks, reviews] = await Promise.all([loadBlockLog(), loadReviews()]);
      setInsights(buildInsights(state.timeLogs, state.goals, blocks, reasonSummary(reviews)));
    })();
  }, [open, state]);

  const memories = state.memories ?? [];

  const remove = async (id: string) => {
    const next = memories.filter(m => m.id !== id);
    await saveMemories(next);
    onMemoriesChanged(next);
  };

  if (!open) {
    return (
      <TouchableOpacity style={styles.closed} onPress={() => setOpen(true)}>
        <Text style={styles.closedText}>
          🧠 我的习惯档案{memories.length ? `（记住了 ${memories.length} 条偏好）` : ''}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>🧠 我的习惯档案</Text>
        <TouchableOpacity onPress={() => setOpen(false)}>
          <Text style={styles.link}>收起</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>你让我记住的</Text>
      {memories.length === 0 ? (
        <Text style={styles.muted}>
          还没有。直接在上面跟 AI 说，比如「记住：周末上午我不想学习」「以后晚上 10 点后别给我排任务」。
        </Text>
      ) : (
        memories.map(m => (
          <View key={m.id} style={styles.memRow}>
            <Text style={styles.memText}>• {m.text}</Text>
            {onAsk && (
              <TouchableOpacity onPress={() => onAsk(`忘掉这条偏好：${m.text}`)}>
                <Text style={styles.link}>让 AI 忘掉</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => remove(m.id)}>
              <Text style={styles.del}>直接删除</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <Text style={styles.section}>从你的数据里发现的</Text>
      {insights === null ? (
        <Text style={styles.muted}>正在分析…</Text>
      ) : insights.length === 0 ? (
        <Text style={styles.muted}>
          数据还不够。多用计时（选中任务再开始）、按时间轴做事、晚上做复盘，几天后这里就会出现你的规律，比如哪类任务总是低估、哪个时段最高效。
        </Text>
      ) : (
        insights.map((i, k) => (
          <Text key={k} style={styles.insight}>
            {i.icon} {i.text}
          </Text>
        ))
      )}
      <Text style={styles.foot}>
        这些规律会自动用于排程（比如给常低估的那类任务多留时间），AI 规划时也会参考。「让 AI 忘掉」会顺带删掉对应的占位日程。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  closed: { paddingVertical: 10, marginTop: 6, maxWidth: 820 },
  closedText: { color: '#5E35B1', fontSize: 14, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#D1C4E9', padding: 16, marginTop: 14, maxWidth: 820 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a2e' },
  link: { color: '#1976D2', fontSize: 13, marginLeft: 10 },
  del: { color: '#C62828', fontSize: 13, marginLeft: 10 },
  section: { fontSize: 14, fontWeight: '700', color: '#5E35B1', marginTop: 12, marginBottom: 6 },
  muted: { fontSize: 13, color: '#888', lineHeight: 19 },
  memRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 },
  memText: { fontSize: 14, color: '#333', flexShrink: 1 },
  insight: { fontSize: 14, color: '#333', lineHeight: 21, marginBottom: 4 },
  foot: { fontSize: 12, color: '#999', marginTop: 10, lineHeight: 18 },
});
