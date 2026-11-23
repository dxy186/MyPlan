import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import AssistantScreen, { FOCUS_ASSISTANT_EVENT } from '../components/assistant/AssistantScreen';
import CalendarPage from '../components/screens/CalendarScreen';
import ReviewScreen from '../components/screens/ReviewScreen';
import SettingsScreen from '../components/screens/SettingsScreen';
import TasksScreen from '../components/screens/TasksScreen';
import ReminderService from '../components/assistant/ReminderService';
import { ASK_AI_EVENT } from '../components/assistant/ask-bridge';
import BreakdownHost from '../components/assistant/BreakdownHost';
import CelebrationHost from '../components/assistant/CelebrationHost';
import { OPEN_TARGET_EVENT, OpenTarget } from '../components/assistant/followup';
import { requestOpenToday } from '../components/assistant/nav-bridge';
import { useTodayStr } from '../hooks/use-today';

const NAVS = [
  { name: '日历', key: 'calendar', icon: '📅' },
  { name: '今天', key: 'today', icon: '🏠' },
  { name: '任务', key: 'tasks', icon: '📋' },
  { name: '复盘', key: 'review', icon: '📊' },
  { name: '设置', key: 'settings', icon: '⚙️' },
];

export default function RootLayout() {
  const [activeKey, setActiveKey] = useState('calendar');
  const { width } = useWindowDimensions();

  // 跳天时让整棵树重渲染，各页面里的「今天」才会跟着更新
  useTodayStr();

  // Ctrl+K / ⌘K：随时跳到「今天」并聚焦 AI 输入框
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveKey('today');
        setTimeout(() => window.dispatchEvent(new Event(FOCUS_ASSISTANT_EVENT)), 50);
      }
    };
    window.addEventListener('keydown', onKey);
    // 别的页面（日历弹窗）要问 AI：切到「今天」，今天页打开后会取走这句话并发送
    const onAsk = () => setActiveKey('today');
    window.addEventListener(ASK_AI_EVENT, onAsk);
    // 点开提醒：早上提醒 → 日历里今天的弹窗；复盘 / 周小结 → 今天页
    const onOpen = (e: Event) => {
      const target = (e as CustomEvent<{ target: OpenTarget }>).detail?.target;
      if (target === 'today') {
        setActiveKey('calendar');
        setTimeout(requestOpenToday, 50);
      } else if (target) setActiveKey('today');
    };
    window.addEventListener(OPEN_TARGET_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(ASK_AI_EVENT, onAsk);
      window.removeEventListener(OPEN_TARGET_EVENT, onOpen);
    };
  }, []);


  const renderPage = () => {
    switch (activeKey) {
      case 'tasks': return <TasksScreen />;
      case 'calendar': return <CalendarPage />;
      case 'review': return <ReviewScreen />;
      case 'settings': return <SettingsScreen />;
      case 'today': return <AssistantScreen />;
      default: return <CalendarPage />;
    }
  };

  return (
    <View style={styles.container}>
      <ReminderService />
      <BreakdownHost />
      <CelebrationHost />
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
