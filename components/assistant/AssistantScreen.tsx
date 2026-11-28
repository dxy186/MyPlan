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

import { AiFormatError, ChatMessage, callChatJSON, extractReplyLoosely, getAiConfig, lastJSONRaw } from '@/app/utils/ai';
import { EnergyCost, KEYS, PlanTask, TaskWindow, addDays, loadJSON, minutesToHM, toDateStr, todayStr } from '@/app/utils/planning';
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
import { appendDiaryText } from '@/components/data/diary';
import { DDL_LIKE, addEvent, eventsOn, loadEvents, looksYearly } from '@/components/data/events';
import { AttachedImage, IMAGE_PROMPT, visionOpts, MAX_IMAGES, fileToImage, imagesFromClipboardFallback, imagesFromTransfer, pickImageFiles } from './image-attach';
import { PriDot } from '@/components/data/priority';
import WeeklyCard from './WeeklyCard';
import { EnergyQuick, EveningCard, MissedCard, MorningCard, NowNextCard } from './FollowUp';
import { takePendingAsk } from './ask-bridge';
import { DATA_CHANGED_EVENT, openBreakdown } from './breakdown';
import { parseDdlLine } from '@/components/data/quick-parse';
import ChatThread, { ChatMsg } from './ChatThread';
import { chatPersonaPrompt, loadPersona } from './coach';
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
type Msg = ChatMsg;

/** 把还没确认的方案标记为某个状态 */
function markPending(h: Msg[], to: 'applied' | 'dismissed'): Msg[] {
  return h.map(m => (m.proposal === 'pending' ? { ...m, proposal: to } : m));
}

