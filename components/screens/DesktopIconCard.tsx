/** 设置 → 提醒（最下面）：把桌面版的图标换成自己的图片（只在桌面版里能用） */
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fileToImage, pickImageFiles } from '@/components/assistant/image-attach';

type Desk = { version?: string; setIcon?: (d: string) => Promise<{ shortcuts: number }>; resetIcon?: () => Promise<{ shortcuts: number }>; hasIcon?: () => Promise<boolean> };
const desk = (): Desk | null => (typeof window !== 'undefined' ? ((window as any).myplanDesktop as Desk) ?? null : null);

export default function DesktopIconCard() {
  const d = desk();
  const [has, setHas] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    d?.hasIcon?.().then(setHas).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🖼️ 桌面图标</Text>
      {!!d?.version && <Text style={styles.muted}>当前桌面版版本：{d.version}</Text>}
      {!d?.setIcon ? (
        <Text style={styles.muted}>这个功能只在桌面版（MyPlan-Setup 安装的那个）里能用：选一张图片，桌面快捷方式、开始菜单、任务栏和托盘的图标都会换成它。</Text>
      ) : (
        <>
          <Text style={styles.muted}>
            选一张图片，桌面快捷方式、开始菜单、窗口和托盘的图标都会换成它（只存在这台电脑上）。正方形、清晰一点的图效果最好；不是正方形会自动补白边。
          </Text>
          <View style={styles.row}>
            {preview ? <Image source={{ uri: preview }} style={styles.preview} /> : null}
            <TouchableOpacity
              style={[styles.btn, busy && { opacity: 0.5 }]}
              disabled={busy}
              onPress={async () => {
                const files = await pickImageFiles();
                if (!files[0]) return;
                setBusy(true);
                setMsg('');
                try {
                  const im = await fileToImage(files[0], 512, 0.95);
                  setPreview(im.dataUrl);
                  const r = await d.setIcon!(im.dataUrl);
                  setHas(true);
                  setMsg(
                    `✅ 换好了，改了 ${r.shortcuts} 个快捷方式。桌面图标如果还没变，在桌面空白处按一下 F5 刷新；任务栏上的图标重启 MyPlan 后更新。`
                  );
                } catch (e: any) {
                  setMsg('❌ ' + (e?.message || String(e)));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text style={styles.btnText}>选择图片</Text>
            </TouchableOpacity>
            {has && (
              <TouchableOpacity
                disabled={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await d.resetIcon!();
                    setHas(false);
                    setPreview(null);
                    setMsg('已恢复默认图标（桌面按 F5 刷新）');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Text style={styles.link}>恢复默认图标</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E3E8EF', marginTop: 14, maxWidth: 820 },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  muted: { fontSize: 13, color: '#78909C', lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' },
  preview: { width: 56, height: 56, borderRadius: 10, borderWidth: 1, borderColor: '#E3E8EF' },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  link: { color: '#1976D2', fontSize: 14 },
  msg: { fontSize: 13, color: '#37474F', marginTop: 8, lineHeight: 19 },
});
