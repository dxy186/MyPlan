import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { callChatJSON, getAiConfig } from '@/app/utils/ai';
import { addDays, minutesToHM, todayStr } from '@/app/utils/planning';
import { ScheduleItem, ScheduleResult } from '@/app/utils/scheduler';

import {
  AppliedChange,
  AssistantAction,
  OVERRUN_OPTIONS,
  OverrunChoice,
  PlanState,
  SYSTEM_PROMPT,
  applyActions,
  buildContext,
  commitState,
  loadPlanState,
  overrunTasks,
  replan,
  resolveOverrun,
} from './plan-store';

export const ASSISTANT_HISTORY_KEY = '@myplan_assistant_history';
export const FOCUS_ASSISTANT_EVENT = 'myplan:focus-assistant';

type Msg = { role: 'user' | 'assistant'; content: string; at: string };
type Proposal = { reply: string; actions: AssistantAction[]; changes: AppliedChange[]; enabled: boolean[] };

const EXAMPLES = [
  '这周五前要交实验报告，大概要 4 个小时',
  '今天下午 3 点到 5 点要开组会',
  '高数作业做完了',
  '把写报告挪到上午做',
  '今晚想早点休息，帮我重新排一下',
];

const TYPE_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  task: { color: '#1976D2', bg: '#E8F1FC', label: '任务' },
  fixed: { color: '#5f6b7a', bg: '#EEF0F4', label: '固定' },
  play: { color: '#2E7D32', bg: '#E7F6E9', label: '玩' },
  rest: { color: '#8e5bd0', bg: '#F2EBFB', label: '休息日' },
  buffer: { color: '#B07800', bg: '#FDF3DC', label: '缓冲' },
  chore: { color: '#0a7ea4', bg: '#E3F2F8', label: '琐事' },
};
const COST_CN: Record<string, string> = { high: '高耗能', medium: '中耗能', low: '低耗能' };

function nowMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function DayTimeline({ schedule, date, title, fromNow }: { schedule: ScheduleResult; date: string; title: string; fromNow?: boolean }) {
  const cur = nowMin();
  const items = schedule.items
    .filter(i => i.date === date && (!fromNow || i.endMin > cur))
    .sort((a, b) => a.startMin - b.startMin);
  return (
    <View style={styles.day}>
      <Text style={styles.dayTitle}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.muted}>（没有安排）</Text>
      ) : (
        items.map((it: ScheduleItem) => {
          const st = TYPE_STYLE[it.type] || TYPE_STYLE.task;
          const isNow = fromNow && it.startMin <= cur && it.endMin > cur;
          return (
            <View key={it.id} style={[styles.item, { backgroundColor: st.bg }, isNow && styles.itemNow]}>
              <Text style={styles.itemTime}>
                {minutesToHM(it.startMin)}–{minutesToHM(it.endMin)}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemTitle, { color: st.color }]}>
                  {isNow ? '▶ ' : ''}
                  {it.title}
                </Text>
                <Text style={styles.itemMeta}>
                  {st.label}
                  {it.energyCost ? ` · ${COST_CN[it.energyCost]}` : ''}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

export default function AssistantScreen() {
  const [state, setState] = useState<PlanState | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const reload = useCallback(async () => {
    const s = await loadPlanState();
    setState(s);
    const sch = await commitState(s); // 打开页面时从现在开始刷新一次排程
    setSchedule(sch);
  }, []);

  useEffect(() => {
    reload();
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ASSISTANT_HISTORY_KEY);
        if (raw) setHistory(JSON.parse(raw));
      } catch {}
    })();
  }, [reload]);

  // Ctrl+K 聚焦输入框
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const focus = () => inputRef.current?.focus();
    window.addEventListener(FOCUS_ASSISTANT_EVENT, focus);
    const t = setTimeout(focus, 300);
    return () => {
      window.removeEventListener(FOCUS_ASSISTANT_EVENT, focus);
      clearTimeout(t);
    };
  }, []);

  const saveHistory = (h: Msg[]) => {
    const trimmed = h.slice(-30);
    setHistory(trimmed);
    void AsyncStorage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(trimmed));
  };

  // 预览：只应用勾选的操作，算出新排程
  const preview = useMemo(() => {
    if (!proposal || !state) return null;
    const chosen = proposal.actions.filter((_, i) => proposal.enabled[i] && proposal.changes[i]?.ok);
    const { next } = applyActions(state, chosen);
    return { next, schedule: replan(next), count: chosen.length };
  }, [proposal, state]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || loading || !state) return;
    setError('');
    setInput('');
    const userMsg: Msg = { role: 'user', content: text, at: new Date().toISOString() };
    const h1 = [...history, userMsg];
    saveHistory(h1);
    setLoading(true);
    try {
      const cfg = await getAiConfig();
      if (!cfg.apiKey) throw new Error('还没有配置 AI Key：到侧边栏「AI 助手」右上角「⚙️ 设置」里填入 DeepSeek API Key。');
      const fresh = await loadPlanState();
      setState(fresh);
      const context = buildContext(fresh, schedule);
      const pendingNote = proposal ? '\n\n（注意：上一个方案用户还没确认，以下面的新要求为准重新给出完整方案。）' : '';
      const result = await callChatJSON<{ reply?: string; actions?: AssistantAction[] }>([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `当前数据：\n${context}` },
        ...h1.slice(-9, -1).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text + pendingNote },
      ]);
      const actions = Array.isArray(result.actions) ? result.actions.filter(a => a && typeof a === 'object') : [];
      const reply = String(result.reply || (actions.length ? '我拟了一个调整方案，请确认。' : '好的。'));
      saveHistory([...h1, { role: 'assistant', content: reply, at: new Date().toISOString() }]);
      if (actions.length > 0) {
        const { changes } = applyActions(fresh, actions);
        setProposal({ reply, actions, changes, enabled: changes.map(c => c.ok) });
      } else {
        setProposal(null);
      }
    } catch (e: any) {
      const msg = e instanceof SyntaxError ? 'AI 返回的格式不对，请换个说法再试一次。' : e?.message || String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const sch = await commitState(preview.next);
      setState(preview.next);
      setSchedule(sch);
      setProposal(null);
      saveHistory([...history, { role: 'assistant', content: `✔ 已应用 ${preview.count} 项调整，排程已更新。`, at: new Date().toISOString() }]);
    } catch (e: any) {
      setError('保存失败：' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (i: number) => {
    if (!proposal || !proposal.changes[i]?.ok) return;
    const enabled = proposal.enabled.slice();
    enabled[i] = !enabled[i];
    setProposal({ ...proposal, enabled });
  };

  const overruns = useMemo(() => (state ? overrunTasks(state) : []), [state]);
  const [overBusy, setOverBusy] = useState(false);
  const answerOverrun = async (taskId: string, choice: OverrunChoice) => {
    setOverBusy(true);
    setError('');
    try {
      const r = await resolveOverrun(taskId, choice);
      setState(r.state);
      setSchedule(r.schedule);
      setProposal(null);
      saveHistory([...history, { role: 'assistant', content: `${r.summary}，已从现在起重新排程。`, at: new Date().toISOString() }]);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setOverBusy(false);
    }
  };

  const today = todayStr();
  const shown = preview?.schedule ?? schedule;
  const recent = history.slice(-8);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>🗣️ AI 秘书</Text>
      <Text style={styles.subtitle}>
        说出你要做什么、做完了什么、想怎么调整，我会结合你现有任务的进度重新安排。随时按 Ctrl+K 回到这里。
      </Text>

      {/* 输入 */}
      <View style={styles.inputCard}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="比如：这周五前要交实验报告，大概要 4 个小时；周三晚上有聚会"
          placeholderTextColor="#9AA4B2"
          multiline
          editable={!loading}
          onKeyPress={(e: any) => {
            if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
              e.preventDefault?.();
              send();
            }
          }}
        />
        <View style={styles.inputBar}>
          <Text style={styles.hint}>Enter 发送 · Shift+Enter 换行</Text>
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || loading) && styles.btnDisabled]}
            disabled={!input.trim() || loading}
            onPress={() => send()}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendText}>发送</Text>}
          </TouchableOpacity>
        </View>
        {history.length === 0 && (
          <View style={styles.chips}>
            {EXAMPLES.map(ex => (
              <TouchableOpacity key={ex} style={styles.chip} onPress={() => setInput(ex)}>
                <Text style={styles.chipText}>{ex}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* 对话 */}
      {recent.length > 0 && (
        <View style={styles.thread}>
          {recent.map((m, i) => (
            <View key={i} style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
              <Text style={m.role === 'user' ? styles.bubbleUserText : styles.bubbleAiText}>{m.content}</Text>
            </View>
          ))}
          {loading && <Text style={styles.muted}>正在结合你的任务进度思考…</Text>}
        </View>
      )}

      {/* 超时跟进 */}
      {overruns.length > 0 && !proposal && (
        <View style={styles.overCard}>
          <Text style={styles.cardTitle}>⏰ 这些任务超出预估了，还要多久？</Text>
          {overruns.map(o => (
            <View key={o.task.id} style={styles.overRow}>
              <Text style={styles.overTitle}>
                {o.task.title}
                <Text style={styles.overMeta}>
                  {'  '}预估 {o.task.estimateMin} 分钟 · 已做 {o.spent} 分钟{o.over > 0 ? ` · 超出 ${o.over} 分钟` : ''}
                </Text>
              </Text>
              <View style={styles.overBtns}>
                {OVERRUN_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.overBtn, overBusy && styles.btnDisabled]}
                    disabled={overBusy}
                    onPress={() => answerOverrun(o.task.id, opt.choice)}
                  >
                    <Text style={styles.overBtnText}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
          <Text style={styles.mutedSmall}>点一下就会把剩下的时间排进后面的空档。也可以直接在上面跟我说具体情况。</Text>
        </View>
      )}

      {/* 改动预览 */}
      {proposal && (
        <View style={styles.proposal}>
          <Text style={styles.cardTitle}>📝 调整方案（确认后才会生效）</Text>
          {proposal.changes.map((c, i) => (
            <TouchableOpacity key={i} style={styles.changeRow} onPress={() => toggle(i)} disabled={!c.ok}>
              <View style={[styles.checkbox, proposal.enabled[i] && styles.checkboxOn, !c.ok && styles.checkboxOff]}>
                {proposal.enabled[i] && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={[styles.changeText, !c.ok && styles.changeSkipped]}>{c.summary}</Text>
            </TouchableOpacity>
          ))}
          {preview && preview.schedule.unscheduled.length > 0 && (
            <Text style={styles.warn}>
              ⚠️ 截止前排不下：{preview.schedule.unscheduled.map(t => t.title).join('、')}
            </Text>
          )}
          <Text style={styles.mutedSmall}>下面的「今天 / 明天」已按这个方案预览。不满意可以直接在上面继续说，比如“写报告放到上午”。</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, (saving || !preview?.count) && styles.btnDisabled]}
              disabled={saving || !preview?.count}
              onPress={confirm}
            >
              <Text style={styles.primaryText}>确认（{preview?.count ?? 0} 项）</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setProposal(null)} disabled={saving}>
              <Text style={styles.secondaryText}>不用了</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 今天 / 明天 */}
      {shown && (
        <View style={styles.planCard}>
          <View style={styles.planHeader}>
            <Text style={styles.cardTitle}>{preview ? '👀 预览：调整后的安排' : '📅 接下来的安排'}</Text>
            <TouchableOpacity onPress={reload}>
              <Text style={styles.link}>刷新</Text>
            </TouchableOpacity>
          </View>
          {!preview && shown.unscheduled.length > 0 && (
            <Text style={styles.warn}>⚠️ 截止前排不下：{shown.unscheduled.map(t => t.title).join('、')}</Text>
          )}
          <Text style={styles.mutedSmall}>{shown.risk.message}</Text>
          <View style={styles.days}>
            <DayTimeline schedule={shown} date={today} title="今天（从现在起）" fromNow />
            <DayTimeline schedule={shown} date={addDays(today, 1)} title="明天" />
          </View>
        </View>
      )}
      {!state && <ActivityIndicator style={{ marginTop: 24 }} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 16, lineHeight: 20 },
  muted: { fontSize: 14, color: '#888' },
  mutedSmall: { fontSize: 12, color: '#888', marginBottom: 10, lineHeight: 18 },
  inputCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D6E0EE',
    padding: 14,
    marginBottom: 14,
    maxWidth: 820,
  },
  input: { minHeight: 64, fontSize: 16, color: '#1a1a2e', textAlignVertical: 'top' },
  inputBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  hint: { fontSize: 12, color: '#9AA4B2' },
  sendBtn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 22, minWidth: 72, alignItems: 'center' },
  sendText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.45 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  chip: { backgroundColor: '#EEF4FC', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, marginRight: 8, marginBottom: 8 },
  chipText: { fontSize: 13, color: '#1976D2' },
  errorBox: { backgroundColor: '#FFEBEE', borderRadius: 8, padding: 10, marginBottom: 12, maxWidth: 820 },
  errorText: { color: '#C62828', fontSize: 14 },
  thread: { maxWidth: 820, marginBottom: 12 },
  bubble: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6, maxWidth: '85%' as unknown as number },
  bubbleUser: { backgroundColor: '#1976D2', alignSelf: 'flex-end' },
  bubbleAi: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E9F0', alignSelf: 'flex-start' },
  bubbleUserText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bubbleAiText: { color: '#1a1a2e', fontSize: 14, lineHeight: 20 },
  proposal: {
    backgroundColor: '#FFFDF5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F2D98A',
    padding: 16,
    marginBottom: 14,
    maxWidth: 820,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 10 },
  changeRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#90A4AE',
    marginRight: 8,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  checkboxOff: { borderColor: '#ddd' },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  changeText: { flex: 1, fontSize: 14, color: '#333', lineHeight: 20 },
  changeSkipped: { color: '#B07800' },
  warn: { fontSize: 13, color: '#BF360C', marginVertical: 6 },
  btnRow: { flexDirection: 'row', alignItems: 'center' },
  primaryBtn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18, marginRight: 10 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: { backgroundColor: '#EEF1F5', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18 },
  secondaryText: { color: '#555', fontSize: 15, fontWeight: '600' },
  overCard: {
    backgroundColor: '#FFF6F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F5C6B5',
    padding: 16,
    marginBottom: 14,
    maxWidth: 820,
  },
  overRow: { marginBottom: 10 },
  overTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a2e', marginBottom: 6 },
  overMeta: { fontSize: 13, fontWeight: '400', color: '#8D6E63' },
  overBtns: { flexDirection: 'row', flexWrap: 'wrap' },
  overBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#F0B29A', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, marginRight: 8, marginBottom: 6 },
  overBtnText: { fontSize: 13, color: '#BF360C' },
  planCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', padding: 16, maxWidth: 820 },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: '#1976D2', fontSize: 14 },
  days: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  day: { flexGrow: 1, flexBasis: 300, marginHorizontal: 6, marginBottom: 8 },
  dayTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 8 },
  item: { flexDirection: 'row', borderRadius: 8, padding: 8, marginBottom: 6 },
  itemNow: { borderWidth: 2, borderColor: '#1976D2' },
  itemTime: { width: 96, fontSize: 13, color: '#555', fontVariant: ['tabular-nums'] },
  itemTitle: { fontSize: 14, fontWeight: '600' },
  itemMeta: { fontSize: 12, color: '#888', marginTop: 2 },
});
