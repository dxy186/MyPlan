import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import AchievementsScreen from './achievements';
import AIScreen from './ai';
import CalendarScreen from './calendar';
import GoalsScreen from './goals';
import HistoryScreen from './history';
import WoopScreen from './woop';

const NAVS = [
  { name: '日历进度', key: 'calendar', icon: '📅' },
  { name: 'SMART任务记录', key: 'goals', icon: '🎯' },
  { name: 'AI 助手', key: 'ai', icon: '🤖' },
  { name: 'WOOP向导', key: 'woop', icon: '🧭' },
  { name: '勋章墙', key: 'achievements', icon: '🏆' },
  { name: '历史任务', key: 'history', icon: '📜' },
];

export default function RootLayout() {
  const [activeKey, setActiveKey] = useState('calendar');
  const { width } = useWindowDimensions();


  const renderPage = () => {
    switch (activeKey) {
      case 'calendar': return <CalendarScreen />;
      case 'goals': return <GoalsScreen />;
      case 'ai': return <AIScreen />;
      case 'woop': return <WoopScreen />;
      case 'achievements': return <AchievementsScreen />;
      case 'history': return <HistoryScreen />;
      default: return <CalendarScreen />;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.sidebar}>
        <Text style={styles.logo}>MyPlan</Text>
        {NAVS.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={[styles.navItem, activeKey === item.key && styles.navItemActive]}
            onPress={() => setActiveKey(item.key)}
          >
            <Text style={styles.navIcon}>{item.icon}</Text>
            <Text style={[styles.navText, activeKey === item.key && styles.navTextActive]}>
              {item.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.content}>
        {renderPage()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // web-only 值：'100vh' / 'auto' 不在 RN 类型联合里，运行时取值与原来完全一致
  container: { flex: 1, flexDirection: 'row', height: '100vh' as unknown as number },
  sidebar: {
    width: 220,
    backgroundColor: '#101523',
    paddingTop: 32,
    paddingHorizontal: 16,
  },
  logo: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 32 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  navItemActive: { backgroundColor: 'rgba(255,255,255,0.1)' },
  navIcon: { fontSize: 20, marginRight: 12 },
  navText: { color: '#c7d0e0', fontSize: 16, fontWeight: '500' },
  navTextActive: { color: '#fff', fontWeight: '700' },
  content: { flex: 1, backgroundColor: '#f7f8fa', padding: 32, overflow: 'auto' as unknown as 'scroll' },
  mobileMask: {
    flex: 1,
    backgroundColor: '#101523',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh' as unknown as number,
  },
  mobileMaskText: { color: '#fff', fontSize: 20, textAlign: 'center', padding: 32 },
});
