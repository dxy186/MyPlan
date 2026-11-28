/**
 * 「今天」页的对话记录：一条连续的时间线，按天插日期分隔线；默认只显示今天（今天还没聊就显示最近一天），
 * 「看更早的」一天一天往前加载；可以搜索、清空；右键（手机上长按）一条消息：引用 / 记进日记 / 复制。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { toDateStr, todayStr } from '@/app/utils/planning';
import { confirmAsync } from '@/components/ui/confirm';
import RichText from './RichText';

export type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  proposal?: 'pending' | 'applied' | 'dismissed';
  raw?: string;
  /** 这条消息引用了之前的哪条（只存一小段用来显示） */
  quote?: { at: string; text: string };
};

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? todayStr() : toDateStr(d);
};
function dayLabel(day: string) {
  const t = todayStr();
  const d = new Date(`${day}T12:00:00`);
  const base = `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEK[d.getDay()]}`;
  if (day === t) return `今天 · ${base}`;
  const y = new Date(`${t}T12:00:00`);
  y.setDate(y.getDate() - 1);
  if (toDateStr(y) === day) return `昨天 · ${base}`;
  return day.slice(0, 4) === t.slice(0, 4) ? base : `${day.slice(0, 4)} 年 ${base}`;
}
const timeOf = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Menu = { x: number; y: number; m: ChatMsg };