/** 发给 AI 的历史：没确认的方案要注明「没有生效」，免得 AI 以为已经加过了 */
function historyForAi(h: Msg[]) {
  // App 自己写的「没给出内容 / 没听懂」提示不发回给 AI，免得它照着学
  return h.filter(m => !(m.role === 'assistant' && (m.raw !== undefined || /^AI 这次没给出内容|^我没太理解/.test(m.content)))).map(m => ({
    role: m.role,
    content:
      m.role === 'assistant' && m.proposal && m.proposal !== 'applied'
        ? `${m.content}\n（系统注：这个方案用户没有确认，没有生效，当前数据里没有这些改动。）`
        : m.quote
          ? `${m.content}\n（引用了之前的这段：${m.quote.text}）`
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

/** 聊天记录全存，但设个上限：最多 3000 条、约 1.5 MB（太旧的先删） */
function capHistory(h: Msg[]): Msg[] {
  let out = h.slice(-3000);
  while (out.length > 50 && JSON.stringify(out).length > 1_500_000) out = out.slice(Math.ceil(out.length / 10));
  return out;
}

/** 输入框上方的提问示例：让人知道除了加任务，还能找 AI 商量事情 */
const IDEAS = [
  '假期有 4 天，想玩游戏、写点作业、练琴，还想出去玩，帮我规划一下',
  '这周事情太多了，帮我看看哪些可以往后放',
  '我总是拖着不写论文，有什么办法？',
  '今天还剩什么？先做哪个比较好？',
];

/** 新回答和最近几条 AI 回答的相似度（三字片段重合率）超过 80%：多半是照抄 */
function sameAsBefore(reply: string, h: Msg[]): boolean {
  const norm = (x: string) => x.replace(/[\s\p{P}\p{S}]/gu, '');
  const grams = (x: string) => {
    const g = new Set<string>();
    for (let i = 0; i + 3 <= x.length; i++) g.add(x.slice(i, i + 3));
    return g;
  };
  const a = grams(norm(reply));
  if (a.size < 40) return false;
  return h
    .filter(m => m.role === 'assistant')
    .slice(-8)
    .some(m => {
      const b = grams(norm(m.content));
      if (b.size < 40) return false;
      let n = 0;
      for (const g of a) if (b.has(g)) n++;
      return n / Math.min(a.size, b.size) > 0.8;
    });
}

/** 只回了「好的 / 收到 / 明白」这类话 */
const HOLLOW_RE = /^(好的?|好嘞|好哒|收到|明白了?|了解|知道了|没问题|ok|okay|嗯+|行|可以)[，,。.!！~～\s]*(?:♪)?$/i;
/** 用户自己只是在应答（谢谢 / 好的 / 嗯）：这时 AI 回「好的」是正常的 */
const ACK_RE = /^(好的?|好嘞|嗯+|ok|okay|谢谢|多谢|thanks|thx|收到|知道了|没事了?|算了|不用了?|行)[，,。.!！~～\s]*$/i;
function isHollow(r: { reply: string; actions: unknown[] }): boolean {
  if (r.actions.length) return false;
  const t = r.reply.trim();
  return !t || HOLLOW_RE.test(t) || t.replace(/[\s，,。.!！~～♪]/g, '').length <= 3;
}

/** AI 回的 JSON 字段名不一定规范：reply / message / response…、actions / operations…，甚至直接是一个数组或单个操作 */
function normalizeAiResult(r: unknown): { reply: string; actions: AssistantAction[] } {
  const isAction = (x: unknown) => !!x && typeof x === 'object' && typeof (x as { type?: unknown }).type === 'string';
  if (Array.isArray(r)) return { reply: '', actions: r.filter(isAction) as AssistantAction[] };
  if (!r || typeof r !== 'object') return { reply: typeof r === 'string' ? r : '', actions: [] };
  const o = r as Record<string, unknown>;
  if (isAction(o) && !('reply' in o)) return { reply: '', actions: [o as unknown as AssistantAction] };
  const actKey = ['actions', 'operations', 'ops', 'action', 'changes', '操作'].find(k => Array.isArray(o[k]) || isAction(o[k]));
  const rawActs = actKey ? o[actKey] : [];
  const actions = (Array.isArray(rawActs) ? rawActs : [rawActs]).filter(isAction) as AssistantAction[];
  // reply 可能是字符串，也可能被写成了段落数组、或者 {text: …} 这样的对象
  const asText = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n');
    if (v && typeof v === 'object') {
      const ob = v as Record<string, unknown>;
      for (const k of ['text', 'content', 'reply', 'message', 'answer']) if (typeof ob[k] === 'string') return ob[k] as string;
    }
    return '';
  };
  const replyKey = ['reply', 'message', 'response', 'answer', 'text', 'content', '回复', '回答', 'msg'].find(k => asText(o[k]).trim());
  let reply = replyKey ? asText(o[replyKey]) : '';
  if (!reply) {
    // 字段名完全不认识：拿最长的一段文字当回复
    const strs = Object.entries(o)
      .filter(([k]) => k !== actKey)
      .map(([, v]) => asText(v))
      .filter(t => t.trim().length > 1)
      .sort((a, b) => b.length - a.length);
    reply = strs[0] ?? '';
  }
  return { reply, actions };
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
      const all = await Promise.all(files.slice(0, MAX_IMAGES).map(f => fileToImage(f)));
      // 读出来太小的（几个像素，基本是空白）不要，免得 AI 说「图是空白的」
      const list = all.filter(im => im.w === undefined || (im.w >= 16 && (im.h ?? 16) >= 16));
      if (list.length < all.length) setError('有图片读出来几乎是空白的，已经去掉了；换成截图（PNG / JPG）或者另存为图片再上传试试。');
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
        return;
      }
      // 粘贴的东西里没有文字（多半是微信 / QQ 截图）：换几种办法再找图片
      const txt = e.clipboardData?.getData('text/plain') || '';
      if (!txt.trim()) {
        const dt = e.clipboardData;
        imagesFromClipboardFallback(dt).then(more => {
          if (more.length) addFiles(more);
          else setError('剪贴板里没找到图片。微信截图可以先点「完成」或「复制」再粘贴；还不行就把截图另存为图片，点「🖼️ 图片」上传。');
        });
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
    const trimmed = capHistory(h);
    setHistory(trimmed);
    void AsyncStorage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(trimmed));
  };
  /** 复盘、空档建议这类卡片往对话里加一句 */
  const appendNote = (text: string) =>
    setHistory(prev => {
      const h = capHistory([...prev, { role: 'assistant' as const, content: text, at: new Date().toISOString() }]);
      void AsyncStorage.setItem(ASSISTANT_HISTORY_KEY, JSON.stringify(h));
      return h;
    });
  // 引用之前的一条消息
  const [quote, setQuote] = useState<Msg | null>(null);

  // 预览：只应用勾选的操作，算出新排程
  const preview = useMemo(() => {
    if (!proposal || !state) return null;
    const chosen = proposal.actions.filter((_, i) => proposal.enabled[i] && proposal.changes[i]?.ok);
    const { next } = applyActions(state, chosen);
    return { next, schedule: replan(next), count: chosen.length, chosen };
  }, [proposal, state]);

  /** 「#ES pre 12/8」：直接加成 DDL。处理了返回 true；没写日期等情况返回 false，交给 AI */
  const addDdlLocally = async (text: string, userMsg: Msg): Promise<boolean> => {
    const pre = text.match(/^关于\s*(\d{4}-\d{2}-\d{2})\s*这天[：:]\s*/);
    const body = pre ? text.slice(pre[0].length) : text;
    const lines = body.split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length || !lines.every(l => /^[#＃]/.test(l))) return false;
    const today = todayStr();
    const items = lines.map(l => {
      const p = parseDdlLine(l, today);
      return p ? { title: p.title, date: p.date ?? pre?.[1], split: /^[#＃]+\s*[?？]|^[?？]+\s*[#＃]/.test(l) } : null;
    });
    if (items.some(x => !x || !x.date)) return false;
    const fresh = await loadPlanState();
    const existing = allTasks(fresh.goals).map(r => r.task);
    const todo = (items as { title: string; date: string; split: boolean }[]).filter(
      x => !existing.some(t => !t.done && t.title === x.title && t.due === x.date)
    );
    const dup = items.length - todo.length;
    const { next, changes } = applyActions(
      fresh,
      todo.map(x => ({ type: 'add_task' as const, title: x.title, due: x.date, estimateMin: 30, energyCost: 'medium' as const }))
    );
    const ok = changes.filter(c => c.ok).length;
    if (ok) await commitState(next);
    setState(ok ? next : fresh);
    const list = todo.map(x => `「${x.title}」${x.date.slice(5)} 截止`).join('、');
    const reply = [
      ok ? `🔴 已记成 DDL：${list}。日历上那天显示红字，不会自动排时间。` : '',
      dup ? `有 ${dup} 条和现有的 DDL 同名同日，没有重复加。` : '',
      ok ? `要拆成几步提前做，就说「拆一下 ${todo[0].title}」，子任务会排在截止日之前。` : '',
    ]
      .filter(Boolean)
      .join('\n');
    saveHistory([...markPending(history, 'dismissed'), userMsg, { role: 'assistant', content: reply, at: new Date().toISOString() }]);
    setProposal(null);
    setInput('');
    const splitOne = todo.find(x => x.split);
    if (ok && splitOne) {
      const added = allTasks(next.goals).find(r => r.task.title === splitOne.title && r.task.due === splitOne.date);
      if (added) openBreakdown(added.task.id);
    }
    return true;
  };

  const send = async (raw?: string) => {
    // 只发有效的图片（防止空的 data URL 让 AI 报 Unsupported image_url format）
    const pics = raw === undefined ? images.filter(im => /^data:image\/[\w.+-]+;base64,/.test(im.dataUrl)) : [];
    if (raw === undefined && images.length > pics.length) setError(`有 ${images.length - pics.length} 张图片没读出来，已经跳过；可以重新截图再发。`);
    const text = (raw ?? input).trim() || (pics.length ? '这是任务要求的截图，帮我拆成子任务并排进日程。' : '');
    if (!text || loading || !state) return;
    setError('');
    setInput('');
    const q = raw === undefined ? quote : null;
    const userMsg: Msg = {
      role: 'user',
      content: pics.length ? `🖼️ [${pics.length} 张图片] ${text}` : text,
      at: new Date().toISOString(),
      ...(q ? { quote: { at: q.at, text: q.content.replace(/\s+/g, ' ').slice(0, 120) } } : {}),
    };
    if (q) setQuote(null);
    // 引用的原文整段发给 AI（历史里只留一小段）
    const quoteNote = q
      ? `\n\n（我引用了${q.role === 'assistant' ? '你' : '我'}在 ${q.at.slice(0, 10)} 说的这段，请以它为依据来做我这次说的事，比如把细化后的任务放进这个安排里对应的时间段：\n【引用开始】\n${q.content.slice(0, 4000)}\n【引用结束】）`
      : '';
    // # 开头 = DDL：有日期就直接记上，不用等 AI（日历「问 AI」带过来的「关于 某天 这天：#…」用那天）
    if (!pics.length && !q && (await addDdlLocally(text, userMsg))) return;
    if (pics.length) setImages([]);
    // 发新消息时，上一个还没点「应用」的方案不丢：把它勾选的操作并进这次的新方案里
    const carried = proposal ? proposal.actions.filter((_, i) => proposal.enabled[i] && proposal.changes[i]?.ok) : [];
    const h1 = [...markPending(history, 'dismissed'), userMsg];
    saveHistory(h1);
    setLoading(true);
    try {
      const cfg = await getAiConfig();
      if (!cfg.apiKey) throw new Error('还没有配置 AI Key：到「⚙️ 设置 → 🤖 AI」里填入 API Key（可以选 DeepSeek、Kimi、智谱等任一家）。');
      const fresh = await loadPlanState();
      setState(fresh);
      const insights = buildInsights(fresh.timeLogs, fresh.goals, await loadBlockLog(), reasonSummary(await loadReviews()));
      const evs = await loadEvents();
      const today0 = todayStr();
      const upcoming = Array.from({ length: 30 }, (_, k) => addDays(today0, k))
        .flatMap(d => eventsOn(evs, d).map(e => `${d}${e.time ? ' ' + e.time : ''} ${e.title}${e.yearly ? '（每年）' : ''}`));
      const context =
        buildContext(fresh, schedule, new Date(), habitsForAi(insights, fresh.memories ?? [])) +
        `\n\n## 接下来 30 天的重要事件（只是标记，不是任务）\n${upcoming.length ? upcoming.join('\n') : '（没有）'}`;
      const pendingNote = carried.length
        ? `\n\n（注意：上一个方案用户还没点「应用」，系统会把它自动并进这次的方案，里面已有这些操作：${JSON.stringify(carried)}。你只需要输出这次新要求的操作；如果新要求是要改掉或取消上面的某一项，就在 reply 里说明，系统会以你这次的操作为准再追加。）`
        : '';
      const personaTone = chatPersonaPrompt(await loadPersona());
      // 作息限制每次都贴在这句话后面（放在最后，AI 最不容易忽略；也防止它照抄以前的方案）
      const se = fresh.settings;
      const WK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const rulesNote = se
        ? `\n\n（系统提醒，必须遵守：每天只能在 ${minutesToHM(se.dayStartMin)}–${minutesToHM(se.dayEndMin)} 之间安排任务，startTime 不能早于 ${minutesToHM(se.dayStartMin)}；一次最多专注 ${se.maxFocusMin} 分钟、块之间休息 ${se.breakMin} 分钟${se.restDayWeekday !== null && se.restDayWeekday !== undefined ? `；${WK[se.restDayWeekday]}是休息日（用户明确要的除外）` : ''}。如果对话历史里你以前给过不符合这些的方案，这次不要照抄，按这些限制重新排，reply 里写的时间也要符合。）`
        : '';
      const msgs: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT + personaTone },
        { role: 'system', content: `当前数据：\n${context}` },
        ...historyForAi(h1.slice(-9, -1)),
        pics.length
          ? {
              role: 'user',
              content: [
                { type: 'text', text: `${text}${quoteNote}\n\n${IMAGE_PROMPT}${pendingNote}${rulesNote}` },
                ...pics.map(p => ({ type: 'image_url' as const, image_url: { url: p.dataUrl } })),
              ],
            }
          : { role: 'user', content: text + quoteNote + pendingNote + rulesNote },
      ];
      const aiOpts = pics.length ? visionOpts(cfg.visionModel) : undefined;
      let result = normalizeAiResult(await callChatJSON<unknown>(msgs, aiOpts));
      // 回了个空的、或者只回「好的 / 收到」却什么都没做（多半是没听懂）：让它认真理解后再答一次
      const userJustAcks = ACK_RE.test(text.trim());
      for (let attempt = 0; attempt < 2 && !userJustAcks && isHollow(result); attempt++) {
        const empty = !result.reply.trim();
        result = normalizeAiResult(
          await callChatJSON<unknown>(
            [
              ...msgs,
              { role: 'assistant', content: lastJSONRaw.slice(0, 2000) || '{}' },
              {
                role: 'user',
                content: empty
                  ? '你刚才的回复是空的，我看不到任何内容。请重新回答上一条：要改数据就在 actions 里写出操作；觉得不用改，就在 reply 里说明当前数据里对应的是哪一条、在哪天。reply 不能为空。'
                  : `你只回了「${result.reply.trim()}」，但什么都没做，我不知道你理解成了什么。请重新理解我上一条话「${text.slice(0, 300)}」：` +
                    '先按最可能的意思直接给出操作（actions）并在 reply 里说清楚你理解成了什么、做了什么；' +
                    '如果确实有两种以上理解，就在 reply 里列出 2–3 个具体选项问我（比如「你是想 ① 加一个 12/8 截止的 DDL，还是 ② 记进 12/8 的日记？」）。' +
                    '不要只回「好的」「收到」这类话。',
              },
            ],
            aiOpts
          )
        );
      }
      // 回答和以前的某次几乎一模一样（照抄了旧方案，新的限制没管）：去掉对话历史，要求它重新排
      if (result.reply.trim() && sameAsBefore(result.reply, h1)) {
        result = normalizeAiResult(
          await callChatJSON<unknown>(
            [
              msgs[0],
              msgs[1],
              msgs[msgs.length - 1],
              {
                role: 'user',
                content: `（你刚才差点把以前的回答原样又发了一遍。不要参考以前的方案，只按「当前数据」和上面的限制重新安排这件事：${text.slice(0, 300)}）`,
              },
            ],
            aiOpts
          )
        );
      }
      const fresh2 = result.actions.map(a =>
        // 保险：AI 把 DDL / 作业 / 考试这类记成了重要事件 → 改回 DDL 任务
        a.type === 'add_event' && DDL_LIKE.test(String((a as any).title || ''))
          ? ({ type: 'add_task', title: String((a as any).title), due: String((a as any).date), estimateMin: 30, energyCost: 'medium' } as AssistantAction)
          : a
      );
      // 兜底：AI 定的开始时间早于作息，直接改成作息开始的时间，并在回复里说明
      const fixedTimes: string[] = [];
      if (se) {
        const early = (t: unknown) => {
          const m = typeof t === 'string' ? t.match(/^(\d{1,2})[:：](\d{2})$/) : null;
          return m ? Number(m[1]) * 60 + Number(m[2]) < se.dayStartMin : false;
        };
        const startHM = minutesToHM(se.dayStartMin);
        for (const a of fresh2 as any[]) {
          if ((a.type === 'add_task' || a.type === 'update_task' || a.type === 'split_task') && early(a.startTime)) {
            fixedTimes.push(`${a.startTime}`);
            a.startTime = startHM;
          }
          if (a.type === 'split_task' && Array.isArray(a.steps))
            for (const st of a.steps)
              if (early(st.startTime)) {
                fixedTimes.push(`${st.startTime}`);
                st.startTime = startHM;
              }
        }
      }
      // 兜底：AI 自己挑的时间压在固定日程（上课、开会）上，挪到那节课结束之后。
      // 用户这句话里亲口说了这个时间的，照他说的来（他要的就是那个时间）
      {
        const said = (hm: string) => {
          const [h, m] = hm.split(':').map(Number);
          return text.includes(hm) || text.includes(`${h}点${m ? (m === 30 ? '半' : `${m}`) : ''}`) || text.includes(`${h}:${String(m).padStart(2, '0')}`);
        };
        const toMin = (t: string) => {
          const m = t.match(/^(\d{1,2})[:：](\d{2})$/);
          return m ? Number(m[1]) * 60 + Number(m[2]) : null;
        };
        const shift = (date: string | undefined, hm: string | undefined, len: number): string | undefined => {
          if (!date || !hm || said(hm)) return undefined;
          let st = toMin(hm);
          if (st === null) return undefined;
          const wd = new Date(`${date}T12:00:00`).getDay();
          const evs = fresh.fixed.filter(e => (e.date ? e.date === date : e.weekday === wd));
          const orig = st;
          for (let g = 0; g < 10; g++) {
            const hit = evs.find(e => e.startMin < (st as number) + Math.min(len, 90) && e.endMin > (st as number));
            if (!hit) break;
            st = hit.endMin + (se?.breakMin ?? 10);
          }
          if (st === orig) return undefined;
          fixedTimes.push(`${hm}（和固定日程冲突）`);
          return minutesToHM(st);
        };
        for (const a of fresh2 as any[]) {
          if (a.type === 'add_task' || a.type === 'update_task') {
            const n = shift(a.notBefore, a.startTime, Number(a.estimateMin) || 60);
            if (n) a.startTime = n;
          }
          if (a.type === 'split_task' && Array.isArray(a.steps))
            for (const st of a.steps) {
              const n = shift(st.date, st.startTime, Number(st.estimateMin) || 60);
              if (n) st.startTime = n;
            }
        }
      }
      // 去掉和上次方案重复的操作（AI 有时会把上一个方案再写一遍）
      const seen = new Set(carried.map(a => JSON.stringify(a)));
      const actions = [...carried, ...fresh2.filter(a => !seen.has(JSON.stringify(a)))];
      let reply = result.reply.trim() || (actions.length ? '我拟了一个调整方案，请确认。' : '');
      if (reply && fixedTimes.length)
        reply += `\n\n（App 提示：AI 定的 ${[...new Set(fixedTimes)].join('、')} 不符合你的作息或和固定日程撞了，已经自动挪开；具体几点以日历上显示的为准。）`;
      let usedFallback = false;
      if (!reply) {
        usedFallback = true;
        const raw = lastJSONRaw.trim();
        const loose = extractReplyLoosely(raw);
        reply = loose
          ? loose
          : raw && !raw.startsWith('{') && !raw.startsWith('[')
            ? raw.slice(0, 3000)
            : 'AI 这次没给出内容（什么也没改）。换个说法再试一次，比如「ES pre 12/8 截止，加成 DDL」。';
      } else if (!userJustAcks && isHollow({ reply, actions })) {
        usedFallback = true;
        // 重试了还是只有一句「好的」：别假装做了，直接说没听懂，给几个能直接照抄的说法
        reply =
          `我没太理解「${text.slice(0, 40)}${text.length > 40 ? '…' : ''}」想让我做什么，这次什么都没改。你是想：\n` +
          '① 加任务 / DDL：比如「#ES pre 12/8」「明天下午写报告 2 小时」\n' +
          '② 改已有的：比如「把写报告挪到周五」「写报告做完了」\n' +
          '③ 记进日记：比如「记进日记：今天状态不错」\n' +
          '④ 问问题：比如「今天还剩什么」「帮我拆一下期末论文」\n' +
          '换个说法再发一次就行。';
      }
      // 只是写日记：不用确认，直接写进去
      if (actions.length > 0 && actions.every(a => a.type === 'add_diary')) {
        const ok = applyActions(fresh, actions).changes.filter(c => c.ok);
        for (const a of actions as { type: 'add_diary'; text: string; date?: string }[]) {
          if (String(a.text || '').trim()) await appendDiaryText(/^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) ? String(a.date) : todayStr(), String(a.text));
        }
        saveHistory([
          ...h1,
          { role: 'assistant', content: `${reply}\n📔 已写进日记（${ok.length} 条），在「复盘 → 今日记录」的日记簿里能看到。`, at: new Date().toISOString() },
        ]);
        setProposal(null);
        return;
      }
      if (carried.length && fresh2.length) reply += `\n（上一个还没应用的 ${carried.length} 项也一起放进了这个方案。）`;
      // AI 自己写了这句就不再重复加
      reply = reply.replace(/^[ \t]*👉?[ \t]*点下面的「应用」后才会生效。?[ \t]*$/gm, '').trimEnd();
      if (actions.length) reply += '\n👉 点下面的「应用」后才会生效。';
      saveHistory([
        ...h1,
        {
          role: 'assistant',
          content: reply,
          at: new Date().toISOString(),
          ...(actions.length ? { proposal: 'pending' as const } : {}),
          ...(usedFallback ? { raw: lastJSONRaw.slice(0, 4000) } : {}),
        },
      ]);
      if (actions.length > 0) {
        const { changes } = applyActions(fresh, actions);
        setProposal({ reply, actions, changes, enabled: changes.map(c => c.ok) });
      } else {
        setProposal(null);
      }
    } catch (e: any) {
      // 格式实在解析不了：别报错，把 AI 的原话当普通回复显示出来
      if (e instanceof AiFormatError && e.raw.trim()) {
        const h2 = [...h1, { role: 'assistant' as const, content: e.raw.trim().slice(0, 3000), at: new Date().toISOString() }];
        saveHistory(h2);
        setProposal(null);
        return;
      }
      let msg = e instanceof SyntaxError ? 'AI 这次没回好，请再发一次。' : e?.message || String(e);
      if (pics.length && /image|vision|model/i.test(msg)) {
        msg = `看图失败：${msg}。可以到「⚙️ 设置 → 🤖 AI」检查「看图模型」（要选支持图片的模型），或者把图里的要求打成文字发给我。`;
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
      for (const a of preview.chosen) {
        if (a.type === 'add_event' && String(a.title || '').trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(a.date))) {
          await addEvent({ date: String(a.date), title: String(a.title), yearly: !!a.yearly || looksYearly(String(a.title)), time: a.time ? String(a.time) : undefined });
        }
        if (a.type === 'add_diary' && String(a.text || '').trim()) {
          await appendDiaryText(/^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) ? String(a.date) : todayStr(), String(a.text));
        }
      }
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
          onNote={appendNote}
        />
      )}
      <MissedCard missed={missed} onClose={() => setMissed([])} />
      {state && <WeeklyCard state={state} />}
      {state && (
        <EveningCard
          state={state}
          schedule={schedule}
          onChanged={(s, sch) => {
            setState(s);
            setSchedule(sch);
          }}
          onNote={appendNote}
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
                {im.w ? <Text style={styles.thumbSize}>{im.w}×{im.h}</Text> : null}
                <TouchableOpacity style={styles.thumbDel} onPress={() => setImages(prev => prev.filter(x => x.id !== im.id))}>
                  <Text style={styles.thumbDelText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        {quote && (
          <View style={styles.quoteBar}>
            <Text style={styles.quoteBarText} numberOfLines={2}>
              ↪ 引用{quote.role === 'assistant' ? ' AI ' : '我'}的话：{quote.content.replace(/\s+/g, ' ').slice(0, 120)}
            </Text>
            <TouchableOpacity onPress={() => setQuote(null)}>
              <Text style={styles.quoteBarX}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {!quote && !input.trim() && images.length === 0 && !loading && (
          <View style={styles.ideaRow}>
            <Text style={styles.ideaLabel}>也可以这样问：</Text>
            {IDEAS.map(q => (
              <TouchableOpacity key={q} style={styles.ideaChip} onPress={() => setInput(q)}>
                <Text style={styles.ideaText}>{q}</Text>
              </TouchableOpacity>
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
          onNote={appendNote}
        />
      )}

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* 对话 */}
      <ChatThread
        history={history}
        loading={loading}
        onQuote={m => {
          setQuote(m);
          setTimeout(() => window.dispatchEvent(new Event(FOCUS_ASSISTANT_EVENT)), 30);
        }}
        onDiary={async m => {
          const d = new Date(m.at);
          const day = isNaN(d.getTime()) ? todayStr() : toDateStr(d);
          await appendDiaryText(day, m.content);
          return `📔 已记进 ${day.slice(5)} 的日记（复盘 → 今日记录 → 日记簿）`;
        }}
        onClear={() => saveHistory([])}
        onDelete={m => saveHistory(history.filter(x => !(x.at === m.at && x.role === m.role && x.content === m.content)))}
      />

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
  quoteBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F1F6FD', borderLeftWidth: 3, borderLeftColor: '#64B5F6', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 8 },
  quoteBarText: { flex: 1, fontSize: 12, color: '#546E7A', lineHeight: 17 },
  quoteBarX: { fontSize: 13, color: '#90A4AE', paddingHorizontal: 4 },
  ideaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 8 },
  ideaLabel: { fontSize: 12, color: '#90A4AE' },
  ideaChip: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#F7F9FC' },
  ideaText: { fontSize: 12, color: '#546E7A' },
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
  thumbSize: { position: 'absolute', left: 0, right: 0, bottom: 0, fontSize: 9, color: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', textAlign: 'center' },
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
