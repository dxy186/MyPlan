/**
 * 后台提醒：应用开着时每 30 秒检查一次，到点提醒。
 * - 能用系统通知就弹系统通知
 * - 同时在页面右上角显示提示、响一声、闪烁标签页标题（Claude 内置浏览器等不能弹系统通知的环境靠这个）
 * 放在根布局里，不管当前在哪个页面都生效。
 */
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { IN_APP_REMINDER_EVENT, InAppReminder, openTarget, reminderTick } from './followup';

function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.4);
    };
    play(880, 0);
    play(1175, 0.45);
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

let flashTimer: ReturnType<typeof setInterval> | null = null;
function flashTitle(text: string) {
  if (flashTimer) clearInterval(flashTimer);
  const original = document.title.replace(/^【.*?】/, '');
  let on = false;
  let n = 0;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? `【${text}】${original}` : original;
    if (++n > 40 || document.hasFocus()) {
      if (flashTimer) clearInterval(flashTimer);
      flashTimer = null;
      document.title = original;
    }
  }, 1000);
}

export default function ReminderService() {
  const [toasts, setToasts] = useState<InAppReminder[]>([]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const sent = new Set<string>();
    const run = () => {
      reminderTick(sent).catch(() => {});
    };
    run();
    const id = setInterval(run, 30000);

    const onReminder = (e: Event) => {
      const r = (e as CustomEvent<InAppReminder>).detail;
      setToasts(prev => [...prev.filter(t => t.key !== r.key), r].slice(-3));
      beep();
      if (!r.system) flashTitle('⏰ 提醒');
    };
    window.addEventListener(IN_APP_REMINDER_EVENT, onReminder);
    return () => {
      clearInterval(id);
      window.removeEventListener(IN_APP_REMINDER_EVENT, onReminder);
    };
  }, []);

  if (toasts.length === 0) return null;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {toasts.map(t => (
        <View key={t.key} style={styles.toast}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={t.target ? 0.7 : 1}
            onPress={() => {
              if (!t.target) return;
              openTarget(t.target);
              setToasts(prev => prev.filter(x => x.key !== t.key));
            }}
          >
            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.body}>{t.body}</Text>
            {t.target ? <Text style={styles.body}>👉 点这里打开</Text> : null}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setToasts(prev => prev.filter(x => x.key !== t.key))}>
            <Text style={styles.close}>知道了</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 12, right: 12, zIndex: 9999, width: 340, maxWidth: '90%' as unknown as number },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  title: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  body: { color: '#cfd6e4', fontSize: 13, lineHeight: 19 },
  close: { color: '#90CAF9', fontSize: 13, fontWeight: '600', marginLeft: 10, marginTop: 2 },
});
