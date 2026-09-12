/**
 * 板块四：精力建模与评估（四层金字塔 + 5 维度加权）
 * 板块九：碎片时间管理（微休息提醒）
 *
 * 功能：手动精力打卡（睡眠/生理/情绪/认知/意义）、精力曲线预测、
 *       黄金时段与低谷时段识别、历史日志、微休息提醒。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  ENERGY_SLOTS,
  ENERGY_WEIGHTS,
  EnergyLog,
  EnergySlotKey,
  KEYS,
  computeEnergyScore,
  goldenSlots,
  loadJSON,
  lowSlots,
  predictCurve,
  randomId,
  saveJSON,
  slotLabel,
  suggestFragment,
  todayStr,
} from '@/app/utils/planning';

function ScorePicker({
  value,
  onChange,
  low,
  high,
}: {
  value: number;
  onChange: (v: number) => void;
  low: string;
  high: string;
}) {
  return (
    <View style={styles.pickerWrap}>
      <View style={styles.scaleRow}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
          <TouchableOpacity
            key={n}
            style={[styles.scaleBtn, value === n && styles.scaleBtnActive]}
            onPress={() => onChange(n)}
          >
            <Text style={[styles.scaleText, value === n && styles.scaleTextActive]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.scaleLegend}>
        <Text style={styles.scaleHint}>{low}</Text>
        <Text style={styles.scaleHint}>{high}</Text>
      </View>
    </View>
  );
}

export default function EnergyPanel() {
  const [logs, setLogs] = useState<EnergyLog[]>([]);
  const [date, setDate] = useState(todayStr());
  const [slot, setSlot] = useState<EnergySlotKey>('morning');
  const [sleepHours, setSleepHours] = useState('');
  const [sleepQuality, setSleepQuality] = useState(6);
  const [physical, setPhysical] = useState(6);
  const [emotional, setEmotional] = useState(6);
  const [cognitive, setCognitive] = useState(6);
  const [meaning, setMeaning] = useState(6);
  const [note, setNote] = useState('');
  const [restTimer, setRestTimer] = useState(0); // 秒
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => setLogs(await loadJSON<EnergyLog[]>(KEYS.energyLogs, [])))();
  }, []);

  useEffect(() => {
    if (restTimer <= 0 && restRef.current) {
      clearInterval(restRef.current);
      restRef.current = null;
    }
  }, [restTimer]);

  const curve = useMemo(() => predictCurve(logs, date), [logs, date]);
  const todayLogs = useMemo(
    () => logs.filter(l => l.date === todayStr()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [logs]
  );
  const latest = todayLogs[0];
  const golden = goldenSlots(curve);
  const lows = lowSlots(curve);
  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date))),
    [logs]
  );

  const persist = async (next: EnergyLog[]) => {
    setLogs(next);
    await saveJSON(KEYS.energyLogs, next);
  };

  const handleSave = async () => {
    const score = computeEnergyScore({ sleepHours: Number(sleepHours) || undefined, sleepQuality, physical, emotional, cognitive, meaning });
    const log: EnergyLog = {
      id: randomId(),
      date,
      slot,
      sleepHours: Number(sleepHours) || undefined,
      sleepQuality,
      physical,
      emotional,
      cognitive,
      meaning,
      score,
      note: note.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    // 同一天同时段覆盖，避免重复堆积
    const next = [...logs.filter(l => !(l.date === date && l.slot === slot)), log];
    await persist(next);
    setNote('');
  };

  const handleDelete = async (id: string) => {
    await persist(logs.filter(l => l.id !== id));
  };

  const toggleRestTimer = () => {
    if (restRef.current) {
      clearInterval(restRef.current);
      restRef.current = null;
      setRestTimer(0);
      return;
    }
    setRestTimer(5 * 60);
    restRef.current = setInterval(() => setRestTimer(t => (t <= 1 ? 0 : t - 1)), 1000);
  };

  const restText = `${String(Math.floor(restTimer / 60)).padStart(2, '0')}:${String(restTimer % 60).padStart(2, '0')}`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>⚡ 精力仪表盘</Text>

      {/* 当前精力 */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>今日精力</Text>
          <Text style={styles.bigScore}>{latest ? latest.score.toFixed(1) : '--'}<Text style={styles.scoreUnit}> /10</Text></Text>
        </View>
        {latest ? (
          <Text style={styles.subText}>
            最近打卡：{slotLabel(latest.slot)} · 睡眠 {latest.sleepHours ? `${latest.sleepHours}h` : '—'} · 意义 {latest.meaning} / 生理 {latest.physical} / 情绪 {latest.emotional} / 认知 {latest.cognitive}
          </Text>
        ) : (
          <Text style={styles.subText}>今天还没有打卡，先记录一次，AI 才能排得更准。</Text>
        )}

        {/* 精力曲线 */}
        <View style={styles.curve}>
          {ENERGY_SLOTS.map(s => {
            const v = curve[s.key];
            return (
              <View key={s.key} style={styles.curveCol}>
                <Text style={styles.curveVal}>{v.toFixed(1)}</Text>
                <View style={styles.curveBarBg}>
                  <View
                    style={[
                      styles.curveBar,
                      { height: `${Math.max(4, (v / 10) * 100)}%` },
                      golden.includes(s.key) && styles.curveBarGolden,
                      lows.includes(s.key) && styles.curveBarLow,
                    ]}
                  />
                </View>
                <Text style={styles.curveLabel}>{s.label.split(' ')[0]}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.tip}>
          🌞 黄金时段：{golden.map(slotLabel).join('、')}　🌙 低谷：{lows.map(slotLabel).join('、')}
        </Text>
      </View>

      {/* 打卡表单 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>精力打卡</Text>
        <Text style={styles.label}>日期（YYYY-MM-DD）</Text>
        <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="2026-01-01" placeholderTextColor="#aaa" />

        <Text style={styles.label}>所处时段</Text>
        <View style={styles.chipWrap}>
          {ENERGY_SLOTS.map(s => (
            <TouchableOpacity
              key={s.key}
              style={[styles.chip, slot === s.key && styles.chipActive]}
              onPress={() => setSlot(s.key)}
            >
              <Text style={[styles.chipText, slot === s.key && styles.chipTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>睡眠时长（小时，可空）</Text>
        <TextInput
          style={styles.input}
          value={sleepHours}
          onChangeText={setSleepHours}
          placeholder="例：7.5"
          placeholderTextColor="#aaa"
          keyboardType="numbers-and-punctuation"
        />

        <Text style={styles.label}>睡眠质量（权重 {(ENERGY_WEIGHTS.sleep * 100).toFixed(0)}%）</Text>
        <ScorePicker value={sleepQuality} onChange={setSleepQuality} low="很差" high="极好" />

        <Text style={styles.label}>生理精力（权重 {(ENERGY_WEIGHTS.physical * 100).toFixed(0)}%）</Text>
        <ScorePicker value={physical} onChange={setPhysical} low="疲惫" high="充沛" />

        <Text style={styles.label}>情绪精力（权重 {(ENERGY_WEIGHTS.emotional * 100).toFixed(0)}%）</Text>
        <ScorePicker value={emotional} onChange={setEmotional} low="低落" high="愉悦" />

        <Text style={styles.label}>认知精力（权重 {(ENERGY_WEIGHTS.cognitive * 100).toFixed(0)}%）</Text>
        <ScorePicker value={cognitive} onChange={setCognitive} low="迟钝" high="专注" />

        <Text style={styles.label}>意义精力（权重 {(ENERGY_WEIGHTS.meaning * 100).toFixed(0)}%）</Text>
        <ScorePicker value={meaning} onChange={setMeaning} low="迷茫" high="笃定" />

        <Text style={styles.label}>备注</Text>
        <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="今天状态如何？" placeholderTextColor="#aaa" />

        <TouchableOpacity style={styles.primaryBtn} onPress={handleSave}>
          <Text style={styles.primaryBtnText}>保存打卡</Text>
        </TouchableOpacity>
      </View>

      {/* 碎片时间 / 微休息 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>碎片时间与微休息</Text>
        <Text style={styles.subText}>
          基于 45-90 分钟超日节律，每完成一个时间盒就站起来、看窗外、深呼吸。
        </Text>
        <Text style={styles.tip}>💡 现在推荐：{suggestFragment(latest?.score ?? 6, true)}</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={toggleRestTimer}>
          <Text style={styles.secondaryBtnText}>{restRef.current ? `休息中 ${restText}（点此停止）` : '开始 5 分钟微休息'}</Text>
        </TouchableOpacity>
      </View>

      {/* 历史日志 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>精力日志（{logs.length}）</Text>
        {sortedLogs.length === 0 ? (
          <Text style={styles.empty}>暂无记录</Text>
        ) : (
          sortedLogs.slice(0, 30).map(l => (
            <View key={l.id} style={styles.logRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.logTitle}>{l.date} · {slotLabel(l.slot)} · {l.score.toFixed(1)}/10</Text>
                <Text style={styles.logDetail}>
                  意义{l.meaning} 生理{l.physical} 情绪{l.emotional} 认知{l.cognitive} 睡眠{l.sleepQuality}
                  {l.note ? ` · ${l.note}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => handleDelete(l.id)}>
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
  header: { fontSize: 22, fontWeight: '700', color: '#1a1a2e', marginBottom: 12 },
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
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  bigScore: { fontSize: 26, fontWeight: '800', color: '#1976D2' },
  scoreUnit: { fontSize: 13, color: '#8aa0c0', fontWeight: '500' },
  subText: { fontSize: 13, color: '#5f6b7a', lineHeight: 19, marginBottom: 6 },
  tip: { fontSize: 13, color: '#1976D2', marginTop: 8, lineHeight: 19 },
  curve: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 120, marginTop: 10 },
  curveCol: { flex: 1, alignItems: 'center' },
  curveVal: { fontSize: 10, color: '#7b8ba2', marginBottom: 2 },
  curveBarBg: { width: 16, height: 70, backgroundColor: '#eef2f7', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  curveBar: { width: '100%', backgroundColor: '#9ec2ea', borderRadius: 6 },
  curveBarGolden: { backgroundColor: '#f2b705' },
  curveBarLow: { backgroundColor: '#b0bec5' },
  curveLabel: { fontSize: 10, color: '#7b8ba2', marginTop: 4 },
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
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#EDF3FD' },
  chipActive: { backgroundColor: '#1976D2' },
  chipText: { fontSize: 12, color: '#1976D2' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  pickerWrap: { marginTop: 2 },
  scaleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  scaleBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EDF3FD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scaleBtnActive: { backgroundColor: '#1976D2' },
  scaleText: { fontSize: 13, color: '#1976D2', fontWeight: '600' },
  scaleTextActive: { color: '#fff' },
  scaleLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  scaleHint: { fontSize: 11, color: '#9aa7b8' },
  primaryBtn: { backgroundColor: '#1976D2', borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { backgroundColor: '#EDF3FD', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  secondaryBtnText: { color: '#1976D2', fontWeight: '700', fontSize: 14 },
  empty: { color: '#9aa7b8', fontSize: 14 },
  logRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 0.6, borderColor: '#e6e6ed' },
  logTitle: { fontSize: 14, color: '#222', fontWeight: '600' },
  logDetail: { fontSize: 12, color: '#7b8ba2', marginTop: 2 },
  deleteText: { color: '#E53935', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 6 },
});
