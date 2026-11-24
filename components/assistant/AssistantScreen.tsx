import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { callChatJSON, getAiConfig } from '@/app/utils/ai';
import { EnergyCost, KEYS, PlanTask, TaskWindow, addDays, loadJSON, minutesToHM, todayStr } from '@/app/utils/planning';
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
  allTasks,
  overrunTasks,
  celebrate,
  replan,
  resolveOverrun,
  spentByTask,
} from './plan-store';
import GapPanel from './GapPanel';
import StreakBadge from './StreakBadge';
import { AttachedImage, IMAGE_PROMPT, MAX_IMAGES, fileToImage, imagesFromTransfer, pickImageFiles } from './image-attach';
import { PriDot } from '@/components/data/priority';
import WeeklyCard from './WeeklyCard';
import { EnergyQuick, EveningCard, MissedCard, MorningCard, NowNextCard } from './FollowUp';
import { takePendingAsk } from './ask-bridge';
import { DATA_CHANGED_EVENT, openBreakdown } from './breakdown';
import { startTaskTimer } from './gap';
import HabitsCard from './HabitsCard';
import PhraseCard from './PhraseCard';
import { appendBlockLog, buildInsights, habitsForAi, loadBlockLog } from './habits';
import {
  MissedBlock,
  SCHEDULE_STALE_EVENT,
  endedBlocks,
  filterUnseenMissed,
  findMissed,
  loadReviews,
  markMissedSeen,
  matchMoved,
  reasonSummary,
} from './followup';
import { confirmAsync } from '@/components/ui/confirm';

export const ASSISTANT_HISTORY_KEY = '@myplan_assistant_history';
export const FOCUS_ASSISTANT_EVENT = 'myplan:focus-assistant';

/** proposal：这条回复带的调整方案后来有没有被确认 */
type Msg = { role: 'user' | 'assistant'; content: string; at: string; proposal?: 'pending' | 'applied' | 'dismissed' };

/** 把还没确认的方案标记为某个状态 */
function markPending(h: Msg[], to: 'applied' | 'dismissed'): Msg[] {
  return h.map(m => (m.proposal === 'pending' ? { ...m, proposal: to } : m));
}

/** 发给 AI 的历史：没确认的方案要注明「没有生效」，免得 AI 以为已经加过了 */
function historyForAi(h: Msg[]) {
  return h.map(m => ({
    role: m.role,
    content:
      m.role === 'assistant' && m.proposal && m.proposal !== 'applied'
        ? `${m.content}\n（系统注：这个方案用户没有确认，没有生效，当前数据里没有这些改动。）`
        : m.content,
  }));
}
type Proposal = { reply: string; actions: AssistantAction[]; changes: AppliedChange[]; enabled: boolean[] };


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

const COST_OPTS: { key: EnergyCost; label: string; color: string }[] = [
  { key: 'high', label: '高', color: '#D84315' },
  { key: 'medium', label: '中', color: '#F9A825' },
  { key: 'low', label: '低', color: '#2E7D32' },
];
const WINDOW_OPTS: { key: TaskWindow | null; label: string }[] = [
  { key: null, label: '不限' },
  { key: 'morning', label: '上午' },
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '晚上' },
];

