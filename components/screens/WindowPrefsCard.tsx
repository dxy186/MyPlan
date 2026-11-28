/** 设置 → 外观最下面（只在桌面版）：点 × 是退到托盘还是直接退出、呼出 / 收起窗口的快捷键 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Prefs = { closeAction: 'tray' | 'quit'; hotkey: string; hotkeyOk: boolean; defaultHotkey?: string; flashOnRemind?: boolean };
type Desk = {
  version?: string;
  getWindowPrefs?: () => Promise<Prefs>;
  setWindowPrefs?: (p: Partial<Prefs>) => Promise<Prefs>;
  quit?: () => void;
};
const desk = (): Desk | null => (typeof window !== 'undefined' ? ((window as unknown as { myplanDesktop?: Desk }).myplanDesktop ?? null) : null);

/** 键盘事件 → Electron 的快捷键写法（Ctrl+Alt+M） */
function toAccelerator(e: KeyboardEvent): string | null {
  const k = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(k)) return null;
  let key = '';
  if (/^[a-z0-9]$/i.test(k)) key = k.toUpperCase();
  else if (/^F([1-9]|1[0-2])$/.test(k)) key = k;
  else if (k === ' ') key = 'Space';
  else if (/^Arrow(Up|Down|Left|Right)$/.test(k)) key = k.replace('Arrow', '');
  else if (e.code && /^(Key|Digit)/.test(e.code)) key = e.code.replace(/^(Key|Digit)/, '');
  else if (['`', '-', '=', '[', ']', ';', "'", ',', '.', '/', '\\'].includes(k)) key = k === '`' ? '`' : k;
  else return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean) as string[];
  // 单个字母、数字当全局快捷键会抢走正常打字：至少要带一个 Ctrl / Alt / Win（F 键除外）
  if (!mods.some(m => m !== 'Shift') && !/^F\d+$/.test(key)) return '';
  return [...mods, key].join('+');
}

