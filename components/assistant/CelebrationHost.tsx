/**
 * 完成任务时的即时回报：小动画 + 提示音；
 * 今天的计划全部完成、今天第一次打卡（连续天数 +1）、断了一天又接上时，给更大的庆祝。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { todayStr } from '@/app/utils/planning';
import { KEYS, loadJSON } from '@/app/utils/planning';
import { ScheduleResult } from '@/app/utils/scheduler';
import { randomCheerImage } from '@/components/data/cheer-images';
import { fireConfetti } from '@/components/ui/confetti';
import { loadAppearance } from '@/components/data/appearance';
import { computeStreak } from '@/components/data/streak';

import { loadReviews } from './followup';
import { CELEBRATE_EVENT, allTasks, loadPlanState } from './plan-store';

type Show = { big: boolean; emoji: string; title: string; sub?: string; img?: string | null; allDone?: boolean };

function chime(big: boolean) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = big ? [784, 988, 1175, 1568] : [880, 1319];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.32);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

export default function CelebrationHost() {
  const [show, setShow] = useState<Show | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onDone = async (e: Event) => {
      const title = (e as CustomEvent<{ title: string }>).detail?.title ?? '';
      const today = todayStr();
      const [st, reviews] = await Promise.all([loadPlanState(), loadReviews()]);
      const reviewDates = reviews.map(r => r.date);
      const tasks = allTasks(st.goals).map(r => r.task).filter(t => !t.split);
      const doneToday = tasks.filter(t => t.done && t.doneAt && new Date(t.doneAt).toDateString() === new Date().toDateString());
      // 今天的计划：「今天做」/ 已到或已过截止的任务，加上排程排在今天的任务
      const sch = await loadJSON<ScheduleResult | null>(KEYS.schedule, null);
      const scheduledToday = new Set((sch?.items ?? []).filter(i => i.date === today && i.type === 'task' && i.taskId).map(i => i.taskId as string));
      const remaining = tasks.filter(
        t => !t.done && ((t.notBefore && t.notBefore <= today) || (t.due && t.due <= today) || scheduledToday.has(t.id))
      );
      const streak = computeStreak(st.goals, reviewDates);
      const firstToday = doneToday.length === 1 && !reviewDates.includes(today);
      const yesterdayStreak = computeStreak(st.goals, reviewDates.filter(d => d !== today));
      let s: Show;
      if (title === '今日复盘') {
        s = { big: true, emoji: '🌙', title: '今天复盘完成', sub: `🔥 连续 ${streak.current} 天 · 明天见` };
      } else if (remaining.length === 0 && doneToday.length >= 1 && title !== '试一下效果') {
        s = { big: true, allDone: true, emoji: '🎉', title: '今天的计划全部完成！', sub: `完成 ${doneToday.length} 项 · 🔥 连续 ${streak.current} 天 · 好好休息吧` };
      } else if (firstToday && streak.current >= 2) {
        s = { big: true, emoji: '🔥', title: `连续 ${streak.current} 天！`, sub: `「${title}」完成，今天已打卡` };
      } else if (firstToday && !yesterdayStreak.todayDone && streak.current === 1 && streak.best > 1) {
        s = { big: true, emoji: '💪', title: '重新开始也很棒', sub: '今天已打卡，明天继续就能连起来' };
      } else if (firstToday) {
        s = { big: true, emoji: '🌱', title: '今天已打卡', sub: `「${title}」完成` };
      } else {
        s = { big: false, emoji: '✅', title: `完成「${title}」`, sub: remaining.length ? `今天还剩 ${remaining.length} 项` : undefined };
      }
      if (title === '试一下效果') s = { big: true, emoji: '🎉', title: '这就是完成任务时的样子', sub: '每次随机一张' };
      if (title === '试一下全部完成') s = { big: true, allDone: true, emoji: '🎉', title: '今天的计划全部完成！', sub: '（预览）全部做完时会这样喷彩带' };
      s.img = await randomCheerImage();
      setShow(s);
      chime(s.big);
      if (s.allDone) {
        if ((await loadAppearance()).animations) fireConfetti();
        setTimeout(() => chime(true), 400);
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShow(null), s.allDone ? 4500 : s.img ? (s.big ? 3200 : 2400) : s.big ? 2600 : 1500);
    };
    window.addEventListener(CELEBRATE_EVENT, onDone);
    return () => window.removeEventListener(CELEBRATE_EVENT, onDone);
  }, []);

  if (!show) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.card, (show.big || show.img) && styles.cardBig, show.allDone && styles.cardAll]}>
        {show.img ? (
          <Image source={{ uri: show.img }} style={show.big ? styles.imgBig : styles.img} resizeMode="contain" />
        ) : null}
        <Text style={[styles.emoji, show.big && styles.emojiBig, !!show.img && { display: 'none' }]}>{show.big ? `${show.emoji}✨${show.emoji}` : show.emoji}</Text>
        <Text style={[styles.title, (show.big || !!show.img) && styles.titleBig]} numberOfLines={2}>
          {show.title}
        </Text>
        {show.sub ? <Text style={styles.sub}>{show.sub}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 70, zIndex: 10000 },
  card: {
    backgroundColor: '#1B5E20',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    maxWidth: 420,
  },
  cardAll: { borderColor: '#FF7043', borderWidth: 3, paddingVertical: 26, paddingHorizontal: 40 },
  cardBig: { backgroundColor: '#fff', borderWidth: 2, borderColor: '#FFD54F', paddingVertical: 20, paddingHorizontal: 32 },
  emoji: { fontSize: 22 },
  emojiBig: { fontSize: 44, marginBottom: 6 },
  title: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  img: { width: 120, height: 120, borderRadius: 12, marginBottom: 8 },
  imgBig: { width: 200, height: 200, borderRadius: 14, marginBottom: 10 },
  titleBig: { color: '#1a1a2e', fontSize: 22 },
  sub: { color: '#607D8B', fontSize: 14, marginTop: 4, textAlign: 'center' },
});
