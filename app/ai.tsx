import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { getAiConfig, saveAiConfig } from './utils/ai';

// ==================== 配置区 ====================
// API Key 不写死在代码里：每个人在 App 内点「⚙️ 设置」填自己的 Key，
// 只保存在自己的浏览器/手机本地，不会上传，也不会进仓库。
// 本地开发也可以放一个 .env（EXPO_PUBLIC_DEEPSEEK_API_KEY=...），.env 不会被提交。
// ===============================================

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const QUICK_ACTIONS = [
  { label: '🔬 科学拆解', action: 'scientific_breakdown' },
  { label: '📅 自动排程', action: 'schedule' },
  { label: '📊 今日报告', action: 'report' },
  { label: '📌 应用到日历', action: 'apply_to_calendar' },
];

const WELCOME_MESSAGE: Message = {
  id: 'welcome',
  role: 'assistant',
  content: '你好！我是 MyPlan AI 助手，现在升级为科学任务拆解专家。\n\n我可以帮你：\n• 🔬 科学拆解任务（基于 HTA/MECE/WOOP）\n• 📅 自动排程\n• 📊 生成今日报告\n\n直接输入目标，或点击“🔬 科学拆解”开始。',
  timestamp: Date.now(),
};

// ==================== 科学拆解提示词 ====================
function buildSystemPrompt(): string {
  return `# Role: 科学任务拆解专家（基于HTA + MECE + WOOP + 执行意向理论）

## 背景
你是一位结合了认知科学、行为心理学和项目管理方法论的任务拆解AI。你的目标是将用户提供的SMART目标，拆解为一套层级化、可执行、有科学依据的子任务体系。

## 输入格式
用户将提供以下信息：
1. **SMART目标**：[目标描述]
2. **可选上下文**：[用户的时间、精力、资源、过往经验等]

## 拆解方法论（必须遵循）
1. **层级化拆解（HTA）**：目标 → 子目标（3-5个）→ 可执行任务（每个子目标拆为3-7个具体操作）
2. **MECE原则**：子目标之间相互独立（Mutually Exclusive），且合起来完整覆盖总目标（Collectively Exhaustive）
3. **瓶颈优先**：识别关键"瓶颈"节点，优先拆解和排程
4. **WOOP障碍预判**：对每个关键子目标，预判1个核心障碍
5. **执行意向**：为核心障碍生成"如果-那么"计划
6. **资源理性原则**：拆解粒度的粗细取决于任务复杂度——简单任务粗粒度，复杂任务细粒度

## 输出格式（必须严格遵循以下结构）
---
### 📌 一、目标总览卡片
| 维度 | 内容 |
|------|------|
| 目标 (S) | [具体目标描述] |
| 衡量标准 (M) | [可量化的完成标准] |
| 可行性评估 (A) | [AI评估：可实现性 + 依据] |
| 相关性 (R) | [与用户长期愿景的关联] |
| 截止时间 (T) | [截止日期 + 剩余天数] |
| **难度评级** | ⭐☆☆☆ / ⭐⭐☆☆ / ⭐⭐⭐☆ / ⭐⭐⭐⭐ |
| **推荐拆解策略** | [时间递进型 / 功能分解型 / 里程碑型 / 混合型] |

### 📌 二、层级任务树（HTA结构）
#### 里程碑 1：[子目标名称]（预估总耗时：XX小时）
> **拆解依据**：[为什么这是第一个关键节点]
> **预期成果**：[完成这个里程碑后，你将拥有什么]
| 任务ID | 任务描述 | 预估耗时 | 前置依赖 | 执行意向触发 |
|--------|---------|---------|---------|-------------|
| 1.1 | [具体操作] | Xh | 无 | — |
| ... | ... | ... | ... | ... |

#### 里程碑 2：[子目标名称]（预估总耗时：XX小时）
[同上结构]
...
### 📌 三、执行意向清单（Implementation Intentions）
| 编号 | 触发情境（If） | 执行行动（Then） | 对应里程碑 |
|------|---------------|-----------------|-----------|
| WI-1 | [具体情境/情绪/时间] | [具体、可立即执行的行动] | M1 |
...
### 📌 四、依赖关系图谱（文字版）
[使用树形图描述]

### 📌 五、风险评估与建议
| 风险等级 | 风险描述 | 缓解建议 |
|---------|---------|---------|
| 🔴 高 | [最大风险] | [建议] |
...
### 📌 六、第一步行动（降低启动摩擦）
**现在就可以执行的5分钟任务**：[一个物理动作，不是心理决策]

## 约束条件
1. 每个可执行任务必须是一个**物理动作**，而非心理活动
2. 每个里程碑必须包含**3-7个**可执行任务
3. 总拆解层级不超过**4层**（目标→里程碑→任务→子任务）
4. 必须至少识别**3个**关键障碍并生成执行意向

请始终保持友好、鼓励的语气。当用户不需要拆解时，可以像朋友一样正常对话。`;
}

