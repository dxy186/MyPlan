/**
 * 板块二：目标设定与可行性分析（SMART + WOOP + TELOS + 难度星级）
 * 板块三：智能拆解引擎（HTA + MECE + 执行意向 + 依赖 + 瓶颈）
 *
 * 拆解支持两种方式：
 *  1) 本地模板拆解（离线，立刻可用）
 *  2) AI 深度拆解（调用 AI 智能体层，输出结构化 JSON）
 * 结果可一键写入「SMART 任务记录」，与原有功能无缝衔接。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { callChatJSON } from '@/app/utils/ai';
import {
  DECOMPOSE_STRATEGIES,
  EnergyCost,
  Goal,
  KEYS,
  Milestone,
  PlanTask,
  checkMECE,
  diffDays,
  isPhysicalAction,
  loadJSON,
  randomId,
  saveJSON,
  todayStr,
} from '@/app/utils/planning';

type MilestoneDraft = Milestone;

const COSTS: { key: EnergyCost; label: string; color: string }[] = [
  { key: 'high', label: '高耗能', color: '#E64A19' },
  { key: 'medium', label: '中耗能', color: '#F2A900' },
  { key: 'low', label: '低耗能', color: '#43A047' },
];

function buildLocalMilestones(goal: string, strategy: string): MilestoneDraft[] {
  const title = goal.trim() || '目标';
  const mk = (name: string, basis: string, outcome: string, tasks: string[]): MilestoneDraft => ({
    id: randomId(),
    title: name,
    basis,
    outcome,
    tasks: tasks.map(t => ({
      id: randomId(),
      title: t,
      estimateMin: 60,
      energyCost: 'medium' as EnergyCost,
      deps: [],
      done: false,
      createdAt: new Date().toISOString(),
    })),
  });

  if (strategy === '时间递进型') {
    return [
      mk('第 1 阶段：启动与信息收集', '按时间递进，先降低启动摩擦', '明确范围与资料', [
        `打开文档写下「${title}」的目标与标准`,
        `收集与「${title}」相关的资料并列出清单`,
        '整理资料归类，标注待解决问题',
      ]),
      mk('第 2 阶段：主体推进', '时间中段集中攻克关键瓶颈', '完成核心产出', [
        `写出「${title}」的核心框架/大纲`,
        '完成最关键的一个模块',
        '自测并记录问题清单',
      ]),
      mk('第 3 阶段：精加工', '留出改进空间', '产出达到可用质量', [
        '按问题清单逐条修正',
        '补充案例/数据/引用',
        '请他人或 AI 给出反馈',
      ]),
      mk('第 4 阶段：收尾与缓冲', '关键链末端预留缓冲', '按时交付', [
        '通读全文检查一致性',
        '导出/打包最终版本',
        '提交并在日历标记完成',
      ]),
    ];
  }
  if (strategy === '功能分解型') {
    return [
      mk('模块 A：输入与准备', '功能独立，先备料', '所需素材齐备', [
        '列出本目标需要的全部输入材料',
        '下载/打印缺失材料',
        '把材料放进统一目录',
      ]),
      mk('模块 B：核心处理', '价值最高的功能模块优先', '核心功能跑通', [
        `搭建「${title}」的主体结构`,
        '实现/撰写最核心的部分',
        '用一个样例验证结果',
      ]),
      mk('模块 C：输出与呈现', '对外可见的成果', '成果可展示', [
        '整理输出格式',
        '撰写说明/摘要',
        '生成最终文件',
      ]),
      mk('模块 D：校验与交付', '确保不返工', '交付无阻断问题', [
        '按清单逐项自检',
        '检查文件命名与路径',
        '提交并记录耗时',
      ]),
    ];
  }
  if (strategy === '混合型') {
    const a = buildLocalMilestones(goal, '时间递进型');
    const b = buildLocalMilestones(goal, '功能分解型');
    return [a[0], b[1], a[2], b[3]];
  }
  // 里程碑型（默认）
  return [
    mk('里程碑 1：明确边界', '先定义完成标准，避免返工', '清晰的范围与验收标准', [
      `写下「${title}」的完成标准（可衡量）`,
      '列出必须做与可以不做的事',
      '确认截止时间与可用总时长',
    ]),
    mk('里程碑 2：打通最小可行版本', '瓶颈优先', '一个能跑通的最小版本', [
      '做出最小可行版本（哪怕粗糙）',
      '记录卡住的地方',
      '针对卡点查资料/求助',
    ]),
    mk('里程碑 3：迭代完善', '资源理性，逐步加码', '质量达到预期', [
      '按卡点清单逐项解决',
      '补充细节与完善表达',
      '做一次完整演练/自测',
    ]),
    mk('里程碑 4：缓冲与交付', '关键链末端缓冲', '按时高质量交付', [
      '留出缓冲日处理意外',
      '最终检查并导出',
      '提交并更新进度',
    ]),
  ];
}

export default function DecomposePanel() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState('');
  const [specific, setSpecific] = useState('');
  const [measurable, setMeasurable] = useState('');
  const [achievable, setAchievable] = useState('');
  const [relevant, setRelevant] = useState('');
  const [due, setDue] = useState('');
  const [strategy, setStrategy] = useState<string>(DECOMPOSE_STRATEGIES[2]);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4>(2);
  const [woopWish, setWoopWish] = useState('');
  const [woopOutcome, setWoopOutcome] = useState('');
  const [woopObstacle, setWoopObstacle] = useState('');
  const [woopPlan, setWoopPlan] = useState('');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    (async () => setGoals(await loadJSON<Goal[]>(KEYS.goals, [])))();
  }, []);

  const totalMin = useMemo(
    () => milestones.reduce((s, m) => s + m.tasks.reduce((a, t) => a + t.estimateMin, 0), 0),
    [milestones]
  );

  // ---------- TELOS 可行性 ----------
  const feasibility = useMemo(() => {
    const days = due ? Math.max(1, diffDays(todayStr(), due)) : 14;
    const available = days * 180 * 0.75; // 每天约 3 小时可支配，留 25% 缓冲
    const load = totalMin > 0 ? totalMin / available : 0.4;
    const timeScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, load - 0.5) * 120)));
    const opsScore = milestones.length === 0 ? 85 : Math.max(40, 100 - Math.abs(milestones.length - 4) * 8);
    const techScore = 80;
    const costScore = 85;
    const legalScore = 100;
    const score = Math.round(
      timeScore * 0.4 + opsScore * 0.2 + techScore * 0.15 + costScore * 0.15 + legalScore * 0.1
    );
    return {
      score,
      breakdown: [
        ['时间 T', timeScore, `${days} 天，预计总耗时 ${(totalMin / 60).toFixed(1)}h`],
        ['操作 O', opsScore, `里程碑 ${milestones.length} 个`],
        ['技术 E', techScore, '取决于你现有技能'],
        ['经济 C', costScore, '默认无额外大额支出'],
        ['法律 L', legalScore, '默认合规'],
      ] as [string, number, string][],
    };
  }, [due, totalMin, milestones.length]);

  const meceIssues = useMemo(() => checkMECE(milestones), [milestones]);

  // ---------- 本地拆解 ----------
  const handleLocalDecompose = () => {
    if (!title.trim()) {
      setMessage('先填写目标标题');
      return;
    }
    setMilestones(buildLocalMilestones(title, strategy));
    setMessage(`已按「${strategy}」拆出里程碑，可继续编辑。`);
  };

  // ---------- AI 拆解 ----------
  const handleAiDecompose = async () => {
    if (!title.trim()) {
      setMessage('先填写目标标题');
      return;
    }
    setAiLoading(true);
    setMessage('AI 正在拆解…');
    try {
      const prompt = `你是科学任务拆解专家。请把下面的目标拆解为层级任务树，严格输出 JSON（不要多余文字）。
目标(特定S)：${title}
衡量标准(M)：${measurable || '未填写'}
可行性说明(A)：${achievable || '未填写'}
相关性(R)：${relevant || '未填写'}
截止时间(T)：${due || '未填写'}
策略：${strategy}

JSON 结构：
{"milestones":[{"title":"里程碑名","outcome":"预期成果","basis":"拆解依据","tasks":[{"title":"物理动作(以动词开头)","estimateMin":60,"energyCost":"high|medium|low","intention":{"triggerIf":"障碍情境","actionThen":"具体行动"}}]}]}
要求：3-5 个里程碑，每个里程碑 3-7 个任务；任务必须是物理动作；标注耗能等级。`;
      const data = await callChatJSON<{ milestones: any[] }>([
        { role: 'system', content: '你是结构化输出助手，只输出合法 JSON。' },
        { role: 'user', content: prompt },
      ]);
      const parsed: MilestoneDraft[] = (data.milestones || []).map(m => ({
        id: randomId(),
        title: String(m.title || '未命名里程碑'),
        outcome: m.outcome ? String(m.outcome) : undefined,
        basis: m.basis ? String(m.basis) : undefined,
        tasks: (m.tasks || []).map((t: any) => ({
          id: randomId(),
          title: String(t.title || '未命名任务'),
          estimateMin: Number(t.estimateMin) > 0 ? Number(t.estimateMin) : 60,
          energyCost: (['high', 'medium', 'low'].includes(t.energyCost) ? t.energyCost : 'medium') as EnergyCost,
          deps: [],
          done: false,
          intention:
            t.intention && (t.intention.triggerIf || t.intention.actionThen)
              ? { triggerIf: String(t.intention.triggerIf || ''), actionThen: String(t.intention.actionThen || '') }
              : undefined,
          createdAt: new Date().toISOString(),
        })),
      }));
      if (parsed.length === 0) throw new Error('AI 没有返回有效里程碑');
      setMilestones(parsed);
      setMessage('AI 拆解完成，请检查 MECE 与物理动作。');
    } catch (e: any) {
      setMessage(`AI 拆解失败：${e?.message || '未知错误'}，可先用本地拆解。`);
    } finally {
      setAiLoading(false);
    }
  };

  // ---------- 编辑里程碑 / 任务 ----------
  const addTask = (milestoneId: string) => {
    const text = (taskInputs[milestoneId] || '').trim();
    if (!text) return;
    setMilestones(prev =>
      prev.map(m =>
        m.id === milestoneId
          ? {
              ...m,
              tasks: [
                ...m.tasks,
                {
                  id: randomId(),
                  title: text,
                  estimateMin: 60,
                  energyCost: 'medium',
                  deps: [],
                  done: false,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : m
      )
    );
    setTaskInputs({ ...taskInputs, [milestoneId]: '' });
  };

  const updateTask = (milestoneId: string, taskId: string, patch: Partial<PlanTask>) => {
    setMilestones(prev =>
      prev.map(m =>
        m.id === milestoneId
          ? { ...m, tasks: m.tasks.map(t => (t.id === taskId ? { ...t, ...patch } : t)) }
          : m
      )
    );
  };

  const removeTask = (milestoneId: string, taskId: string) => {
    setMilestones(prev =>
      prev.map(m => (m.id === milestoneId ? { ...m, tasks: m.tasks.filter(t => t.id !== taskId) } : m))
    );
  };

  const removeMilestone = (milestoneId: string) => {
    setMilestones(prev => prev.filter(m => m.id !== milestoneId));
  };

  // ---------- 保存目标 ----------
  const handleSaveGoal = async () => {
    if (!title.trim()) {
      setMessage('先填写目标标题');
      return;
    }
    const goal: Goal = {
      id: randomId(),
      title: title.trim(),
      specific: specific.trim(),
      measurable: measurable.trim(),
      achievable: achievable.trim(),
      relevant: relevant.trim(),
      due: due.trim(),
      feasibility: feasibility.score,
      difficulty,
      strategy,
      woop:
        woopWish || woopOutcome || woopObstacle || woopPlan
          ? { wish: woopWish, outcome: woopOutcome, obstacle: woopObstacle, plan: woopPlan }
          : undefined,
      milestones,
      createdAt: new Date().toISOString(),
    };
    await saveJSON(KEYS.goals, [goal, ...goals]);
    setGoals([goal, ...goals]);
    setMessage('目标已保存（可去「双轨排程」生成日程）');
  };

  // ---------- 写入 SMART 任务记录（与原功能桥接） ----------
  const handlePushToTasks = async () => {
    if (milestones.length === 0) {
      setMessage('先完成拆解');
      return;
    }
    const raw = await AsyncStorage.getItem(KEYS.tasks);
    const tasks: any[] = raw ? JSON.parse(raw) : [];
    const now = new Date().toISOString();
    for (const m of milestones) {
      tasks.push({
        id: randomId(),
        title: `${title.trim()} · ${m.title}`,
        dueDate: due.trim() || todayStr(),
        quadrant: 'important_not_urgent',
        subtasks: m.tasks.map(t => ({ id: t.id, title: t.title, completed: false })),
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
        specific: m.outcome || '',
        measurable,
        relevant,
      });
    }
    await AsyncStorage.setItem(KEYS.tasks, JSON.stringify(tasks));
    setMessage(`已把 ${milestones.length} 个里程碑写入 SMART 任务记录`);
  };

  const handleDeleteGoal = async (id: string) => {
    const next = goals.filter(g => g.id !== id);
    setGoals(next);
    await saveJSON(KEYS.goals, next);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>🧩 目标拆解 · SMART / WOOP / HTA</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {/* 目标设定 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>1. 目标设定（SMART）</Text>
        <Text style={styles.label}>目标标题 (S) *</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="例：12月20日前完成机器学习项目" placeholderTextColor="#aaa" />
        <Text style={styles.label}>衡量标准 (M)</Text>
        <TextInput style={styles.input} value={measurable} onChangeText={setMeasurable} placeholder="如何算完成？" placeholderTextColor="#aaa" />
        <Text style={styles.label}>可行性说明 (A)</Text>
        <TextInput style={styles.input} value={achievable} onChangeText={setAchievable} placeholder="为什么做得到？" placeholderTextColor="#aaa" />
        <Text style={styles.label}>相关性 (R)</Text>
        <TextInput style={styles.input} value={relevant} onChangeText={setRelevant} placeholder="与长期目标的关系" placeholderTextColor="#aaa" />
        <Text style={styles.label}>截止时间 (T)</Text>
        <TextInput style={styles.input} value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" placeholderTextColor="#aaa" />

        <Text style={styles.label}>拆解策略</Text>
        <View style={styles.chipWrap}>
          {DECOMPOSE_STRATEGIES.map(s => (
            <TouchableOpacity key={s} style={[styles.chip, strategy === s && styles.chipActive]} onPress={() => setStrategy(s)}>
              <Text style={[styles.chipText, strategy === s && styles.chipTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>难度星级</Text>
        <View style={styles.chipWrap}>
          {([1, 2, 3, 4] as const).map(d => (
            <TouchableOpacity key={d} style={[styles.chip, difficulty === d && styles.chipActive]} onPress={() => setDifficulty(d)}>
              <Text style={[styles.chipText, difficulty === d && styles.chipTextActive]}>{'⭐'.repeat(d)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* WOOP */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>2. WOOP 障碍预判（可空）</Text>
        <TextInput style={styles.input} value={woopWish} onChangeText={setWoopWish} placeholder="W 愿望" placeholderTextColor="#aaa" />
        <View style={{ height: 8 }} />
        <TextInput style={styles.input} value={woopOutcome} onChangeText={setWoopOutcome} placeholder="O 最佳结果" placeholderTextColor="#aaa" />
        <View style={{ height: 8 }} />
        <TextInput style={styles.input} value={woopObstacle} onChangeText={setWoopObstacle} placeholder="O 核心障碍" placeholderTextColor="#aaa" />
        <View style={{ height: 8 }} />
        <TextInput style={styles.input} value={woopPlan} onChangeText={setWoopPlan} placeholder="P 如果[障碍]，那么我就……" placeholderTextColor="#aaa" />
      </View>

      {/* 拆解按钮 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>3. 智能拆解</Text>
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleLocalDecompose}>
            <Text style={styles.primaryBtnText}>本地拆解（离线）</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, styles.aiBtn]} onPress={handleAiDecompose} disabled={aiLoading}>
            <Text style={styles.primaryBtnText}>{aiLoading ? 'AI 拆解中…' : 'AI 深度拆解'}</Text>
          </TouchableOpacity>
        </View>
        {aiLoading && <ActivityIndicator color="#1976D2" style={{ marginTop: 10 }} />}
        <Text style={styles.subText}>总预估耗时：{(totalMin / 60).toFixed(1)} 小时 · 里程碑 {milestones.length} 个 · 任务 {milestones.reduce((s, m) => s + m.tasks.length, 0)} 个</Text>
        {meceIssues.length > 0 ? (
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>MECE 检查提示</Text>
            {meceIssues.map((w, i) => (
              <Text key={i} style={styles.warnText}>• {w}</Text>
            ))}
          </View>
        ) : (
          <Text style={styles.okText}>✅ MECE 检查通过</Text>
        )}
      </View>

      {/* 任务树 */}
      {milestones.map(m => (
        <View key={m.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.milestoneTitle}>{m.title}</Text>
            <TouchableOpacity onPress={() => removeMilestone(m.id)}>
              <Text style={styles.deleteText}>✕</Text>
            </TouchableOpacity>
          </View>
          {m.basis ? <Text style={styles.subText}>依据：{m.basis}</Text> : null}
          {m.outcome ? <Text style={styles.subText}>成果：{m.outcome}</Text> : null}
          {m.tasks.map(t => (
            <View key={t.id} style={styles.taskRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.taskTitle}>
                  {isPhysicalAction(t.title) ? '🟢' : '🟠'} {t.title}
                </Text>
                {t.intention ? (
                  <Text style={styles.intention}>如果[{t.intention.triggerIf}]，那么[{t.intention.actionThen}]</Text>
                ) : null}
                <View style={styles.costRow}>
                  {COSTS.map(c => (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.costChip, t.energyCost === c.key && { backgroundColor: c.color }]}
                      onPress={() => updateTask(m.id, t.id, { energyCost: c.key })}
                    >
                      <Text style={[styles.costText, t.energyCost === c.key && { color: '#fff' }]}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                  <TextInput
                    style={styles.minInput}
                    value={String(t.estimateMin)}
                    onChangeText={v => updateTask(m.id, t.id, { estimateMin: Math.max(5, Number(v.replace(/\D/g, '')) || 0) })}
                    keyboardType="number-pad"
                  />
                  <Text style={styles.minUnit}>分钟</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => removeTask(m.id, t.id)}>
                <Text style={styles.deleteText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={styles.addRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={taskInputs[m.id] || ''}
              onChangeText={v => setTaskInputs({ ...taskInputs, [m.id]: v })}
              placeholder="新增可执行任务（用动词开头）"
              placeholderTextColor="#aaa"
              onSubmitEditing={() => addTask(m.id)}
            />
            <TouchableOpacity style={styles.addBtn} onPress={() => addTask(m.id)}>
              <Text style={styles.addBtnText}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {/* 可行性 & 保存 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>4. 可行性评估（TELOS）</Text>
        <View style={styles.feasRow}>
          <Text style={styles.feasScore}>{feasibility.score}</Text>
          <Text style={styles.feasUnit}>/100</Text>
          <Text style={styles.stars}>{'⭐'.repeat(difficulty)}{'☆'.repeat(4 - difficulty)}</Text>
        </View>
        {feasibility.breakdown.map(([name, v, desc]) => (
          <View key={name} style={styles.feasItem}>
            <Text style={styles.feasName}>{name}</Text>
            <View style={styles.feasBarBg}>
              <View style={[styles.feasBar, { width: `${v}%` }]} />
            </View>
            <Text style={styles.feasDesc}>{v} · {desc}</Text>
          </View>
        ))}
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveGoal}>
            <Text style={styles.primaryBtnText}>保存目标</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, styles.aiBtn]} onPress={handlePushToTasks}>
            <Text style={styles.primaryBtnText}>写入 SMART 任务</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 目标库 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📚 目标库（{goals.length}）</Text>
        {goals.length === 0 ? (
          <Text style={styles.empty}>暂无目标</Text>
        ) : (
          goals.map(g => (
            <View key={g.id} style={styles.goalRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.goalTitle}>{g.title}</Text>
                <Text style={styles.goalDetail}>
                  可行性 {g.feasibility} · {'⭐'.repeat(g.difficulty)} · 里程碑 {g.milestones.length} · 截止 {g.due || '—'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => handleDeleteGoal(g.id)}>
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
  message: { backgroundColor: '#EDF3FD', color: '#1976D2', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14, shadowColor: '#101523', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 3 }, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  label: { fontSize: 13, color: '#283147', fontWeight: '600', marginTop: 10, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#e2e5ed', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: '#f8fafc', color: '#222' },
  subText: { fontSize: 12, color: '#7b8ba2', marginTop: 4, lineHeight: 18 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: '#EDF3FD' },
  chipActive: { backgroundColor: '#1976D2' },
  chipText: { fontSize: 12, color: '#1976D2' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  primaryBtn: { flex: 1, minWidth: 140, backgroundColor: '#1976D2', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  aiBtn: { backgroundColor: '#7b3fe4' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  warnBox: { backgroundColor: '#FFF7E6', borderRadius: 8, padding: 10, marginTop: 10 },
  warnTitle: { fontSize: 13, fontWeight: '700', color: '#B26A00', marginBottom: 4 },
  warnText: { fontSize: 12, color: '#B26A00', lineHeight: 18 },
  okText: { fontSize: 13, color: '#43A047', marginTop: 8, fontWeight: '600' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  milestoneTitle: { fontSize: 15, fontWeight: '700', color: '#1976D2', flex: 1, marginRight: 8 },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 0.6, borderColor: '#e6e6ed' },
  taskTitle: { fontSize: 14, color: '#222', fontWeight: '600' },
  intention: { fontSize: 12, color: '#7b3fe4', marginTop: 2 },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  costChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#eef2f7' },
  costText: { fontSize: 11, color: '#555' },
  minInput: { borderWidth: 1, borderColor: '#e2e5ed', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, fontSize: 12, width: 54, textAlign: 'center', backgroundColor: '#f8fafc' },
  minUnit: { fontSize: 11, color: '#9aa7b8' },
  deleteText: { color: '#E53935', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  addBtn: { backgroundColor: '#EDF3FD', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnText: { color: '#1976D2', fontSize: 18, fontWeight: 'bold' },
  feasRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  feasScore: { fontSize: 30, fontWeight: '800', color: '#1976D2' },
  feasUnit: { fontSize: 14, color: '#8aa0c0', marginBottom: 4, marginLeft: 2 },
  stars: { fontSize: 16, marginLeft: 12, marginBottom: 4 },
  feasItem: { marginBottom: 8 },
  feasName: { fontSize: 12, color: '#283147', fontWeight: '600', marginBottom: 3 },
  feasBarBg: { height: 8, backgroundColor: '#eef2f7', borderRadius: 4, overflow: 'hidden' },
  feasBar: { height: '100%', backgroundColor: '#1976D2', borderRadius: 4 },
  feasDesc: { fontSize: 11, color: '#9aa7b8', marginTop: 2 },
  empty: { color: '#9aa7b8', fontSize: 14 },
  goalRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.6, borderColor: '#e6e6ed' },
  goalTitle: { fontSize: 14, color: '#222', fontWeight: '600' },
  goalDetail: { fontSize: 12, color: '#7b8ba2', marginTop: 2 },
});
