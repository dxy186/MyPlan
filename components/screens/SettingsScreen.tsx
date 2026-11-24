/**
 * ⚙️ 设置：AI、作息与排程、提醒、数据备份。全应用共用这一份设置。
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { callChat, getAiConfig, saveAiConfig } from '@/app/utils/ai';
import { hmToMinutes, minutesToHM } from '@/app/utils/planning';
import {
  ReminderSettings,
  loadReminderSettings,
  notificationSupported,
  requestNotificationPermission,
  saveReminderSettings,
} from '@/components/assistant/followup';
import { commitState, loadPlanState } from '@/components/assistant/plan-store';
import { PERSONAS, PersonaSetting, loadPersona, personaLabel, samplePersona, savePersona } from '@/components/assistant/coach';
import BackupScreen from '@/components/backup/BackupScreen';
import { DEFAULT_SETTINGS, ScheduleSettings, loadScheduleSettings, saveScheduleSettings } from '@/components/data/settings';
import SubTabBar from '@/components/secretary/SubTabBar';
import QuickSyntaxGuide from '@/components/data/QuickSyntaxGuide';
import CheerImagesCard from './CheerImagesCard';

const TABS = [
  { key: 'schedule', label: '🕘 作息与排程' },
  { key: 'ai', label: '🤖 AI' },
  { key: 'reminder', label: '🔔 提醒' },
  { key: 'backup', label: '💾 数据备份' },
  { key: 'help', label: '📖 说明' },
];
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DOC_URL = 'https://github.com/dxy186/MyPlan/blob/main/docs/AI%E7%A7%91%E5%AD%A6%E8%AE%A1%E5%88%92%E7%A7%98%E4%B9%A6-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.fieldBody}>
        {children}
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function ScheduleSettingsPanel() {
  const [s, setS] = useState<ScheduleSettings | null>(null);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    loadScheduleSettings().then(x => {
      setS(x);
      setStart(minutesToHM(x.dayStartMin));
      setEnd(minutesToHM(x.dayEndMin));
    });
  }, []);
  if (!s) return <ActivityIndicator />;
  const num = (v: string) => Math.max(0, Number(v.replace(/[^0-9]/g, '')) || 0);
  const hmOk = (v: string) => /^\d{1,2}:\d{2}$/.test(v.trim());
  const valid = hmOk(start) && hmOk(end) && hmToMinutes(end) > hmToMinutes(start) && s.maxFocusMin >= 15;

  const save = async () => {
    const next: ScheduleSettings = { ...s, dayStartMin: hmToMinutes(start), dayEndMin: hmToMinutes(end) };
    await saveScheduleSettings(next);
    const st = await loadPlanState();
    await commitState(st);
    setS(next);
    setMsg('✅ 已保存，并按新的作息从现在起重新排程');
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🕘 作息与排程</Text>
        <Text style={styles.muted}>今天页、AI、日历、提醒全都按这里的设置排。</Text>
        <Field label="一天从" hint="早于这个时间不排任务">
          <TextInput style={[styles.input, styles.short]} value={start} onChangeText={setStart} placeholder="08:00" />
        </Field>
        <Field label="一天到" hint="晚于这个时间不排任务">
          <TextInput style={[styles.input, styles.short]} value={end} onChangeText={setEnd} placeholder="23:00" />
        </Field>
        <Field label="每天玩的时间" hint="排在一天最后，不会被任务占用；0 = 不留">
          <TextInput
            style={[styles.input, styles.short]}
            value={String(s.playMinPerDay)}
            onChangeText={v => setS({ ...s, playMinPerDay: num(v) })}
            keyboardType="number-pad"
          />
          <Text style={styles.unit}>分钟</Text>
        </Field>
        <Field label="每周休息日" hint="这一天不排任务">
          <View style={styles.chips}>
            <TouchableOpacity style={[styles.chip, s.restDayWeekday === null && styles.chipOn]} onPress={() => setS({ ...s, restDayWeekday: null })}>
              <Text style={[styles.chipText, s.restDayWeekday === null && styles.chipTextOn]}>不设</Text>
            </TouchableOpacity>
            {WEEK.map((w, i) => (
              <TouchableOpacity key={w} style={[styles.chip, s.restDayWeekday === i && styles.chipOn]} onPress={() => setS({ ...s, restDayWeekday: i })}>
                <Text style={[styles.chipText, s.restDayWeekday === i && styles.chipTextOn]}>{w}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Field>
        <Field label="一次最多专注" hint="大任务会被切成不超过这么长的块">
          <TextInput style={[styles.input, styles.short]} value={String(s.maxFocusMin)} onChangeText={v => setS({ ...s, maxFocusMin: num(v) })} keyboardType="number-pad" />
          <Text style={styles.unit}>分钟</Text>
        </Field>
        <Field label="一次至少" hint="比这短的空档，自动排程不放任务（「我现在有空」仍可用）">
          <TextInput style={[styles.input, styles.short]} value={String(s.minFocusMin)} onChangeText={v => setS({ ...s, minFocusMin: num(v) })} keyboardType="number-pad" />
          <Text style={styles.unit}>分钟</Text>
        </Field>
        <Field label="块之间休息">
          <TextInput style={[styles.input, styles.short]} value={String(s.breakMin)} onChangeText={v => setS({ ...s, breakMin: num(v) })} keyboardType="number-pad" />
          <Text style={styles.unit}>分钟</Text>
        </Field>
        <Field label="往后排几天">
          <TextInput style={[styles.input, styles.short]} value={String(s.days)} onChangeText={v => setS({ ...s, days: Math.min(60, Math.max(1, num(v))) })} keyboardType="number-pad" />
          <Text style={styles.unit}>天</Text>
        </Field>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, !valid && styles.disabled]} disabled={!valid} onPress={save}>
            <Text style={styles.btnText}>保存并重新排程</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnGhost}
            onPress={() => {
              setS(DEFAULT_SETTINGS);
              setStart(minutesToHM(DEFAULT_SETTINGS.dayStartMin));
              setEnd(minutesToHM(DEFAULT_SETTINGS.dayEndMin));
            }}
          >
            <Text style={styles.btnGhostText}>恢复默认</Text>
          </TouchableOpacity>
        </View>
        {msg ? <Text style={styles.ok}>{msg}</Text> : null}
        <Text style={styles.muted}>课程、会议这类固定时间，在「📅 日历」里点某一天添加，或直接跟 AI 说。</Text>
      </View>
    </ScrollView>
  );
}

function AiSettingsPanel() {
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    getAiConfig().then(c => {
      setKey(c.apiKey);
      setModel(c.model);
      setVisionModel(c.visionModel || 'deepseek-flash');
    });
  }, []);
  const save = async () => {
    await saveAiConfig({ apiKey: key.trim(), model: model.trim() || 'deepseek-chat', visionModel: visionModel.trim() || 'deepseek-flash' });
    setMsg('✅ 已保存');
  };
  const test = async () => {
    setTesting(true);
    setMsg('');
    try {
      await saveAiConfig({ apiKey: key.trim(), model: model.trim() || 'deepseek-chat', visionModel: visionModel.trim() || 'deepseek-flash' });
      const r = await callChat([{ role: 'user', content: '只回复两个字：可以' }]);
      setMsg(`✅ 连接成功，AI 回复：${String(r).slice(0, 30)}`);
    } catch (e: any) {
      setMsg('❌ 连接失败：' + (e?.message || e));
    } finally {
      setTesting(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🤖 AI 设置</Text>
        <Text style={styles.muted}>「🏠 今天」里的 AI 和「目标拆解」都用这里的 Key。Key 只保存在这台电脑上。</Text>
        <Field label="DeepSeek API Key" hint="在 platform.deepseek.com 申请">
          <TextInput
            style={[styles.input, { flex: 1, minWidth: 260 }]}
            value={key}
            onChangeText={setKey}
            secureTextEntry={!show}
            placeholder="sk-..."
            placeholderTextColor="#aaa"
          />
          <TouchableOpacity onPress={() => setShow(!show)}>
            <Text style={styles.link}>{show ? '隐藏' : '显示'}</Text>
          </TouchableOpacity>
        </Field>
        <Field label="模型">
          <TextInput style={[styles.input, { width: 200 }]} value={model} onChangeText={setModel} placeholder="deepseek-chat" placeholderTextColor="#aaa" />
        </Field>
        <Field label="看图模型" hint="给 AI 发截图时用，要支持图片输入；DeepSeek 用 deepseek-flash">
          <TextInput style={[styles.input, { width: 200 }]} value={visionModel} onChangeText={setVisionModel} placeholder="deepseek-flash" placeholderTextColor="#aaa" />
        </Field>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={save}>
            <Text style={styles.btnText}>保存</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btnGhost, testing && styles.disabled]} disabled={testing || !key.trim()} onPress={test}>
            <Text style={styles.btnGhostText}>{testing ? '测试中…' : '测试连接'}</Text>
          </TouchableOpacity>
        </View>
        {msg ? <Text style={msg.startsWith('❌') ? styles.err : styles.ok}>{msg}</Text> : null}
      </View>
      <PersonaCard />
    </ScrollView>
  );
}

/** 每晚复盘点评、每周小结用什么语气 */
function PersonaCard() {
  const [p, setP] = useState<PersonaSetting | null>(null);
  const [sample, setSample] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadPersona().then(setP);
  }, []);
  if (!p) return null;
  const pick = async (next: PersonaSetting) => {
    setP(next);
    setSample('');
    await savePersona(next);
  };
  const tryOne = async () => {
    setBusy(true);
    setSample('');
    const r = await samplePersona(p);
    setBusy(false);
    setSample(r ? `${personaLabel(p)}：${r}` : '❌ 没拿到回复：先在上面填好 AI Key 并测试连接');
  };
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>🎭 点评的语气</Text>
      <Text style={styles.muted}>晚上复盘后的点评、每周小结都用这个语气写。只改说话风格，数字和建议照旧按你的真实数据来。</Text>
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8 }]}>
        {(Object.keys(PERSONAS) as (keyof typeof PERSONAS)[]).map(id => (
          <TouchableOpacity key={id} style={[styles.chip, p.id === id && styles.chipOn]} onPress={() => pick({ ...p, id })}>
            <Text style={[styles.chipText, p.id === id && styles.chipTextOn]}>
              {PERSONAS[id].icon} {PERSONAS[id].name}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.chip, p.id === 'custom' && styles.chipOn]} onPress={() => pick({ ...p, id: 'custom' })}>
          <Text style={[styles.chipText, p.id === 'custom' && styles.chipTextOn]}>✏️ 自定义</Text>
        </TouchableOpacity>
      </View>
      {p.id !== 'custom' ? (
        <Text style={[styles.muted, { marginTop: 6 }]}>{PERSONAS[p.id].desc}</Text>
      ) : (
        <>
          <Field label="显示的名字">
            <TextInput
              style={[styles.input, { width: 200 }]}
              value={p.customName ?? ''}
              onChangeText={v => setP({ ...p, customName: v })}
              onBlur={() => savePersona(p)}
              placeholder="比如：学姐"
              placeholderTextColor="#aaa"
            />
          </Field>
          <TextInput
            style={[styles.input, { minHeight: 90, textAlignVertical: 'top', marginTop: 6 }]}
            multiline
            value={p.custom ?? ''}
            onChangeText={v => setP({ ...p, custom: v })}
            onBlur={() => savePersona(p)}
            placeholder="描述你想要的说话风格，比如：像一个毒舌但心软的学姐，先吐槽一句再认真鼓励…"
            placeholderTextColor="#aaa"
          />
        </>
      )}
      <View style={[styles.row, { marginTop: 8 }]}>
        <TouchableOpacity style={[styles.btnGhost, busy && styles.disabled]} disabled={busy} onPress={tryOne}>
          <Text style={styles.btnGhostText}>{busy ? '正在想…' : '🎧 试一句看看'}</Text>
        </TouchableOpacity>
      </View>
      {sample ? <Text style={[styles.muted, { marginTop: 6, color: sample.startsWith('❌') ? '#C62828' : '#1a1a2e', lineHeight: 20 }]}>{sample}</Text> : null}
    </View>
  );
}

