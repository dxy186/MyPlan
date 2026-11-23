import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ScheduleResult } from '@/app/utils/scheduler';

import {
  ENERGY_LEVEL_CN,
  EnergyLevel,
  GapTimer,
  TIMER_CHANGED_EVENT,
  currentEnergy,
  freeWindow,
  loadGapTimer,
  recordGapTimer,
  saveGapTimer,
  suggestForGap,
} from './gap';
import {
  OVERRUN_OPTIONS,
  OverrunChoice,
  PlanState,
  allTasks,
  commitState,
  loadPlanState,
  resolveOverrun,
  setTaskDone,
  spentByTask,
} from './plan-store';

const DURATIONS = [10, 15, 25, 45, 60];
const LEVELS: EnergyLevel[] = ['high', 'medium', 'low'];

function fmtElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function GapPanel({
  state,
  schedule,
  onChanged,
  onNote,
}: {
  state: PlanState;
  schedule: ScheduleResult | null;
  onChanged: (state: PlanState, schedule: ScheduleResult) => void;
  onNote: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [energy, setEnergy] = useState<EnergyLevel | null>(null);
  const [timer, setTimer] = useState<GapTimer | null>(null);
  const [tick, setTick] = useState(0);
  const [askDone, setAskDone] = useState<{ taskId: string; title: string; minutes: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // 恢复正在进行的计时（切换页面后回来）
  useEffect(() => {
    const sync = () =>
      loadGapTimer().then(t => {
        setTimer(t);
        if (t) setOpen(true);
      });
    sync();
    // 在别的地方（时间轴、任务页）开始计时时同步过来
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener(TIMER_CHANGED_EVENT, sync);
    return () => window.removeEventListener(TIMER_CHANGED_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!timer) return;
    const id = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const win = useMemo(() => freeWindow(state, schedule), [state, schedule, open]);
  const detected = useMemo(() => currentEnergy(state), [state, open]);
  const freeMin = Math.min(win.minutes, 180);
  const defaultMin = win.minutes === 0 ? 25 : freeMin <= 90 ? Math.max(5, freeMin) : 60;
  const chosenMin = minutes ?? defaultMin;
  const chosenEnergy = energy ?? detected.level;
  const suggestions = useMemo(
    () => (open && !timer ? suggestForGap(state, chosenMin, chosenEnergy, schedule) : []),
    [open, timer, state, schedule, chosenMin, chosenEnergy]
  );

  const start = async (s: (typeof suggestions)[number]) => {
    const t: GapTimer = {
      taskId: s.task.id,
      title: s.task.title,
      startAt: new Date().toISOString(),
      plannedMin: s.minutes,
      estimateMin: s.task.estimateMin,
    };
    await saveGapTimer(t);
    setTimer(t);
  };

  const finishChunk = async () => {
    if (!timer) return;
    setBusy(true);
    try {
      const used = await recordGapTimer(timer);
      setAskDone({ taskId: timer.taskId, title: timer.title, minutes: used });
      setTimer(null);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await saveGapTimer(null);
    setTimer(null);
  };

  const answerDone = async (done: boolean) => {
    if (!askDone) return;
    setBusy(true);
    try {
      if (done) await setTaskDone(askDone.taskId, true);
      const fresh = await loadPlanState();
      const sch = await commitState(fresh);
      onChanged(fresh, sch);
      onNote(
        done
          ? `✅「${askDone.title}」做完了（这次 ${askDone.minutes} 分钟），已重新排程。`
          : `⏱ 「${askDone.title}」推进了 ${askDone.minutes} 分钟，剩下的已重新排进后面的空档。`
      );
      setAskDone(null);
      setMinutes(null);
      setEnergy(null);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open && !timer && !askDone) {
    return (
      <TouchableOpacity style={styles.openBtn} onPress={() => setOpen(true)}>
        <Text style={styles.openText}>⚡ 我现在有空</Text>
        <Text style={styles.openSub}>
          {win.minutes > 0
            ? `到 ${win.until}（${win.nextTitle}）还有 ${win.minutes} 分钟`
            : win.busyWith
            ? `现在在「${win.busyWith}」中`
            : `已过今天的作息时间（${win.until}）`}
        </Text>
      </TouchableOpacity>
    );
  }

  // 正在做
  if (timer) {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(timer.startAt).getTime()) / 1000));
    void tick;
    const over = elapsed > timer.plannedMin * 60;
    // 超出整个任务的预估：问还要多久
    const task = allTasks(state.goals).find(r => r.task.id === timer.taskId)?.task;
    const before = spentByTask(state.timeLogs).get(timer.taskId) ?? 0;
    const total = before + Math.floor(elapsed / 60);
    const overrun = !!task && total >= task.estimateMin;
    const answerOverrun = async (choice: OverrunChoice) => {
      setBusy(true);
      try {
        if ('done' in choice) {
          await recordGapTimer(timer);
          setTimer(null);
          await setTaskDone(timer.taskId, true);
          const fresh = await loadPlanState();
          onChanged(fresh, await commitState(fresh));
          onNote(`✅「${timer.title}」做完了，已重新排程。`);
          setOpen(false);
        } else if (choice.tomorrow) {
          const used = await recordGapTimer(timer);
          setTimer(null);
          const r = await resolveOverrun(timer.taskId, choice);
          onChanged(r.state, r.schedule);
          onNote(`⏱ 今天先做到这里（这次 ${used} 分钟）。${r.summary}，剩下的明天继续。`);
          setOpen(false);
        } else {
          const r = await resolveOverrun(timer.taskId, choice, Math.floor(elapsed / 60));
          onChanged(r.state, r.schedule);
          const t = { ...timer, plannedMin: Math.floor(elapsed / 60) + choice.addMin, estimateMin: before + Math.floor(elapsed / 60) + choice.addMin };
          await saveGapTimer(t);
          setTimer(t);
          onNote(`${r.summary}，继续计时，后面的安排已顺延。`);
        }
      } finally {
        setBusy(false);
      }
    };
    return (
      <View style={styles.card}>
        <Text style={styles.title}>⏱ 正在做：{timer.title}</Text>
        <Text style={[styles.clock, over && styles.clockOver]}>{fmtElapsed(elapsed)}</Text>
        <Text style={styles.muted}>
          计划 {timer.plannedMin} 分钟{over ? '，已经到时间了，可以收尾' : ''}。切换页面不会中断计时。
        </Text>
        {overrun && task && (
          <View style={styles.overBox}>
            <Text style={styles.overTitle}>
              ⏰ 已超出这个任务的预估：预估 {task.estimateMin} 分钟，已做 {total} 分钟。还要多久？
            </Text>
            <View style={styles.pickRow}>
              {OVERRUN_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.pick, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => answerOverrun(opt.choice)}
                >
                  <Text style={styles.pickText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        <View style={styles.row}>
          <TouchableOpacity style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={finishChunk}>
            <Text style={styles.primaryText}>■ 这段做完了</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={cancel} disabled={busy}>
            <Text style={styles.secondaryText}>放弃，不记录</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // 做完一段：问整个任务完成了没
  if (askDone) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>
          已记录「{askDone.title}」{askDone.minutes} 分钟。整个任务做完了吗？
        </Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => answerDone(true)}>
            <Text style={styles.primaryText}>✅ 做完了</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondary, busy && styles.disabled]} disabled={busy} onPress={() => answerDone(false)}>
            <Text style={styles.secondaryText}>还没，剩下的排到后面</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.title}>⚡ 我现在有空</Text>
        <TouchableOpacity onPress={() => setOpen(false)}>
          <Text style={styles.link}>收起</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.muted}>
        {win.minutes > 0
          ? `到 ${win.until}（${win.nextTitle}）还有 ${win.minutes} 分钟。`
          : win.busyWith
          ? `你现在在「${win.busyWith}」中，到 ${win.until} 结束；如果其实有空，也可以选个时长。`
          : `已经过了今天的作息时间（${win.until}），早点休息吧；如果还想做点什么，可以选个时长。`}
      </Text>

      <View style={styles.pickRow}>
        <Text style={styles.pickLabel}>有多久</Text>
        {DURATIONS.filter(d => win.minutes === 0 || d <= Math.max(10, freeMin)).map(d => (
          <TouchableOpacity key={d} style={[styles.pick, chosenMin === d && styles.pickOn]} onPress={() => setMinutes(d)}>
            <Text style={[styles.pickText, chosenMin === d && styles.pickTextOn]}>{d} 分钟</Text>
          </TouchableOpacity>
        ))}
        {freeMin > 0 && !DURATIONS.includes(freeMin) && freeMin <= 180 && (
          <TouchableOpacity style={[styles.pick, chosenMin === freeMin && styles.pickOn]} onPress={() => setMinutes(freeMin)}>
            <Text style={[styles.pickText, chosenMin === freeMin && styles.pickTextOn]}>到 {win.until}（{freeMin} 分钟）</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.pickRow}>
        <Text style={styles.pickLabel}>精力</Text>
        {LEVELS.map(l => (
          <TouchableOpacity key={l} style={[styles.pick, chosenEnergy === l && styles.pickOn]} onPress={() => setEnergy(l)}>
            <Text style={[styles.pickText, chosenEnergy === l && styles.pickTextOn]}>{ENERGY_LEVEL_CN[l]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.mutedSmall}>
        {energy
          ? '已按你选的精力推荐。'
          : detected.source === 'log'
          ? `按你最近一次精力打卡（${detected.score} 分）判断。`
          : `按你这个时段的历史精力（约 ${detected.score} 分）估计，不准就点一下改。`}
      </Text>

      {suggestions.length === 0 ? (
        <Text style={styles.muted}>没有合适的任务：可能都做完了，或者剩下的都需要更长的整块时间。可以在上面跟 AI 说说想做什么。</Text>
      ) : (
        suggestions.map((s, i) => (
          <View key={s.task.id} style={[styles.sugg, i === 0 && styles.suggTop]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.suggTitle}>
                {i === 0 ? '👉 ' : ''}
                {s.task.title}
                <Text style={styles.suggGoal}>  · {s.goal.title}</Text>
              </Text>
              <Text style={styles.suggMeta}>
                {s.finishes ? `做完它，约 ${s.minutes} 分钟` : `推进 ${s.minutes} 分钟`} · {s.reasons.join(' · ')}
              </Text>
            </View>
            <TouchableOpacity style={styles.startBtn} onPress={() => start(s)}>
              <Text style={styles.startText}>▶ 开始</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  openBtn: {
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFE082',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    maxWidth: 820,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  openText: { fontSize: 16, fontWeight: '700', color: '#E65100', marginRight: 12 },
  openSub: { fontSize: 13, color: '#8D6E63' },
  card: {
    backgroundColor: '#FFFDF6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FFE082',
    padding: 16,
    marginBottom: 14,
    maxWidth: 820,
  },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  link: { color: '#1976D2', fontSize: 14 },
  muted: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 8 },
  mutedSmall: { fontSize: 12, color: '#888', marginBottom: 10 },
  pickRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 },
  pickLabel: { fontSize: 13, color: '#666', marginRight: 8, width: 44 },
  pick: {
    borderWidth: 1,
    borderColor: '#E0C878',
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 10,
    marginRight: 6,
    marginBottom: 4,
    backgroundColor: '#fff',
  },
  pickOn: { backgroundColor: '#EF6C00', borderColor: '#EF6C00' },
  pickText: { fontSize: 13, color: '#6D4C41' },
  pickTextOn: { color: '#fff', fontWeight: '600' },
  sugg: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EFE3C0',
    padding: 10,
    marginBottom: 8,
  },
  suggTop: { borderColor: '#EF6C00', borderWidth: 1.5 },
  suggTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a2e' },
  suggGoal: { fontSize: 12, fontWeight: '400', color: '#999' },
  suggMeta: { fontSize: 12, color: '#777', marginTop: 3, lineHeight: 18 },
  startBtn: { backgroundColor: '#EF6C00', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, marginLeft: 10 },
  startText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  clock: { fontSize: 36, fontWeight: '700', color: '#1976D2', marginVertical: 6, fontVariant: ['tabular-nums'] },
  clockOver: { color: '#D84315' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  primary: { backgroundColor: '#2E7D32', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, marginRight: 10 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondary: { backgroundColor: '#EEF1F5', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  secondaryText: { color: '#555', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  overBox: { backgroundColor: '#FFF6F2', borderRadius: 10, borderWidth: 1, borderColor: '#F5C6B5', padding: 10, marginBottom: 8 },
  overTitle: { fontSize: 14, fontWeight: '600', color: '#BF360C', marginBottom: 6 },
});
