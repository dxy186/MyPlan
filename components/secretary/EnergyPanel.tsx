/**
 * 板块四：精力建模与评估（四层金字塔 + 5 维度加权）
 * 板块九：碎片时间管理（微休息提醒）
 *
 * 「精力仪表盘」升级为「今日记录」：
 *   1) 今日精力：打卡 + 曲线预测 + 黄金/低谷时段
 *   2) 今日日记：心情 / 天气 / 正文
 *   3) 日记簿：按天翻看历史日记与当天精力值
 *   4) 碎片时间微休息
 *
 * 精力写入 @myplan_energy_logs，日记写入 @myplan_diary，一并供 AI 读取分析。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  DiaryEntry,
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
} from '@/app/utils/planning';
import { useCurrentSlot, useTodayStr } from '@/hooks/use-today';

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 2026-10-06 -> 10月6日 周二 */
function fmtCN(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_CN[d.getDay()]}`;
}

/** 10/06 */
function fmtShort(date: string): { md: string; wd: string } {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { md: date, wd: '' };
  return {
    md: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`,
    wd: `周${WEEK_CN[d.getDay()]}`,
  };
}

function dayEnergyAvg(list: EnergyLog[]): number | null {
  if (list.length === 0) return null;
  return Math.round((list.reduce((s, l) => s + l.score, 0) / list.length) * 10) / 10;
}