function ReminderPanel() {
  const [r, setR] = useState<ReminderSettings | null>(null);
  const [reviewAt, setReviewAt] = useState('');
  const [morningAt, setMorningAt] = useState('');
  const [msg, setMsg] = useState('');
  const perm = notificationSupported() ? Notification.permission : 'unsupported';
  useEffect(() => {
    loadReminderSettings().then(x => {
      setR(x);
      setReviewAt(minutesToHM(x.eveningReviewAt));
      setMorningAt(x.morningAt === null ? '' : minutesToHM(x.morningAt));
    });
  }, []);
  if (!r) return <ActivityIndicator />;
  const save = async (next: ReminderSettings) => {
    if (next.enabled && !r.enabled) await requestNotificationPermission();
    await saveReminderSettings(next);
    setR(next);
    setMsg('✅ 已保存');
  };
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔔 提醒</Text>
        <Field label="到点提醒">
          <TouchableOpacity style={[styles.chip, r.enabled && styles.chipOn]} onPress={() => save({ ...r, enabled: !r.enabled })}>
            <Text style={[styles.chipText, r.enabled && styles.chipTextOn]}>{r.enabled ? '已开启' : '已关闭'}</Text>
          </TouchableOpacity>
        </Field>
        <Text style={styles.muted}>
          {perm === 'granted'
            ? '系统通知可用：到点会弹系统通知，页面右上角也会提示。'
            : '这里不能弹系统通知（比如在 Claude 内置浏览器里），会改用页面内提醒：右上角提示 + 提示音 + 标签页标题闪烁，需要 MyPlan 开着。'}
        </Text>
        <Field label="任务提前几分钟提醒">
          <TextInput
            style={[styles.input, styles.short]}
            value={String(r.leadMin)}
            onChangeText={v => setR({ ...r, leadMin: Math.min(30, Number(v.replace(/[^0-9]/g, '')) || 0) })}
            keyboardType="number-pad"
          />
          <Text style={styles.unit}>分钟</Text>
        </Field>
        <Field label="早上提醒时间" hint="提醒你今天有几件事、第一件几点开始；点开直接打开日历里的今天。留空 = 不提醒">
          <TextInput style={[styles.input, styles.short]} value={morningAt} onChangeText={setMorningAt} placeholder="8:30" />
        </Field>
        <Field label="晚上复盘时间" hint="到这个时间提醒复盘，今天页也从这时起显示复盘卡片">
          <TextInput style={[styles.input, styles.short]} value={reviewAt} onChangeText={setReviewAt} placeholder="21:00" />
        </Field>
        <TouchableOpacity
          style={[styles.btn, (!/^\d{1,2}:\d{2}$/.test(reviewAt) || !/^(\d{1,2}:\d{2})?$/.test(morningAt.trim())) && styles.disabled]}
          disabled={!/^\d{1,2}:\d{2}$/.test(reviewAt) || !/^(\d{1,2}:\d{2})?$/.test(morningAt.trim())}
          onPress={() =>
            save({ ...r, eveningReviewAt: hmToMinutes(reviewAt), morningAt: morningAt.trim() ? hmToMinutes(morningAt.trim()) : null })
          }
        >
          <Text style={styles.btnText}>保存</Text>
        </TouchableOpacity>
        {msg ? <Text style={styles.ok}>{msg}</Text> : null}
      </View>
      <CheerImagesCard />
    </ScrollView>
  );
}

