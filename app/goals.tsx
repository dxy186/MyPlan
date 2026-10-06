import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
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
import { Calendar } from 'react-native-calendars';
import DecomposePanel from '../components/secretary/DecomposePanel';
import SubTabBar from '../components/secretary/SubTabBar';

// ---------- 类型定义 ----------
type Subtask = {
  id: string;
  title: string;
  completed: boolean;
  scheduledDate?: string;
};

type Task = {
  id: string;
  title: string;
  dueDate: string;
  quadrant: string;
  subtasks: Subtask[];
  status: 'PENDING' | 'IN_PROGRESS' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  specific: string;
  measurable: string;
  relevant: string;
};

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  parentTaskId?: string;
};

type CompletedTask = Task & {
  completedAt: string;
};

// ---------- 常量 ----------
const TASKS_STORAGE_KEY = '@myplan_tasks';
const CALENDAR_STORAGE_KEY = '@myplan_calendar';
const COMPLETED_STORAGE_KEY = '@myplan_completed_tasks';

const QUADRANTS = [
  { key: 'important_urgent', label: '重要紧急', color: '#1976D2' },
  { key: 'not_important_urgent', label: '不重要紧急', color: '#E64A19' },
  { key: 'important_not_urgent', label: '重要不紧急', color: '#43A047' },
  { key: 'not_important_not_urgent', label: '不重要不紧急', color: '#9E9E9E' },
];

const QUADRANT_ORDER: Record<string, number> = {
  important_urgent: 0,
  not_important_urgent: 1,
  important_not_urgent: 2,
  not_important_not_urgent: 3,
};

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

// ---------- 工具函数 ----------
function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString().slice(-5);
}

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

// ---------- 辅助组件 ----------
function ProgressBar({ progress }: { progress: number }) {
  return (
    <View style={progressBarStyles.container}>
      <View style={[progressBarStyles.bar, { width: `${Math.round(progress * 100)}%` }]} />
    </View>
  );
}

function QuadrantBadge({ quadrant }: { quadrant: string }) {
  return (
    <View style={badgeStyles.container}>
      <View style={[badgeStyles.dot, { backgroundColor: QUADRANT_COLORS[quadrant] || '#ccc' }]} />
      <Text style={badgeStyles.label}>{QUADRANT_LABELS[quadrant]}</Text>
    </View>
  );
}