async function loadContext(): Promise<string> {
  try {
    const taskRaw = await AsyncStorage.getItem('@myplan_tasks');
    const calRaw = await AsyncStorage.getItem('@myplan_calendar');
    const tasks = taskRaw ? JSON.parse(taskRaw) : [];
    const items = calRaw ? JSON.parse(calRaw) : [];
    return `当前任务数据：${JSON.stringify(tasks)}\n当前日历事项：${JSON.stringify(items)}`;
  } catch {
    return '';
  }
}

async function callDeepSeek(messages: { role: string; content: string }[]): Promise<string> {
  const cfg = await getAiConfig();
  if (!cfg.apiKey) {
    throw new Error('还没有配置 API Key。点右上角「⚙️ 设置」填入你自己的 DeepSeek API Key 就能用了。');
  }
  const response = await fetch(cfg.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `请求失败 (${response.status})`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '抱歉，我没有给出回复。';
}

export default function AIScreen() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState(true);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    (async () => {
      try {
        const history = await AsyncStorage.getItem('@myplan_ai_history');
        if (history) {
          const parsed: Message[] = JSON.parse(history);
          if (parsed.length > 0) setMessages(parsed);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const MAX = 200;
        const trimmed = messages.length > MAX ? messages.slice(-MAX) : messages;
        await AsyncStorage.setItem('@myplan_ai_history', JSON.stringify(trimmed));
      } catch {}
    })();
  }, [messages]);

  useEffect(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, [messages]);

  const clearHistory = async () => {
    const confirmed = window.confirm('确定要清除所有聊天记录吗？');
    if (!confirmed) return;
    try {
      await AsyncStorage.removeItem('@myplan_ai_history');
    } catch {}
    setMessages([{ ...WELCOME_MESSAGE, id: 'welcome_' + Date.now(), timestamp: Date.now() }]);
  };

  // 检查本地有没有存过 API Key（打开设置弹窗后重新检查一次）
  useEffect(() => {
    (async () => {
      const cfg = await getAiConfig();
      setHasKey(!!cfg.apiKey);
    })();
  }, [showKeyModal]);

  const openKeyModal = async () => {
    const cfg = await getAiConfig();
    setKeyDraft(cfg.apiKey);
    setShowKeyModal(true);
  };

  const saveKey = async () => {
    await saveAiConfig({ apiKey: keyDraft.trim() });
    setShowKeyModal(false);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setLoading(true);

    try {
      const context = await loadContext();
      const apiMessages = [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'system', content: `用户的真实任务情况：${context}` },
        ...messages
          .filter(m => m.id !== WELCOME_MESSAGE.id && !m.id.startsWith('welcome'))
          .map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text.trim() },
      ];

      const reply = await callDeepSeek(apiMessages);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ 出错了：${error.message || '请检查 API Key 或网络连接'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  // 应用到日历：解析 AI 回复中带日期的任务（支持常见格式）
  const applyToCalendar = async () => {
    const lastAiMsg = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAiMsg) {
      window.alert('还没有 AI 生成的计划');
      return;
    }

    const lines = lastAiMsg.content.split('\n');
    const items: { title: string; date: string }[] = [];
    const regex1 = /(.+?)\s*📅\s*(\d{4}-\d{2}-\d{2})/;
    const regex2 = /\|.*?\|\s*(.+?)\s*\|\s*.*?\|\s*.*?\|\s*(\d{4}-\d{2}-\d{2})\s*\|/;
    for (const line of lines) {
      let m = line.match(regex1);
      if (m) {
        items.push({ title: m[1].replace(/^[-•|]\s*/, '').trim(), date: m[2] });
        continue;
      }
      m = line.match(regex2);
      if (m) {
        items.push({ title: m[1].trim(), date: m[2] });
      }
    }

    if (items.length === 0) {
      window.alert('未找到带日期的任务项。请确保 AI 输出了日期。');
      return;
    }

    try {
      const raw = await AsyncStorage.getItem('@myplan_calendar');
      const existing: any[] = raw ? JSON.parse(raw) : [];
      const newItems = items.map(item => ({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        title: item.title,
        date: item.date,
        completed: false,
        parentTaskId: undefined,
      }));
      const updated = [...existing, ...newItems];
      await AsyncStorage.setItem('@myplan_calendar', JSON.stringify(updated));
      window.alert(`成功将 ${newItems.length} 个任务添加到日历`);
    } catch {
      window.alert('保存日历时出错');
    }
  };

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'scientific_breakdown':
        if (!inputText.trim()) {
          window.alert('请先在输入框输入你的目标');
          return;
        }
        sendMessage(`请使用科学任务拆解模板，对以下目标进行拆解：${inputText}`);
        break;
      case 'schedule':
        sendMessage('请读取我当前所有未完成的任务，并按照科学拆解模板中的格式，为我推荐未来7天的执行计划（请包含日期）。');
        break;
      case 'report':
        const todayStr = new Date().toISOString().slice(0, 10);
        sendMessage(`请根据我今天的任务和日历数据，生成今日（${todayStr}）的完成报告，包含已完成事项、未完成原因、明日建议。`);
        break;
      case 'apply_to_calendar':
        applyToCalendar();
        break;
      default:
        break;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🤖 AI 助手 · 科学拆解专家</Text>
        <View style={styles.headerBtns}>
          <TouchableOpacity onPress={openKeyModal} style={styles.settingBtn}>
            <Text style={styles.settingBtnText}>⚙️ 设置</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={clearHistory} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>清空</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!hasKey && (
        <TouchableOpacity style={styles.keyHint} onPress={openKeyModal}>
          <Text style={styles.keyHintText}>⚠️ 还没填 API Key，点这里设置（AI 功能需要）</Text>
        </TouchableOpacity>
      )}

      <View style={styles.quickActions}>
        {QUICK_ACTIONS.map(action => (
          <TouchableOpacity
            key={action.action}
            style={styles.quickBtn}
            onPress={() => handleQuickAction(action.action)}
            disabled={loading}
          >
            <Text style={styles.quickBtnText}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.chatArea}
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map(msg => (
          <View
            key={msg.id}
            style={[
              styles.messageBubble,
              msg.role === 'user' ? styles.userBubble : styles.aiBubble,
            ]}
          >
            <Text
              style={[
                styles.messageText,
                msg.role === 'user' ? styles.userText : styles.aiText,
              ]}
            >
              {msg.content}
            </Text>
          </View>
        ))}
        {loading && (
          <View style={[styles.messageBubble, styles.aiBubble]}>
            <ActivityIndicator size="small" color="#1976D2" />
          </View>
        )}
      </ScrollView>

      <View style={styles.inputArea}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="输入你的目标或需求..."
          placeholderTextColor="#aaa"
          multiline
          maxLength={2000}
          onSubmitEditing={() => sendMessage(inputText)}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!inputText.trim() || loading) && { opacity: 0.5 }]}
          onPress={() => sendMessage(inputText)}
          disabled={!inputText.trim() || loading}
        >
          <Text style={styles.sendBtnText}>发送</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showKeyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowKeyModal(false)}
      >
        <View style={styles.modalMask}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>填写 DeepSeek API Key</Text>
            <Text style={styles.modalDesc}>
              去 platform.deepseek.com 注册并创建一个 API Key，粘贴到这里。Key 只保存在你自己的设备上，不会上传。
            </Text>
            <TextInput
              style={styles.modalInput}
              value={keyDraft}
              onChangeText={setKeyDraft}
              placeholder="sk-..."
              placeholderTextColor="#aaa"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                onPress={() => setShowKeyModal(false)}
                style={[styles.modalBtn, styles.modalCancel]}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveKey} style={[styles.modalBtn, styles.modalOk]}>
                <Text style={styles.modalOkText}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e8ecf1',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a2e' },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#fee2e2',
  },
  clearBtnText: { color: '#E53935', fontSize: 13, fontWeight: '600' },
  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#EDF3FD',
    borderWidth: 1,
    borderColor: '#d0e0f7',
  },
  settingBtnText: { color: '#1976D2', fontSize: 13, fontWeight: '600' },
  keyHint: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FFF7E6',
    borderWidth: 1,
    borderColor: '#FFE0A3',
  },
  keyHintText: { color: '#B26A00', fontSize: 13, fontWeight: '600' },
  modalMask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  modalDesc: { fontSize: 13, color: '#64748b', lineHeight: 20, marginBottom: 12 },
  modalInput: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1e293b',
  },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  modalBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20 },
  modalCancel: { backgroundColor: '#f1f5f9' },
  modalCancelText: { color: '#475569', fontSize: 14, fontWeight: '600' },
  modalOk: { backgroundColor: '#1976D2' },
  modalOkText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  quickActions: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexWrap: 'wrap',
  },
  quickBtn: {
    backgroundColor: '#EDF3FD',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d0e0f7',
  },
  quickBtnText: { color: '#1976D2', fontSize: 13, fontWeight: '600' },
  chatArea: { flex: 1, paddingHorizontal: 16 },
  chatContent: { paddingVertical: 12 },
  messageBubble: {
    maxWidth: '80%',
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#1976D2' },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  messageText: { fontSize: 15, lineHeight: 22 },
  userText: { color: '#ffffff' },
  aiText: { color: '#1e293b' },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e8ecf1',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    color: '#1e293b',
  },
  sendBtn: {
    backgroundColor: '#1976D2',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginLeft: 8,
  },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});