function HelpPanel() {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📖 MyPlan 怎么用</Text>
        {[
          '🏠 今天：每天的主页。看正在做什么、下一项；跟 AI 说要做什么、做完了什么（它会直接改计划，确认后生效）；有空时点「我现在有空」；早上确认计划、晚上复盘。',
          '📋 任务：所有任务都在这里，按目标分组。可以勾完成、改时长和耗能、设开始时间、优先级（彩色圆点）和分类，点 ▶ 计时、🧩 让 AI 拆成子任务；还有固定日程、任务池导入、WOOP。',
          '📅 日历（默认首页）：双击某天打开「我的事项」：快捷添加（写法见下面）、看每项排在几点、▶ 开始、完整时间轴、晚上一键顺延。DDL 红字、固定日程绿字、做完的灰色划线沉底。',
          '📊 复盘：最近 7 天的数据、勋章、时间记录、精力、已完成的任务、习惯档案。',
          '⚙️ 设置：作息时间、AI Key、提醒、数据备份。',
          '所有页面用的是同一份数据：在任何地方改了任务，排程都会从现在起自动重排。',
          '快捷键：任何页面按 Ctrl+K 回到「今天」并开始跟 AI 说话。',
        ].map(t => (
          <Text key={t} style={styles.helpLine}>
            {t}
          </Text>
        ))}
        <TouchableOpacity onPress={() => Linking.openURL(DOC_URL)}>
          <Text style={styles.link}>查看完整使用说明 ↗</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.card}>
        <QuickSyntaxGuide />
      </View>
    </ScrollView>
  );
}

