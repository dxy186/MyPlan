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
  speedSamples,
  suggestFragment,
  todayStr,
} from '@/app/utils/planning';
import { commitState, loadPlanState } from '@/components/assistant/plan-store';
import { loadScheduleSettings, saveScheduleSettings } from '@/components/data/settings';

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
  // 手动速率系数：undefined = 自动
  const [override, setOverride] = useState<number | undefined>(undefined);
  const [overrideText, setOverrideText] = useState('');
  const [speedMsg, setSpeedMsg] = useState('');

  // 碎片时间
  const [fragType, setFragType] = useState<(typeof FRAGMENT_TYPES)[number]>('微恢复');
  const [fragMinutes, setFragMinutes] = useState('10');

  useEffect(() => {
    (async () => {
      setLogs(await loadJSON<TimeLog[]>(KEYS.timeLogs, []));
      setGoals((await loadPlanState()).goals);
      setEnergyLogs(await loadJSON<EnergyLog[]>(KEYS.energyLogs, []));
      const savedChores = await loadJSON<{ title: string; minutes: number }[]>(KEYS.choreTemplates, []);
      setChores(savedChores.length > 0 ? savedChores : DEFAULT_CHORES);
      const ss = await loadScheduleSettings();
      setOverride(ss.speedOverride);
      if (ss.speedOverride) setOverrideText(String(ss.speedOverride));
    })();
  }, []);


  const pendingTasks = useMemo(() => {
    const out: PlanTask[] = [];
    for (const g of goals) for (const m of g.milestones) for (const t of m.tasks) if (!t.done) out.push(t);
    return out;
  }, [goals]);


  const persist = async (next: TimeLog[]) => {
    setLogs(next);
    await saveJSON(KEYS.timeLogs, next);
  };

  const persistFragment = async (next: TimeLog[]) => {
    await saveJSON(KEYS.fragmentLogs, next.filter(l => l.category === '碎片时间'));
  };

  const allPlanTasks = useMemo(() => goals.flatMap(g => g.milestones.flatMap(m => m.tasks)), [goals]);
  const autoFactor = useMemo(() => speedFactor(logs, allPlanTasks), [logs, allPlanTasks]);
  const factor = override ?? autoFactor;

  const applySpeed = async (v: number | undefined) => {
    if (v !== undefined && !(v >= 0.2 && v <= 5)) {
      setSpeedMsg('系数要在 0.2 到 5 之间');
      return;
    }
    const val = v === undefined ? undefined : Math.round(v * 100) / 100;
    const ss = await loadScheduleSettings();
    const next = { ...ss };
    if (val === undefined) delete next.speedOverride;
    else next.speedOverride = val;
    await saveScheduleSettings(next);
    setOverride(val);
    setOverrideText(val === undefined ? '' : String(val));
    await commitState(await loadPlanState());
    setSpeedMsg(val === undefined ? `✅ 改回自动（×${autoFactor.toFixed(2)}），已重新排程` : `✅ 已改成 ×${val.toFixed(2)}，已重新排程`);
  };
  const sampleCount = useMemo(() => speedSamples(logs, allPlanTasks).length, [logs, allPlanTasks]);

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

  const calibrateDemo = calibrateEstimate(60, factor);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>⏱ 时间记录</Text>
      <Text style={styles.lead}>
        记录实际耗时，才能校准预估。低门槛：一键计时、一键套用琐事，或只记一段碎片时间。
      </Text>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>⏱ 给任务计时</Text>
        <Text style={styles.subText}>
          计时器统一放在「🏠 今天」：点时间轴上的任务块「▶ 开始计时」、用「⚡ 我现在有空」，或在「📋 任务」里点任务旁的 ▶。做完的计时会自动出现在下面的记录里。
        </Text>
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
        <Text style={styles.cardTitle}>实际 vs 预估（速率校准）{override !== undefined ? '　· 手动' : '　· 自动'}</Text>
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
        <Text style={styles.subText}>
          样本：{sampleCount} 个（同一任务的多次计时合并计算，任务完成后才计入）
          {override !== undefined ? `；按记录自动算是 ×${autoFactor.toFixed(2)}` : ''}
        </Text>
        <View style={styles.speedRow}>
          <Text style={styles.subText}>手动调整：</Text>
          {[0.8, 1, 1.2, 1.5].map(v => (
            <TouchableOpacity key={v} style={[styles.speedChip, override === v && styles.speedChipOn]} onPress={() => applySpeed(v)}>
              <Text style={[styles.speedChipText, override === v && styles.speedChipTextOn]}>×{v}</Text>
            </TouchableOpacity>
          ))}
          <TextInput
            style={styles.speedInput}
            value={overrideText}
            onChangeText={t => setOverrideText(t.replace(/[^0-9.]/g, ''))}
            onSubmitEditing={() => applySpeed(Number(overrideText))}
            placeholder="自定义，如 1.3"
            placeholderTextColor="#9AA4B2"
            keyboardType="decimal-pad"
          />
          <TouchableOpacity style={styles.speedChip} onPress={() => applySpeed(Number(overrideText))}>
            <Text style={styles.speedChipText}>设定</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.speedChip, override === undefined && styles.speedChipOn]} onPress={() => applySpeed(undefined)}>
            <Text style={[styles.speedChipText, override === undefined && styles.speedChipTextOn]}>自动</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.subText}>大于 1 = 给每个任务多留时间，小于 1 = 排得更紧。手动设了以后排程、拆分、AI 都按这个数来，点「自动」改回按记录计算。</Text>
        {!!speedMsg && <Text style={styles.tip}>{speedMsg}</Text>}
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
  speedRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 8, gap: 6 },
  speedChip: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#fff' },
  speedChipOn: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  speedChipText: { fontSize: 13, color: '#455A64' },
  speedChipTextOn: { color: '#fff', fontWeight: '600' },
  speedInput: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8, fontSize: 13, width: 110, backgroundColor: '#fff' },
  bigScore: { fontSize: 26, fontWeight: '800', color: '#1976D2' },
  deleteText: { color: '#E53935', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 6 },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.6, borderColor: '#e6e6ed' },
  logTitle: { fontSize: 13, fontWeight: '700' },
  logDetail: { fontSize: 12, color: '#7b8ba2', marginTop: 2 },
  overBox: { backgroundColor: '#FFF6F2', borderRadius: 10, borderWidth: 1, borderColor: '#F5C6B5', padding: 12, marginTop: 12 },
  overTitle: { fontSize: 14, fontWeight: '600', color: '#BF360C', marginBottom: 8 },
  overBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#F0B29A', borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10, marginRight: 8, marginBottom: 6 },
  overBtnText: { fontSize: 13, color: '#BF360C' },
});