const MOODS = ['😄 开心', '🙂 平静', '😌 放松', '😐 一般', '😔 低落', '😤 烦躁', '😴 疲惫'];
const WEATHERS = ['☀️ 晴', '⛅ 多云', '🌧️ 雨', '❄️ 雪', '🌫️ 雾', '🌬️ 风'];

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
  // —— 精力打卡 ——
  const [logs, setLogs] = useState<EnergyLog[]>([]);
  // 日期/时段默认跟随当前时间；用户手动调整后固定为手动值
  const [manualDate, setManualDate] = useState<string | null>(null);
  const [manualSlot, setManualSlot] = useState<EnergySlotKey | null>(null);
  const [sleepHours, setSleepHours] = useState('');
  const [sleepQuality, setSleepQuality] = useState(6);
  const [physical, setPhysical] = useState(6);
  const [emotional, setEmotional] = useState(6);
  const [cognitive, setCognitive] = useState(6);
  const [meaning, setMeaning] = useState(6);
  const [note, setNote] = useState('');
  const [restTimer, setRestTimer] = useState(0); // 秒
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // —— 日记 ——
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [diaryText, setDiaryText] = useState('');
  const [mood, setMood] = useState('');
  const [weather, setWeather] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLogs(await loadJSON<EnergyLog[]>(KEYS.energyLogs, []));
      setDiary(await loadJSON<DiaryEntry[]>(KEYS.diary, []));
    })();
  }, []);

  useEffect(() => {
    if (restTimer <= 0 && restRef.current) {
      clearInterval(restRef.current);
      restRef.current = null;
    }
  }, [restTimer]);

  const today = useTodayStr();
  const autoSlot = useCurrentSlot();
  const date = manualDate ?? today;
  const slot = manualSlot ?? autoSlot;
  const curve = useMemo(() => predictCurve(logs, date), [logs, date]);
  const todayLogs = useMemo(
    () => logs.filter(l => l.date === today).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [logs, today]
  );
  const latest = todayLogs[0];
  const golden = goldenSlots(curve);
  const lows = lowSlots(curve);

  // 今日日记：随 today / 已保存内容同步到编辑区
  useEffect(() => {
    const e = diary.find(d => d.date === today);
    setDiaryText(e?.content ?? '');
    setMood(e?.mood ?? '');
    setWeather(e?.weather ?? '');
  }, [today, diary]);

  // 日记簿：有日记或有精力记录的日期（新→旧）
  const dayKeys = useMemo(() => {
    const set = new Set<string>();
    diary.forEach(d => set.add(d.date));
    logs.forEach(l => set.add(l.date));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [diary, logs]);

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

  const persistDiary = async (next: DiaryEntry[]) => {
    setDiary(next);
    await saveJSON(KEYS.diary, next);
  };

  const handleSaveDiary = async () => {
    const content = diaryText.trim();
    if (!content && !mood && !weather) return;
    const now = new Date().toISOString();
    const existing = diary.find(d => d.date === today);
    const entry: DiaryEntry = existing
      ? { ...existing, content, mood: mood || undefined, weather: weather || undefined, updatedAt: now }
      : { id: randomId(), date: today, content, mood: mood || undefined, weather: weather || undefined, createdAt: now, updatedAt: now };
    const next = [...diary.filter(d => d.date !== today), entry];
    await persistDiary(next);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const handleDeleteDiary = async (id: string) => {
    await persistDiary(diary.filter(d => d.id !== id));
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
  const todayEntry = diary.find(d => d.date === today);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>📖 今日记录</Text>
      <Text style={styles.headerSub}>{fmtCN(today)} · 记录精力，也记下这一天</Text>

      {/* 今日精力 */}
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
        <View style={styles.labelRow}>
          <Text style={styles.label}>日期（YYYY-MM-DD）</Text>
          <TouchableOpacity onPress={() => setManualDate(null)} disabled={manualDate === null}>
            <Text style={styles.autoTag}>{manualDate === null ? '⏱ 跟随今天' : '↺ 回到今天'}</Text>
          </TouchableOpacity>
        </View>
        <TextInput style={styles.input} value={date} onChangeText={setManualDate} placeholder="2026-01-01" placeholderTextColor="#aaa" />

        <View style={styles.labelRow}>
          <Text style={styles.label}>所处时段</Text>
          <TouchableOpacity onPress={() => setManualSlot(null)} disabled={manualSlot === null}>
            <Text style={styles.autoTag}>{manualSlot === null ? '⏱ 自动跟随当前时间' : '↺ 恢复跟随时间'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chipWrap}>
          {ENERGY_SLOTS.map(s => (
            <TouchableOpacity
              key={s.key}
              style={[styles.chip, slot === s.key && styles.chipActive]}
              onPress={() => setManualSlot(s.key)}
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

      {/* 今日日记 */}
      <View style={[styles.card, styles.diaryCard]}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>✍️ 今日日记</Text>
          <Text style={styles.diaryDate}>{fmtCN(today)}</Text>
        </View>

        <Text style={styles.diaryFieldLabel}>今天的心情</Text>
        <View style={styles.chipWrap}>
          {MOODS.map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.diaryChip, mood === m && styles.diaryChipActive]}
              onPress={() => setMood(prev => (prev === m ? '' : m))}
            >
              <Text style={[styles.diaryChipText, mood === m && styles.diaryChipTextActive]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.diaryFieldLabel}>天气</Text>
        <View style={styles.chipWrap}>
          {WEATHERS.map(w => (
            <TouchableOpacity
              key={w}
              style={[styles.diaryChip, weather === w && styles.diaryChipActive]}
              onPress={() => setWeather(prev => (prev === w ? '' : w))}
            >
              <Text style={[styles.diaryChipText, weather === w && styles.diaryChipTextActive]}>{w}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.diaryFieldLabel}>想写点什么</Text>
        <TextInput
          style={styles.diaryInput}
          value={diaryText}
          onChangeText={setDiaryText}
          placeholder="今天发生了什么？有什么感受或收获…"
          placeholderTextColor="#b9ac9a"
          multiline
          textAlignVertical="top"
        />

        <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveDiary}>
          <Text style={styles.primaryBtnText}>{todayEntry ? '更新今天的日记' : '保存今天的日记'}</Text>
        </TouchableOpacity>
        {savedFlash ? <Text style={styles.savedFlash}>已保存 ✓</Text> : null}
      </View>

      {/* 日记簿：按天翻看 */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>📔 日记簿</Text>
          <Text style={styles.diaryCount}>{dayKeys.length} 天</Text>
        </View>
        <Text style={styles.subText}>点开任意一天，翻看当天的日记与精力值。</Text>

        {dayKeys.length === 0 ? (
          <Text style={styles.empty}>还没有记录，从今天开始吧。</Text>
        ) : (
          dayKeys.map(dk => {
            const entry = diary.find(d => d.date === dk);
            const dayLogs = logs.filter(l => l.date === dk).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            const avg = dayEnergyAvg(dayLogs);
            const short = fmtShort(dk);
            const open = openDay === dk;
            const idx = dayKeys.indexOf(dk);
            const prevDay = idx < dayKeys.length - 1 ? dayKeys[idx + 1] : null;
            const nextDay = idx > 0 ? dayKeys[idx - 1] : null;
            return (
              <View key={dk} style={styles.dayCard}>
                <TouchableOpacity style={styles.dayHead} onPress={() => setOpenDay(open ? null : dk)}>
                  <View style={styles.dayDateBox}>
                    <Text style={styles.dayDateMd}>{short.md}</Text>
                    <Text style={styles.dayDateWd}>{short.wd}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dayTitle} numberOfLines={1}>
                      {entry?.mood ? `${entry.mood}  ` : ''}{entry?.weather ? `${entry.weather}  ` : ''}
                      {entry?.content ? entry.content.replace(/\s+/g, ' ') : (entry ? '（无正文）' : '这天没有写日记')}
                    </Text>
                    <Text style={styles.dayMeta}>
                      {dk === today ? '今天 · ' : ''}精力 {avg != null ? `${avg.toFixed(1)}/10` : '—'} · {dayLogs.length} 次打卡
                    </Text>
                  </View>
                  <Text style={styles.dayChevron}>{open ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {open ? (
                  <View style={styles.dayBody}>
                    {/* 当天精力值 */}
                    <Text style={styles.daySectionTitle}>当天精力</Text>
                    {dayLogs.length === 0 ? (
                      <Text style={styles.dayEmpty}>这天没有精力打卡。</Text>
                    ) : (
                      dayLogs.map(l => (
                        <View key={l.id} style={styles.logRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.logTitle}>{slotLabel(l.slot)} · {l.score.toFixed(1)}/10</Text>
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

                    {/* 当天日记 */}
                    <Text style={styles.daySectionTitle}>当天日记</Text>
                    {entry ? (
                      <>
                        {entry.mood || entry.weather ? (
                          <Text style={styles.diaryTags}>{[entry.mood, entry.weather].filter(Boolean).join('  ')}</Text>
                        ) : null}
                        <Text style={styles.diaryBody}>{entry.content || '（只记了心情/天气）'}</Text>
                        <TouchableOpacity onPress={() => handleDeleteDiary(entry.id)}>
                          <Text style={styles.diaryDelete}>删除这篇日记</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <Text style={styles.dayEmpty}>这天没有日记。</Text>
                    )}

                    {/* 逐日翻看 */}
                    <View style={styles.dayNav}>
                      <TouchableOpacity
                        style={[styles.dayNavBtn, !prevDay && styles.dayNavBtnDisabled]}
                        disabled={!prevDay}
                        onPress={() => setOpenDay(prevDay)}
                      >
                        <Text style={styles.dayNavText}>◀ 前一天</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.dayNavBtn, !nextDay && styles.dayNavBtnDisabled]}
                        disabled={!nextDay}
                        onPress={() => setOpenDay(nextDay)}
                      >
                        <Text style={styles.dayNavText}>后一天 ▶</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
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

      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const serifFont = Platform.OS === 'web' ? 'Georgia, "Times New Roman", "Songti SC", serif' : undefined;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 16 },
  header: { fontSize: 22, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  headerSub: { fontSize: 13, color: '#8a94a6', marginBottom: 12 },
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
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  autoTag: { fontSize: 12, color: '#1976D2', fontWeight: '600', marginBottom: 6 },
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

  // —— 日记（暖色纸张风）——
  diaryCard: { backgroundColor: '#FFFDF8', borderWidth: 1, borderColor: '#F0E7D8' },
  diaryDate: { fontSize: 12, color: '#B08A5A', fontWeight: '600' },
  diaryFieldLabel: { fontSize: 13, color: '#8A7358', fontWeight: '600', marginTop: 12, marginBottom: 6 },
  diaryChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F4EDE1' },
  diaryChipActive: { backgroundColor: '#C99A5B' },
  diaryChipText: { fontSize: 12.5, color: '#8A7358' },
  diaryChipTextActive: { color: '#fff', fontWeight: '600' },
  diaryInput: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: '#EDE2D2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 24,
    backgroundColor: '#fff',
    color: '#3A3226',
  },
  savedFlash: { color: '#3BA55D', fontSize: 13, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  diaryCount: { fontSize: 12, color: '#B08A5A', fontWeight: '600' },
  dayCard: { borderWidth: 1, borderColor: '#EFE7DB', borderRadius: 10, marginTop: 10, overflow: 'hidden' },
  dayHead: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#FFFDF8' },
  dayDateBox: { width: 46, alignItems: 'center', marginRight: 8 },
  dayDateMd: { fontSize: 16, fontWeight: '800', color: '#B08A5A' },
  dayDateWd: { fontSize: 11, color: '#A99A85', marginTop: 1 },
  dayTitle: { fontSize: 14, color: '#3A3226', fontWeight: '600' },
  dayMeta: { fontSize: 11.5, color: '#9C8E7A', marginTop: 3 },
  dayChevron: { fontSize: 11, color: '#B9AC9A', paddingHorizontal: 4 },
  dayBody: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4, backgroundColor: '#fff' },
  daySectionTitle: { fontSize: 13, fontWeight: '700', color: '#8A7358', marginTop: 10, marginBottom: 2 },
  dayEmpty: { fontSize: 13, color: '#A99A85', marginTop: 2 },
  diaryTags: { fontSize: 14, color: '#C99A5B', marginTop: 4 },
  diaryBody: { fontSize: 15, lineHeight: 26, color: '#3A3226', marginTop: 6, fontFamily: serifFont },
  diaryDelete: { fontSize: 12, color: '#C0574E', marginTop: 10 },
  dayNav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  dayNavBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F4EDE1', alignItems: 'center', marginHorizontal: 3 },
  dayNavBtnDisabled: { opacity: 0.4 },
  dayNavText: { fontSize: 12.5, color: '#8A7358', fontWeight: '600' },
});
