/**
 * 外观设置：皮肤、背景图、透明度、界面缩放、侧边栏收起。
 * 存在本机（@myplan_appearance / @myplan_wallpaper），改了马上生效，数据备份会一起导出。
 */
import { useEffect, useState } from 'react';

import { loadJSON, saveJSON } from '@/app/utils/planning';

export const APPEARANCE_KEY = '@myplan_appearance';
export const WALLPAPER_KEY = '@myplan_wallpaper';
export const APPEARANCE_EVENT = 'myplan:appearance-changed';

export type SkinKey = 'classic' | 'sakura' | 'mint' | 'sunset' | 'lavender' | 'light' | 'dark';

export type Skin = {
  key: SkinKey;
  name: string;
  /** 侧边栏 */
  sidebar: string;
  navText: string;
  navActiveBg: string;
  navActiveText: string;
  logo: string;
  /** 内容区底色 */
  content: string;
  /** 深色：内容区整体反色 */
  dark?: boolean;
  /** 侧边栏右边的分隔线（浅色侧边栏用） */
  border?: string;
};

export const SKINS: Skin[] = [
  { key: 'classic', name: '经典深蓝', sidebar: '#101523', navText: '#c7d0e0', navActiveBg: 'rgba(255,255,255,0.1)', navActiveText: '#fff', logo: '#fff', content: '#f7f8fa' },
  { key: 'sakura', name: '樱花粉', sidebar: '#F9D9E6', navText: '#8A4A68', navActiveBg: 'rgba(255,255,255,0.65)', navActiveText: '#C2185B', logo: '#C2185B', content: '#FFF6F9', border: '#F3C4D7' },
  { key: 'mint', name: '薄荷绿', sidebar: '#1F4E45', navText: '#CDE8E0', navActiveBg: 'rgba(255,255,255,0.14)', navActiveText: '#fff', logo: '#B9F3DF', content: '#F3FAF7' },
  { key: 'sunset', name: '暖阳橙', sidebar: '#4A2C2A', navText: '#F3D9CF', navActiveBg: 'rgba(255,255,255,0.13)', navActiveText: '#fff', logo: '#FFB38A', content: '#FFF8F2' },
  { key: 'lavender', name: '薰衣草', sidebar: '#E8E1F7', navText: '#5B4A86', navActiveBg: 'rgba(255,255,255,0.7)', navActiveText: '#4527A0', logo: '#5E35B1', content: '#F8F6FD', border: '#D9CFF0' },
  { key: 'light', name: '纯净白', sidebar: '#FFFFFF', navText: '#546E7A', navActiveBg: '#E3F2FD', navActiveText: '#1565C0', logo: '#1976D2', content: '#F4F6FA', border: '#E3E8EF' },
  { key: 'dark', name: '深色模式', sidebar: '#0B0E14', navText: '#AAB4C5', navActiveBg: 'rgba(255,255,255,0.1)', navActiveText: '#fff', logo: '#fff', content: '#f7f8fa', dark: true },
];

export type Appearance = {
  skin: SkinKey;
  /** 内容区底色的不透明度 0–1：设了背景图时，调低能透出背景 */
  contentOpacity: number;
  /** 卡片（白色、浅色块）的不透明度 0.05–1 */
  cardOpacity: number;
  /** 背景图模糊（px） */
  wallpaperBlur: number;
  /** 背景图上盖一层底色的浓度 0–0.8，让字更清楚 */
  wallpaperDim: number;
  /** 界面缩放 0.8–1.3 */
  zoom: number;
  /** 桌面版：整个窗口的不透明度 0.05–1 */
  windowOpacity: number;
  /** 侧边栏收起（只显示图标） */
  sidebarCollapsed: boolean;
  /** 完成任务时的彩带 / 鼓励动画 */
  animations: boolean;
};

export const DEFAULT_APPEARANCE: Appearance = {
  skin: 'classic',
  contentOpacity: 1,
  cardOpacity: 1,
  wallpaperBlur: 0,
  wallpaperDim: 0.25,
  zoom: 1,
  windowOpacity: 1,
  sidebarCollapsed: false,
  animations: true,
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function normalizeAppearance(raw: Partial<Appearance> | null | undefined): Appearance {
  const r = raw || {};
  return {
    skin: SKINS.some(s => s.key === r.skin) ? (r.skin as SkinKey) : 'classic',
    contentOpacity: clamp(r.contentOpacity, 0, 1, 1),
    cardOpacity: clamp(r.cardOpacity, 0.05, 1, 1),
    wallpaperBlur: clamp(r.wallpaperBlur, 0, 30, 0),
    wallpaperDim: clamp(r.wallpaperDim, 0, 0.8, 0.25),
    zoom: clamp(r.zoom, 0.8, 1.3, 1),
    windowOpacity: clamp(r.windowOpacity, 0.05, 1, 1),
    sidebarCollapsed: !!r.sidebarCollapsed,
    animations: r.animations !== false,
  };
}

export function skinOf(a: Appearance): Skin {
  return SKINS.find(s => s.key === a.skin) ?? SKINS[0];
}

/** 页面一打开就同步读出来（避免先闪一下默认样式） */
export function readAppearanceSync(): Appearance {
  try {
    if (typeof localStorage !== 'undefined') return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || 'null'));
  } catch {}
  return { ...DEFAULT_APPEARANCE };
}
export function readWallpaperSync(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(WALLPAPER_KEY);
      return v ? (JSON.parse(v) as string | null) : null;
    }
  } catch {}
  return null;
}

export async function loadAppearance(): Promise<Appearance> {
  return normalizeAppearance(await loadJSON<Partial<Appearance> | null>(APPEARANCE_KEY, null));
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

export async function saveAppearance(patch: Partial<Appearance>): Promise<Appearance> {
  const next = normalizeAppearance({ ...(await loadAppearance()), ...patch });
  await saveJSON(APPEARANCE_KEY, next);
  notify();
  return next;
}

export async function resetAppearance(): Promise<void> {
  await saveJSON(APPEARANCE_KEY, DEFAULT_APPEARANCE);
  notify();
}

export async function loadWallpaper(): Promise<string | null> {
  return loadJSON<string | null>(WALLPAPER_KEY, null);
}
export async function saveWallpaper(dataUrl: string | null): Promise<void> {
  await saveJSON(WALLPAPER_KEY, dataUrl);
  notify();
}

/** 桌面版才有：整个窗口的透明度 */
export function desktopBridge(): { setOpacity?: (v: number) => void } | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { myplanDesktop?: { setOpacity?: (v: number) => void } }).myplanDesktop ?? null);
}

/**
 * 卡片现在该有多不透明（卡片不透明度 ×（桌面玻璃窗口时）窗口不透明度），跟着外观设置实时变。
 * 给自己固定颜色、又要跟着整体变透明的卡片用。
 */
export function useCardAlpha(): number {
  const calc = () => {
    const a = readAppearanceSync();
    const glass = !!(desktopBridge() as { glass?: boolean } | null)?.glass;
    return a.cardOpacity * (glass ? a.windowOpacity : 1);
  };
  const [v, setV] = useState(calc);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = () => setV(calc());
    window.addEventListener(APPEARANCE_EVENT, on);
    return () => window.removeEventListener(APPEARANCE_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}