/** 用原生事件接右键：不经过 React / 触摸组件，哪个浏览器、桌面版都能用 */
function RightClick({ onMenu, right, children }: { onMenu: (x: number, y: number) => void; right: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onMenu);
  cb.current = onMenu;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cb.current(e.clientX, e.clientY);
    };
    el.addEventListener('contextmenu', h);
    return () => el.removeEventListener('contextmenu', h);
  }, []);
  return React.createElement(
    'div',
    { ref, style: { display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start' } },
    children
  );
}

export default function ChatThread({
  history,
  loading,
  onQuote,
  onDiary,
  onClear,
}: {
  history: ChatMsg[];
  loading: boolean;
  onQuote: (m: ChatMsg) => void;
  onDiary: (m: ChatMsg) => Promise<string>;
  onClear: () => void;
}) {
  const [moreDays, setMoreDays] = useState(0);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<Menu | null>(null);
  const [toast, setToast] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const days = useMemo(() => {
    const out: string[] = [];
    for (const m of history) {
      const d = dayOf(m.at);
      if (out[out.length - 1] !== d) out.push(d);
    }
    return [...new Set(out)];
  }, [history]);

  // 默认显示今天；今天还没聊过就显示最近有对话的那天
  const today = todayStr();
  const baseIdx = days.includes(today) ? days.indexOf(today) : days.length - 1;
  const firstIdx = Math.max(0, baseIdx - moreDays);
  const shownDays = new Set(days.slice(firstIdx));
  const olderDays = firstIdx;

  const query = q.trim().toLowerCase();
  const list = query
    ? history.filter(m => m.content.toLowerCase().includes(query)).slice(-100)
    : history.filter(m => shownDays.has(dayOf(m.at)));

  // 新消息进来时滚到底
  const lastAt = history[history.length - 1]?.at;
  useEffect(() => {
    if (query) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 30);
    return () => clearTimeout(t);
  }, [lastAt, loading, query]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  if (history.length === 0 && !loading) return null;

  const openMenu = (e: { clientX: number; clientY: number; preventDefault?: () => void }, m: ChatMsg) => {
    e.preventDefault?.();
    const w = typeof window !== 'undefined' ? window.innerWidth : 800;
    const h = typeof window !== 'undefined' ? window.innerHeight : 600;
    setMenu({ x: Math.min(e.clientX, w - 180), y: Math.min(e.clientY, h - 150), m });
  };

  let prevDay = '';
  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="🔍 搜索聊天记录"
          placeholderTextColor="#9AA4B2"
        />
        {query ? (
          <Text style={styles.muted}>找到 {list.length} 条{list.length >= 100 ? '（只显示最近 100 条）' : ''}</Text>
        ) : (
          <Text style={styles.muted}>右键一条消息，或点它右下角的 ⋯：引用 / 记进日记 / 复制</Text>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={async () => {
            if (await confirmAsync('清空所有聊天记录？只删对话，任务、日记和 AI 记住的偏好都不受影响。删了找不回来。')) onClear();
          }}
        >
          <Text style={styles.clear}>清空对话</Text>
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={{ paddingBottom: 6 }}>
        {!query && olderDays > 0 && (
          <TouchableOpacity style={styles.more} onPress={() => setMoreDays(n => n + 1)}>
            <Text style={styles.moreText}>↑ 看更早的（还有 {olderDays} 天）</Text>
          </TouchableOpacity>
        )}
        {list.map((m, i) => {
          const d = dayOf(m.at);
          const sep = d !== prevDay;
          prevDay = d;
          const bubble = (
            <View style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
              {m.quote ? (
                <View style={[styles.quote, m.role === 'user' && styles.quoteOnBlue]}>
                  <Text style={[styles.quoteText, m.role === 'user' && { color: '#E3F2FD' }]} numberOfLines={2}>
                    ↪ {m.quote.text}
                  </Text>
                </View>
              ) : null}
              {m.role === 'user' ? (
                <Text style={styles.bubbleUserText}>{m.content}</Text>
              ) : (
                <RichText text={m.content} style={styles.bubbleAiText} />
              )}
              <View style={styles.metaRow}>
                <Text style={[styles.time, m.role === 'user' && { color: '#BBDEFB' }]}>{timeOf(m.at)}</Text>
                {/* 右键不方便时点这里也能打开菜单 */}
                <TouchableOpacity
                  onPress={(e: any) => openMenu({ clientX: e?.nativeEvent?.pageX ?? 200, clientY: e?.nativeEvent?.pageY ?? 200 }, m)}
                  style={styles.moreBtn}
                  accessibilityLabel="更多操作"
                >
                  <Text style={[styles.moreDots, m.role === 'user' && { color: '#E3F2FD' }]}>⋯</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
          return (
            <View key={`${m.at}-${i}`}>
              {sep && (
                <View style={styles.sepRow}>
                  <View style={styles.sepLine} />
                  <Text style={styles.sepText}>{dayLabel(d)}</Text>
                  <View style={styles.sepLine} />
                </View>
              )}
              {/* 网页上用原生 div 接右键；手机上用长按 */}
              <RightClick right={m.role === 'user'} onMenu={(x, y) => openMenu({ clientX: x, clientY: y }, m)}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  delayLongPress={450}
                  onLongPress={(e: any) =>
                    openMenu({ clientX: e?.nativeEvent?.pageX ?? 100, clientY: e?.nativeEvent?.pageY ?? 100 }, m)
                  }
                  style={{ maxWidth: '100%', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}
                >
                  {bubble}
                </TouchableOpacity>
              </RightClick>
            </View>
          );
        })}
        {loading && <Text style={styles.muted}>正在结合你的任务进度思考…</Text>}
      </ScrollView>

      {!!toast && <Text style={styles.toast}>{toast}</Text>}

      {menu && (
        <>
          <TouchableOpacity activeOpacity={1} style={styles.overlay} onPress={() => setMenu(null)} />
          <View style={[styles.menu, { left: menu.x, top: menu.y }]}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                onQuote(menu.m);
                setMenu(null);
              }}
            >
              <Text style={styles.menuText}>💬 引用这条，让 AI 照着做</Text>
            </TouchableOpacity>
            {menu.m.role === 'assistant' && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={async () => {
                  const m = menu.m;
                  setMenu(null);
                  setToast(await onDiary(m));
                }}
              >
                <Text style={styles.menuText}>📔 记进日记</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={async () => {
                const m = menu.m;
                setMenu(null);
                try {
                  await navigator.clipboard.writeText(m.content);
                  setToast('📋 已复制');
                } catch {
                  setToast('复制失败：浏览器没给权限');
                }
              }}
            >
              <Text style={styles.menuText}>📋 复制</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' },
  search: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 16, paddingVertical: 5, paddingHorizontal: 12, fontSize: 13, width: 200, backgroundColor: '#fff' },
  muted: { fontSize: 12, color: '#90A4AE' },
  clear: { fontSize: 12, color: '#E57373' },
  // 固定高度、单独滚动：聊得再多也不会把下面的东西挤走
  scroll: { maxHeight: '58vh' as unknown as number, borderRadius: 12 },
  more: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12, marginBottom: 4 },
  moreText: { fontSize: 13, color: '#1976D2', fontWeight: '600' },
  sepRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 10, gap: 8 },
  sepLine: { flex: 1, height: 1, backgroundColor: '#E3E8EF' },
  sepText: { fontSize: 12, color: '#90A4AE' },
  bubble: { borderRadius: 14, paddingVertical: 9, paddingHorizontal: 13, marginVertical: 4, maxWidth: 760 },
  bubbleUser: { backgroundColor: '#1976D2' },
  bubbleAi: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E8EF' },
  bubbleUserText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  bubbleAiText: { color: '#263238', fontSize: 15, lineHeight: 23 },
  time: { fontSize: 10, color: '#B0BEC5' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  moreBtn: { paddingHorizontal: 4, borderRadius: 6 },
  moreDots: { fontSize: 14, color: '#90A4AE', fontWeight: '700', lineHeight: 14 },
  quote: { borderLeftWidth: 3, borderLeftColor: '#90CAF9', paddingLeft: 8, marginBottom: 6 },
  quoteOnBlue: { borderLeftColor: '#BBDEFB' },
  quoteText: { fontSize: 12, color: '#78909C' },
  toast: { alignSelf: 'center', fontSize: 13, color: '#2E7D32', marginTop: 6 },
  overlay: { position: 'fixed' as unknown as 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 },
  menu: {
    position: 'fixed' as unknown as 'absolute',
    zIndex: 999,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 4,
    minWidth: 170,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    borderWidth: 1,
    borderColor: '#E3E8EF',
  },
  menuItem: { paddingVertical: 9, paddingHorizontal: 14 },
  menuText: { fontSize: 14, color: '#263238' },
});
