/**
 * 「🧩 帮我拆」弹窗：放在根布局里，任何页面调用 openBreakdown(taskId) 都会打开。
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { EnergyCost, addDays, todayStr } from '@/app/utils/planning';

import { BREAKDOWN_EVENT, BreakdownStep, applyBreakdown, requestBreakdown } from './breakdown';
import { allTasks, loadPlanState } from './plan-store';

type Phase = 'loading' | 'questions' | 'steps' | 'error' | 'done';
const COSTS: { key: EnergyCost; label: string; color: string }[] = [
  { key: 'high', label: '高', color: '#D84315' },
  { key: 'medium', label: '中', color: '#F9A825' },
  { key: 'low', label: '低', color: '#2E7D32' },
];

export default function BreakdownHost() {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<string | undefined>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [steps, setSteps] = useState<BreakdownStep[]>([]);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const run = async (id: string, ans?: { q: string; a: string }[]) => {
    setPhase('loading');
    setError('');
    try {
      const r = await requestBreakdown(id, ans);
      if (r.questions && r.questions.length) {
        setQuestions(r.questions);
        setAnswers(r.questions.map(() => ''));
        setPhase('questions');
      } else {
        setSteps(r.steps ?? []);
        setSummary(r.summary ?? '');
        setPhase('steps');
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      setError(/key|Key|密钥|401/.test(msg) ? '还没有配置 AI Key：到「⚙️ 设置 → 🤖 AI」填入 API Key。' : msg);
      setPhase('error');
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onOpen = async (e: Event) => {
      const id = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (!id) return;
      const st = await loadPlanState();
      const t = allTasks(st.goals).find(r => r.task.id === id)?.task;
      setTaskId(id);
      setTitle(t?.title ?? '');
      setDue(t?.due);
      setQuestions([]);
      setSteps([]);
      setSummary('');
      run(id);
    };
    window.addEventListener(BREAKDOWN_EVENT, onOpen);
    return () => window.removeEventListener(BREAKDOWN_EVENT, onOpen);
  }, []);

  const close = () => {
    setTaskId(null);
    setPhase('loading');
  };

  const editStep = (i: number, patch: Partial<BreakdownStep>) => setSteps(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const removeStep = (i: number) => setSteps(prev => prev.filter((_, j) => j !== i));
  const addStep = () =>
    setSteps(prev => [...prev, { title: '', estimateMin: 30, energyCost: 'medium', date: prev[prev.length - 1]?.date ?? todayStr() }]);

  const valid = steps.length > 0 && steps.every(s => s.title.trim() && s.estimateMin >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  const total = steps.reduce((k, s) => k + (s.estimateMin || 0), 0);

  const confirm = async () => {
    if (!taskId) return;
    setSaving(true);
    try {
      // 步骤有先后：后一步的日期不能早于前一步
      const fixed = steps.map(s => ({ ...s, title: s.title.trim() }));
      for (let i = 1; i < fixed.length; i++) if (fixed[i].date < fixed[i - 1].date) fixed[i].date = fixed[i - 1].date;
      await applyBreakdown(taskId, fixed);
      setPhase('done');
    } catch (e: any) {
      setError(e?.message || String(e));
      setPhase('error');
    } finally {
      setSaving(false);
    }
  };

  if (!taskId) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.box}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={2}>
              🧩 帮我拆：{title}
            </Text>
            <TouchableOpacity onPress={close}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          {due ? <Text style={styles.muted}>截止 {due}</Text> : <Text style={styles.muted}>没有截止日，会在 7 天内安排</Text>}

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {phase === 'loading' && (
              <View style={styles.center}>
                <ActivityIndicator />
                <Text style={styles.muted}>AI 正在结合你的空闲时间和做事速度拆解…</Text>
              </View>
            )}

            {phase === 'error' && <Text style={styles.err}>{error}</Text>}

            {phase === 'questions' && (
              <View>
                <Text style={styles.section}>先回答几个问题，拆得会更准：</Text>
                {questions.map((q, i) => (
                  <View key={i} style={{ marginBottom: 10 }}>
                    <Text style={styles.q}>{q}</Text>
                    <TextInput
                      style={styles.input}
                      value={answers[i]}
                      onChangeText={t => setAnswers(prev => prev.map((a, j) => (j === i ? t : a)))}
                      placeholder="简单写几个字就行"
                      placeholderTextColor="#aaa"
                    />
                  </View>
                ))}
              </View>
            )}

            {phase === 'steps' && (
              <View>
                {summary ? <Text style={styles.summary}>{summary}</Text> : null}
                <Text style={styles.section}>
                  拆成 {steps.length} 步，共约 {total} 分钟（每一项都可以直接改）
                </Text>
                {steps.map((s, i) => (
                  <View key={i} style={styles.step}>
                    <View style={styles.stepHead}>
                      <Text style={styles.stepNo}>{i + 1}</Text>
                      <TextInput style={[styles.input, { flex: 1 }]} value={s.title} onChangeText={t => editStep(i, { title: t })} />
                      <TouchableOpacity onPress={() => removeStep(i)}>
                        <Text style={styles.del}>✕</Text>
                      </TouchableOpacity>
                    </View>
                    {s.note ? <Text style={styles.note}>💡 {s.note}</Text> : null}
                    <View style={styles.row}>
                      <TextInput
                        style={[styles.input, styles.small]}
                        value={String(s.estimateMin)}
                        onChangeText={t => editStep(i, { estimateMin: Number(t.replace(/[^0-9]/g, '')) || 0 })}
                        keyboardType="number-pad"
                      />
                      <Text style={styles.lbl}>分钟</Text>
                      {COSTS.map(c => (
                        <TouchableOpacity
                          key={c.key}
                          style={[styles.chip, s.energyCost === c.key && { backgroundColor: c.color, borderColor: c.color }]}
                          onPress={() => editStep(i, { energyCost: c.key })}
                        >
                          <Text style={[styles.chipText, s.energyCost === c.key && styles.chipTextOn]}>{c.label}</Text>
                        </TouchableOpacity>
                      ))}
                      <TextInput style={[styles.input, styles.date]} value={s.date} onChangeText={t => editStep(i, { date: t.trim() })} />
                      <TouchableOpacity onPress={() => editStep(i, { date: addDays(s.date, -1) })}>
                        <Text style={styles.arrow}>‹</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => editStep(i, { date: addDays(s.date, 1) })}>
                        <Text style={styles.arrow}>›</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                <TouchableOpacity onPress={addStep}>
                  <Text style={styles.link}>＋ 加一步</Text>
                </TouchableOpacity>
              </View>
            )}

            {phase === 'done' && (
              <View style={styles.center}>
                <Text style={styles.ok}>✅ 已拆好并排进日历，每一步都在它那天显示，到点会提醒。</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            {phase === 'questions' && (
              <>
                <TouchableOpacity style={styles.btn} onPress={() => run(taskId, questions.map((q, i) => ({ q, a: answers[i] })))}>
                  <Text style={styles.btnText}>继续拆</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnGhost} onPress={() => run(taskId, questions.map(q => ({ q, a: '' })))}>
                  <Text style={styles.btnGhostText}>跳过，直接拆</Text>
                </TouchableOpacity>
              </>
            )}
            {phase === 'steps' && (
              <>
                <TouchableOpacity style={[styles.btn, (!valid || saving) && styles.disabled]} disabled={!valid || saving} onPress={confirm}>
                  <Text style={styles.btnText}>{saving ? '保存中…' : '确认拆分'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnGhost} onPress={() => run(taskId)} disabled={saving}>
                  <Text style={styles.btnGhostText}>重新拆</Text>
                </TouchableOpacity>
              </>
            )}
            {phase === 'error' && (
              <TouchableOpacity style={styles.btn} onPress={() => run(taskId)}>
                <Text style={styles.btnText}>再试一次</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btnGhost} onPress={close}>
              <Text style={styles.btnGhostText}>{phase === 'done' ? '好的' : '取消'}</Text>
            </TouchableOpacity>
          </View>
          {phase === 'steps' && <Text style={styles.foot}>确认后，原来的「{title}」会被这几步替换。</Text>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { backgroundColor: '#fff', borderRadius: 16, padding: 18, width: '100%' as unknown as number, maxWidth: 620 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', flex: 1, marginRight: 10 },
  close: { fontSize: 18, color: '#E53935' },
  muted: { fontSize: 13, color: '#888', marginTop: 4, marginBottom: 8 },
  center: { alignItems: 'center', paddingVertical: 24 },
  err: { color: '#C62828', fontSize: 14, marginVertical: 12 },
  ok: { color: '#2E7D32', fontSize: 15, textAlign: 'center' },
  section: { fontSize: 14, fontWeight: '700', color: '#333', marginVertical: 8 },
  summary: { fontSize: 14, color: '#455A64', lineHeight: 21, backgroundColor: '#F3F7FC', borderRadius: 8, padding: 10 },
  q: { fontSize: 14, color: '#1a1a2e', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, fontSize: 14, backgroundColor: '#fff', marginRight: 6 },
  small: { width: 60, textAlign: 'center' },
  date: { width: 110, marginLeft: 6 },
  step: { borderWidth: 1, borderColor: '#EEF1F5', borderRadius: 10, padding: 8, marginBottom: 8 },
  stepHead: { flexDirection: 'row', alignItems: 'center' },
  stepNo: { width: 22, fontSize: 14, fontWeight: '700', color: '#1976D2' },
  del: { color: '#E53935', fontSize: 15, paddingHorizontal: 4 },
  note: { fontSize: 12, color: '#78909C', marginLeft: 22, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 6, marginLeft: 22 },
  lbl: { fontSize: 13, color: '#666', marginRight: 8 },
  chip: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 12, paddingVertical: 2, paddingHorizontal: 9, marginRight: 4, backgroundColor: '#fff' },
  chipText: { fontSize: 13, color: '#455A64' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  arrow: { fontSize: 18, color: '#1976D2', paddingHorizontal: 6 },
  link: { color: '#1976D2', fontSize: 14, marginTop: 4 },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: 12, flexWrap: 'wrap' },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16, marginRight: 10 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnGhost: { paddingVertical: 9, paddingHorizontal: 10 },
  btnGhostText: { color: '#455A64', fontSize: 14 },
  disabled: { opacity: 0.45 },
  foot: { fontSize: 12, color: '#999', marginTop: 6 },
});
