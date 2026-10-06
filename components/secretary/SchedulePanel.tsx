/**
 * 板块五：进度-精力双轨排程引擎（核心）
 * 板块七：动态重规划与风险预警
 * 板块八：动力与反馈（每日复盘 / 进度可视化）
 *
 * 功能：
 *  - 硬约束录入（课程 / 会议 / 已购票活动，可每周重复或指定日期）
 *  - 生活琐事标准时间库（时间块法，可一键变成当天固定占用）
 *  - 双轨排程：DDL 倒推 + 依赖拓扑 + 关键链 + 精力匹配 + 时间盒 + 强制玩的时间
 *  - 风险报告：完成概率、缓冲占用、容量 vs 需求
 *  - 质量弹性：黄金 / 白银 / 青铜 建议
 *  - 一键重排（重新规划今天 / 本周）
 *
 * 任务来源：『目标拆解』页保存到目标库（Goal → Milestone → PlanTask）的未完成任务。
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
  FixedEvent,
  Goal,
  KEYS,
  PlanTask,
  diffDays,
  hmToMinutes,
  loadJSON,
  minutesToHM,
  randomId,
  saveJSON,
  slotLabel,
  todayStr,
  weekdayOf,
} from '@/app/utils/planning';
import {
  DEFAULT_SCHEDULE_OPTIONS,
  ScheduleItem,
  ScheduleResult,
  fmtRange,
  generateSchedule,
  qualityTierFor,
} from '@/app/utils/scheduler';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const KIND_LABEL: Record<FixedEvent['kind'], string> = {
  course: '📚 课程',
  meeting: '👥 会议',
  ticket: '🎫 已购票活动',
  other: '📌 其他',
};

const TYPE_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  task: { color: '#1976D2', bg: '#E8F1FC', label: '任务' },
  fixed: { color: '#5f6b7a', bg: '#EEF0F4', label: '硬约束' },
  play: { color: '#2E7D32', bg: '#E7F6E9', label: '玩' },
  rest: { color: '#8e5bd0', bg: '#F2EBFB', label: '缓冲日' },
  buffer: { color: '#B07800', bg: '#FDF3DC', label: '缓冲' },
  chore: { color: '#0a7ea4', bg: '#E3F2F8', label: '琐事' },
};

const COST_LABEL: Record<string, string> = { high: '高耗能', medium: '中耗能', low: '低耗能' };

type Props = {
  /** 嵌入到别的滚动容器里时置 true（外层已有 ScrollView，避免嵌套滚动） */
  embedded?: boolean;
};