export default function WindowPrefsCard() {
  const d = desk();
  const [p, setP] = useState<Prefs | null>(null);
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    d?.getWindowPrefs?.().then(setP).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!recording) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        setMsg('');
        return;
      }
      const acc = toAccelerator(e);
      if (acc === null) return; // 只按了修饰键，继续等
      if (acc === '') {
        setMsg('要带上 Ctrl、Alt 或 Win 键（比如 Ctrl+Alt+M），不然打字时会误触发。再按一次试试，Esc 取消。');
        return;
      }
      setRecording(false);
      const r = await d?.setWindowPrefs?.({ hotkey: acc });
      if (r) setP(prev => ({ ...(prev as Prefs), ...r }));
      setMsg(r?.hotkeyOk ? `✅ 快捷键改成 ${acc}` : `❌ ${acc} 被别的软件占用了，换一个试试`);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  if (!d?.getWindowPrefs) return null;

  const setClose = async (v: 'tray' | 'quit') => {
    const r = await d.setWindowPrefs?.({ closeAction: v });
    if (r) setP(prev => ({ ...(prev as Prefs), ...r }));
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🖥️ 窗口与快捷键（桌面版）</Text>

      <Text style={styles.label}>点窗口右上角的 × 时</Text>
      <View style={styles.chips}>
        {(
          [
            ['tray', '收到托盘里（到点照样提醒）'],
            ['quit', '直接退出'],
          ] as const
        ).map(([v, t]) => (
          <TouchableOpacity key={v} style={[styles.chip, p?.closeAction === v && styles.chipOn]} onPress={() => setClose(v)}>
            <Text style={[styles.chipText, p?.closeAction === v && styles.chipTextOn]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>
        收到托盘时，MyPlan 还在后台运行（右下角托盘里有图标），提醒照常弹出。想彻底关掉：右键托盘图标 →「彻底退出」，或者点下面的按钮。
      </Text>

      <Text style={[styles.label, { marginTop: 14 }]}>到点提醒时让图标闪烁</Text>
      <View style={styles.chips}>
        {[true, false].map(v => (
          <TouchableOpacity
            key={String(v)}
            style={[styles.chip, (p?.flashOnRemind !== false) === v && styles.chipOn]}
            onPress={async () => {
              const r = await d.setWindowPrefs?.({ flashOnRemind: v });
              if (r) setP(prev => ({ ...(prev as Prefs), ...r }));
            }}
          >
            <Text style={[styles.chipText, (p?.flashOnRemind !== false) === v && styles.chipTextOn]}>{v ? '闪' : '不闪'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>
        任务栏上的 MyPlan 图标会闪橙色，右下角托盘图标也会一闪一闪，点开 MyPlan 或开始计时就停。窗口收在托盘里时，会先以最小化的样子放回任务栏再闪（不会弹到前面打断你）。
      </Text>

      <Text style={[styles.label, { marginTop: 14 }]}>呼出 / 收起窗口的快捷键</Text>
      <View style={styles.chips}>
        <View style={styles.keyBox}>
          <Text style={styles.keyText}>{recording ? '请按下新的组合键…' : p?.hotkey || '（不用快捷键）'}</Text>
        </View>
        <TouchableOpacity style={[styles.chip, recording && styles.chipOn]} onPress={() => { setMsg(''); setRecording(r => !r); }}>
          <Text style={[styles.chipText, recording && styles.chipTextOn]}>{recording ? '取消' : '修改'}</Text>
        </TouchableOpacity>
        {!!p?.hotkey && (
          <TouchableOpacity
            style={styles.chip}
            onPress={async () => {
              const r = await d.setWindowPrefs?.({ hotkey: '' });
              if (r) setP(prev => ({ ...(prev as Prefs), ...r }));
              setMsg('已关掉快捷键');
            }}
          >
            <Text style={styles.chipText}>不用快捷键</Text>
          </TouchableOpacity>
        )}
        {p?.defaultHotkey && p.hotkey !== p.defaultHotkey && (
          <TouchableOpacity
            style={styles.chip}
            onPress={async () => {
              const r = await d.setWindowPrefs?.({ hotkey: p.defaultHotkey });
              if (r) setP(prev => ({ ...(prev as Prefs), ...r }));
              setMsg(r?.hotkeyOk ? `✅ 改回 ${p.defaultHotkey}` : `❌ ${p.defaultHotkey} 被别的软件占用了`);
            }}
          >
            <Text style={styles.chipText}>恢复默认（{p.defaultHotkey}）</Text>
          </TouchableOpacity>
        )}
      </View>
      {p && p.hotkey && !p.hotkeyOk ? <Text style={styles.err}>这个快捷键被别的软件占用了，现在按了没反应，换一个吧。</Text> : null}
      {!!msg && <Text style={styles.msg}>{msg}</Text>}
      <Text style={styles.hint}>在任何软件里按这个组合键：MyPlan 没在前面就弹出来，已经在前面就收起来。</Text>

      <View style={[styles.chips, { marginTop: 14 }]}>
        <TouchableOpacity style={styles.quitBtn} onPress={() => d.quit?.()}>
          <Text style={styles.quitText}>彻底退出 MyPlan</Text>
        </TouchableOpacity>
        {!!d.version && <Text style={styles.hint}>当前版本 {d.version}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E3E8EF', marginTop: 14, maxWidth: 820 },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#37474F', marginBottom: 6 },
  hint: { fontSize: 12, color: '#90A4AE', marginTop: 6, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 16, paddingVertical: 5, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  chipText: { fontSize: 13, color: '#455A64' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  keyBox: { borderWidth: 1, borderColor: '#B0BEC5', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#F5F7FA', minWidth: 140 },
  keyText: { fontSize: 14, fontWeight: '700', color: '#263238' },
  msg: { fontSize: 13, color: '#2E7D32', marginTop: 6 },
  err: { fontSize: 13, color: '#E53935', marginTop: 6 },
  quitBtn: { backgroundColor: '#FFEBEE', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14, borderWidth: 1, borderColor: '#FFCDD2' },
  quitText: { color: '#C62828', fontSize: 14, fontWeight: '600' },
});
