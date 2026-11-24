/**
 * 应用内的确认框，替代 window.confirm。
 * 有些环境（比如嵌在别的应用里的浏览器面板）会直接屏蔽系统确认框，
 * window.confirm 一律返回 false，导致「删除」点了没反应。
 */
import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Req = { text: string; okText: string; danger: boolean; resolve: (v: boolean) => void };
let push: ((r: Req) => void) | null = null;

export function confirmAsync(text: string, opts?: { okText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise(resolve => {
    const req = { text, okText: opts?.okText ?? '确定', danger: opts?.danger ?? /删除|清空/.test(text), resolve };
    if (push) push(req);
    else resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : true);
  });
}

export default function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => {
    push = r => setReq(r);
    return () => {
      push = null;
    };
  }, []);
  if (!req) return null;
  const done = (v: boolean) => {
    req.resolve(v);
    setReq(null);
  };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => done(false)}>
      <View style={styles.mask}>
        <View style={styles.box}>
          <Text style={styles.text}>{req.text}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.cancel} onPress={() => done(false)}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ok, req.danger && styles.danger]} onPress={() => done(true)}>
              <Text style={styles.okText}>{req.okText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  box: { backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '100%', maxWidth: 400 },
  text: { fontSize: 15, color: '#1a1a2e', lineHeight: 22 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18 },
  cancel: { paddingVertical: 8, paddingHorizontal: 16, marginRight: 8 },
  cancelText: { color: '#607D8B', fontSize: 15 },
  ok: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 18 },
  danger: { backgroundColor: '#E53935' },
  okText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