export default function SchedulePanel({ embedded = false }: Props = {}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [logs, setLogs] = useState<EnergyLog[]>([]);
  const [fixed, setFixed] = useState<FixedEvent[]>([]);
  const [chores, setChores] = useState<{ title: string; minutes: number }[]>(DEFAULT_CHORES);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [message, setMessage] = useState('');

  // 排程参数
  const [days, setDays] = useState(String(DEFAULT_SCHEDULE_OPTIONS.days));
  const [dayStart, setDayStart] = useState('08:00');
  const [dayEnd, setDayEnd] = useState('23:00');
  const [playMin, setPlayMin] = useState(String(DEFAULT_SCHEDULE_OPTIONS.playMinPerDay));
  const [bufferRatio, setBufferRatio] = useState(DEFAULT_SCHEDULE_OPTIONS.bufferRatio);
  const [useRestDay, setUseRestDay] = useState(true);
  const [restWeekday, setRestWeekday] = useState(0);

  // 硬约束表单
  const [evTitle, setEvTitle] = useState('');
  const [evKind, setEvKind] = useState<FixedEvent['kind']>('course');
  const [evRepeat, setEvRepeat] = useState<'weekly' | 'date'>('weekly');
  const [evWeekday, setEvWeekday] = useState(1);
  const [evDate, setEvDate] = useState(todayStr());
  const [evStart, setEvStart] = useState('09:00');
  const [evEnd, setEvEnd] = useState('11:00');

  useEffect(() => {
    (async () => {
      setGoals(await loadJSON<Goal[]>(KEYS.goals, []));
      setLogs(await loadJSON<EnergyLog[]>(KEYS.energyLogs, []));
      setFixed(await loadJSON<FixedEvent[]>(KEYS.fixedEvents, []));
      const savedChores = await loadJSON<{ title: string; minutes: number }[]>(KEYS.choreTemplates, []);
      setChores(savedChores.length > 0 ? savedChores : DEFAULT_CHORES);
      setResult(await loadJSON<ScheduleResult | null>(KEYS.schedule, null));
    })();
  }, []);

  // 全部未完成任务
  const pendingTasks = useMemo(() => {
    const out: PlanTask[] = [];
    for (const g of goals) for (const m of g.milestones) for (const t of m.tasks) if (!t.done) out.push(t);
    return out;
  }, [goals]);

  const taskTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of pendingTasks) m.set(t.id, t.title);
    return m;
  }, [pendingTasks]);

  const persistFixed = async (next: FixedEvent[]) => {
    setFixed(next);
    await saveJSON(KEYS.fixedEvents, next);
  };

  const persistChores = async (next: { title: string; minutes: number }[]) => {
    setChores(next);
    await saveJSON(KEYS.choreTemplates, next);
  };

  const addFixed = async () => {
    const title = evTitle.trim();
    if (!title) {
      setMessage('请先填写名称');
      return;
    }
    const startMin = hmToMinutes(evStart);
    const endMin = hmToMinutes(evEnd);
    if (endMin <= startMin) {
      setMessage('结束时间要晚于开始时间');
      return;
    }
    const ev: FixedEvent = {
      id: randomId(),
      title,
      kind: evKind,
      startMin,
      endMin,
      date: evRepeat === 'date' ? evDate : undefined,
      weekday: evRepeat === 'weekly' ? evWeekday : undefined,
    };
    await persistFixed([...fixed, ev]);
    setEvTitle('');
    setMessage('硬约束已锁定，排程时不会被占用');
  };

  const addChoreAsFixed = async (title: string, minutes: number) => {
    const ev: FixedEvent = {
      id: randomId(),
      title: `${title}（生活琐事）`,
      kind: 'other',
      startMin: 7 * 60,
      endMin: 7 * 60 + minutes,
      date: todayStr(),
    };
    await persistFixed([...fixed, ev]);
    setMessage(`已把「${title} ${minutes}min」记为今天 07:00 起的固定占用`);
  };

  const removeFixed = async (id: string) => {
    await persistFixed(fixed.filter(e => e.id !== id));
  };

  const addChore = async () => {
    const title = choreTitle.trim();
    const min = Number(choreMinutes);
    if (!title || !min || min <= 0) {
      setMessage('琐事名称和分钟数都要填');
      return;
    }
    await persistChores([...chores, { title, minutes: min }]);
    setChoreTitle('');
    setChoreMinutes('');
  };

  const [choreTitle, setChoreTitle] = useState('');
  const [choreMinutes, setChoreMinutes] = useState('');

  const resetChores = async () => {
    await persistChores(DEFAULT_CHORES);
    setMessage('已恢复默认生活琐事标准时间库');
  };

  // ---------- 生成 / 重排 ----------
  const run = (note: string) => {
    if (pendingTasks.length === 0) {
      setMessage('目标库里还没有未完成任务，先去『目标拆解』页拆一个目标。');
      return;
    }
    const res = generateSchedule(pendingTasks, logs, fixed, {
      ...DEFAULT_SCHEDULE_OPTIONS,
      startDate: todayStr(),
      days: Math.max(1, Number(days) || 7),
      dayStartMin: hmToMinutes(dayStart),
      dayEndMin: hmToMinutes(dayEnd),
      playMinPerDay: Math.max(0, Number(playMin) || 0),
      bufferRatio,
      restDayWeekday: useRestDay ? restWeekday : undefined,
    });
    setResult(res);
    void saveJSON(KEYS.schedule, res);
    setMessage(note);
  };

  const toggleTaskDone = async (taskId: string) => {
    const next = goals.map(g => ({
      ...g,
      milestones: g.milestones.map(m => ({
        ...m,
        tasks: m.tasks.map(t => (t.id === taskId ? { ...t, done: !t.done } : t)),
      })),
    }));
    setGoals(next);
    await saveJSON(KEYS.goals, next);
  };

  const byDate = useMemo(() => {
    const m = new Map<string, ScheduleItem[]>();
    for (const it of result?.items ?? []) {
      const list = m.get(it.date) ?? [];
      list.push(it);
      m.set(it.date, list);
    }
    return m;
  }, [result]);

  const riskColor = result?.risk.level === 'low' ? '#2E7D32' : result?.risk.level === 'medium' ? '#B07800' : '#C62828';
  const globalTier = result ? qualityTierFor(result.requiredMin, result.capacityMin) : 'gold';
  const tierLabel = globalTier === 'gold' ? '黄金档（做全）' : globalTier === 'silver' ? '白银档（保核心）' : '青铜档（先交作业）';

  const doneCount = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const g of goals) for (const m of g.milestones) for (const t of m.tasks) {
      total++;
      if (t.done) done++;
    }
    return { total, done };
  }, [goals]);

  const percent = doneCount.total === 0 ? 0 : Math.round((doneCount.done / doneCount.total) * 100);

  const body = (
    <>
      <Text style={styles.header}>🗓 双轨排程</Text>
      <Text style={styles.lead}>
        进度轨保证「做得完」，精力轨保证「做得爽」。硬约束先锁死，高耗能任务排进黄金时段，每天还留固定玩的时间。
      </Text>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {/* 进度 */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>目标进度</Text>
          <Text style={styles.percent}>{percent}%　({doneCount.done}/{doneCount.total})</Text>
        </View>
        <View style={styles.progressBg}>
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
        <Text style={styles.subText}>
          目标库里未完成任务 {pendingTasks.length} 个{goals.length === 0 ? ' —— 还没有目标，先去『目标拆解』页建一个。' : ''}
        </Text>
      </View>

      {/* 硬约束 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>硬约束（先锁死，不可移动）</Text>
        {fixed.length === 0 ? (
          <Text style={styles.empty}>还没有硬约束。课程、会议、已购票活动都放这里。</Text>
        ) : (
          fixed.map(e => (
            <View key={e.id} style={styles.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>
                  {KIND_LABEL[e.kind]} {e.title}
                </Text>
                <Text style={styles.subText}>
                  {fmtRange(e.startMin, e.endMin)} · {e.date ? e.date : `每周${WEEKDAYS[e.weekday ?? 0]}`}
                </Text>
              </View>
              <TouchableOpacity onPress={() => removeFixed(e.id)}>
                <Text style={styles.deleteText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <Text style={styles.label}>名称</Text>
        <TextInput style={styles.input} value={evTitle} onChangeText={setEvTitle} placeholder="例：机器学习课 / 组会" placeholderTextColor="#aaa" />

        <Text style={styles.label}>类型</Text>
        <View style={styles.chipWrap}>
          {(Object.keys(KIND_LABEL) as FixedEvent['kind'][]).map(k => (
            <TouchableOpacity key={k} style={[styles.chip, evKind === k && styles.chipActive]} onPress={() => setEvKind(k)}>
              <Text style={[styles.chipText, evKind === k && styles.chipTextActive]}>{KIND_LABEL[k]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>重复方式</Text>
        <View style={styles.chipWrap}>
          <TouchableOpacity style={[styles.chip, evRepeat === 'weekly' && styles.chipActive]} onPress={() => setEvRepeat('weekly')}>
            <Text style={[styles.chipText, evRepeat === 'weekly' && styles.chipTextActive]}>每周重复</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, evRepeat === 'date' && styles.chipActive]} onPress={() => setEvRepeat('date')}>
            <Text style={[styles.chipText, evRepeat === 'date' && styles.chipTextActive]}>指定日期</Text>
          </TouchableOpacity>
        </View>

        {evRepeat === 'weekly' ? (
          <>
            <Text style={styles.label}>星期</Text>
            <View style={styles.chipWrap}>
              {WEEKDAYS.map((w, i) => (
                <TouchableOpacity key={w} style={[styles.chip, evWeekday === i && styles.chipActive]} onPress={() => setEvWeekday(i)}>
                  <Text style={[styles.chipText, evWeekday === i && styles.chipTextActive]}>{w}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={styles.label}>日期（YYYY-MM-DD）</Text>
            <TextInput style={styles.input} value={evDate} onChangeText={setEvDate} placeholder="2026-01-01" placeholderTextColor="#aaa" />
          </>
        )}

        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>开始（HH:MM）</Text>
            <TextInput style={styles.input} value={evStart} onChangeText={setEvStart} placeholder="09:00" placeholderTextColor="#aaa" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>结束（HH:MM）</Text>
            <TextInput style={styles.input} value={evEnd} onChangeText={setEvEnd} placeholder="11:00" placeholderTextColor="#aaa" />
          </View>
        </View>

        <TouchableOpacity style={styles.secondaryBtn} onPress={addFixed}>
          <Text style={styles.secondaryBtnText}>+ 加入硬约束</Text>
        </TouchableOpacity>
      </View>

      {/* 生活琐事标准时间库 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>生活琐事标准时间库（时间块法）</Text>
        <Text style={styles.subText}>排程时会把这些时间当作已占用，避免把一天排满。</Text>
        <View style={styles.chipWrap}>
          {chores.map(c => (
            <TouchableOpacity key={c.title} style={styles.chip} onPress={() => addChoreAsFixed(c.title, c.minutes)}>
              <Text style={styles.chipText}>{c.title} {c.minutes}min ▸ 记为今天</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.twoCol}>
          <View style={{ flex: 2 }}>
            <Text style={styles.label}>自定义琐事</Text>
            <TextInput style={styles.input} value={choreTitle} onChangeText={setChoreTitle} placeholder="例：洗衣服" placeholderTextColor="#aaa" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>分钟</Text>
            <TextInput style={styles.input} value={choreMinutes} onChangeText={setChoreMinutes} placeholder="20" placeholderTextColor="#aaa" keyboardType="number-pad" />
          </View>
        </View>
        <View style={styles.twoCol}>
          <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={addChore}>
            <Text style={styles.secondaryBtnText}>+ 加入时间库</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={resetChores}>
            <Text style={styles.secondaryBtnText}>恢复默认</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 排程参数 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>排程参数</Text>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>规划天数</Text>
            <TextInput style={styles.input} value={days} onChangeText={setDays} keyboardType="number-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>每天玩（分钟）</Text>
            <TextInput style={styles.input} value={playMin} onChangeText={setPlayMin} keyboardType="number-pad" />
          </View>
        </View>
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>一天开始</Text>
            <TextInput style={styles.input} value={dayStart} onChangeText={setDayStart} placeholder="08:00" placeholderTextColor="#aaa" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>一天结束</Text>
            <TextInput style={styles.input} value={dayEnd} onChangeText={setDayEnd} placeholder="23:00" placeholderTextColor="#aaa" />
          </View>
        </View>

        <Text style={styles.label}>项目缓冲比例（吸收低能量日）</Text>
        <View style={styles.chipWrap}>
          {[0.2, 0.25, 0.3].map(r => (
            <TouchableOpacity key={r} style={[styles.chip, bufferRatio === r && styles.chipActive]} onPress={() => setBufferRatio(r)}>
              <Text style={[styles.chipText, bufferRatio === r && styles.chipTextActive]}>{Math.round(r * 100)}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>每周缓冲日（当天不排任务，强制恢复）</Text>
        <View style={styles.chipWrap}>
          <TouchableOpacity style={[styles.chip, !useRestDay && styles.chipActive]} onPress={() => setUseRestDay(false)}>
            <Text style={[styles.chipText, !useRestDay && styles.chipTextActive]}>不设置</Text>
          </TouchableOpacity>
          {WEEKDAYS.map((w, i) => (
            <TouchableOpacity
              key={w}
              style={[styles.chip, useRestDay && restWeekday === i && styles.chipActive]}
              onPress={() => {
                setUseRestDay(true);
                setRestWeekday(i);
              }}
            >
              <Text style={[styles.chipText, useRestDay && restWeekday === i && styles.chipTextActive]}>{w}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => run('已生成日程：按黄金时段匹配高耗能任务，并预留了玩的时间和缓冲。')}>
          <Text style={styles.primaryBtnText}>生成 / 重新规划</Text>
        </TouchableOpacity>
      </View>

      {/* 风险报告 */}
      {result ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>风险报告</Text>
          <View style={styles.rowBetween}>
            <Text style={[styles.prob, { color: riskColor }]}>完成概率 {(result.risk.probability * 100).toFixed(0)}%</Text>
            <Text style={styles.subText}>
              需求 {Math.round(result.requiredMin / 60)}h · 容量 {Math.round(result.capacityMin / 60)}h · 缓冲 {Math.round(result.bufferMin / 60)}h
            </Text>
          </View>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${Math.round(result.risk.probability * 100)}%`, backgroundColor: riskColor }]} />
          </View>
          <Text style={[styles.tip, { color: riskColor }]}>{result.risk.message}</Text>
          <Text style={styles.tip}>建议质量档位：{tierLabel}</Text>
          {result.unscheduled.length > 0 ? (
            <Text style={styles.warn}>⚠️ 排不下的任务：{result.unscheduled.map(t => t.title).join('、')}</Text>
          ) : null}
          <Text style={styles.tip}>
            🌞 黄金时段：{result.golden.map(slotLabel).join('、')}　🌙 低谷：{result.low.map(slotLabel).join('、')}
          </Text>
          {result.criticalPath.length > 0 ? (
            <Text style={styles.tip}>
              🔗 关键链（别推迟）：{result.criticalPath.map(id => taskTitleById.get(id) ?? id).join(' → ')}
            </Text>
          ) : null}
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => run('已按最新情况重排（动态重规划）。')}>
            <Text style={styles.secondaryBtnText}>🔄 一键重排今天 / 本周</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 日程表 */}
      {result ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>日程表</Text>
          {[...byDate.keys()].sort().map(date => {
            const items = byDate.get(date) as ScheduleItem[];
            const taskMin = items.filter(i => i.type === 'task').reduce((s, i) => s + (i.endMin - i.startMin), 0);
            return (
              <View key={date} style={styles.dayBlock}>
                <View style={styles.rowBetween}>
                  <Text style={styles.dayTitle}>
                    {date}　{WEEKDAYS[weekdayOf(date)]}
                    {diffDays(todayStr(), date) === 0 ? '（今天）' : ''}
                  </Text>
                  <Text style={styles.subText}>任务 {Math.round(taskMin / 60)}h</Text>
                </View>
                {items.map(it => {
                  const st = TYPE_STYLE[it.type] ?? TYPE_STYLE.task;
                  const isTask = it.type === 'task' && it.taskId;
                  const task = isTask ? pendingTasks.find(t => t.id === it.taskId) : undefined;
                  return (
                    <View key={it.id} style={[styles.slot, { backgroundColor: st.bg }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.slotTime, { color: st.color }]}>
                          {minutesToHM(it.startMin)}-{minutesToHM(it.endMin)} · {st.label}
                          {it.energyCost ? ` · ${COST_LABEL[it.energyCost]}` : ''}
                          {it.slotKey ? ` · ${slotLabel(it.slotKey)}` : ''}
                        </Text>
                        <Text style={styles.slotTitle}>{it.title}</Text>
                        {task?.intention ? (
                          <Text style={styles.subText}>如果{task.intention.triggerIf}，那么我就{task.intention.actionThen}</Text>
                        ) : null}
                      </View>
                      {isTask && it.taskId ? (
                        <TouchableOpacity onPress={() => toggleTaskDone(it.taskId as string)}>
                          <Text style={styles.checkText}>✓ 完成</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            );
          })}
          <Text style={styles.subText}>生成于 {new Date(result.generatedAt).toLocaleString()}</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.empty}>还没有日程。填好硬约束和参数后点「生成 / 重新规划」。</Text>
        </View>
      )}

      {/* 每日复盘 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>每日复盘</Text>
        <Text style={styles.subText}>
          只有 20 分钟也别停：把最关键的一步做完，就算赢。低精力时，任务降到青铜档不丢人。
        </Text>
        <Text style={styles.tip}>今日已完成 {doneCount.done} 个任务，整体进度 {percent}%。</Text>
        {result ? (
          <Text style={styles.tip}>
            排在今天的任务：{(byDate.get(todayStr()) ?? []).filter(i => i.type === 'task').length} 个 ·
            {' '}玩的时间已锁定 {Math.round(Number(playMin) || 0)} 分钟。
          </Text>
        ) : null}
      </View>

      <View style={{ height: 24 }} />
    </>
  );

  // 作为合并页面的一部分时，嵌进外层滚动容器（避免 ScrollView 嵌套）
  if (embedded) {
    return <View style={[styles.embeddedRoot, styles.content]}>{body}</View>;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  embeddedRoot: { backgroundColor: '#F8FAFC' },
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
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  message: { fontSize: 13, color: '#2E7D32', marginBottom: 8, fontWeight: '600' },
  percent: { fontSize: 15, fontWeight: '800', color: '#1976D2' },
  progressBg: { height: 10, borderRadius: 5, backgroundColor: '#eef2f7', overflow: 'hidden', marginTop: 6, marginBottom: 6 },
  progressFill: { height: '100%', backgroundColor: '#1976D2', borderRadius: 5 },
  subText: { fontSize: 13, color: '#5f6b7a', lineHeight: 19, marginBottom: 4 },
  tip: { fontSize: 13, color: '#1976D2', marginTop: 6, lineHeight: 19 },
  warn: { fontSize: 13, color: '#C62828', marginTop: 6, lineHeight: 19, fontWeight: '600' },
  prob: { fontSize: 18, fontWeight: '800' },
  empty: { color: '#9aa7b8', fontSize: 14, marginBottom: 6 },
  itemTitle: { fontSize: 14, color: '#222', fontWeight: '600' },
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
  twoCol: { flexDirection: 'row', gap: 10 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#EDF3FD' },
  chipActive: { backgroundColor: '#1976D2' },
  chipText: { fontSize: 12, color: '#1976D2' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  primaryBtn: { backgroundColor: '#1976D2', borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { backgroundColor: '#EDF3FD', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  secondaryBtnText: { color: '#1976D2', fontWeight: '700', fontSize: 14 },
  deleteText: { color: '#E53935', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 6 },
  dayBlock: { marginTop: 12, borderTopWidth: 0.6, borderColor: '#e6e6ed', paddingTop: 8 },
  dayTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a2e' },
  slot: { borderRadius: 8, padding: 9, marginTop: 6 },
  slotTime: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  slotTitle: { fontSize: 14, color: '#222', fontWeight: '600' },
  checkText: { color: '#2E7D32', fontSize: 12, fontWeight: '700', paddingHorizontal: 6 },
});