export default function SettingsScreen() {
  const [tab, setTab] = useState('schedule');
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.title}>⚙️ 设置</Text>
      <SubTabBar tabs={TABS} active={tab} onChange={setTab} />
      <View style={{ flex: 1 }}>
        {tab === 'schedule' ? (
          <ScheduleSettingsPanel />
        ) : tab === 'ai' ? (
          <AiSettingsPanel />
        ) : tab === 'reminder' ? (
          <ReminderPanel />
        ) : tab === 'backup' ? (
          <BackupScreen />
        ) : (
          <HelpPanel />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#E5E9F0', padding: 16, maxWidth: 760, marginBottom: 12 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
  muted: { fontSize: 13, color: '#888', lineHeight: 19, marginVertical: 6 },
  field: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 6, flexWrap: 'wrap' },
  label: { width: 130, fontSize: 14, color: '#333', paddingTop: 7 },
  fieldBody: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 240 },
  hint: { fontSize: 12, color: '#9AA4B2', marginLeft: 8, flexShrink: 1 },
  input: { borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, fontSize: 14, backgroundColor: '#fff', marginRight: 6 },
  short: { width: 80, textAlign: 'center' },
  unit: { fontSize: 13, color: '#666' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10, marginRight: 6, marginBottom: 4, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  chipText: { fontSize: 13, color: '#455A64' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 16, marginRight: 10, alignSelf: 'flex-start', marginTop: 6 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnGhost: { paddingVertical: 9, paddingHorizontal: 12, marginTop: 6 },
  btnGhostText: { color: '#1976D2', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  link: { color: '#1976D2', fontSize: 14, marginLeft: 8, marginTop: 6 },
  ok: { color: '#2E7D32', fontSize: 14, marginTop: 8 },
  err: { color: '#C62828', fontSize: 14, marginTop: 8 },
  helpLine: { fontSize: 14, color: '#333', lineHeight: 22, marginBottom: 8 },
});
