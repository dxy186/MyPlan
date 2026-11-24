import React, { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  AI_CONFIG_KEY,
  applyBackup,
  BackupFile,
  backupFileName,
  buildBackup,
  downloadText,
  KeySummary,
  parseBackup,
  pickTextFile,
  readAllData,
  readUndoSnapshot,
  summarize,
  undoLastImport,
  wipeAllData,
  UndoSnapshot,
} from './backup';
import { confirmAsync } from '@/components/ui/confirm';

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '未知';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function SummaryList({ items }: { items: KeySummary[] }) {
  if (items.length === 0) return <Text style={styles.muted}>（没有数据）</Text>;
  return (
    <View style={styles.summary}>
      {items.map((it) => (
        <View key={it.key} style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>{it.label}</Text>
          <Text style={styles.summaryCount}>{it.count} 条</Text>
        </View>
      ))}
    </View>
  );
}

export default function BackupScreen() {
  const isWeb = Platform.OS === 'web';
  const [current, setCurrent] = useState<KeySummary[]>([]);
  const [includeAi, setIncludeAi] = useState(false);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [undo, setUndo] = useState<UndoSnapshot | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepAi, setKeepAi] = useState(true);

  const refresh = useCallback(async () => {
    setCurrent(summarize(await readAllData()));
    setUndo(await readUndoSnapshot());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasAi = current.some((s) => s.key === AI_CONFIG_KEY);
  const total = current.filter((s) => includeAi || s.key !== AI_CONFIG_KEY).length;

  const onExport = async () => {
    setMsg(null);
    try {
      const backup = await buildBackup(includeAi);
      downloadText(backupFileName(), JSON.stringify(backup, null, 2));
      setMsg({ text: '已生成备份文件。桌面版会弹出保存窗口，网页版会保存到浏览器的下载文件夹。' });
    } catch (e: any) {
      setMsg({ text: '导出失败：' + (e?.message || e), error: true });
    }
  };

  const onPick = async () => {
    setMsg(null);
    try {
      const text = await pickTextFile();
      if (text == null) return;
      setPending(parseBackup(text));
    } catch (e: any) {
      setPending(null);
      setMsg({ text: '无法读取：' + (e?.message || e), error: true });
    }
  };

  const onConfirmImport = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await applyBackup(pending);
      setMsg({ text: '导入成功，正在刷新…' });
      setTimeout(() => window.location.reload(), 600);
    } catch (e: any) {
      setMsg({ text: '导入失败：' + (e?.message || e), error: true });
      setBusy(false);
    }
  };

  const onUndo = async () => {
    setBusy(true);
    try {
      if (await undoLastImport()) {
        setMsg({ text: '已恢复到导入之前的数据，正在刷新…' });
        setTimeout(() => window.location.reload(), 600);
      } else {
        setBusy(false);
      }
    } catch (e: any) {
      setMsg({ text: '撤销失败：' + (e?.message || e), error: true });
      setBusy(false);
    }
  };

  if (!isWeb) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>💾 数据备份</Text>
        <Text style={styles.muted}>导出 / 导入目前只支持桌面版和网页版。</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.title}>💾 数据备份</Text>
      <Text style={styles.subtitle}>
        数据只保存在这台电脑上。换电脑、重装系统或清理缓存前，先导出一份备份文件。
      </Text>

      {msg && (
        <View style={[styles.msg, msg.error && styles.msgError]}>
          <Text style={[styles.msgText, msg.error && styles.msgTextError]}>{msg.text}</Text>
        </View>
      )}

      {/* 导出 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📤 导出</Text>
        <Text style={styles.muted}>当前数据：</Text>
        <SummaryList items={current} />
        {hasAi && (
          <TouchableOpacity style={styles.checkRow} onPress={() => setIncludeAi(!includeAi)}>
            <View style={[styles.checkbox, includeAi && styles.checkboxOn]}>
              {includeAi && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>同时导出 AI 设置（含 API Key，文件请勿外传）</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.primaryBtn, total === 0 && styles.btnDisabled]}
          disabled={total === 0}
          onPress={onExport}
        >
          <Text style={styles.primaryBtnText}>导出备份文件</Text>
        </TouchableOpacity>
      </View>

      {/* 导入 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📥 导入</Text>
        <Text style={styles.muted}>
          选择之前导出的 .json 备份文件。导入会用备份里的数据覆盖当前数据；备份里没有 AI 设置时，会保留现在的 AI 设置。
        </Text>
        {!pending ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={onPick} disabled={busy}>
            <Text style={styles.secondaryBtnText}>选择备份文件…</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>备份导出时间：{fmtTime(pending.exportedAt)}</Text>
            <SummaryList items={summarize(pending.data)} />
            <Text style={styles.warn}>⚠️ 确认后，当前数据会被替换。导入前的数据会自动保留一份，可以撤销。</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.dangerBtn, busy && styles.btnDisabled]}
                onPress={onConfirmImport}
                disabled={busy}
              >
                <Text style={styles.primaryBtnText}>确认导入</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPending(null)} disabled={busy}>
                <Text style={styles.secondaryBtnText}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* 撤销 */}
      {undo && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>↩️ 撤销上次导入</Text>
          <Text style={styles.muted}>
            {fmtTime(undo.savedAt)} 导入前的数据还保留着（{Object.keys(undo.data).length} 项）。
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onUndo} disabled={busy}>
            <Text style={styles.secondaryBtnText}>恢复到导入前</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 清空 */}
      <View style={[styles.card, { borderColor: '#FFCDD2' }]}>
        <Text style={styles.cardTitle}>🗑️ 清空这台电脑上的全部数据</Text>
        <Text style={styles.muted}>
          删掉任务、日历、固定日程、日记、精力、计时、复盘、鼓励图片和各种设置，回到刚安装时的空白状态。不能撤销——需要的话先在上面导出一份备份。
        </Text>
        <TouchableOpacity style={styles.checkRow} onPress={() => setKeepAi(!keepAi)}>
          <View style={[styles.checkbox, keepAi && { backgroundColor: '#1976D2', borderColor: '#1976D2' }]} />
          <Text style={styles.checkLabel}>保留 AI 设置（API Key），不用重新填</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryBtn, { backgroundColor: '#FFEBEE' }]}
          disabled={busy}
          onPress={async () => {
            if (!(await confirmAsync('确定清空这台电脑上的全部 MyPlan 数据吗？清空后不能恢复。', { okText: '清空', danger: true }))) return;
            setBusy(true);
            try {
              await wipeAllData(keepAi);
              if (typeof window !== 'undefined') window.location.reload();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Text style={[styles.secondaryBtnText, { color: '#C62828' }]}>清空全部数据</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 16 },
  muted: { fontSize: 14, color: '#666', marginBottom: 8, lineHeight: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    maxWidth: 640,
    borderWidth: 1,
    borderColor: '#E5E9F0',
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a2e', marginBottom: 10 },
  summary: { backgroundColor: '#F4F7FB', borderRadius: 8, padding: 10, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  summaryLabel: { fontSize: 14, color: '#333' },
  summaryCount: { fontSize: 14, color: '#1976D2', fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#90A4AE',
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { fontSize: 14, color: '#333' },
  primaryBtn: {
    backgroundColor: '#1976D2',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
  },
  dangerBtn: {
    backgroundColor: '#D84315',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginRight: 10,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
  },
  secondaryBtnText: { color: '#1976D2', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  btnRow: { flexDirection: 'row', alignItems: 'center' },
  preview: { marginTop: 4 },
  previewTitle: { fontSize: 14, color: '#333', fontWeight: '600', marginBottom: 8 },
  warn: { fontSize: 13, color: '#BF360C', marginBottom: 12 },
  msg: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    maxWidth: 640,
  },
  msgError: { backgroundColor: '#FFEBEE' },
  msgText: { color: '#2E7D32', fontSize: 14 },
  msgTextError: { color: '#C62828' },
});
