/**
 * 日历「添加」框的快捷写法说明。日历弹窗里点「写法？」展开，设置 → 说明 里也有一份。
 * 规则和 components/data/quick-parse.ts 保持一致，改写法时两边一起改。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Row = { ex: string; means: string };
const SECTIONS: { title: string; rows: Row[]; note?: string }[] = [
  {
    title: '① 开头的符号（可以组合）',
    rows: [
      { ex: '!复习高数', means: '高耗能任务（会排在你精力好的时段）；没写时长时默认 60 分钟' },
      { ex: '?写期末论文', means: '加好后马上弹出 AI 拆解，拆成父任务 + 子任务' },
      { ex: '?!写期末论文', means: '两个一起用：高耗能 + 让 AI 拆（写成 !? 也行）' },
      { ex: '#ES pre', means: '🔴 DDL：这天截止（红字），不自动排时间；在问 AI 的输入框里写「#ES pre 12/8」也会直接记成 DDL' },
      { ex: '#?期末论文', means: 'DDL + 马上让 AI 拆成子任务，子任务排在截止日之前' },
      { ex: '*妈妈生日', means: '⭐ 重要事件：只在日历上标出来提醒，不当任务、不占时间；生日、纪念日自动每年重复' },
      { ex: '*每年 结婚纪念日', means: '每年重复的重要事件；「*14:00 面试」可以带个时间' },
    ],
    note: '中文的 ！ ？ ＃ ＊ 也可以。不加符号就是普通任务（名字里带 DDL / 截止的也会当 DDL）。',
  },
  {
    title: '② 时长（写在任务名前后都行）',
    rows: [
      { ex: '写报告 2小时', means: '120 分钟；也可以写 2个小时、1.5h、2hr' },
      { ex: '背单词 45分钟', means: '45 分钟；也可以写 45min、45m' },
      { ex: '整理笔记 半小时', means: '30 分钟；也可以写 半个小时' },
      { ex: '取快递', means: '没写时长：默认 30 分钟、低耗能' },
    ],
    note: '时长要在 5 分钟到 24 小时之间。30 分钟以内自动算低耗能，更长算中耗能（加 ! 的算高耗能）。',
  },
  {
    title: '③ 固定日程（写了几点 = 时间定死，排程会避开）',
    rows: [
      { ex: '15:00-17:00 开组会', means: '这天 15:00 到 17:00；中间可以用 - ~ 到 至' },
      { ex: '下午3点-5点 面试', means: '支持 上午 / 中午 / 下午 / 晚上、3点、3点半、3点20分' },
      { ex: '14:00 打电话', means: '只写开始时间：默认 1 小时' },
      { ex: '9点半 晨会 15分钟', means: '开始时间 + 时长：9:30–9:45' },
    ],
    note: '时间要写在最前面。固定日程会显示成绿字。',
  },
  {
    title: '④ 每周重复的固定日程',
    rows: [
      { ex: '每周二、四 8:00-10:00 高数课', means: '每周二和周四；也可以用 , 和 及 分隔' },
      { ex: '每周一到五 9:00-12:00 上班', means: '周一到周五每天；到 至 - ~ 都行' },
      { ex: '每星期日 19:00 家庭电话', means: '「每周 / 每星期 / 每礼拜」都认；日、天都表示周日' },
    ],
    note: '每周重复一定要写时间，否则会被当成一个名字叫「每周…」的普通任务。',
  },
];

export default function QuickSyntaxGuide({ compact }: { compact?: boolean }) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      {!compact && <Text style={styles.title}>✍️ 日历「添加」框的快捷写法</Text>}
      <Text style={styles.intro}>
        在日历里双击某一天，用弹窗下面的「添加」框。按这些写法写，不用问 AI 就能马上加好；写不成这些格式的，会当成一个普通任务。想让 AI 理解一句随便说的话，用下面的「问 AI」。
      </Text>
      {SECTIONS.map(sec => (
        <View key={sec.title} style={styles.sec}>
          <Text style={styles.secTitle}>{sec.title}</Text>
          {sec.rows.map(r => (
            <View key={r.ex} style={styles.row}>
              <Text style={styles.ex}>{r.ex}</Text>
              <Text style={styles.means}>{r.means}</Text>
            </View>
          ))}
          {sec.note ? <Text style={styles.note}>{sec.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  compact: { backgroundColor: '#F7F9FC', borderRadius: 10, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#E3E8EF' },
  title: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  intro: { fontSize: 13, color: '#607D8B', lineHeight: 19, marginBottom: 6 },
  sec: { marginTop: 8 },
  secTitle: { fontSize: 14, fontWeight: '700', color: '#37474F', marginBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', paddingVertical: 3 },
  ex: { fontFamily: 'monospace', fontSize: 13, color: '#1565C0', backgroundColor: '#E8F0FE', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, marginRight: 8, minWidth: 150 },
  means: { flex: 1, minWidth: 160, fontSize: 13, color: '#37474F', lineHeight: 19 },
  note: { fontSize: 12, color: '#90A4AE', marginTop: 2, lineHeight: 17 },
});
