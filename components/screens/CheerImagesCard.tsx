/** 设置 → 提醒：管理「完成任务时随机弹出的鼓励图片」 */
import React, { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fileToImage, imagesFromTransfer, pickImageFiles } from '@/components/assistant/image-attach';
import { CELEBRATE_EVENT } from '@/components/assistant/plan-store';
import { CheerImage, MAX_CHEER, loadCheerImages, saveCheerImages } from '@/components/data/cheer-images';
import { confirmAsync } from '@/components/ui/confirm';

export default function CheerImagesCard() {
  const [list, setList] = useState<CheerImage[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    loadCheerImages().then(setList);
  }, []);

  const add = useCallback(async (files: File[]) => {
    if (!files.length) return;
    try {
      const cur = await loadCheerImages();
      const room = MAX_CHEER - cur.length;
      if (room <= 0) return setMsg(`最多 ${MAX_CHEER} 张，先删掉几张`);
      const made = await Promise.all(files.slice(0, room).map(f => fileToImage(f, 480, 0.82)));
      const next = [...cur, ...made.map(m => ({ id: m.id, dataUrl: m.dataUrl }))];
      await saveCheerImages(next);
      setList(next);
      setMsg(`✅ 加了 ${made.length} 张`);
    } catch (e: any) {
      setMsg('❌ ' + (e?.message || String(e)));
    }
  }, []);

  // 在这个页面 Ctrl+V 粘贴图片也能加
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesFromTransfer(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [add]);

  const remove = async (id: string) => {
    const next = list.filter(x => x.id !== id);
    await saveCheerImages(next);
    setList(next);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🎉 完成任务时的鼓励图片</Text>
      <Text style={styles.muted}>
        勾掉任务时，从这里随机挑一张跟庆祝一起弹出来。可以点「上传」选图（能多选），也可以在这个页面直接 Ctrl+V 粘贴。图片只存在这台电脑上，导出备份时会一起带走。
      </Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={async () => add(await pickImageFiles())}>
          <Text style={styles.btnText}>🖼️ 上传图片</Text>
        </TouchableOpacity>
        {list.length > 0 && (
          <TouchableOpacity
            style={styles.ghost}
            onPress={() => window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: { title: '试一下效果' } }))}
          >
            <Text style={styles.link}>👀 试一下</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.ghost}
          onPress={() => window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: { title: '试一下全部完成' } }))}
        >
          <Text style={styles.link}>🎊 预览「全部完成」</Text>
        </TouchableOpacity>
        {list.length > 0 && (
          <TouchableOpacity
            style={styles.ghost}
            onPress={async () => {
              if (!(await confirmAsync(`删除全部 ${list.length} 张鼓励图片？`))) return;
              await saveCheerImages([]);
              setList([]);
            }}
          >
            <Text style={styles.del}>全部删除</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.muted}>
          {list.length}/{MAX_CHEER} 张
        </Text>
      </View>
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      <View style={styles.grid}>
        {list.map(im => (
          <View key={im.id} style={styles.thumbBox}>
            <Image source={{ uri: im.dataUrl }} style={styles.thumb} resizeMode="cover" />
            <TouchableOpacity style={styles.x} onPress={() => remove(im.id)}>
              <Text style={styles.xText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {list.length === 0 && <Text style={styles.muted}>还没有图片，完成任务时只显示文字和动画。</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E3E8EF', marginTop: 14, maxWidth: 820 },
  title: { fontSize: 17, fontWeight: '700', color: '#1a1a2e', marginBottom: 6 },
  muted: { fontSize: 13, color: '#78909C', lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 10, gap: 10 },
  btn: { backgroundColor: '#1976D2', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  ghost: { paddingVertical: 7, paddingHorizontal: 6 },
  link: { color: '#1976D2', fontSize: 14, fontWeight: '600' },
  del: { color: '#E53935', fontSize: 14 },
  msg: { fontSize: 13, color: '#2E7D32', marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  thumbBox: { width: 84, height: 84, borderRadius: 10, overflow: 'hidden', marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#E3E8EF' },
  thumb: { width: '100%', height: '100%' },
  x: { position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  xText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
