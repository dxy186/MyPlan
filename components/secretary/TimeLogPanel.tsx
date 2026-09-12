/**
 * 板块六：执行支持与时间记录（一键计时 + 琐事一键套用 + 实际vs预估）
 * 板块九：碎片时间与生活琐事管理（碎片时间日志 / 微休息）
 *
 * 功能：
 *  - 一键计时：选一个目标库任务，点开始 / 完成，自动生成时间记录
 *  - 生活琐事一键套用（来自生活琐事标准时间库）
 *  - 碎片时间记录：微输入 / 微整理 / 微恢复 / 微充电 / 刷手机
 *  - 实际 vs 预估对比，算出个人速率系数（规划谬误修正）
 *  - 今日统计与碎片时间周报
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  DEFAULT_CHORES,
  EnergyLog,
  FRAGMENT_TYPES,
  Goal,
  KEYS,
  PlanTask,
  TimeLog,
  calibrateEstimate,
  loadJSON,
  randomId,
  saveJSON,
  speedFactor,
  suggestFragment,
  todayStr,
} from '@/app/utils/planning';

const CATEGORY_COLOR: Record<TimeLog['category'], string> = {
  任务: '#1976D2',
  生活琐事: '#B07800',
  碎片时间: '#8e5bd0',
};

function isoNow(): string {
  return new Date().toISOString();
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtDuration(min: number): string {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export default function TimeLogPanel() {
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [energyLogs, setEnergyLogs] = useState<EnergyLog[]>([]);
  const [chores, setChores] = useState<{ title: string; minutes: number }[]>(DEFAULT_CHORES);
  const [message, setMessage] = useState('');

  // 计时器
  const [runTitle, setRunTitle] = useState('');
  const [runTaskId, setRunTaskId] = useState<string | undefined>(undefined);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0); // 秒
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 碎片时间
  const [fragType, setFragType] = useState<(typeof FRAGMENT_TYPES)[number]>('微恢复');
  const [fragMinutes, setFragMinutes] = useState('10');

  useEffect(() => {
    (async () => {
      setLogs(await loadJSON<TimeLog[]>(KEYS.timeLogs, []));
      setGoals(await loadJSON<Goal[]>(KEYS.goals, []));
      setEnergyLogs(await loadJSON<EnergyLog[]>(KEYS.energyLogs, []));
      const savedChores = await loadJSON<{ title: string; minutes: number }[]>(KEYS.choreTemplates, []);
      setChores(savedChores.length > 0 ? savedChores : DEFAULT_CHORES);
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const pendingTasks = useMemo(() => {
    const out: PlanTask[] = [];
    for (const g of goals) for (const m of g.milestones) for (const t of m.tasks) if (!t.done) out.push(t);
    return out;
  }, [goals]);

  const taskById = useMemo(() => {
    const m = new Map<string, PlanTask>();
    for (const t of pendingTasks) m.set(t.id, t);
    return m;
  }, [pendingTasks]);

  const persist = async (next: TimeLog[]) => {
    setLogs(next);
    await saveJSON(KEYS.timeLogs, next);
  };

  const persistFragment = async (next: TimeLog[]) => {
    await saveJSON(KEYS.fragmentLogs, next.filter(l => l.category === '碎片时间'));
  };

  const factor = useMemo(() => speedFactor(logs), [logs]);

  const today = todayStr();
  const todayLogs = useMemo(
    () => logs.filter(l => l.startAt.slice(0, 10) === today).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [logs, today]
  );

  const todayTotal = todayLogs.reduce((s, l) => s + l.minutes, 0);
  const todayByCategory = useMemo(() => {
    const m: Record<string, number> = { 任务: 0, 生活琐事: 0, 碎片时间: 0 };
    for (const l of todayLogs) m[l.category] = (m[l.category] ?? 0) + l.minutes;
    return m;
  }, [todayLogs]);

  const weekFragmentStats = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const frags = logs.filter(
      l => l.category === '碎片时间' && new Date(l.startAt).getTime() >= since.getTime()
    );
    const m: Record<string, number> = {};
    for (const f of frags) {
      const k = f.fragmentType ?? '未分类';
      m[k] = (m[k] ?? 0) + f.minutes;
    }
    return m;
  }, [logs]);

  // ---------- 计时 ----------
  const startTimer = () => {
    if (timerRef.current) return;
    const title = runTitle.trim() || (runTaskId ? taskById.get(runTaskId)?.title ?? '' : '');
    if (!title) {
      setMessage('先选一个任务，或者填一下要做什么');
      return;
    }
    if (!runTitle.trim()) setRunTitle(title);
    setStartedAt(isoNow());
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    setMessage('开始计时，专注做一件事就好。');
  };

  const stopTimer = async (save: boolean) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!save || !startedAt) {
      setStartedAt(null);
      setElapsed(0);
      setMessage('已取消计时');
      return;
    }
    const minutes = Math.max(1, Math.round(elapsed / 60));
    const estimateMin = runTaskId ? taskById.get(runTaskId)?.estimateMin : undefined;
    const log: TimeLog = {
      id: randomId(),
      title: runTitle.trim() || '未命名任务',
      taskId: runTaskId,
      category: '任务',
      startAt: startedAt,
      endAt: isoNow(),
      minutes,
      estimateMin,
      createdAt: isoNow(),
    };
    await persist([log, ...logs]);
    setStartedAt(null);
    setElapsed(0);
    setMessage(
      estimateMin
        ? `记录完成：实际 ${minutes}min / 预估 ${estimateMin}min（速率已更新）`
        : `记录完成：${fmtDuration(minutes)}`
    );
  };

  const markTaskDone = async (taskId: string) => {
    const next = goals.map(g => ({
      ...g,
      milestones: g.milestones.map(m => ({
        ...m,
        tasks: m.tasks.map(t => (t.id === taskId ? { ...t, done: true } : t)),
      })),
    }));
    setGoals(next);
    await saveJSON(KEYS.goals, next);
  };

  // ---------- 生活琐事 ----------
  const logChore = async (title: string, minutes: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60000);
    const log: TimeLog = {
      id: randomId(),
      title,
      category: '生活琐事',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      minutes,
      createdAt: isoNow(),
    };
    await persist([log, ...logs]);
    setMessage(`已记下「${title} ${minutes}min」`);
  };

  // ---------- 碎片时间 ----------
  const logFragment = async () => {
    const minutes = Math.max(1, Number(fragMinutes) || 10);
    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60000);
    const log: TimeLog = {
      id: randomId(),
      title: `碎片时间 · ${fragType}`,
      category: '碎片时间',
      fragmentType: fragType,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      minutes,
      createdAt: isoNow(),
    };
    const next = [log, ...logs];
    await persist(next);
    await persistFragment(next);
    setMessage(`碎片时间已记录：${fragType} ${minutes}min`);
  };

  const removeLog = async (id: string) => {
    const next = logs.filter(l => l.id !== id);
    await persist(next);
    await persistFragment(next);
  };

  // ---------- 展示 ----------
  const latestEnergy = useMemo(
    () => [...energyLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [energyLogs]
  );
  const nextTaskIsHigh = pendingTasks.some(t => t.energyCost === 'high');
  const fragmentTip = suggestFragment(latestEnergy?.score ?? 6, nextTaskIsHigh);

  const elapsedText = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const timerRunning = startedAt !== null;
  const calibrateDemo = calibrateEstimate(60, factor);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>⏱ 时间记录</Text>
      <Text style={styles.lead}>
        记录实际耗时，才能校准预估。低门槛：一键计时、一键套用琐事，或只记一段碎片时间。
      </Text>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {/* 一键计时 */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>一键计时</Text>
          <Text style={[styles.clock, timerRunning && styles.clockRunning]}>{elapsedText}</Text>
        </View>

        <Text style={styles.label}>要做什么（可手填，或点下面的任务）</Text>
        <TextInput
          style={styles.input}
          value={runTitle}
          onChangeText={t => {
            setRunTitle(t);
            setRunTaskId(undefined);
          }}
          placeholder="例：写机器学习项目报告 - 数据清洗"
          placeholderTextColor="#aaa"
          editable={!timerRunning}
        />

        {pendingTasks.length > 0 ? (
          <View style={styles.chipWrap}>
            {pendingTasks.slice(0, 12).map(t => (
              <TouchableOpacity
                key={t.id}
                style={[styles.chip, runTaskId === t.id && styles.chipActive]}
                disabled={timerRunning}
                onPress={() => {
                  setRunTaskId(t.id);
                  setRunTitle(t.title);
                }}
              >
                <Text style={[styles.chipText, runTaskId === t.id && styles.chipTextActive]}>
                  {t.energyCost === 'high' ? '🔴 ' : t.energyCost === 'medium' ? '🟡 ' : '🟢 '}
                  {t.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={styles.empty}>目标库里还没有任务，可以直接手填。</Text>
        )}

        <View style={styles.rowBetween}>
          {!timerRunning ? (
            <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={startTimer}>
              <Text style={styles.primaryBtnText}>▶ 开始</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1, backgroundColor: '#2E7D32' }]} onPress={() => stopTimer(true)}>
                <Text style={styles.primaryBtnText}>■ 完成并记录</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, { flex: 1, marginTop: 16 }]} onPress={() => stopTimer(false)}>
                <Text style={styles.secondaryBtnText}>取消</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {timerRunning && runTaskId ? (
          <TouchableOpacity style={styles.linkBtn} onPress={() => markTaskDone(runTaskId)}>
            <Text style={styles.linkText}>把「{runTitle}」标记为已完成</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* 生活琐事 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>生活琐事一键记（标准时间库）</Text>
        <Text style={styles.subText}>点一下，就按标准时长记一笔账。</Text>
        <View style={styles.chipWrap}>
          {chores.map(c => (
            <TouchableOpacity key={c.title} style={styles.chip} onPress={() => logChore(c.title, c.minutes)}>
              <Text style={styles.chipText}>{c.title} {c.minutes}min</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 碎片时间 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>碎片时间日志</Text>
        <Text style={styles.tip}>💡 现在推荐：{fragmentTip}</Text>
        <Text style={styles.label}>类型</Text>
        <View style={styles.chipWrap}>
          {FRAGMENT_TYPES.map(t => (
            <TouchableOpacity key={t} style={[styles.chip, fragType === t && styles.chipActive]} onPress={() => setFragType(t)}>
              <Text style={[styles.chipText, fragType === t && styles.chipTextActive]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>分钟</Text>
            <TextInput style={styles.input} value={fragMinutes} onChangeText={setFragMinutes} keyboardType="number-pad" />
          </View>
          <TouchableOpacity style={[styles.secondaryBtn, { flex: 2, marginTop: 26 }]} onPress={logFragment}>
            <Text style={styles.secondaryBtnText}>记录这笔碎片时间</Text>
          </TouchableOpacity>
        </View>
        {Object.keys(weekFragmentStats).length > 0 ? (
          <Text style={styles.tip}>
            近 7 天碎片时间：
            {Object.entries(weekFragmentStats).map(([k, v]) => `${k} ${v}min`).join(' · ')}
          </Text>
        ) : (
          <Text style={styles.empty}>近 7 天还没有碎片时间记录。</Text>
        )}
      </View>

      {/* 速率校准 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>实际 vs 预估（速率校准）</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.bigScore}>×{factor.toFixed(2)}</Text>
          <Text style={styles.subText}>
            {factor > 1.15
              ? '你习惯性低估耗时，排程会按这个系数自动放大预估。'
              : factor < 0.85
              ? '你比预估更快，排程会更紧凑一些。'
              : '预估挺准的，继续保持。'}
          </Text>
        </View>
        <Text style={styles.tip}>例：预估 60min 的任务，按你的速率会排 {calibrateDemo}min。</Text>
        <Text style={styles.subText}>样本：{logs.filter(l => l.estimateMin).length} 条带预估的记录</Text>
      </View>

      {/* 今日统计 */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>今日统计</Text>
          <Text style={styles.percent}>{fmtDuration(todayTotal)}</Text>
        </View>
        <Text style={styles.subText}>
          任务 {fmtDuration(todayByCategory['任务'] ?? 0)} · 生活琐事 {fmtDuration(todayByCategory['生活琐事'] ?? 0)} · 碎片时间 {fmtDuration(todayByCategory['碎片时间'] ?? 0)}
        </Text>
      </View>

      {/* 记录列表 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>时间记录（{logs.length}）</Text>
        {logs.length === 0 ? (
          <Text style={styles.empty}>暂无记录</Text>
        ) : (
          [...logs]
            .sort((a, b) => b.startAt.localeCompare(a.startAt))
            .slice(0, 40)
            .map(l => (
              <View key={l.id} style={styles.logRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.logTitle, { color: CATEGORY_COLOR[l.category] }]}>
                    {fmtClock(l.startAt)}-{fmtClock(l.endAt)} · {l.category} · {fmtDuration(l.minutes)}
                  </Text>
                  <Text style={styles.logDetail}>
                    {l.title}
                    {l.estimateMin ? `　预估 ${l.estimateMin}min → 实际 ${l.minutes}min` : ''}
                    {l.note ? ` · ${l.note}` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => removeLog(l.id)}>
                  <Text style={styles.deleteText}>✕</Text>
                </TouchableOpacity>
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
  header: { fontSize: 22, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  lead: { fontSize: 13, color: '#5f6b7a', lineHeight: 20, marginBottom: 10 },
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
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  message: { fontSize: 13, color: '#2E7D32', marginBottom: 8, fontWeight: '600' },
  subText: { fontSize: 13, color: '#5f6b7a', lineHeight: 19, marginBottom: 4, flexShrink: 1 },
  tip: { fontSize: 13, color: '#1976D2', marginTop: 6, lineHeight: 19 },
  empty: { color: '#9aa7b8', fontSize: 14, marginTop: 4 },
  label: { fontSize: 13, color: '#283147', fontWeight: '600', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e5ed',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    backgroundColor: '#f8fafc',
    color: '#222',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#EDF3FD' },
  chipActive: { backgroundColor: '#1976D2' },
  chipText: { fontSize: 12, color: '#1976D2' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  clock: { fontSize: 26, fontWeight: '800', color: '#9aa7b8', fontVariant: ['tabular-nums'] },
  clockRunning: { color: '#2E7D32' },
  primaryBtn: { backgroundColor: '#1976D2', borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { backgroundColor: '#EDF3FD', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  secondaryBtnText: { color: '#1976D2', fontWeight: '700', fontSize: 14 },
  linkBtn: { marginTop: 10 },
  linkText: { color: '#2E7D32', fontSize: 13, fontWeight: '600' },
  percent: { fontSize: 18, fontWeight: '800', color: '#1976D2' },
  bigScore: { fontSize: 26, fontWeight: '800', color: '#1976D2' },
  deleteText: { color: '#E53935', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 6 },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.6, borderColor: '#e6e6ed' },
  logTitle: { fontSize: 13, fontWeight: '700' },
  logDetail: { fontSize: 12, color: '#7b8ba2', marginTop: 2 },
});
