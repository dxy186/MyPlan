/**
 * 日历顶部的一条：正在 / 下一项；有计时时显示计时和结束按钮。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { KEYS, loadJSON, minutesToHM } from '@/app/utils/planning';
import { ScheduleResult } from '@/app/utils/scheduler';
import { nowAndNext, fmtWhen, SCHEDULE_STALE_EVENT } from '@/components/assistant/followup';
import { GapTimer, TIMER_CHANGED_EVENT, loadGapTimer, recordGapTimer, startTaskTimer } from '@/components/assistant/gap';
import { allTasks, commitState, loadPlanState, setTaskDone } from '@/components/assistant/plan-store';

export const SCHEDULE_UPDATED_EVENT = 'myplan:schedule-updated';

function fmt(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

export default function CalendarTopBar({ right }: { right?: React.ReactNode } = {}) {
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [timer, setTimer] = useState<GapTimer | null>(null);
  const [ask, setAsk] = useState<{ taskId: string; title: string; minutes: number } | null>(null);
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setSchedule(await loadJSON<ScheduleResult | null>(KEYS.schedule, null));
    setTimer(await loadGapTimer());
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => setTick(x => x + 1), 1000);
    if (typeof window === 'undefined' || !window.addEventListener) return () => clearInterval(id);
    const evs = [TIMER_CHANGED_EVENT, SCHEDULE_STALE_EVENT, SCHEDULE_UPDATED_EVENT];
    evs.forEach(e => window.addEventListener(e, load));
    return () => {
      clearInterval(id);
      evs.forEach(e => window.removeEventListener(e, load));
    };
  }, [load]);

  const finish = async () => {
    if (!timer) return;
    setBusy(true);
    try {
      const minutes = await recordGapTimer(timer);
      setAsk({ taskId: timer.taskId, title: timer.title, minutes });
      setTimer(null);
    } finally {
      setBusy(false);
    }
  };

  const answer = async (done: boolean) => {
    if (!ask) return;
    setBusy(true);
    try {
      if (done) await setTaskDone(ask.taskId, true);
      await commitState(await loadPlanState());
      setAsk(null);
      await load();
      window.dispatchEvent(new Event(SCHEDULE_UPDATED_EVENT));
    } finally {
      setBusy(false);
    }
  };

  if (ask) {
    return (
      <View style={[styles.bar, styles.barAsk]}>
        <Text style={styles.text}>
          已记录「{ask.title}」{ask.minutes} 分钟。整个任务做完了吗？
        </Text>
        <TouchableOpacity style={styles.btn} disabled={busy} onPress={() => answer(true)}>
          <Text style={styles.btnText}>✅ 做完了</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnGhost} disabled={busy} onPress={() => answer(false)}>
          <Text style={styles.btnGhostText}>还没，剩下的往后排</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (timer) {
    const sec = Math.max(0, Math.floor((Date.now() - new Date(timer.startAt).getTime()) / 1000));
    const over = sec > timer.plannedMin * 60;
    return (
      <View style={[styles.bar, styles.barTimer]}>
        <Text style={styles.text}>
          ⏱ 正在做：<Text style={styles.strong}>{timer.title}</Text>
          <Text style={[styles.clock, over && styles.clockOver]}>　{fmt(sec)}</Text>
          <Text style={styles.meta}>　计划 {timer.plannedMin} 分钟</Text>
        </Text>
        <TouchableOpacity style={styles.btn} disabled={busy} onPress={finish}>
          <Text style={styles.btnText}>■ 这段做完了</Text>
        </TouchableOpacity>
        {right}
      </View>
    );
  }

  const { current, next } = nowAndNext(schedule);
  // 点 ▶ 直接给「正在」的任务开始计时（计划时长 = 这段排程剩下的分钟）
  const startCurrent = async () => {
    if (!current?.taskId) return;
    setBusy(true);
    try {
      const st = await loadPlanState();
      const ref = allTasks(st.goals).find(r => r.task.id === current.taskId);
      if (!ref || ref.task.done) return;
      const now = new Date();
      const left = Math.max(5, current.endMin - (now.getHours() * 60 + now.getMinutes()));
      await startTaskTimer(ref.task, left);
      await load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.bar}>
      {current?.type === 'task' && current.taskId ? (
        <TouchableOpacity style={styles.play} disabled={busy} onPress={startCurrent} accessibilityLabel="开始计时">
          <Text style={styles.playText}>▶</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.text}>
        {current ? (
          <>
            {current.type === 'task' && current.taskId ? '' : '▶ '}正在：<Text style={styles.strong}>{current.title}</Text>
            <Text style={styles.meta}>　到 {minutesToHM(current.endMin)}</Text>
          </>
        ) : (
          '☕ 现在没有安排'
        )}
        {next ? <Text style={styles.meta}>　｜　下一项：{next.title} · {fmtWhen(next)}</Text> : null}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    backgroundColor: '#E8F1FC',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  barTimer: { backgroundColor: '#FFF8E1' },
  barAsk: { backgroundColor: '#E8F5E9' },
  text: { fontSize: 14, color: '#263238', flexShrink: 1, marginRight: 10 },
  strong: { fontWeight: '700', color: '#0D47A1' },
  meta: { fontSize: 13, color: '#607D8B' },
  clock: { fontSize: 15, fontWeight: '700', color: '#1976D2', fontVariant: ['tabular-nums'] },
  clockOver: { color: '#D84315' },
  play: { backgroundColor: '#1976D2', borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  playText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btn: { backgroundColor: '#2E7D32', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12, marginRight: 8 },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnGhost: { paddingVertical: 5, paddingHorizontal: 8 },
  btnGhostText: { color: '#455A64', fontSize: 13 },
});
