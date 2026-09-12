/**
 * 板块一：信息采集与上下文感知
 *
 * 功能：
 *  - Canvas / LMS 日历通过 iCal 订阅链接或粘贴 ICS 文本导入作业 DDL、考试
 *  - 自然语言手动补充（"下周三交机器学习项目报告" → 结构化任务）
 *  - 统一「任务池」，可一键进入 SMART 任务记录 / 日历
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import ICAL from 'ical.js';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  KEYS,
  loadJSON,
  normalizeDate,
  parseChineseDate,
  randomId,
  saveJSON,
  todayStr,
} from '@/app/utils/planning';

type InboxSource = 'canvas' | 'manual' | 'email' | 'syllabus';

type InboxItem = {
  id: string;
  title: string;
  source: InboxSource;
  dueDate?: string;
  course?: string;
  detail?: string;
  createdAt: string;
  imported?: boolean;
};

type RawTask = {
  id: string;
  title: string;
  dueDate: string;
  quadrant: string;
  subtasks: { id: string; title: string; completed: boolean }[];
  status: 'PENDING' | 'IN_PROGRESS' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  specific: string;
  measurable: string;
  relevant: string;
};

type CalendarItem = { id: string; title: string; date: string; completed: boolean; parentTaskId?: string };

const SOURCE_LABEL: Record<InboxSource, string> = {
  canvas: '📚 Canvas',
  manual: '✍️ 手动',
  email: '✉️ 邮件',
  syllabus: '📄 Syllabus',
};

const SOURCE_COLOR: Record<InboxSource, string> = {
  canvas: '#0a7ea4',
  manual: '#43A047',
  email: '#8e5bd0',
  syllabus: '#E64A19',
};

export default function InboxPanel() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [quickText, setQuickText] = useState('');
  const [icalUrl, setIcalUrl] = useState('');
  const [icsText, setIcsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => setItems(await loadJSON<InboxItem[]>(KEYS.inbox, [])))();
  }, []);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')),
    [items]
  );

  const persist = async (next: InboxItem[]) => {
    setItems(next);
    await saveJSON(KEYS.inbox, next);
  };

  // ---------- 手动自然语言补充 ----------
  const handleQuickAdd = async () => {
    const text = quickText.trim();
    if (!text) return;
    const due = parseChineseDate(text);
    const item: InboxItem = {
      id: randomId(),
      title: text,
      source: 'manual',
      dueDate: due,
      createdAt: new Date().toISOString(),
    };
    await persist([...items, item]);
    setQuickText('');
    setMessage(due ? `已加入任务池，识别到截止日期 ${due}` : '已加入任务池（未识别到日期，可稍后补）');
  };

  // ---------- iCal 解析 ----------
  const parseIcs = (ics: string): InboxItem[] => {
    const out: InboxItem[] = [];
    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal);
    const vevents = comp.getAllSubcomponents('vevent');
    for (const vevent of vevents) {
      const ev = new ICAL.Event(vevent);
      const summary: string = ev.summary || '未命名事件';
      const start = ev.startDate ? ev.startDate.toJSDate() : null;
      const due = start ? start.toISOString().slice(0, 10) : undefined;
      let course = '';
      try {
        course = ev.component?.getFirstPropertyValue?.('location') || '';
      } catch {}
      out.push({
        id: randomId(),
        title: summary,
        source: 'canvas',
        dueDate: due,
        course: typeof course === 'string' ? course : '',
        detail: ev.description || '',
        createdAt: new Date().toISOString(),
      });
    }
    return out;
  };

  const importIcs = async (ics: string, tag: string) => {
    try {
      const parsed = parseIcs(ics);
      if (parsed.length === 0) {
        setMessage('没有解析到任何事件，请确认内容格式。');
        return;
      }
      // 去重：同标题+同日期
      const existingKey = new Set(items.map(i => `${i.title}|${i.dueDate || ''}`));
      const fresh = parsed.filter(p => !existingKey.has(`${p.title}|${p.dueDate || ''}`));
      await persist([...items, ...fresh]);
      setMessage(`已从 ${tag} 导入 ${fresh.length} 条（重复 ${parsed.length - fresh.length} 条已跳过）`);
    } catch (e: any) {
      setMessage(`解析失败：${e?.message || '未知错误'}`);
    }
  };

  const handleFetchUrl = async () => {
    const url = icalUrl.trim();
    if (!url) return;
    setBusy(true);
    setMessage('正在拉取 iCal…');
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await importIcs(text, 'iCal 链接');
    } catch (e: any) {
      setMessage(
        `拉取失败：${e?.message || '网络错误'}。浏览器可能因 CORS 拦截，请改用下方「粘贴 ICS 文本」。`
      );
    } finally {
      setBusy(false);
    }
  };

  // ---------- 一键进入 SMART 任务记录 ----------
  const promoteToTask = async (item: InboxItem) => {
    const raw = await AsyncStorage.getItem(KEYS.tasks);
    const tasks: RawTask[] = raw ? JSON.parse(raw) : [];
    const now = new Date().toISOString();
    const task: RawTask = {
      id: randomId(),
      title: item.title,
      dueDate: item.dueDate ? normalizeDate(item.dueDate) : todayStr(),
      quadrant: 'important_urgent',
      subtasks: [],
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      specific: item.detail || '',
      measurable: '',
      relevant: item.course ? `课程：${item.course}` : '',
    };
    await AsyncStorage.setItem(KEYS.tasks, JSON.stringify([...tasks, task]));
    await persist(items.map(i => (i.id === item.id ? { ...i, imported: true } : i)));
    setMessage(`「${item.title}」已进入 SMART 任务记录`);
  };

  const addToCalendar = async (item: InboxItem) => {
    const raw = await AsyncStorage.getItem(KEYS.calendar);
    const cal: CalendarItem[] = raw ? JSON.parse(raw) : [];
    const date = item.dueDate ? normalizeDate(item.dueDate) : todayStr();
    if (cal.some(c => c.title === item.title && c.date === date)) {
      setMessage('日历里已有同名同日期的事项。');
      return;
    }
    cal.push({ id: randomId(), title: item.title, date, completed: false });
    await AsyncStorage.setItem(KEYS.calendar, JSON.stringify(cal));
    setMessage(`「${item.title}」已加入日历 ${date}`);
  };

  const handleDelete = async (id: string) => {
    await persist(items.filter(i => i.id !== id));
  };

  const handleClear = async () => {
    if (!window.confirm('确定清空任务池吗？（不影响已进入任务记录/日历的条目）')) return;
    await persist([]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>📥 信息采集 · 任务池</Text>
        {items.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
            <Text style={styles.clearBtnText}>清空任务池</Text>
          </TouchableOpacity>
        )}
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {/* 手动补充 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>✍️ 自然语言补充</Text>
        <Text style={styles.subText}>例：下周三交机器学习项目报告 / 12月20日前完成论文初稿</Text>
        <TextInput
          style={styles.input}
          value={quickText}
          onChangeText={setQuickText}
          placeholder="输入一句话，自动识别日期"
          placeholderTextColor="#aaa"
          onSubmitEditing={handleQuickAdd}
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleQuickAdd}>
          <Text style={styles.primaryBtnText}>加入任务池</Text>
        </TouchableOpacity>
      </View>

      {/* Canvas iCal */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📚 Canvas / LMS 日历（iCal）</Text>
        <Text style={styles.subText}>
          在 Canvas → Calendar → 「Calendar Feed」复制订阅链接粘到这里；若浏览器拦截跨域，可直接粘贴 ICS 文本。
        </Text>
        <TextInput
          style={styles.input}
          value={icalUrl}
          onChangeText={setIcalUrl}
          placeholder="https://.../feeds/calendars/user_xxx.ics"
          placeholderTextColor="#aaa"
        />
        <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={handleFetchUrl} disabled={busy}>
          <Text style={styles.primaryBtnText}>{busy ? '拉取中…' : '拉取并导入'}</Text>
        </TouchableOpacity>

        <Text style={styles.label}>或粘贴 ICS 文本</Text>
        <TextInput
          style={[styles.input, styles.icsInput]}
          value={icsText}
          onChangeText={setIcsText}
          placeholder="BEGIN:VCALENDAR ... END:VCALENDAR"
          placeholderTextColor="#aaa"
          multiline
        />
        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => icsText.trim() && importIcs(icsText, 'ICS 文本')}
        >
          <Text style={styles.secondaryBtnText}>解析粘贴内容</Text>
        </TouchableOpacity>
      </View>

      {/* 任务池列表 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🗂 任务池（{items.length}）</Text>
        {sorted.length === 0 ? (
          <Text style={styles.empty}>暂无条目，用上面任一方式采集。</Text>
        ) : (
          sorted.map(item => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.itemMain}>
                <View style={styles.badgeRow}>
                  <View style={[styles.badge, { backgroundColor: SOURCE_COLOR[item.source] + '22' }]}>
                    <Text style={[styles.badgeText, { color: SOURCE_COLOR[item.source] }]}>{SOURCE_LABEL[item.source]}</Text>
                  </View>
                  {item.dueDate ? <Text style={styles.due}>截止 {normalizeDate(item.dueDate)}</Text> : <Text style={styles.dueMuted}>无日期</Text>}
                  {item.imported ? <Text style={styles.imported}>已进入任务</Text> : null}
                </View>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.course ? <Text style={styles.itemDetail}>地点/课程：{item.course}</Text> : null}
                {item.detail ? <Text style={styles.itemDetail} numberOfLines={2}>{item.detail}</Text> : null}
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => promoteToTask(item)}>
                    <Text style={styles.smallBtnText}>→ SMART 任务</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => addToCalendar(item)}>
                    <Text style={styles.smallBtnText}>📅 加日历</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtnDanger} onPress={() => handleDelete(item.id)}>
                    <Text style={styles.smallBtnDangerText}>删除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  header: { fontSize: 22, fontWeight: '700', color: '#1a1a2e' },
  clearBtn: { backgroundColor: '#fee2e2', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 14 },
  clearBtnText: { color: '#E53935', fontSize: 13, fontWeight: '600' },
  message: { backgroundColor: '#EDF3FD', color: '#1976D2', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#101523',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  subText: { fontSize: 13, color: '#5f6b7a', lineHeight: 19, marginBottom: 10 },
  label: { fontSize: 13, color: '#283147', fontWeight: '600', marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e5ed',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#f8fafc',
    color: '#222',
  },
  icsInput: { minHeight: 70, textAlignVertical: 'top' },
  primaryBtn: { backgroundColor: '#1976D2', borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondaryBtn: { backgroundColor: '#EDF3FD', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  secondaryBtnText: { color: '#1976D2', fontWeight: '700', fontSize: 14 },
  empty: { color: '#9aa7b8', fontSize: 14 },
  itemRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 0.6, borderColor: '#e6e6ed' },
  itemMain: { flex: 1 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  due: { fontSize: 12, color: '#E64A19', fontWeight: '600' },
  dueMuted: { fontSize: 12, color: '#9aa7b8' },
  imported: { fontSize: 11, color: '#43A047' },
  itemTitle: { fontSize: 15, color: '#222', fontWeight: '600' },
  itemDetail: { fontSize: 12, color: '#7b8ba2', marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  smallBtn: { backgroundColor: '#EDF3FD', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  smallBtnText: { color: '#1976D2', fontSize: 12, fontWeight: '600' },
  smallBtnDanger: { backgroundColor: '#FEE2E2', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  smallBtnDangerText: { color: '#E53935', fontSize: 12, fontWeight: '600' },
});
