/** AI 回复的简单排版：### 小标题、- / 1. 列点、**加粗**，其余原样换行 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

function inline(text: string, base: object, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text key={key} style={base}>
      {parts.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? (
          <Text key={i} style={{ fontWeight: '700' }}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          p
        )
      )}
    </Text>
  );
}

export default function RichText({ text, style }: { text: string; style: object }) {
  const lines = text.replace(/\r/g, '').split('\n');
  // 没有任何排版符号：原样显示，和以前一样
  if (!lines.some(l => /^\s*(#{1,4}\s|[-*•]\s|\d+[.)、]\s?)/.test(l) || /\*\*[^*]+\*\*/.test(l))) return <Text style={style}>{text}</Text>;
  return (
    <View>
      {lines.map((raw, i) => {
        const l = raw.trimEnd();
        if (!l.trim()) return <View key={i} style={{ height: 6 }} />;
        const h = l.match(/^\s*#{1,4}\s+(.*)$/);
        if (h) return inline(h[1], [style, styles.h], `h${i}`);
        const b = l.match(/^(\s*)[-*•]\s+(.*)$/);
        if (b)
          return (
            <View key={i} style={[styles.li, { paddingLeft: b[1].length >= 2 ? 16 : 0 }]}>
              <Text style={[style, styles.dot]}>•</Text>
              <View style={{ flex: 1 }}>{inline(b[2], style, `b${i}`)}</View>
            </View>
          );
        const n = l.match(/^(\s*)(\d+)[.)、]\s?(.*)$/);
        if (n)
          return (
            <View key={i} style={[styles.li, { paddingLeft: n[1].length >= 2 ? 16 : 0 }]}>
              <Text style={[style, styles.num]}>{n[2]}.</Text>
              <View style={{ flex: 1 }}>{inline(n[3], style, `n${i}`)}</View>
            </View>
          );
        return inline(l, style, `p${i}`);
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  h: { fontWeight: '700', fontSize: 15, marginTop: 6, marginBottom: 2 },
  li: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 2 },
  dot: { width: 14 },
  num: { minWidth: 20 },
});
