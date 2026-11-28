/** 设置 → 🎨 外观：皮肤、背景图、透明度、缩放、侧边栏、动画 */
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { fileToImage, pickImageFiles } from '@/components/assistant/image-attach';
import {
  APPEARANCE_EVENT,
  Appearance,
  DEFAULT_APPEARANCE,
  SKINS,
  desktopBridge,
  loadAppearance,
  loadWallpaper,
  resetAppearance,
  saveAppearance,
  saveWallpaper,
} from '@/components/data/appearance';
import { confirmAsync } from '@/components/ui/confirm';
import WindowPrefsCard from './WindowPrefsCard';

function Steps({
  value,
  options,
  onPick,
  fmt = v => `${Math.round(v * 100)}%`,
}: {
  value: number;
  options: number[];
  onPick: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <View style={styles.chips}>
      {options.map(v => {
        const on = Math.abs(v - value) < 0.001;
        return (
          <TouchableOpacity key={v} style={[styles.chip, on && styles.chipOn]} onPress={() => onPick(v)}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{fmt(v)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** 拖动条 + 数字 + −/＋：百分比，min~max（整数 %） */
function Slider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (pct: number) => void }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(value)), [value]);
  const clampPct = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const commit = (n: number) => {
    if (!Number.isFinite(n)) return setTxt(String(value));
    onChange(clampPct(n));
  };
  return (
    <View style={styles.sliderRow}>
      <TouchableOpacity style={styles.stepBtn} onPress={() => commit(value - 5)}>
        <Text style={styles.stepText}>−</Text>
      </TouchableOpacity>
      {React.createElement('input', {
        type: 'range',
        min,
        max,
        step: 1,
        value,
        onChange: (e: { target: { value: string } }) => commit(Number(e.target.value)),
        style: { flex: 1, minWidth: 160, maxWidth: 360, accentColor: '#1976D2', cursor: 'pointer' },
      })}
      <TouchableOpacity style={styles.stepBtn} onPress={() => commit(value + 5)}>
        <Text style={styles.stepText}>＋</Text>
      </TouchableOpacity>
      <TextInput
        style={styles.pctInput}
        value={txt}
        onChangeText={t => setTxt(t.replace(/[^0-9]/g, ''))}
        onBlur={() => commit(Number(txt))}
        onSubmitEditing={() => commit(Number(txt))}
        keyboardType="numeric"
      />
      <Text style={styles.pctSign}>%</Text>
    </View>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.rowBox}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export default function AppearancePanel() {
  const [ap, setAp] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [wall, setWall] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const isDesktop = !!desktopBridge()?.setOpacity;

  useEffect(() => {
    const load = async () => {
      setAp(await loadAppearance());
      setWall(await loadWallpaper());
    };
    load();
    window.addEventListener(APPEARANCE_EVENT, load);
    return () => window.removeEventListener(APPEARANCE_EVENT, load);
  }, []);

  const set = async (patch: Partial<Appearance>) => {
    setAp(a => ({ ...a, ...patch }));
    await saveAppearance(patch);
  };

  const pickWall = async () => {
    const files = await pickImageFiles();
    if (!files[0]) return;
    try {
      const img = await fileToImage(files[0], 1920, 0.85);
      await saveWallpaper(img.dataUrl);
      setWall(img.dataUrl);
      // 刚换背景图时，让底色透一点，背景才看得见
      if (ap.contentOpacity >= 1) await set({ contentOpacity: 0.6 });
      setMsg('✅ 背景图换好了');
    } catch (e) {
      setMsg(`没换成：${(e as Error).message}`);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.card}>
        <Text style={styles.title}>🎨 皮肤</Text>
        <View style={styles.skins}>
          {SKINS.map(s => {
            const on = ap.skin === s.key;
            return (
              <TouchableOpacity key={s.key} style={[styles.skin, on && styles.skinOn]} onPress={() => set({ skin: s.key })}>
                <View style={styles.swatch}>
                  <View style={[styles.swSide, { backgroundColor: s.sidebar }, s.border ? { borderRightWidth: 1, borderRightColor: s.border } : null]}>
                    <View style={[styles.swDot, { backgroundColor: s.logo }]} />
                    <View style={[styles.swBar, { backgroundColor: s.navActiveBg }]} />
                  </View>
                  <View style={[styles.swMain, { backgroundColor: s.dark ? '#1c1f26' : s.content }]}>
                    <View style={[styles.swCard, { backgroundColor: s.dark ? '#2a2e37' : '#fff' }]} />
                  </View>
                </View>
                <Text style={[styles.skinName, on && { color: '#1976D2', fontWeight: '700' }]}>{s.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.hint}>深色模式把内容区整体换成深色，图片会保持原色。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>🖼️ 背景图</Text>
        <View style={styles.wallRow}>
          {wall ? <Image source={{ uri: wall }} style={styles.wallThumb} /> : <View style={[styles.wallThumb, styles.wallEmpty]}><Text style={styles.hint}>没有</Text></View>}
          <View style={{ gap: 8 }}>
            <TouchableOpacity style={styles.btn} onPress={pickWall}>
              <Text style={styles.btnText}>{wall ? '换一张' : '上传背景图'}</Text>
            </TouchableOpacity>
            {wall && (
              <TouchableOpacity
                onPress={async () => {
                  await saveWallpaper(null);
                  setWall(null);
                }}
              >
                <Text style={styles.del}>去掉背景图</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {!!msg && <Text style={styles.msg}>{msg}</Text>}
        {wall && (
          <>
            <Row label="背景透出" hint="内容区底色有多透：越高，背景图越清楚。">
              <Slider value={Math.round((1 - ap.contentOpacity) * 100)} min={0} max={100} onChange={p => set({ contentOpacity: 1 - p / 100 })} />
            </Row>
            <Row label="背景模糊">
              <Steps value={ap.wallpaperBlur} options={[0, 4, 10, 20]} fmt={v => (v === 0 ? '不模糊' : v <= 4 ? '轻' : v <= 10 ? '中' : '重')} onPick={v => set({ wallpaperBlur: v })} />
            </Row>
            <Row label="背景压暗" hint="背景图太花、字看不清时调高。">
              <Steps value={ap.wallpaperDim} options={[0, 0.15, 0.3, 0.5]} fmt={v => (v === 0 ? '不压' : `${Math.round(v * 100)}%`)} onPick={v => set({ wallpaperDim: v })} />
            </Row>
          </>
        )}
        <Text style={styles.hint}>图片只存在这台电脑上（会压缩到 1920px 以内），导出备份时会一起带走。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>🔍 透明度</Text>
        <Row label="卡片不透明度" hint="白色卡片、面板有多实：调低能透出底色或背景图。字不受影响。">
          <Slider value={Math.round(ap.cardOpacity * 100)} min={5} max={100} onChange={p => set({ cardOpacity: p / 100 })} />
        </Row>
        <Row
          label="整个窗口的不透明度"
          hint={
            isDesktop
              ? '只让背景变透明、能看到后面的桌面，字始终 100% 清楚。调到 100% 以下时窗口会换成透明窗口（会闪一下）：这时不能拖边框改大小，用右上角的 ☐ 最大化 / 还原。调太低看不清了：按 Ctrl+Shift+0，或右键托盘图标 →「窗口恢复不透明」。'
              : '这个只在桌面版里能用（能看到窗口后面的桌面）；网页版可以用上面的背景图 + 透明度。'
          }
        >
          {isDesktop ? (
            <Slider value={Math.round(ap.windowOpacity * 100)} min={5} max={100} onChange={p => set({ windowOpacity: p / 100 })} />
          ) : null}
        </Row>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>📐 布局</Text>
        <Row label="界面大小" hint="字和按钮整体放大 / 缩小。">
          <Steps value={ap.zoom} options={[0.85, 0.9, 1, 1.1, 1.2]} onPick={v => set({ zoom: v })} />
        </Row>
        <Row label="侧边栏" hint="收起后只显示图标。侧边栏顶上的 « / » 也能切换，快捷键 Ctrl+B（Mac 是 ⌘B）。">
          <View style={styles.chips}>
            {[false, true].map(v => (
              <TouchableOpacity key={String(v)} style={[styles.chip, ap.sidebarCollapsed === v && styles.chipOn]} onPress={() => set({ sidebarCollapsed: v })}>
                <Text style={[styles.chipText, ap.sidebarCollapsed === v && styles.chipTextOn]}>{v ? '收起（只显示图标）' : '展开'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Row>
        <Row label="「全部完成」的彩带">
          <View style={styles.chips}>
            {[true, false].map(v => (
              <TouchableOpacity key={String(v)} style={[styles.chip, ap.animations === v && styles.chipOn]} onPress={() => set({ animations: v })}>
                <Text style={[styles.chipText, ap.animations === v && styles.chipTextOn]}>{v ? '开' : '关'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Row>
      </View>

      <WindowPrefsCard />
      {process.env.EXPO_PUBLIC_BUILD_TIME ? (
        <Text style={[styles.hint, { marginTop: 14 }]}>
          这一版页面更新于 {process.env.EXPO_PUBLIC_BUILD_TIME}（美东时间）。网页版刚更新过但没看到新功能：按 Ctrl+F5 强制刷新。
        </Text>
      ) : null}

      <TouchableOpacity
        style={styles.reset}
        onPress={async () => {
          if (!(await confirmAsync('外观恢复成默认（经典深蓝、不透明、100% 大小）？背景图会保留，可以单独去掉。'))) return;
          // 快捷键 Ctrl+Shift+0 也能只恢复透明度
          await resetAppearance();
          setAp(DEFAULT_APPEARANCE);
        }}
      >
        <Text style={styles.link}>↺ 外观恢复默认</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E3E8EF', marginTop: 14, maxWidth: 820 },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#37474F', marginBottom: 6 },
  hint: { fontSize: 12, color: '#90A4AE', marginTop: 6, lineHeight: 18 },
  rowBox: { marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#CFD8DC', borderRadius: 16, paddingVertical: 5, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#1976D2', borderColor: '#1976D2' },
  chipText: { fontSize: 13, color: '#455A64' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  skins: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  skin: { alignItems: 'center', padding: 6, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  skinOn: { borderColor: '#1976D2' },
  swatch: { width: 92, height: 58, borderRadius: 8, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: '#E3E8EF' },
  swSide: { width: 28, paddingTop: 8, alignItems: 'center', gap: 6 },
  swDot: { width: 10, height: 4, borderRadius: 2 },
  swBar: { width: 18, height: 6, borderRadius: 3 },
  swMain: { flex: 1, padding: 8 },
  swCard: { flex: 1, borderRadius: 4 },
  skinName: { fontSize: 13, color: '#455A64', marginTop: 6 },
  wallRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  wallThumb: { width: 160, height: 90, borderRadius: 8, borderWidth: 1, borderColor: '#E3E8EF' },
  wallEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F7FA' },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14, alignSelf: 'flex-start' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  del: { color: '#E53935', fontSize: 14 },
  msg: { fontSize: 13, color: '#2E7D32', marginTop: 8 },
  reset: { marginTop: 18, paddingVertical: 8 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  stepBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#CFD8DC', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  stepText: { fontSize: 16, color: '#455A64', fontWeight: '700' },
  pctInput: { width: 54, borderWidth: 1, borderColor: '#D6E0EE', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8, fontSize: 14, textAlign: 'right', backgroundColor: '#fff' },
  pctSign: { fontSize: 14, color: '#455A64' },
  link: { color: '#1976D2', fontSize: 14, fontWeight: '600' },
});
