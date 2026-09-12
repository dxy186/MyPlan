import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

type WoopPlan = {
  id: string;
  wish: string;
  outcome: string;
  obstacle: string;
  plan: string;
  createdAt: string;
};

const WOOP_STORAGE_KEY = '@myplan_woops';

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString().slice(-5);
}

export default function WoopScreen() {
  const [step, setStep] = useState(0);
  const [wish, setWish] = useState('');
  const [outcome, setOutcome] = useState('');
  const [obstacle, setObstacle] = useState('');
  const [plan, setPlan] = useState('');
  const [plans, setPlans] = useState<WoopPlan[]>([]);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(WOOP_STORAGE_KEY);
        if (raw) {
          const list: WoopPlan[] = JSON.parse(raw);
          list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          setPlans(list);
        }
      } catch {}
    })();
  }, []);

  const saveWoop = async () => {
    const newPlan: WoopPlan = {
      id: randomId(),
      wish: wish.trim(),
      outcome: outcome.trim(),
      obstacle: obstacle.trim(),
      plan: plan.trim(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newPlan, ...plans];
    setPlans(updated);
    await AsyncStorage.setItem(WOOP_STORAGE_KEY, JSON.stringify(updated));
    setStep(0);
    setWish('');
    setOutcome('');
    setObstacle('');
    setPlan('');
    setShowResult(false);
  };

  const deleteWoop = (id: string) => {
    if (!window.confirm('确定要删除这条 WOOP 计划吗？')) return;
    const updated = plans.filter(p => p.id !== id);
    setPlans(updated);
    AsyncStorage.setItem(WOOP_STORAGE_KEY, JSON.stringify(updated));
  };

  const handleNext = () => {
    if (step === 0 && !wish.trim()) {
      window.alert('请填写你的愿望');
      return;
    }
    if (step === 1 && !outcome.trim()) {
      window.alert('请填写最佳结果');
      return;
    }
    if (step === 2 && !obstacle.trim()) {
      window.alert('请填写内在障碍');
      return;
    }
    if (step === 3 && !plan.trim()) {
      window.alert('请填写执行计划');
      return;
    }
    if (step < 3) {
      setStep(step + 1);
    } else {
      setShowResult(true);
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const stepTitles = ['W - Wish（愿望）', 'O - Outcome（结果）', 'O - Obstacle（障碍）', 'P - Plan（计划）'];
  const stepPrompts = [
    '你的愿望是什么？',
    '想象一下，愿望实现后最好的结果是什么？',
    '阻碍你实现它的最大内在障碍是什么？',
    '如果[障碍]出现，那么我就[具体行动]',
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.header}>🧭 WOOP 计划向导</Text>

      <View style={styles.stepIndicator}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[styles.stepDot, i === step && styles.stepDotActive]} />
        ))}
      </View>

      <Text style={styles.stepTitle}>{stepTitles[step]}</Text>
      <Text style={styles.stepPrompt}>{stepPrompts[step]}</Text>

      <View style={styles.inputArea}>
        {step === 0 && (
          <TextInput
            style={styles.input}
            value={wish}
            onChangeText={setWish}
            placeholder="例：我想通过英语六级考试"
            placeholderTextColor="#aaa"
            multiline
          />
        )}
        {step === 1 && (
          <TextInput
            style={styles.input}
            value={outcome}
            onChangeText={setOutcome}
            placeholder="例：我拿到六级证书，自信心大增，未来求职更有优势"
            placeholderTextColor="#aaa"
            multiline
          />
        )}
        {step === 2 && (
          <TextInput
            style={styles.input}
            value={obstacle}
            onChangeText={setObstacle}
            placeholder="例：我经常拖延，总想玩手机而不想背单词"
            placeholderTextColor="#aaa"
            multiline
          />
        )}
        {step === 3 && (
          <TextInput
            style={styles.input}
            value={plan}
            onChangeText={setPlan}
            placeholder="如果我想玩手机，那么我就立刻打开背单词APP背10个单词"
            placeholderTextColor="#aaa"
            multiline
          />
        )}
      </View>

      <View style={styles.btnRow}>
        {step > 0 && (
          <TouchableOpacity style={styles.prevBtn} onPress={handlePrev}>
            <Text style={styles.prevBtnText}>上一步</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
          <Text style={styles.nextBtnText}>{step === 3 ? '生成计划' : '下一步'}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showResult} transparent animationType="fade" onRequestClose={() => setShowResult(false)}>
        <View style={styles.resultModalBg}>
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>✨ 你的 WOOP 计划</Text>
            <View style={styles.resultContent}>
              <Text style={styles.resultLine}>愿望：{wish}</Text>
              <Text style={styles.resultLine}>最佳结果：{outcome}</Text>
              <Text style={styles.resultLine}>关键障碍：{obstacle}</Text>
              <Text style={styles.resultLine}>执行意向：如果[{obstacle}]，那么我就[{plan}]</Text>
            </View>
            <View style={styles.resultBtnRow}>
              <TouchableOpacity style={styles.resultCancelBtn} onPress={() => setShowResult(false)}>
                <Text style={{ color: '#5C5C5C' }}>返回修改</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.resultSaveBtn} onPress={saveWoop}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Text style={styles.savedHeader}>📚 已保存的 WOOP 计划</Text>
      <ScrollView style={styles.savedList} contentContainerStyle={{ paddingBottom: 20 }}>
        {plans.length === 0 ? (
          <Text style={styles.empty}>暂无 WOOP 计划</Text>
        ) : (
          plans.map(p => (
            <View key={p.id} style={styles.woopCard}>
              <View style={styles.woopCardHeader}>
                <Text style={styles.woopWish}>{p.wish}</Text>
                <TouchableOpacity onPress={() => deleteWoop(p.id)}>
                  <Text style={styles.deleteText}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.woopDetail}>结果：{p.outcome}</Text>
              <Text style={styles.woopDetail}>障碍：{p.obstacle}</Text>
              <Text style={styles.woopPlan}>执行意向：如果[{p.obstacle}]，那么我就[{p.plan}]</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 12,
    textAlign: 'center',
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ddd',
    marginHorizontal: 6,
  },
  stepDotActive: {
    backgroundColor: '#1976D2',
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1976D2',
    marginBottom: 6,
  },
  stepPrompt: {
    fontSize: 14,
    color: '#555',
    marginBottom: 12,
  },
  inputArea: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#101523',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },
  input: {
    minHeight: 60,
    fontSize: 15,
    color: '#222',
    textAlignVertical: 'top',
  },
  btnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  prevBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1976D2',
    backgroundColor: '#EDF3FD',
  },
  prevBtnText: {
    color: '#1976D2',
    fontWeight: '600',
  },
  nextBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1976D2',
  },
  nextBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
  resultModalBg: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    minWidth: 350,
    maxWidth: 450,
    shadowColor: '#1976d2',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 13,
    elevation: 7,
  },
  resultTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#222',
    marginBottom: 12,
    textAlign: 'center',
  },
  resultContent: {
    marginBottom: 16,
  },
  resultLine: {
    fontSize: 14,
    color: '#555',
    marginBottom: 6,
    lineHeight: 20,
  },
  resultBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  resultCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e5ed',
    marginRight: 8,
  },
  resultSaveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1976D2',
  },
  savedHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a2e',
    marginBottom: 8,
  },
  savedList: {
    flex: 1,
  },
  empty: {
    textAlign: 'center',
    marginTop: 30,
    color: '#999',
    fontSize: 16,
  },
  woopCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#101523',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 2,
  },
  woopCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  woopWish: {
    fontSize: 17,
    fontWeight: '600',
    color: '#222',
    flex: 1,
    marginRight: 8,
  },
  deleteText: {
    color: '#E53935',
    fontSize: 18,
    fontWeight: 'bold',
  },
  woopDetail: {
    fontSize: 13,
    color: '#666',
    marginBottom: 3,
  },
  woopPlan: {
    fontSize: 14,
    color: '#1976D2',
    fontWeight: '500',
    marginTop: 4,
  },
});