function CostPicker({ value, onChange }: { value?: EnergyCost; onChange: (c: EnergyCost) => void }) {
  return (
    <View style={styles.pickRow}>
      <Text style={styles.pickLabel}>耗能</Text>
      {COST_OPTS.map(c => (
        <TouchableOpacity
          key={c.key}
          style={[styles.pick, value === c.key && { backgroundColor: c.color, borderColor: c.color }]}
          onPress={() => onChange(c.key)}
        >
          <Text style={[styles.pickText, value === c.key && styles.pickTextOn]}>{c.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function MinutesInput({ value, onChange, label = '时长' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <View style={styles.pickRow}>
      <Text style={styles.pickLabel}>{label}</Text>
      <TextInput
        style={styles.minInput}
        value={value}
        onChangeText={t => onChange(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
      />
      <Text style={styles.pickLabel}>分钟</Text>
    </View>
  );
}

/** 点开已排任务后的编辑面板 */
function TaskEditor({
  task,
  spent,
  busy,
  onSave,
  onDone,
  onClose,
  onStart,
  onDelete,
  onBreakdown,
}: {
  task: PlanTask;
  spent: number;
  busy: boolean;
  onSave: (patch: { energyCost: EnergyCost; estimateMin: number; window: TaskWindow | null }) => void;
  onDone: () => void;
  onClose: () => void;
  onStart: () => void;
  onDelete: () => void;
  onBreakdown: () => void;
}) {
  const [cost, setCost] = useState<EnergyCost>(task.energyCost);
  const [minutes, setMinutes] = useState(String(task.estimateMin));
  const [win, setWin] = useState<TaskWindow | null>(task.window ?? null);
  const min = Number(minutes);
  const valid = min >= 5;
  return (
    <View style={styles.editor}>
      <CostPicker value={cost} onChange={setCost} />
      <MinutesInput value={minutes} onChange={setMinutes} label="总时长" />
      {spent > 0 && <Text style={styles.mutedSmall}>已经做了 {spent} 分钟，排程只排剩下的部分。</Text>}
      <View style={styles.pickRow}>
        <Text style={styles.pickLabel}>时段</Text>
        {WINDOW_OPTS.map(w => (
          <TouchableOpacity key={w.label} style={[styles.pick, win === w.key && styles.pickOnBlue]} onPress={() => setWin(w.key)}>
            <Text style={[styles.pickText, win === w.key && styles.pickTextOn]}>{w.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.smallPrimary, (!valid || busy) && styles.btnDisabled]}
          disabled={!valid || busy}
          onPress={() => onSave({ energyCost: cost, estimateMin: min, window: win })}
        >
          <Text style={styles.smallPrimaryText}>保存</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.smallSecondary, busy && styles.btnDisabled]} disabled={busy} onPress={onStart}>
          <Text style={styles.smallSecondaryText}>▶ 计时</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.smallSecondary, busy && styles.btnDisabled]} disabled={busy} onPress={onBreakdown}>
          <Text style={styles.smallSecondaryText}>🧩 拆分</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.smallSecondary, busy && styles.btnDisabled]} disabled={busy} onPress={onDone}>
          <Text style={styles.smallSecondaryText}>✅ 完成</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.smallDanger, busy && styles.btnDisabled]} disabled={busy} onPress={onDelete}>
          <Text style={styles.smallDangerText}>🗑️ 删除</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DayTimeline({
  schedule,
  date,
  title,
  fromNow,
  selectedId,
  onSelect,
  renderEditor,
}: {
  schedule: ScheduleResult;
  date: string;
  title: string;
  fromNow?: boolean;
  selectedId?: string | null;
  onSelect?: (item: ScheduleItem | null) => void;
  renderEditor?: (item: ScheduleItem) => React.ReactNode;
}) {
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
          const editable = !!onSelect && it.type === 'task' && !!it.taskId;
          const open = editable && selectedId === it.id;
          return (
            <View key={it.id}>
              <TouchableOpacity
                disabled={!editable}
                onPress={() => onSelect?.(open ? null : it)}
                style={[styles.item, { backgroundColor: st.bg }, isNow && styles.itemNow, open && styles.itemOpen]}
              >
                <Text style={styles.itemTime}>
                  {minutesToHM(it.startMin)}–{minutesToHM(it.endMin)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemTitle, { color: st.color }]}>
                    {isNow ? '▶ ' : ''}
                    {it.type === 'task' && <PriDot q={it.quadrant} size={13} />}
                    {it.title}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {st.label}
                    {it.energyCost ? ` · ${COST_CN[it.energyCost]}` : ''}
                    {it.note ? ` · ⚠️ ${it.note}` : ''}
                    {editable ? (open ? '' : ' · 点击修改') : ''}
                  </Text>
                </View>
              </TouchableOpacity>
              {open && renderEditor?.(it)}
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
  // 附带的图片（任务要求截图）
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    try {
      const list = await Promise.all(files.slice(0, MAX_IMAGES).map(fileToImage));
      setImages(prev => [...prev, ...list].slice(0, MAX_IMAGES));
      setError('');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }, []);
  // 在今天页任何地方 Ctrl+V 粘贴截图，都会附到输入框；也可以把图片拖进来
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesFromTransfer(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      const files = imagesFromTransfer(e.dataTransfer);
      setDragOver(false);
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addFiles]);

  const [missed, setMissed] = useState<MissedBlock[]>([]);

  const reload = useCallback(async () => {
    const old = await loadJSON<ScheduleResult | null>(KEYS.schedule, null);
    const s = await loadPlanState();
    setState(s);
    const sch = await commitState(s); // 打开页面时从现在开始刷新一次排程
    setSchedule(sch);
    // 自动补排：错过的任务块已经被重新排进后面的空档，告诉用户挪到了哪里
    // 习惯档案：记下每个已结束的任务块有没有按时开始
    await appendBlockLog(endedBlocks(old, s));
    const unseen = await filterUnseenMissed(findMissed(old, s));
    if (unseen.length) {
      setMissed(prev => [...prev, ...matchMoved(unseen, sch)]);
      await markMissedSeen(unseen.map(m => m.id));
    }
  }, []);

  // 有任务块刚结束（后台提醒服务发出的信号）或别处改了数据（比如拆解）：刷新
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onStale = () => reload();
    window.addEventListener(SCHEDULE_STALE_EVENT, onStale);
    window.addEventListener(DATA_CHANGED_EVENT, onStale);
    return () => {
      window.removeEventListener(SCHEDULE_STALE_EVENT, onStale);
      window.removeEventListener(DATA_CHANGED_EVENT, onStale);
    };
  }, [reload]);

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
    const pics = raw === undefined ? images : [];
    const text = (raw ?? input).trim() || (pics.length ? '这是任务要求的截图，帮我拆成子任务并排进日程。' : '');
    if (!text || loading || !state) return;
    setError('');
    setInput('');
    const userMsg: Msg = { role: 'user', content: pics.length ? `🖼️ [${pics.length} 张图片] ${text}` : text, at: new Date().toISOString() };
    if (pics.length) setImages([]);
    // 发新消息时，上一个还没点「应用」的方案不丢：把它勾选的操作并进这次的新方案里
    const carried = proposal ? proposal.actions.filter((_, i) => proposal.enabled[i] && proposal.changes[i]?.ok) : [];
    const h1 = [...markPending(history, 'dismissed'), userMsg];
    saveHistory(h1);
    setLoading(true);
    try {
      const cfg = await getAiConfig();
      if (!cfg.apiKey) throw new Error('还没有配置 AI Key：到「⚙️ 设置 → 🤖 AI」里填入 DeepSeek API Key。');
      const fresh = await loadPlanState();
      setState(fresh);
      const insights = buildInsights(fresh.timeLogs, fresh.goals, await loadBlockLog(), reasonSummary(await loadReviews()));
      const context = buildContext(fresh, schedule, new Date(), habitsForAi(insights, fresh.memories ?? []));
      const pendingNote = carried.length
        ? `\n\n（注意：上一个方案用户还没点「应用」，系统会把它自动并进这次的方案，里面已有这些操作：${JSON.stringify(carried)}。你只需要输出这次新要求的操作；如果新要求是要改掉或取消上面的某一项，就在 reply 里说明，系统会以你这次的操作为准再追加。）`
        : '';
      const result = await callChatJSON<{ reply?: string; actions?: AssistantAction[] }>([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'system', content: `当前数据：\n${context}` },
        ...historyForAi(h1.slice(-9, -1)),
        pics.length
          ? {
              role: 'user',
              content: [
                { type: 'text', text: `${text}\n\n${IMAGE_PROMPT}${pendingNote}` },
                ...pics.map(p => ({ type: 'image_url' as const, image_url: { url: p.dataUrl } })),
              ],
            }
          : { role: 'user', content: text + pendingNote },
      ], pics.length ? { model: cfg.visionModel || 'deepseek-flash' } : undefined);
      const fresh2 = Array.isArray(result.actions) ? result.actions.filter(a => a && typeof a === 'object') : [];
      // 去掉和上次方案重复的操作（AI 有时会把上一个方案再写一遍）
      const seen = new Set(carried.map(a => JSON.stringify(a)));
      const actions = [...carried, ...fresh2.filter(a => !seen.has(JSON.stringify(a)))];
      let reply = String(result.reply || (actions.length ? '我拟了一个调整方案，请确认。' : '好的。'));
      if (carried.length && fresh2.length) reply += `\n（上一个还没应用的 ${carried.length} 项也一起放进了这个方案。）`;
      if (actions.length) reply += '\n👉 点下面的「应用」后才会生效。';
      saveHistory([
        ...h1,
        { role: 'assistant', content: reply, at: new Date().toISOString(), ...(actions.length ? { proposal: 'pending' as const } : {}) },
      ]);
      if (actions.length > 0) {
        const { changes } = applyActions(fresh, actions);
        setProposal({ reply, actions, changes, enabled: changes.map(c => c.ok) });
      } else {
        setProposal(null);
      }
    } catch (e: any) {
      let msg = e instanceof SyntaxError ? 'AI 返回的格式不对，请换个说法再试一次。' : e?.message || String(e);
      if (pics.length && /image|vision|model/i.test(msg)) {
        msg = `看图失败：${msg}。可以到「⚙️ 设置 → 🤖 AI」检查「看图模型」（DeepSeek 用 deepseek-flash），或者把图里的要求打成文字发给我。`;
        setImages(pics);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // 从日历弹窗「问 AI」过来的话：页面数据就绪后自动发送
  const askedRef = useRef(false);
  useEffect(() => {
    if (!state || askedRef.current) return;
    askedRef.current = true;
    const pendingAsk = takePendingAsk();
    if (pendingAsk) send(pendingAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const confirm = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const sch = await commitState(preview.next);
      setState(preview.next);
      setSchedule(sch);
      setProposal(null);
      saveHistory([
        ...markPending(history, 'applied'),
        { role: 'assistant', content: `✔ 已应用 ${preview.count} 项调整，排程已更新。`, at: new Date().toISOString() },
      ]);
    } catch (e: any) {
      setError('保存失败：' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  // 直接改方案里某一项的耗能 / 时长，并刷新说明和预览
  const editAction = (i: number, patch: { energyCost?: EnergyCost; estimateMin?: number }) => {
    if (!proposal || !state) return;
    const actions = proposal.actions.map((a, j) => (j === i ? ({ ...a, ...patch } as AssistantAction) : a));
    const { changes } = applyActions(state, actions);
    setProposal({ ...proposal, actions, changes });
  };
  const taskById = useMemo(() => new Map((state ? allTasks(state.goals) : []).map(r => [r.task.id, r.task])), [state]);
  const spentMap = useMemo(() => spentByTask(state?.timeLogs ?? []), [state]);

  // 时间轴上点开的任务块
  const [selected, setSelected] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const runQuickAction = async (action: AssistantAction) => {
    if (!state) return;
    setEditBusy(true);
    setError('');
    try {
      const fresh = await loadPlanState();
      const { next, changes } = applyActions(fresh, [action]);
      if (!changes[0]?.ok) throw new Error(changes[0]?.summary || '操作失败');
      const sch = await commitState(next);
      setState(next);
      setSchedule(sch);
      setSelected(null);
      saveHistory([...history, { role: 'assistant', content: `${changes[0].summary}，已重新排程。`, at: new Date().toISOString() }]);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setEditBusy(false);
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
      <Text style={styles.title}>🏠 今天</Text>
      <View style={{ marginBottom: 6 }}>
        <StreakBadge />
      </View>
      <Text style={styles.subtitle}>
        跟 AI 说你要做什么、做完了什么、想怎么调整，或者问它问题；它会结合你所有任务的进度重新安排。随时按 Ctrl+K 回到这里。
      </Text>

      <NowNextCard schedule={schedule} />
      {state && (
        <EnergyQuick
          state={state}
          onLogged={logs => setState({ ...state, energyLogs: logs })}
        />
      )}
      <MissedCard missed={missed} onClose={() => setMissed([])} />
      {state && <WeeklyCard state={state} />}
      {state && !proposal && (
        <EveningCard
          state={state}
          schedule={schedule}
          onChanged={(s, sch) => {
            setState(s);
            setSchedule(sch);
          }}
          onNote={text =>
            setHistory(prev => {
              const h = [...prev, { role: 'assistant' as const, content: text, at: new Date().toISOString() }].slice(-30);
              void AsyncStorage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(h));
              return h;
            })
          }
        />
      )}
      {!proposal && (
        <MorningCard
          schedule={schedule}
          onAdjust={() => {
            setInput('今天我想调整一下：');
            inputRef.current?.focus();
          }}
        />
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
            <Text style={styles.warn}>
              ⚠️ 截止前排不下：{shown.unscheduled.map(t => t.title).join('、')}（已尽量排在截止后最早的空档，标了 ⚠️）
            </Text>
          )}
          <Text style={styles.mutedSmall}>
            {shown.risk.message}
            {!preview ? '  点任务块可以改耗能、时长、时段，开始计时、让 AI 帮你拆、标记完成或删除。' : ''}
          </Text>
          <View style={styles.days}>
            {[
              { date: today, title: '今天（从现在起）', fromNow: true },
              { date: addDays(today, 1), title: '明天', fromNow: false },
            ].map(d => (
              <DayTimeline
                key={d.date}
                schedule={shown}
                date={d.date}
                title={d.title}
                fromNow={d.fromNow}
                selectedId={selected}
                onSelect={preview ? undefined : it => setSelected(it ? it.id : null)}
                renderEditor={it => {
                  const t = it.taskId ? taskById.get(it.taskId) : undefined;
                  if (!t) return null;
                  return (
                    <TaskEditor
                      key={t.id + t.estimateMin + t.energyCost}
                      task={t}
                      spent={spentMap.get(t.id) ?? 0}
                      busy={editBusy}
                      onClose={() => setSelected(null)}
                      onStart={async () => {
                        await startTaskTimer(t, it.endMin - it.startMin);
                        setSelected(null);
                        if (Platform.OS === 'web') window.scrollTo?.({ top: 0, behavior: 'smooth' });
                      }}
                      onDone={async () => {
                        await runQuickAction({ type: 'complete_task', taskId: t.id });
                        celebrate(t.title);
                      }}
                      onBreakdown={() => {
                        setSelected(null);
                        openBreakdown(t.id);
                      }}
                      onDelete={async () => {
                        const ok = await confirmAsync(`删除任务「${t.title}」？删除后不能恢复（日历和任务列表里也会一起删掉）。`);
                        if (ok) runQuickAction({ type: 'delete_task', taskId: t.id });
                      }}
                      onSave={p =>
                        runQuickAction({
                          type: 'update_task',
                          taskId: t.id,
                          energyCost: p.energyCost,
                          estimateMin: p.estimateMin,
                          window: p.window,
                        })
                      }
                    />
                  );
                }}
              />
            ))}
          </View>
        </View>
      )}
      {/* 输入 */}
      <View style={[styles.inputCard, dragOver && { borderColor: '#1976D2', borderStyle: 'dashed', backgroundColor: '#F3F8FF' }]}>
        {dragOver && <Text style={styles.hint}>松开鼠标，把图片附给 AI</Text>}
        {images.length > 0 && (
          <View style={styles.thumbRow}>
            {images.map(im => (
              <View key={im.id} style={styles.thumbBox}>
                <Image source={{ uri: im.dataUrl }} style={styles.thumb} resizeMode="cover" />
                <TouchableOpacity style={styles.thumbDel} onPress={() => setImages(prev => prev.filter(x => x.id !== im.id))}>
                  <Text style={styles.thumbDelText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={images.length ? '说说要怎么安排（可不填，直接发送就会按截图拆分并排程）' : '比如：这周五前要交实验报告，大概要 4 个小时；也可以 Ctrl+V 粘贴任务要求截图'}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <TouchableOpacity
              style={styles.attachBtn}
              disabled={loading || images.length >= MAX_IMAGES}
              onPress={async () => addFiles(await pickImageFiles())}
            >
              <Text style={styles.attachText}>🖼️ 图片</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>Enter 发送 · Shift+Enter 换行 · 可粘贴 / 拖入截图</Text>
          </View>
          <TouchableOpacity
            style={[styles.sendBtn, ((!input.trim() && !images.length) || loading) && styles.btnDisabled]}
            disabled={(!input.trim() && !images.length) || loading}
            onPress={() => send()}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendText}>发送</Text>}
          </TouchableOpacity>
        </View>
        <PhraseCard
          onPick={text => {
            setInput(text);
            inputRef.current?.focus();
          }}
        />
      </View>

      {state && !proposal && (
        <GapPanel
          state={state}
          schedule={schedule}
          onChanged={(s, sch) => {
            setState(s);
            setSchedule(sch);
          }}
          onNote={text =>
            setHistory(prev => {
              const h = [...prev, { role: 'assistant' as const, content: text, at: new Date().toISOString() }].slice(-30);
              void AsyncStorage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(h));
              return h;
            })
          }
        />
      )}

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
          {proposal.changes.map((c, i) => {
            const a = proposal.actions[i];
            const isTask = c.ok && (a.type === 'add_task' || a.type === 'update_task');
            const base = a.type === 'update_task' ? taskById.get(a.taskId) : undefined;
            const cost = isTask ? (a as { energyCost?: EnergyCost }).energyCost ?? base?.energyCost ?? 'medium' : undefined;
            const est = isTask ? (a as { estimateMin?: number }).estimateMin ?? base?.estimateMin ?? 60 : undefined;
            return (
              <View key={i} style={styles.changeBlock}>
                <TouchableOpacity style={styles.changeRow} onPress={() => toggle(i)} disabled={!c.ok}>
                  <View style={[styles.checkbox, proposal.enabled[i] && styles.checkboxOn, !c.ok && styles.checkboxOff]}>
                    {proposal.enabled[i] && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  <Text style={[styles.changeText, !c.ok && styles.changeSkipped]}>{c.summary}</Text>
                </TouchableOpacity>
                {isTask && proposal.enabled[i] && (
                  <View style={styles.changeEdit}>
                    <CostPicker value={cost} onChange={v => editAction(i, { energyCost: v })} />
                    <MinutesInput
                      value={String(est ?? '')}
                      onChange={v => v && editAction(i, { estimateMin: Number(v) })}
                    />
                  </View>
                )}
              </View>
            );
          })}
          {preview && preview.schedule.unscheduled.length > 0 && (
            <Text style={styles.warn}>
              ⚠️ 截止前排不下：{preview.schedule.unscheduled.map(t => t.title).join('、')}
            </Text>
          )}
          <Text style={styles.mutedSmall}>可以直接点「高 / 中 / 低」改耗能、改时长，下面的「今天 / 明天」会马上按新方案预览。也可以在上面继续跟我说，比如“写报告放到上午”。</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.primaryBtn, (saving || !preview?.count) && styles.btnDisabled]}
              disabled={saving || !preview?.count}
              onPress={confirm}
            >
              <Text style={styles.primaryText}>确认（{preview?.count ?? 0} 项）</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                setProposal(null);
                saveHistory(markPending(history, 'dismissed'));
              }}
              disabled={saving}
            >
              <Text style={styles.secondaryText}>不用了</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {state && (
        <HabitsCard
          state={state}
          onMemoriesChanged={m => setState({ ...state, memories: m })}
          onAsk={text => send(text)}
        />
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
  attachBtn: { backgroundColor: '#EEF1F5', borderRadius: 6, paddingVertical: 5, paddingHorizontal: 10, marginRight: 10 },
  attachText: { fontSize: 13, color: '#37474F', fontWeight: '600' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  thumbBox: { width: 76, height: 76, borderRadius: 8, overflow: 'hidden', marginRight: 8, marginBottom: 6, borderWidth: 1, borderColor: '#D6E0EE' },
  thumb: { width: '100%', height: '100%' },
  thumbDel: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  thumbDelText: { color: '#fff', fontSize: 11, fontWeight: '700' },
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
  btnRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
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
  changeBlock: { marginBottom: 4 },
  changeEdit: { marginLeft: 26, marginBottom: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  pickRow: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginVertical: 3 },
  pickLabel: { fontSize: 13, color: '#666', marginRight: 6 },
  pick: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 12, paddingVertical: 3, paddingHorizontal: 10, marginRight: 6, backgroundColor: '#fff' },
  pickOnBlue: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  pickText: { fontSize: 13, color: '#455A64' },
  pickTextOn: { color: '#fff', fontWeight: '600' },
  minInput: { width: 64, borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 6, paddingVertical: 3, paddingHorizontal: 6, fontSize: 14, backgroundColor: '#fff', marginRight: 6 },
  editor: { backgroundColor: '#F7FAFF', borderRadius: 8, borderWidth: 1, borderColor: '#C9DCF5', padding: 10, marginTop: -2, marginBottom: 8 },
  itemOpen: { borderWidth: 2, borderColor: '#90CAF9' },
  smallPrimary: { backgroundColor: '#1976D2', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginTop: 6 },
  smallPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  smallSecondary: { backgroundColor: '#EEF1F5', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginTop: 6 },
  smallDanger: { backgroundColor: '#FFEBEE', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginTop: 6 },
  smallDangerText: { color: '#C62828', fontSize: 13, fontWeight: '600' },
  smallSecondaryText: { color: '#455A64', fontSize: 13, fontWeight: '600' },
  planCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', padding: 16, marginBottom: 14, maxWidth: 820 },
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
