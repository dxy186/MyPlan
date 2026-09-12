/**
 * 子界面切换条
 *
 * 用途：把「AI 科学计划秘书」的新功能作为子界面嵌进原有页面（日历进度 / SMART任务记录 / 历史任务），
 * 而不是在侧边栏新开独立页面。原有界面始终是第一个 tab（默认展示）。
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type SubTabItem = { key: string; label: string };

type Props = {
  tabs: SubTabItem[];
  active: string;
  onChange: (key: string) => void;
};

export default function SubTabBar({ tabs, active, onChange }: Props) {
  return (
    <View style={styles.bar}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, on && styles.tabActive]}
            onPress={() => onChange(t.key)}
          >
            <Text style={[styles.tabText, on && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 12 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: '#E8EEF7' },
  tabActive: { backgroundColor: '#1976D2' },
  tabText: { fontSize: 13, color: '#5776A5', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
});
