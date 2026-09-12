import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SubTabBar from '../components/secretary/SubTabBar';
import TimeLogPanel from '../components/secretary/TimeLogPanel';

// 已完成任务类型
type CompletedTask = {
  id: string;
  title: string;
  dueDate: string;
  quadrant: string;
  subtasks: { id: string; title: string; completed: boolean; scheduledDate?: string }[];
  completedAt: string;
};

// 普通任务类型（恢复时使用）
type Task = {
  id: string;
  title: string;
  dueDate: string;
  quadrant: string;
  subtasks: { id: string; title: string; completed: boolean; scheduledDate?: string }[];
  status: 'PENDING' | 'IN_PROGRESS' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  specific: string;
  measurable: string;
  relevant: string;
};

const COMPLETED_STORAGE_KEY = '@myplan_completed_tasks';
const TASKS_STORAGE_KEY = '@myplan_tasks';

// 四象限标签和颜色
const QUADRANT_LABELS: Record<string, string> = {
  important_urgent: '重要紧急',
  important_not_urgent: '重要不紧急',
  not_important_urgent: '不重要紧急',
  not_important_not_urgent: '不重要不紧急',
};

const QUADRANT_COLORS: Record<string, string> = {
  important_urgent: '#1976D2',
  important_not_urgent: '#43A047',
  not_important_urgent: '#E64A19',
  not_important_not_urgent: '#9E9E9E',
};

function HistoryMain() {
  const [completedTasks, setCompletedTasks] = useState<CompletedTask[]>([]);

  const loadCompletedTasks = async () => {
    try {
      const raw = await AsyncStorage.getItem(COMPLETED_STORAGE_KEY);
      if (raw) {
        const parsed: CompletedTask[] = JSON.parse(raw);
        parsed.sort(
          (a, b) =>
            new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
        );
        setCompletedTasks(parsed);
      } else {
        setCompletedTasks([]);
      }
    } catch {}
  };

  useEffect(() => {
    loadCompletedTasks();
  }, []);

  // 删除单个历史任务
  const handleDeleteTask = async (taskId: string) => {
    const confirmed = window.confirm('确定要删除这条完成记录吗？');
    if (!confirmed) return;

    const updated = completedTasks.filter(task => task.id !== taskId);
    setCompletedTasks(updated);
    try {
      await AsyncStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  };

  // 清空所有历史任务
  const handleClearAll = async () => {
    const confirmed = window.confirm('确定要删除所有历史任务吗？此操作不可恢复。');
    if (!confirmed) return;

    setCompletedTasks([]);
    try {
      await AsyncStorage.removeItem(COMPLETED_STORAGE_KEY);
    } catch {}
  };

  // 恢复任务到 SMART 任务记录
  const handleRestoreTask = async (taskId: string) => {
    const taskToRestore = completedTasks.find(t => t.id === taskId);
    if (!taskToRestore) return;

    // 从历史记录中移除
    const updatedHistory = completedTasks.filter(t => t.id !== taskId);
    setCompletedTasks(updatedHistory);
    await AsyncStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(updatedHistory));

    // 构造普通任务对象（去掉 completedAt，设置状态为 PENDING）
    const restoredTask: Task = {
      id: taskToRestore.id,
      title: taskToRestore.title,
      dueDate: taskToRestore.dueDate,
      quadrant: taskToRestore.quadrant,
      subtasks: taskToRestore.subtasks.map(st => ({
        id: st.id,
        title: st.title,
        completed: st.completed,
        scheduledDate: st.scheduledDate,
      })),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      specific: (taskToRestore as any).specific || '',
      measurable: (taskToRestore as any).measurable || '',
      relevant: (taskToRestore as any).relevant || '',
    };

    // 读取当前任务列表，添加恢复的任务
    try {
      const raw = await AsyncStorage.getItem(TASKS_STORAGE_KEY);
      const tasks: Task[] = raw ? JSON.parse(raw) : [];
      // 避免重复（如果已存在相同 id，则移除旧记录）
      const filtered = tasks.filter(t => t.id !== restoredTask.id);
      filtered.push(restoredTask);
      await AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
      console.error('恢复任务失败', e);
    }

    // 可选提示
    window.alert('任务已恢复到 SMART 任务记录');
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>📜 历史任务</Text>
        {completedTasks.length > 0 && (
          <TouchableOpacity onPress={handleClearAll} style={styles.clearAllBtn}>
            <Text style={styles.clearAllText}>清空全部</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {completedTasks.length === 0 ? (
          <Text style={styles.empty}>暂无已完成的任务</Text>
        ) : (
          completedTasks.map(task => (
            <View key={task.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.title}>{task.title}</Text>
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    onPress={() => handleRestoreTask(task.id)}
                    style={styles.restoreBtn}
                  >
                    <Text style={styles.restoreText}>↩️ 恢复</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeleteTask(task.id)}
                    style={styles.deleteBtn}
                  >
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.badgeRow}>
                <View style={[styles.badge, { backgroundColor: QUADRANT_COLORS[task.quadrant] + '22' }]}>
                  <View style={[styles.dot, { backgroundColor: QUADRANT_COLORS[task.quadrant] }]} />
                  <Text style={[styles.badgeText, { color: QUADRANT_COLORS[task.quadrant] }]}>
                    {QUADRANT_LABELS[task.quadrant]}
                  </Text>
                </View>
              </View>

              <Text style={styles.dueDate}>原截止日期：{task.dueDate}</Text>
              <Text style={styles.completedAt}>完成时间：{formatDate(task.completedAt)}</Text>
              <Text style={styles.subtaskSummary}>
                子任务完成情况：{task.subtasks.filter(s => s.completed).length}/{task.subtasks.length}
              </Text>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  clearAllBtn: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
  },
  clearAllText: {
    color: '#E53935',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 24,
  },
  empty: {
    textAlign: 'center',
    marginTop: 60,
    color: '#999',
    fontSize: 16,
  },
  card: {
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#222',
    flex: 1,
    marginRight: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  restoreBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#E8F5E9',
    borderRadius: 12,
    marginRight: 8,
  },
  restoreText: {
    color: '#43A047',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteBtn: {
    padding: 4,
  },
  deleteBtnText: {
    color: '#E53935',
    fontSize: 18,
    fontWeight: 'bold',
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dueDate: {
    fontSize: 13,
    color: '#666',
    marginBottom: 3,
  },
  completedAt: {
    fontSize: 13,
    color: '#1976D2',
    fontWeight: '500',
    marginBottom: 3,
  },
  subtaskSummary: {
    fontSize: 13,
    color: '#555',
  },
});

// ---------- 页面入口：原有「历史任务」+ 子界面「时间记录」----------
const HISTORY_PAGE_TABS = [
  { key: 'main', label: '历史任务' },
  { key: 'timelog', label: '时间记录' },
];

export default function HistoryScreen() {
  const [subTab, setSubTab] = useState('main');
  return (
    <View style={{ flex: 1 }}>
      <SubTabBar tabs={HISTORY_PAGE_TABS} active={subTab} onChange={setSubTab} />
      {subTab === 'main' ? <HistoryMain /> : <TimeLogPanel />}
    </View>
  );
}