// ---------- 主组件 ----------
function GoalsMain() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [subtaskInputs, setSubtaskInputs] = useState<{ [taskId: string]: string }>({});

  // 子任务编辑状态
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskTitleValue, setEditingSubtaskTitleValue] = useState('');

  // 子任务日期选择器状态
  const [subtaskDatePicker, setSubtaskDatePicker] = useState<{ taskId: string; subtaskId: string } | null>(null);
  const [showSubtaskDatePicker, setShowSubtaskDatePicker] = useState(false);

  // 添加表单状态
  const [form, setForm] = useState({
    title: '',
    dueDate: '',
    quadrant: 'important_urgent',
    specific: '',
    measurable: '',
    relevant: '',
  });

  // 编辑表单状态
  const [editForm, setEditForm] = useState({
    title: '',
    dueDate: '',
    quadrant: 'important_urgent',
    specific: '',
    measurable: '',
    relevant: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(TASKS_STORAGE_KEY);
        if (raw) setTasks(JSON.parse(raw));
      } catch {}
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const displayedTasks = [...tasks]
    .sort((a, b) => (QUADRANT_ORDER[a.quadrant] ?? 99) - (QUADRANT_ORDER[b.quadrant] ?? 99))
    .filter(t => filterStatus === 'all' || t.status === filterStatus);

  // ---------- 添加任务 ----------
  const handleAddTask = () => {
    if (!form.title.trim()) return;
    const newTask: Task = {
      id: randomId(),
      title: form.title.trim(),
      dueDate: formatDate(form.dueDate.trim()),
      quadrant: form.quadrant,
      subtasks: [],
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      specific: form.specific.trim(),
      measurable: form.measurable.trim(),
      relevant: form.relevant.trim(),
    };
    setTasks([...tasks, newTask]);
    setShowAddModal(false);
    setForm({ title: '', dueDate: '', quadrant: 'important_urgent', specific: '', measurable: '', relevant: '' });
  };

  // ---------- 打开编辑任务 ----------
  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setEditForm({
      title: task.title,
      dueDate: task.dueDate,
      quadrant: task.quadrant,
      specific: task.specific,
      measurable: task.measurable,
      relevant: task.relevant,
    });
    setShowEditModal(true);
  };

  // ---------- 保存编辑任务 ----------
  const handleSaveEdit = async () => {
    if (!editingTask) return;
    const updatedTask: Task = {
      ...editingTask,
      title: editForm.title.trim(),
      dueDate: formatDate(editForm.dueDate.trim()),
      quadrant: editForm.quadrant,
      specific: editForm.specific.trim(),
      measurable: editForm.measurable.trim(),
      relevant: editForm.relevant.trim(),
      updatedAt: new Date().toISOString(),
    };
    setTasks(tasks.map(t => (t.id === editingTask.id ? updatedTask : t)));
    try {
      const calRaw = await AsyncStorage.getItem(CALENDAR_STORAGE_KEY);
      const calItems: CalendarItem[] = calRaw ? JSON.parse(calRaw) : [];
      const updatedCalItems = calItems.map(item =>
        item.parentTaskId === editingTask.id ? { ...item, date: updatedTask.dueDate, title: updatedTask.title } : item
      );
      await AsyncStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(updatedCalItems));
    } catch {}
    setShowEditModal(false);
    setEditingTask(null);
  };

  // ---------- 更新状态 ----------
  const handleUpdateStatus = (taskId: string, status: Task['status']) => {
    setTasks(tasks.map(t => (t.id === taskId ? { ...t, status, updatedAt: new Date().toISOString() } : t)));
  };

  // ---------- 删除任务 ----------
  const handleDeleteTask = async (taskId: string) => {
    if (!window.confirm('确定要删除这个任务吗？')) return;
    const updated = tasks.filter(t => t.id !== taskId);
    setTasks(updated);
    await AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(updated));
    try {
      const calRaw = await AsyncStorage.getItem(CALENDAR_STORAGE_KEY);
      const calItems: CalendarItem[] = calRaw ? JSON.parse(calRaw) : [];
      const filtered = calItems.filter(item => item.parentTaskId !== taskId);
      await AsyncStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(filtered));
    } catch {}
  };

  // ---------- 完成任务归档（修复历史记录问题） ----------
  const handleCompleteTask = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // 从当前任务列表移除
    const updatedTasks = tasks.filter(t => t.id !== taskId);
    setTasks(updatedTasks);
    await AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(updatedTasks));

    // 写入历史任务
    const completedTask: CompletedTask = {
      ...task,
      completedAt: new Date().toISOString(),
    };
    try {
      const raw = await AsyncStorage.getItem(COMPLETED_STORAGE_KEY);
      const list: CompletedTask[] = raw ? JSON.parse(raw) : [];
      list.push(completedTask);
      await AsyncStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.error('保存历史任务失败', e);
    }
  };

  // ---------- 添加到日历 ----------
  const handleAddToCalendar = async (task: Task) => {
    try {
      const raw = await AsyncStorage.getItem(CALENDAR_STORAGE_KEY);
      const existing: CalendarItem[] = raw ? JSON.parse(raw) : [];
      const alreadyExists = existing.some(item => item.parentTaskId === task.id && item.date === task.dueDate);
      if (alreadyExists) return;
      const newItem: CalendarItem = {
        id: randomId(),
        title: task.title,
        date: formatDate(task.dueDate),
        completed: false,
        parentTaskId: task.id,
      };
      const updated = [...existing, newItem];
      await AsyncStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  };

  // ---------- 展开/收起子任务 ----------
  const handleExpand = (id: string) => {
    setExpandedTaskId(expandedTaskId === id ? null : id);
  };

  // ---------- 子任务输入 ----------
  const handleSubtaskInput = (taskId: string, value: string) => {
    setSubtaskInputs({ ...subtaskInputs, [taskId]: value });
  };

  const handleAddSubtask = (taskId: string) => {
    const title = subtaskInputs[taskId];
    if (!title || !title.trim()) return;
    setTasks(tasks.map(task =>
      task.id === taskId
        ? { ...task, subtasks: [...task.subtasks, { id: randomId(), title: title.trim(), completed: false }] }
        : task
    ));
    setSubtaskInputs({ ...subtaskInputs, [taskId]: '' });
  };

  // ---------- 切换子任务完成状态（双向同步日历） ----------
  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    let updatedTask: Task | undefined;
    const updatedTasks = tasks.map(task => {
      if (task.id !== taskId) return task;
      const nextSubtasks = task.subtasks.map(sub =>
        sub.id === subtaskId ? { ...sub, completed: !sub.completed } : sub
      );
      updatedTask = { ...task, subtasks: nextSubtasks };
      return updatedTask;
    });
    setTasks(updatedTasks);
    await AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(updatedTasks));

    const subtask = updatedTask?.subtasks.find(s => s.id === subtaskId);
    if (subtask) {
      try {
        const calRaw = await AsyncStorage.getItem(CALENDAR_STORAGE_KEY);
        const calItems: CalendarItem[] = calRaw ? JSON.parse(calRaw) : [];
        const newCalItems = calItems.map(item =>
          item.parentTaskId === taskId && item.title === subtask.title
            ? { ...item, completed: subtask.completed }
            : item
        );
        await AsyncStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(newCalItems));
      } catch {}
    }
  };

  // ---------- 子任务标题编辑 ----------
  const startEditSubtaskTitle = (taskId: string, subtaskId: string, currentTitle: string) => {
    setEditingSubtaskId(`${taskId}_${subtaskId}`);
    setEditingSubtaskTitleValue(currentTitle);
  };

  const saveSubtaskTitle = (taskId: string, subtaskId: string) => {
    const newTitle = editingSubtaskTitleValue.trim();
    if (newTitle) {
      setTasks(tasks.map(task => {
        if (task.id !== taskId) return task;
        return {
          ...task,
          subtasks: task.subtasks.map(st =>
            st.id === subtaskId ? { ...st, title: newTitle } : st
          ),
        };
      }));
    }
    setEditingSubtaskId(null);
  };

  // ---------- 子任务日期修改（同步日历） ----------
  const handleSubtaskDateChange = async (taskId: string, subtaskId: string, newDate: string) => {
    const updatedTasks = tasks.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        subtasks: t.subtasks.map(st =>
          st.id === subtaskId ? { ...st, scheduledDate: newDate || undefined } : st
        ),
      };
    });
    setTasks(updatedTasks);
    await AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(updatedTasks));

    const subtask = updatedTasks.find(t => t.id === taskId)?.subtasks.find(s => s.id === subtaskId);
    if (!subtask) return;

    try {
      const calRaw = await AsyncStorage.getItem(CALENDAR_STORAGE_KEY);
      const calItems: CalendarItem[] = calRaw ? JSON.parse(calRaw) : [];
      const existingIndex = calItems.findIndex(item => item.parentTaskId === taskId && item.title === subtask.title);
      if (newDate.trim()) {
        const updatedItem: CalendarItem = {
          id: existingIndex !== -1 ? calItems[existingIndex].id : randomId(),
          title: subtask.title,
          date: formatDate(newDate.trim()),
          completed: subtask.completed,
          parentTaskId: taskId,
        };
        if (existingIndex !== -1) {
          calItems[existingIndex] = updatedItem;
        } else {
          calItems.push(updatedItem);
        }
      } else {
        if (existingIndex !== -1) calItems.splice(existingIndex, 1);
      }
      await AsyncStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(calItems));
    } catch {}
  };

  // ---------- 子任务日期选择器 ----------
  const openSubtaskDatePicker = (taskId: string, subtaskId: string) => {
    setSubtaskDatePicker({ taskId, subtaskId });
    setShowSubtaskDatePicker(true);
  };

  const handleSelectSubtaskDate = (dateStr: string) => {
    if (subtaskDatePicker) {
      handleSubtaskDateChange(subtaskDatePicker.taskId, subtaskDatePicker.subtaskId, dateStr);
      setShowSubtaskDatePicker(false);
      setSubtaskDatePicker(null);
    }
  };

  const syncSubtaskToCalendar = (taskId: string, subtaskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    const subtask = task?.subtasks.find(s => s.id === subtaskId);
    if (!subtask || !subtask.scheduledDate) {
      window.alert('请先为该子任务设置日期');
      return;
    }
    handleSubtaskDateChange(taskId, subtaskId, subtask.scheduledDate);
    window.alert('已同步到日历');
  };

  // ---------- 一键同步所有子任务到日历 ----------
  const syncAllSubtasksToCalendar = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const datedSubtasks = task.subtasks.filter(st => st.scheduledDate);
    if (datedSubtasks.length === 0) {
      window.alert('该任务下还没有设置日期的子任务，请先为子任务选择日期');
      return;
    }
    for (const subtask of datedSubtasks) {
      await handleSubtaskDateChange(taskId, subtask.id, subtask.scheduledDate!);
    }
    window.alert(`已同步 ${datedSubtasks.length} 个子任务到日历`);
  };

  // ---------- 删除子任务（同步删除日历） ----------
  const handleDeleteSubtask = async (taskId: string, subtaskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    const subtask = task?.subtasks.find(s => s.id === subtaskId);
    if (!subtask) return;
    if (!window.confirm(`确定要删除子任务 "${subtask.title}" 吗？`)) return;

    const updatedTasks = tasks.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        subtasks: t.subtasks.filter(st => st.id !== subtaskId),
      };
    });
    setTasks(updatedTasks);
    await AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(updatedTasks));

    try {
      const calRaw = await AsyncStorage.getItem(CALENDAR_STORAGE_KEY);
      const calItems: CalendarItem[] = calRaw ? JSON.parse(calRaw) : [];
      const filteredCalItems = calItems.filter(
        item => !(item.parentTaskId === taskId && item.title === subtask.title)
      );
      await AsyncStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(filteredCalItems));
    } catch {}
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>🎯 SMART任务记录</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
          <Text style={styles.addBtnText}>＋ 添加任务</Text>
        </TouchableOpacity>
      </View>

      {/* 状态筛选 */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterBtn, filterStatus === 'all' && styles.filterBtnActive]}
          onPress={() => setFilterStatus('all')}
        >
          <Text style={[styles.filterText, filterStatus === 'all' && styles.filterTextActive]}>全部</Text>
        </TouchableOpacity>
        {(['PENDING', 'IN_PROGRESS', 'FAILED'] as const).map(status => (
          <TouchableOpacity
            key={status}
            style={[styles.filterBtn, filterStatus === status && styles.filterBtnActive]}
            onPress={() => setFilterStatus(status)}
          >
            <Text style={[styles.filterText, filterStatus === status && styles.filterTextActive]}>
              {status === 'PENDING' ? '待进行' : status === 'IN_PROGRESS' ? '进行中' : '失败'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {displayedTasks.length === 0 ? (
          <Text style={styles.empty}>暂无任务，点击右上角添加你的第一个任务</Text>
        ) : (
          displayedTasks.map(task => {
            const total = task.subtasks.length;
            const completed = task.subtasks.filter(s => s.completed).length;
            const progress = total === 0 ? 1 : completed / total;
            return (
              <View key={task.id} style={styles.taskCard}>
                <View style={styles.taskHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                    <QuadrantBadge quadrant={task.quadrant} />
                    <Text style={styles.taskTitle}>{task.title}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => openEditTask(task)} style={styles.editTaskBtn}>
                      <Text style={styles.editTaskBtnText}>✏️ 编辑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteTask(task.id)}>
                      <Text style={styles.deleteText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.dueDate}>截止：{task.dueDate}</Text>

                {task.specific ? <Text style={styles.detailText}>S: {task.specific}</Text> : null}
                {task.measurable ? <Text style={styles.detailText}>M: {task.measurable}</Text> : null}
                {task.relevant ? <Text style={styles.detailText}>R: {task.relevant}</Text> : null}

                <View style={styles.progressRow}>
                  <Text style={styles.progressText}>{completed}/{total} 子任务</Text>
                  <ProgressBar progress={progress} />
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleAddToCalendar(task)}>
                    <Text style={styles.actionBtnText}>📅 添加到日历</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, styles.completeBtn]} onPress={() => handleCompleteTask(task.id)}>
                    <Text style={[styles.actionBtnText, { color: '#43A047' }]}>✅ 完成</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.statusRow}>
                  {(['PENDING', 'IN_PROGRESS', 'FAILED'] as const).map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[styles.statusBtn, task.status === status && styles.statusBtnActive]}
                      onPress={() => handleUpdateStatus(task.id, status)}
                    >
                      <Text style={[styles.statusText, task.status === status && styles.statusTextActive]}>
                        {status === 'PENDING' ? '待进行' : status === 'IN_PROGRESS' ? '进行中' : '失败'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* 展开/收起 + 一键同步按钮行 */}
                <View style={styles.expandSyncRow}>
                  <TouchableOpacity onPress={() => handleExpand(task.id)} style={styles.expandBtn}>
                    <Text style={styles.expandText}>{expandedTaskId === task.id ? '收起子任务' : '展开子任务'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => syncAllSubtasksToCalendar(task.id)}
                    style={styles.syncAllBtn}
                  >
                    <Text style={styles.syncAllBtnText}>📅 一键同步</Text>
                  </TouchableOpacity>
                </View>

                {expandedTaskId === task.id && (
                  <View style={styles.subtaskArea}>
                    {task.subtasks.length === 0 && (
                      <Text style={{ color: '#bbb', fontSize: 13 }}>暂无子任务，添加一个吧</Text>
                    )}
                    {task.subtasks.map(subtask => (
                      <View key={subtask.id} style={styles.subtaskRow}>
                        <TouchableOpacity
                          onPress={() => handleToggleSubtask(task.id, subtask.id)}
                          style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        >
                          <View style={[styles.checkbox, subtask.completed && { backgroundColor: '#43A047', borderColor: '#43A047' }]}>
                            {subtask.completed && <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text>}
                          </View>
                          {editingSubtaskId === `${task.id}_${subtask.id}` ? (
                            <TextInput
                              style={styles.subtaskTitleInput}
                              value={editingSubtaskTitleValue}
                              onChangeText={setEditingSubtaskTitleValue}
                              onBlur={() => saveSubtaskTitle(task.id, subtask.id)}
                              onSubmitEditing={() => saveSubtaskTitle(task.id, subtask.id)}
                              autoFocus
                            />
                          ) : (
                            <TouchableOpacity onPress={() => startEditSubtaskTitle(task.id, subtask.id, subtask.title)}>
                              <Text style={[styles.subtaskText, subtask.completed && { textDecorationLine: 'line-through', color: '#bbb' }]}>
                                {subtask.title} ✎
                              </Text>
                            </TouchableOpacity>
                          )}
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => openSubtaskDatePicker(task.id, subtask.id)}
                          style={styles.subtaskDateButton}
                        >
                          <Text style={styles.subtaskDateText}>
                            {subtask.scheduledDate || '📅 选择日期'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => syncSubtaskToCalendar(task.id, subtask.id)}
                          style={styles.syncSubtaskBtn}
                        >
                          <Text style={styles.syncSubtaskText}>同步</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => handleDeleteSubtask(task.id, subtask.id)}
                          style={styles.subtaskDeleteBtn}
                        >
                          <Text style={styles.subtaskDeleteText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}

                    <View style={styles.addSubtaskRow}>
                      <TextInput
                        style={styles.subtaskInput}
                        value={subtaskInputs[task.id] || ''}
                        onChangeText={text => handleSubtaskInput(task.id, text)}
                        placeholder="新子任务标题"
                        placeholderTextColor="#aaa"
                        onSubmitEditing={() => handleAddSubtask(task.id)}
                      />
                      <TouchableOpacity style={styles.addSubtaskBtn} onPress={() => handleAddSubtask(task.id)}>
                        <Text style={{ fontSize: 22, color: '#1976D2', fontWeight: 'bold' }}>＋</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* 添加任务弹窗 */}
      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}>
            <View style={styles.modalCard}>
              <Text style={styles.modalHeader}>添加 SMART 任务</Text>

              <Text style={styles.label}>任务标题 *</Text>
              <TextInput
                style={styles.input}
                value={form.title}
                onChangeText={text => setForm({ ...form, title: text })}
                placeholder="例：完成周报"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>S - 具体说明</Text>
              <TextInput
                style={styles.input}
                value={form.specific}
                onChangeText={text => setForm({ ...form, specific: text })}
                placeholder="具体要做什么？"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>M - 衡量标准</Text>
              <TextInput
                style={styles.input}
                value={form.measurable}
                onChangeText={text => setForm({ ...form, measurable: text })}
                placeholder="如何衡量完成？"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>R - 相关性说明</Text>
              <TextInput
                style={styles.input}
                value={form.relevant}
                onChangeText={text => setForm({ ...form, relevant: text })}
                placeholder="为什么这个任务对你重要？"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>四象限</Text>
              <View style={styles.quadrantSelect}>
                {QUADRANTS.map(q => (
                  <TouchableOpacity
                    key={q.key}
                    style={[styles.quadrantBtn, form.quadrant === q.key && styles.quadrantBtnActive]}
                    onPress={() => setForm({ ...form, quadrant: q.key })}
                  >
                    <View style={[badgeStyles.dot, { backgroundColor: q.color, marginRight: 4 }]} />
                    <Text style={{ color: form.quadrant === q.key ? '#fff' : '#333' }}>{q.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>T - 截止日期</Text>
              <TextInput
                style={styles.input}
                value={form.dueDate}
                onChangeText={text => setForm({ ...form, dueDate: text })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#aaa"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <View style={styles.modalBtnRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddModal(false)}>
                  <Text style={{ color: '#5C5C5C' }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, !form.title.trim() && { opacity: 0.5 }]}
                  onPress={handleAddTask}
                  disabled={!form.title.trim()}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>添加</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* 编辑任务弹窗 */}
      <Modal visible={showEditModal} transparent animationType="fade" onRequestClose={() => setShowEditModal(false)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}>
            <View style={styles.modalCard}>
              <Text style={styles.modalHeader}>编辑 SMART 任务</Text>

              <Text style={styles.label}>任务标题 *</Text>
              <TextInput
                style={styles.input}
                value={editForm.title}
                onChangeText={text => setEditForm({ ...editForm, title: text })}
                placeholder="任务标题"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>S - 具体说明</Text>
              <TextInput
                style={styles.input}
                value={editForm.specific}
                onChangeText={text => setEditForm({ ...editForm, specific: text })}
                placeholder="具体要做什么？"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>M - 衡量标准</Text>
              <TextInput
                style={styles.input}
                value={editForm.measurable}
                onChangeText={text => setEditForm({ ...editForm, measurable: text })}
                placeholder="如何衡量完成？"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>R - 相关性说明</Text>
              <TextInput
                style={styles.input}
                value={editForm.relevant}
                onChangeText={text => setEditForm({ ...editForm, relevant: text })}
                placeholder="为什么这个任务对你重要？"
                placeholderTextColor="#aaa"
              />

              <Text style={styles.label}>四象限</Text>
              <View style={styles.quadrantSelect}>
                {QUADRANTS.map(q => (
                  <TouchableOpacity
                    key={q.key}
                    style={[styles.quadrantBtn, editForm.quadrant === q.key && styles.quadrantBtnActive]}
                    onPress={() => setEditForm({ ...editForm, quadrant: q.key })}
                  >
                    <View style={[badgeStyles.dot, { backgroundColor: q.color, marginRight: 4 }]} />
                    <Text style={{ color: editForm.quadrant === q.key ? '#fff' : '#333' }}>{q.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>T - 截止日期</Text>
              <TextInput
                style={styles.input}
                value={editForm.dueDate}
                onChangeText={text => setEditForm({ ...editForm, dueDate: text })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#aaa"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <View style={styles.modalBtnRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowEditModal(false)}>
                  <Text style={{ color: '#5C5C5C' }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, !editForm.title.trim() && { opacity: 0.5 }]}
                  onPress={handleSaveEdit}
                  disabled={!editForm.title.trim()}
                >
                  <Text style={{ color: '#fff', fontWeight: '700' }}>保存</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* 子任务日期选择器 Modal */}
      <Modal
        visible={showSubtaskDatePicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSubtaskDatePicker(false)}
      >
        <View style={styles.datePickerModalBg}>
          <View style={styles.datePickerModalCard}>
            <Text style={styles.datePickerHeader}>选择子任务日期</Text>
            <Calendar
              onDayPress={(day) => handleSelectSubtaskDate(day.dateString)}
              markedDates={{
                [subtaskDatePicker
                  ? tasks.find(t => t.id === subtaskDatePicker.taskId)?.subtasks.find(s => s.id === subtaskDatePicker.subtaskId)?.scheduledDate || ''
                  : '']: { selected: true, selectedColor: '#1976D2' },
              }}
              theme={{ todayTextColor: '#1976D2', arrowColor: '#1976D2' }}
            />
            <TouchableOpacity style={styles.datePickerCloseBtn} onPress={() => setShowSubtaskDatePicker(false)}>
              <Text style={{ color: '#1976D2', fontWeight: '600' }}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------- 样式 ----------
const progressBarStyles = StyleSheet.create({
  container: {
    width: '100%',
    height: 7,
    backgroundColor: '#e3e9ef',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4,
  },
  bar: {
    height: '100%',
    backgroundColor: '#1976D2',
    borderRadius: 4,
  },
});

const badgeStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', marginRight: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  label: { fontSize: 12, color: '#5C5C5C', fontWeight: '500' },
});

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
    marginBottom: 12,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  addBtn: {
    backgroundColor: '#1976D2',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
    gap: 8,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#EDF3FD',
  },
  filterBtnActive: {
    backgroundColor: '#1976D2',
  },
  filterText: {
    color: '#1976D2',
    fontSize: 13,
  },
  filterTextActive: {
    color: '#fff',
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
  taskCard: {
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
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  taskTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#222',
    marginRight: 8,
  },
  editTaskBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#EDF3FD',
    borderRadius: 12,
    marginRight: 8,
  },
  editTaskBtnText: {
    fontSize: 12,
    color: '#1976D2',
    fontWeight: '600',
  },
  deleteText: {
    color: '#E53935',
    fontSize: 18,
    fontWeight: 'bold',
  },
  dueDate: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
  },
  detailText: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
  },
  progressRow: {
    marginBottom: 8,
  },
  progressText: {
    fontSize: 12,
    color: '#1976D2',
    marginBottom: 2,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  actionBtn: {
    backgroundColor: '#EDF3FD',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  completeBtn: {
    backgroundColor: '#E8F5E9',
  },
  actionBtnText: {
    color: '#1976D2',
    fontSize: 13,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
    gap: 6,
  },
  statusBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
  },
  statusBtnActive: {
    backgroundColor: '#1976D2',
  },
  statusText: {
    fontSize: 12,
    color: '#555',
  },
  statusTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  expandSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  expandBtn: {
    paddingVertical: 2,
  },
  expandText: {
    color: '#1976D2',
    fontSize: 13,
    fontWeight: '600',
  },
  syncAllBtn: {
    backgroundColor: '#1976D2',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  syncAllBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  subtaskArea: {
    marginTop: 8,
    backgroundColor: '#f4f7fa',
    padding: 10,
    borderRadius: 6,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#bbb',
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subtaskText: {
    fontSize: 15,
    color: '#252525',
  },
  subtaskTitleInput: {
    fontSize: 15,
    color: '#252525',
    borderBottomWidth: 1,
    borderBottomColor: '#1976D2',
    flex: 1,
    padding: 0,
  },
  subtaskDateButton: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 4,
    backgroundColor: '#fafafa',
  },
  subtaskDateText: {
    fontSize: 12,
    color: '#333',
  },
  syncSubtaskBtn: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#EDF3FD',
  },
  syncSubtaskText: {
    fontSize: 12,
    color: '#1976D2',
    fontWeight: '600',
  },
  subtaskDeleteBtn: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#FEE2E2',
  },
  subtaskDeleteText: {
    fontSize: 14,
    color: '#E53935',
    fontWeight: 'bold',
  },
  addSubtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  subtaskInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#eaeaea',
    backgroundColor: '#fff',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  addSubtaskBtn: {
    backgroundColor: 'rgba(25,118,210,0.06)',
    borderRadius: 7,
    marginLeft: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  modalBg: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    minWidth: 380,
    maxWidth: 500,
    maxHeight: '90%',
    shadowColor: '#1976d2',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 13,
    elevation: 7,
  },
  modalHeader: {
    fontSize: 19,
    fontWeight: '700',
    color: '#222',
    marginBottom: 14,
    textAlign: 'center',
  },
  label: {
    fontSize: 13,
    color: '#283147',
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e5ed',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    backgroundColor: '#f8fafc',
    color: '#222',
  },
  quadrantSelect: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  quadrantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e3eef4',
    backgroundColor: '#f7fafd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  quadrantBtnActive: {
    backgroundColor: '#1976D2',
    borderColor: '#1976D2',
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e5ed',
    marginRight: 8,
  },
  submitBtn: {
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1976D2',
  },
  datePickerModalBg: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  datePickerModalCard: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    minWidth: 350,
    maxWidth: 400,
    shadowColor: '#1976d2',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 13,
    elevation: 7,
  },
  datePickerHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
    marginBottom: 12,
    textAlign: 'center',
  },
  datePickerCloseBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
});

// ---------- 页面入口：原有「SMART任务记录」+ 子界面「目标拆解」----------
// 注：「任务池」已合并到「日历进度 → 双轨排程」页
const GOALS_PAGE_TABS = [
  { key: 'main', label: 'SMART任务记录' },
  { key: 'decompose', label: '目标拆解' },
];

export default function GoalsScreen() {
  const [subTab, setSubTab] = useState('main');
  return (
    <View style={{ flex: 1 }}>
      <SubTabBar tabs={GOALS_PAGE_TABS} active={subTab} onChange={setSubTab} />
      {subTab === 'main' ? <GoalsMain /> : <DecomposePanel />}
    </View>
  );
}
