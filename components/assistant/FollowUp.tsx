/**
 * AI 秘书首页的跟进卡片：正在做 / 下一项、到点提醒开关、自动补排、早上计划、晚上复盘
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { addDays, minutesToHM, todayStr } from '@/app/utils/planning';
import { ScheduleResult } from '@/app/utils/scheduler';

import {
  DailyPlan,
  DailyReview,
  MissedBlock,
  REVIEW_REASONS,
  ReminderSettings,
  ReviewItem,
  ReviewReason,
  fmtWhen,
  loadDailyPlans,
  loadReminderSettings,
  loadReviews,
  minuteNow,
  notificationSupported,
  notify,
  nowAndNext,
  requestNotificationPermission,
  reviewCandidates,
  saveDailyPlan,
  saveReminderSettings,
  saveReview,
  todayTasks,
} from './followup';
import { AssistantAction, PlanState, applyActions, commitState, loadPlanState } from './plan-store';

const TYPE_ICON: Record<string, string> = { task: '📝', fixed: '📌', play: '🎮', chore: '🧹' };

function fmtMin(m: number) {
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} 小时 ${r} 分钟` : `${h} 小时`;
}

// ---------------------------------------------------------------------------
// 正在做 / 下一项 + 提醒开关
// ---------------------------------------------------------------------------
export function NowNextCard({ schedule }: { schedule: ScheduleResult | null }) {
  const [, setTick] = useState(0);
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [permission, setPermission] = useState<string>(notificationSupported() ? Notification.permission : 'unsupported');

  useEffect(() => {
    loadReminderSettings().then(setSettings);
    const id = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const { current, next } = nowAndNext(schedule);
  const cur = minuteNow();

  const toggleReminders = async () => {
    if (!settings) return;
    if (!settings.enabled) {
      const ok = await requestNotificationPermission();
      setPermission(notificationSupported() ? Notification.permission : 'unsupported');
      if (!ok) return;
      const s = { ...settings, enabled: true };
      await saveReminderSettings(s);
      setSettings(s);
      notify('🔔 MyPlan 提醒已开启', '任务开始时、固定日程前 10 分钟和晚上复盘时会提醒你。');
    } else {
      const s = { ...settings, enabled: false };
      await saveReminderSettings(s);
      setSettings(s);
    }
  };

  return (
    <View style={styles.nowCard}>
      <View style={{ flex: 1, minWidth: 240 }}>
        {current ? (
          <Text style={styles.nowText}>
            ▶ 正在：{TYPE_ICON[current.type] ?? ''} {current.title}
            <Text style={styles.nowMeta}>  到 {minutesToHM(current.endMin)}（还有 {current.endMin - cur} 分钟）</Text>
          </Text>
        ) : (
          <Text style={styles.nowText}>☕ 现在没有安排</Text>
        )}
        {next && (
          <Text style={styles.nextText}>
            下一项：{TYPE_ICON[next.type] ?? ''} {next.title} · {fmtWhen(next)}
          </Text>
        )}
      </View>
      {Platform.OS === 'web' && settings && (
        <TouchableOpacity
          style={[styles.bellBtn, settings.enabled && styles.bellOn]}
          onPress={toggleReminders}
          disabled={permission === 'unsupported'}
        >
          <Text style={[styles.bellText, settings.enabled && styles.bellTextOn]}>
            {permission === 'unsupported'
              ? '此环境不支持提醒'
              : permission === 'denied'
              ? '🔕 通知被浏览器禁止'
              : settings.enabled
              ? '🔔 到点提醒：开'
              : '🔔 开启到点提醒'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 自动补排
// ---------------------------------------------------------------------------
export function MissedCard({ missed, onClose }: { missed: MissedBlock[]; onClose: () => void }) {
  if (missed.length === 0) return null;
  return (
    <View style={styles.missedCard}>
      <Text style={styles.cardTitle}>🔁 这些没按时开始，已经帮你顺延</Text>
      {missed.map(m => (
        <Text key={m.item.id} style={styles.missedRow}>
          • {m.item.title}（原 {minutesToHM(m.item.startMin)}–{minutesToHM(m.item.endMin)}）→{' '}
          {m.movedTo ? <Text style={styles.strong}>{fmtWhen(m.movedTo)}</Text> : <Text style={styles.warnText}>截止前排不下了，可以跟 AI 说说怎么办</Text>}
        </Text>
      ))}
      <TouchableOpacity onPress={onClose}>
        <Text style={styles.link}>知道了</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 早上：确认今日计划
// ---------------------------------------------------------------------------
export function MorningCard({ schedule, onAdjust }: { schedule: ScheduleResult | null; onAdjust: () => void }) {
  const [plan, setPlan] = useState<DailyPlan | null | undefined>(undefined);
  useEffect(() => {
    loadDailyPlans().then(all => setPlan(all.find(p => p.date === todayStr()) ?? null));
  }, []);
  const tasks = useMemo(() => todayTasks(schedule), [schedule]);
  const cur = minuteNow();
  if (plan !== null || cur < 5 * 60 || cur >= 14 * 60 || tasks.length === 0) return null;
  const total = tasks.reduce((s, t) => s + t.minutes, 0);

  const confirm = async () => {
    const p: DailyPlan = {
      date: todayStr(),
      confirmedAt: new Date().toISOString(),
      taskIds: tasks.map(t => t.taskId),
      titles: tasks.map(t => t.title),
      totalMin: total,
    };
    await saveDailyPlan(p);
    setPlan(p);
  };

  return (
    <View style={styles.morningCard}>
      <Text style={styles.cardTitle}>☀️ 今天的计划（共 {fmtMin(total)}）</Text>
      {tasks.map(t => (
        <Text key={t.taskId} style={styles.planRow}>
          {minutesToHM(t.first)}　{t.title}
          <Text style={styles.planMeta}>　{fmtMin(t.minutes)}</Text>
        </Text>
      ))}
      <View style={styles.row}>
        <TouchableOpacity style={styles.primary} onPress={confirm}>
          <Text style={styles.primaryText}>👍 就这样，开始今天</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={onAdjust}>
          <Text style={styles.secondaryText}>我想调整</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 晚上：1 分钟复盘
// ---------------------------------------------------------------------------
type Draft = { status?: ReviewItem['status']; reason?: ReviewReason };

export function EveningCard({
  state,
  schedule,
  onChanged,
  onNote,
}: {
  state: PlanState;
  schedule: ScheduleResult | null;
  onChanged: (s: PlanState, sch: ScheduleResult) => void;
  onNote: (t: string) => void;
}) {
  const [review, setReview] = useState<DailyReview | null | undefined>(undefined);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const today = todayStr();
    loadReviews().then(all => setReview(all.find(r => r.date === today) ?? null));
    loadDailyPlans().then(all => setPlan(all.find(p => p.date === today) ?? null));
    loadReminderSettings().then(setSettings);
  }, []);

  const items = useMemo(() => reviewCandidates(state, schedule, plan), [state, schedule, plan]);
  if (review !== null || !settings || items.length === 0) return null;
  const cur = minuteNow();
  if (cur < settings.eveningReviewAt) return null;

  const set = (id: string, d: Draft) => setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...d } }));
  const pending = items.filter(i => !i.task.done);
  const ready = pending.every(i => drafts[i.task.id]?.status);

  const submit = async () => {
    setBusy(true);
    try {
      const fresh = await loadPlanState();
      const tomorrow = addDays(todayStr(), 1);
      const actions: AssistantAction[] = [];
      const reviewItems: ReviewItem[] = [];
      for (const i of items) {
        if (i.task.done) {
          reviewItems.push({ taskId: i.task.id, title: i.task.title, status: 'done' });
          continue;
        }
        const d = drafts[i.task.id] ?? {};
        const status = d.status ?? 'tomorrow';
        reviewItems.push({ taskId: i.task.id, title: i.task.title, status, reason: status === 'done' ? undefined : d.reason });
        if (status === 'done') actions.push({ type: 'complete_task', taskId: i.task.id });
        else if (status === 'tomorrow') actions.push({ type: 'update_task', taskId: i.task.id, notBefore: tomorrow });
        else actions.push({ type: 'update_task', taskId: i.task.id, notBefore: addDays(todayStr(), 3) });
      }
      const { next } = applyActions(fresh, actions);
      const sch = await commitState(next);
      const r: DailyReview = { date: todayStr(), at: new Date().toISOString(), items: reviewItems };
      await saveReview(r);
      setReview(r);
      onChanged(next, sch);
      const done = reviewItems.filter(x => x.status === 'done').length;
      onNote(`🌙 今日复盘：完成 ${done}/${reviewItems.length} 项。没做完的已经顺延，明天见。`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.eveningCard}>
      <Text style={styles.cardTitle}>🌙 1 分钟复盘今天</Text>
      {items.map(({ task, todayMin }) => {
        const d = drafts[task.id] ?? {};
        return (
          <View key={task.id} style={styles.reviewRow}>
            <Text style={styles.reviewTitle}>
              {task.done ? '✅ ' : ''}
              {task.title}
              {todayMin > 0 && <Text style={styles.planMeta}>　今天做了 {todayMin} 分钟</Text>}
            </Text>
            {!task.done && (
              <>
                <View style={styles.chips}>
                  {(
                    [
                      ['done', '其实做完了'],
                      ['tomorrow', '明天继续'],
                      ['later', '放一放（3 天后）'],
                    ] as const
                  ).map(([k, label]) => (
                    <TouchableOpacity key={k} style={[styles.chip, d.status === k && styles.chipOn]} onPress={() => set(task.id, { status: k })}>
                      <Text style={[styles.chipText, d.status === k && styles.chipTextOn]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {d.status && d.status !== 'done' && (
                  <View style={styles.chips}>
                    <Text style={styles.reasonLabel}>为什么没做完？</Text>
                    {REVIEW_REASONS.map(r => (
                      <TouchableOpacity key={r} style={[styles.chipSmall, d.reason === r && styles.chipOn]} onPress={() => set(task.id, { reason: r })}>
                        <Text style={[styles.chipTextSmall, d.reason === r && styles.chipTextOn]}>{r}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        );
      })}
      <Text style={styles.muted}>原因会记下来，以后规划时 AI 会参考（比如常常「估少了」就多留时间）。</Text>
      <TouchableOpacity style={[styles.primary, (!ready || busy) && styles.disabled]} disabled={!ready || busy} onPress={submit}>
        <Text style={styles.primaryText}>{ready ? '完成复盘' : '每项选一下状态'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  nowCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: '#E8F1FC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14,
    maxWidth: 820,
  },
  nowText: { fontSize: 16, fontWeight: '700', color: '#0D47A1' },
  nowMeta: { fontSize: 13, fontWeight: '400', color: '#5C7CA6' },
  nextText: { fontSize: 13, color: '#455A64', marginTop: 4 },
  bellBtn: { borderWidth: 1, borderColor: '#90CAF9', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff', marginTop: 4 },
  bellOn: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  bellText: { fontSize: 13, color: '#1976D2', fontWeight: '600' },
  bellTextOn: { color: '#fff' },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  missedCard: { backgroundColor: '#F3F7F0', borderRadius: 12, borderWidth: 1, borderColor: '#C5E1A5', padding: 14, marginBottom: 14, maxWidth: 820 },
  missedRow: { fontSize: 14, color: '#333', marginBottom: 4, lineHeight: 20 },
  strong: { fontWeight: '700', color: '#2E7D32' },
  warnText: { color: '#BF360C' },
  link: { color: '#1976D2', fontSize: 14, marginTop: 4 },
  morningCard: { backgroundColor: '#FFFBEA', borderRadius: 12, borderWidth: 1, borderColor: '#FFE082', padding: 14, marginBottom: 14, maxWidth: 820 },
  planRow: { fontSize: 14, color: '#333', marginBottom: 3, fontVariant: ['tabular-nums'] },
  planMeta: { fontSize: 12, color: '#999' },
  eveningCard: { backgroundColor: '#F3F0FA', borderRadius: 12, borderWidth: 1, borderColor: '#D1C4E9', padding: 14, marginBottom: 14, maxWidth: 820 },
  reviewRow: { marginBottom: 10 },
  reviewTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a2e', marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: '#B39DDB', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 4, backgroundColor: '#fff' },
  chipSmall: { borderWidth: 1, borderColor: '#D1C4E9', borderRadius: 12, paddingVertical: 2, paddingHorizontal: 8, marginRight: 5, marginBottom: 4, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#7E57C2', borderColor: '#7E57C2' },
  chipText: { fontSize: 13, color: '#5E35B1' },
  chipTextSmall: { fontSize: 12, color: '#7E57C2' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  reasonLabel: { fontSize: 12, color: '#888', marginRight: 6 },
  muted: { fontSize: 12, color: '#888', marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  primary: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16, marginRight: 10, alignSelf: 'flex-start' },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  secondary: { backgroundColor: '#EEF1F5', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16 },
  secondaryText: { color: '#555', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
