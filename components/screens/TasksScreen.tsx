/**
 * 📋 任务：所有任务在一个地方。
 * - 全部任务：统一列表（按目标分组、四象限、筛选、勾完成、计时）
 * - 固定日程：课程、会议等定死的时间，一览、添加、编辑、删除
 * - 导入 · 任务池：Canvas / iCal / 手动收集
 * - WOOP：心理对照，想清楚后可以一键变成目标
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import InboxPanel from '@/components/secretary/InboxPanel';
import SubTabBar from '@/components/secretary/SubTabBar';

import FixedPanel from './FixedPanel';
import TaskList from './TaskList';
import WoopPanel from './WoopPanel';

const TABS = [
  { key: 'list', label: '📋 全部任务' },
  { key: 'fixed', label: '📌 固定日程' },
  { key: 'inbox', label: '📥 导入 · 任务池' },
  { key: 'woop', label: '🧭 WOOP' },
];

export default function TasksScreen() {
  const [tab, setTab] = useState('list');
  return (
    <View style={styles.container}>
      <Text style={styles.title}>📋 任务</Text>
      <SubTabBar tabs={TABS} active={tab} onChange={setTab} />
      <View style={{ flex: 1 }}>
        {tab === 'list' ? <TaskList /> : tab === 'fixed' ? <FixedPanel /> : tab === 'inbox' ? <InboxPanel /> : <WoopPanel />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
});
