/**
 * 💡 常用说法：分类列出 AI 秘书能听懂的话，点一下填进输入框（不会直接发送）
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Group = { key: string; title: string; phrases: string[] };

export const PHRASE_GROUPS: Group[] = [
  {
    key: 'new',
    title: '📥 新的事',
    phrases: [
      '这周五前要交实验报告，大概要 4 个小时',
      '下周三考高数，帮我安排复习',
      '明天要去取快递、交电费',
      '准备期末论文，月底交，帮我拆一下',
    ],
  },
  {
    key: 'fixed',
    title: '📌 固定时间',
    phrases: ['今天下午 3 点到 5 点开组会', '每周二、四上午 8 点到 10 点上课', '周三晚上有聚会', '明天的组会取消了'],
  },
  {
    key: 'progress',
    title: '✅ 汇报进度',
    phrases: ['高数作业做完了', '论文写了一半', '报告写了 2 小时还没完，还要 1 个半小时', '查文献比想的难，估计要 3 小时'],
  },
  {
    key: 'adjust',
    title: '🔧 调整安排',
    phrases: [
      '把写报告挪到上午做',
      'PPT 下周再做',
      '论文截止日推迟到下周一',
      '查文献挺费脑子的，改成高耗能',
      '今天太累了，把难的往后挪',
      '今晚想早点休息，帮我重新排一下',
      '背单词这项不做了',
    ],
  },
  {
    key: 'habit',
    title: '🧠 记住习惯',
    phrases: ['记住：周末上午我不想学习', '以后晚上 10 点后别给我排任务', '记住：我早上效率最高，难的事放上午', '忘掉周末上午那条'],
  },
  {
    key: 'ask',
    title: '❓ 问问题',
    phrases: ['这周还排得下吗？', '哪些任务可能赶不上截止？', '接下来我该先做什么？'],
  },
];

const TIPS = [
  '一次说多件事也行：「周五交报告，周三晚上聚会，高数作业做完了」',
  '方案不满意不用取消，直接接着说，比如「报告放到上午」',
  '方案里可以直接点「高 / 中 / 低」改耗能、改时长',
  '做不到：指定几点几分做某个任务（只能上午 / 下午 / 晚上）、删除 SMART 同步来的任务、设置先后顺序',
];

export default function PhraseCard({ onPick }: { onPick: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(PHRASE_GROUPS[0].key);
  const current = PHRASE_GROUPS.find(g => g.key === group) ?? PHRASE_GROUPS[0];

  if (!open) {
    return (
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.toggle}>
        <Text style={styles.toggleText}>💡 不知道说什么？看看常用说法</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>💡 常用说法（点一下填进输入框，可以改了再发）</Text>
        <TouchableOpacity onPress={() => setOpen(false)}>
          <Text style={styles.link}>收起</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tabs}>
        {PHRASE_GROUPS.map(g => (
          <TouchableOpacity key={g.key} style={[styles.tab, g.key === group && styles.tabOn]} onPress={() => setGroup(g.key)}>
            <Text style={[styles.tabText, g.key === group && styles.tabTextOn]}>{g.title}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.chips}>
        {current.phrases.map(p => (
          <TouchableOpacity key={p} style={styles.chip} onPress={() => onPick(p)}>
            <Text style={styles.chipText}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.tips}>
        {TIPS.map(t => (
          <Text key={t} style={styles.tip}>
            · {t}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { marginTop: 10, alignSelf: 'flex-start' },
  toggleText: { fontSize: 13, color: '#1976D2' },
  box: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#EEF1F5', paddingTop: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 13, fontWeight: '700', color: '#333', flexShrink: 1 },
  link: { color: '#1976D2', fontSize: 13, marginLeft: 10 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  tab: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, marginRight: 6, marginBottom: 6, backgroundColor: '#F2F4F7' },
  tabOn: { backgroundColor: '#1976D2' },
  tabText: { fontSize: 13, color: '#455A64' },
  tabTextOn: { color: '#fff', fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { backgroundColor: '#EEF4FC', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, marginRight: 8, marginBottom: 8 },
  chipText: { fontSize: 13, color: '#1976D2' },
  tips: { marginTop: 4 },
  tip: { fontSize: 12, color: '#888', lineHeight: 18 },
});
