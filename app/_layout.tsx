import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

import AssistantScreen, { FOCUS_ASSISTANT_EVENT } from '../components/assistant/AssistantScreen';
import CalendarPage from '../components/screens/CalendarScreen';
import ReviewScreen from '../components/screens/ReviewScreen';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import SettingsScreen from '../components/screens/SettingsScreen';
import TasksScreen from '../components/screens/TasksScreen';
import ReminderService from '../components/assistant/ReminderService';
import { ASK_AI_EVENT } from '../components/assistant/ask-bridge';
import BreakdownHost from '../components/assistant/BreakdownHost';
import CelebrationHost from '../components/assistant/CelebrationHost';
import { OPEN_TARGET_EVENT, OpenTarget } from '../components/assistant/followup';
import { requestOpenToday } from '../components/assistant/nav-bridge';
import { useTodayStr } from '../hooks/use-today';
import ConfirmHost from '../components/ui/confirm';
import {
  APPEARANCE_EVENT,
  Appearance,
  desktopBridge,
  loadAppearance,
  loadWallpaper,
  readAppearanceSync,
  readWallpaperSync,
  saveAppearance,
  skinOf,
} from '../components/data/appearance';

/** 把浅色块（卡片、面板）的底色改成半透明：react-native-web 把样式编译成 .r-xxx 原子类，按颜色找出来覆盖 */
function cardOverrideCss(alpha: number): string {
  if (typeof document === 'undefined' || alpha >= 1) return '';
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ss of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = ss.cssRules;
    } catch {
      continue;
    }
    for (const r of Array.from(rules)) {
      const st = r as CSSStyleRule;
      if (!st.selectorText || !/^\.r-[\w-]+$/.test(st.selectorText) || seen.has(st.selectorText)) continue;
      const m = st.style?.backgroundColor?.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      if (!m) continue;
      const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (Math.min(a, b, c) < 232) continue;
      seen.add(st.selectorText);
      out.push(`#myplan-content ${st.selectorText}{background-color:rgba(${a},${b},${c},${alpha})!important}`);
    }
  }
  return out.join('\n');
}

const NAVS = [
  { name: '日历', key: 'calendar', icon: '📅' },
  { name: '今天', key: 'today', icon: '🏠' },
  { name: '任务', key: 'tasks', icon: '📋' },
  { name: '复盘', key: 'review', icon: '📊' },
  { name: '设置', key: 'settings', icon: '⚙️' },
];

export default function RootLayout() {
  const [activeKey, setActiveKey] = useState('calendar');
  const { width } = useWindowDimensions();
  const [ap, setAp] = useState<Appearance>(readAppearanceSync);
  const [wallpaper, setWallpaper] = useState<string | null>(readWallpaperSync);
  const skin = skinOf(ap);
  const collapsed = ap.sidebarCollapsed;

  // 外观设置改了马上生效
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reload = async () => {
      setAp(await loadAppearance());
      setWallpaper(await loadWallpaper());
    };
    window.addEventListener(APPEARANCE_EVENT, reload);
    return () => window.removeEventListener(APPEARANCE_EVENT, reload);
  }, []);

  // 桌面版：托盘「窗口恢复不透明」→ 设置里也改回 100%
  useEffect(() => {
    const d = desktopBridge() as { onOpacityReset?: (cb: () => void) => void } | null;
    d?.onOpacityReset?.(() => {
      saveAppearance({ windowOpacity: 1 });
    });
  }, []);

  // 桌面版没有系统标题栏：顶上留一条能拖动窗口的区域，右上角按钮颜色跟着背景深浅
  const frameless = !!(desktopBridge() as { frameless?: boolean } | null)?.frameless;
  // 桌面版「玻璃窗口」：窗口不透明度 < 100% 时，只把各层背景按比例变透明，文字始终 100% 不透明
  const glass = !!(desktopBridge() as { glass?: boolean } | null)?.glass;
  const winA = glass ? ap.windowOpacity : 1;
  useEffect(() => {
    const d = desktopBridge() as { setTitleBar?: (o: { symbolColor: string }) => void } | null;
    const darkBg = skin.dark || (!!wallpaper && (ap.wallpaperDim >= 0.3 || ap.contentOpacity <= 0.5));
    d?.setTitleBar?.({ symbolColor: darkBg ? '#FFFFFF' : '#37474F' });
  }, [skin.dark, wallpaper, ap.wallpaperDim, ap.contentOpacity]);

  // 桌面版：整个窗口的透明度
  useEffect(() => {
    desktopBridge()?.setOpacity?.(ap.windowOpacity);
  }, [ap.windowOpacity]);

  // 缩放、深色、卡片透明：写成一段 CSS 挂到页面上
  const [cardCss, setCardCss] = useState('');
  useEffect(() => {
    if (ap.cardOpacity * winA >= 1) {
      setCardCss('');
      return;
    }
    // 新页面打开时会生成新的样式类：切页后和每隔几秒补一次
    const run = () => setCardCss(cardOverrideCss(ap.cardOpacity * winA));
    const t0 = setTimeout(run, 60);
    const iv = setInterval(run, 3000);
    return () => {
      clearTimeout(t0);
      clearInterval(iv);
    };
  }, [ap.cardOpacity, activeKey, winA]);
  const css = useMemo(() => {
    const z = ap.zoom;
    const lines = [
      `#myplan-root{zoom:${z};height:calc(100vh / ${z})!important}`,
      '#myplan-drag{-webkit-app-region:drag;app-region:drag}',
      ap.skin === 'dark'
        ? `#myplan-content{filter:invert(0.92) hue-rotate(180deg)}#myplan-content img,#myplan-content video,#myplan-content canvas,#myplan-content [style*="background-image"]{filter:invert(1) hue-rotate(180deg)}`
        : '',
      cardCss,
      // 玻璃窗口：页面最外层不画底色，让桌面透出来
      glass ? 'html,body,#root{background:transparent!important}' : '',
    ];
    return lines.filter(Boolean).join('\n');
  }, [ap.zoom, ap.skin, cardCss, glass]);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let el = document.getElementById('myplan-appearance-css') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'myplan-appearance-css';
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [css]);

  const toggleSidebar = () => {
    setAp(a => ({ ...a, sidebarCollapsed: !a.sidebarCollapsed }));
    saveAppearance({ sidebarCollapsed: !collapsed });
  };

  // 跳天时让整棵树重渲染，各页面里的「今天」才会跟着更新
  useTodayStr();

  // Ctrl+K / ⌘K：随时跳到「今天」并聚焦 AI 输入框
  useEffect(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Shift+0：透明度调太低看不清时，一键恢复不透明
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '0' || e.key === ')')) {
        e.preventDefault();
        saveAppearance({ windowOpacity: 1, cardOpacity: 1, contentOpacity: 1 });
        return;
      }
      // Ctrl+B / ⌘B：收起 / 展开侧边栏
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setAp(a => {
          saveAppearance({ sidebarCollapsed: !a.sidebarCollapsed });
          return { ...a, sidebarCollapsed: !a.sidebarCollapsed };
        });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveKey('today');
        setTimeout(() => window.dispatchEvent(new Event(FOCUS_ASSISTANT_EVENT)), 50);
      }
    };
    window.addEventListener('keydown', onKey);
    // 别的页面（日历弹窗）要问 AI：切到「今天」，今天页打开后会取走这句话并发送
    const onAsk = () => setActiveKey('today');
    window.addEventListener(ASK_AI_EVENT, onAsk);
    // 点开提醒：早上提醒 → 日历里今天的弹窗；复盘 / 周小结 → 今天页
    const onOpen = (e: Event) => {
      const target = (e as CustomEvent<{ target: OpenTarget }>).detail?.target;
      if (target === 'today') {
        setActiveKey('calendar');
        setTimeout(requestOpenToday, 50);
      } else if (target) setActiveKey('today');
    };
    window.addEventListener(OPEN_TARGET_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(ASK_AI_EVENT, onAsk);
      window.removeEventListener(OPEN_TARGET_EVENT, onOpen);
    };
  }, []);


  const renderPage = () => {
    switch (activeKey) {
      case 'tasks': return <TasksScreen />;
      case 'calendar': return <CalendarPage />;
      case 'review': return <ReviewScreen />;
      case 'settings': return <SettingsScreen />;
      case 'today': return <AssistantScreen />;
      default: return <CalendarPage />;
    }
  };

  // 内容区底色：有背景图时按「背景透出」调成半透明
  const contentBg = hexAlpha(skin.content, (wallpaper ? ap.contentOpacity : 1) * winA);

  return (
    <View nativeID="myplan-root" style={styles.container}>
      {wallpaper ? (
        <View pointerEvents="none" style={[styles.wallLayer, winA < 1 && { opacity: winA }]}>
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundImage: `url(${wallpaper})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: ap.wallpaperBlur ? `blur(${ap.wallpaperBlur}px)` : undefined,
                transform: ap.wallpaperBlur ? [{ scale: 1.05 }] : undefined,
              } as object,
            ]}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${ap.wallpaperDim})` }]} />
        </View>
      ) : null}
      {frameless ? <View nativeID="myplan-drag" style={styles.dragBar} /> : null}
      {glass ? (
        <View style={styles.winBtns}>
          {(
            [
              ['min', '—'],
              ['max', '☐'],
              ['close', '✕'],
            ] as const
          ).map(([a, t]) => (
            <TouchableOpacity
              key={a}
              style={[styles.winBtn, a === 'close' && styles.winBtnClose]}
              onPress={() => (desktopBridge() as { win?: (x: string) => void } | null)?.win?.(a)}
              accessibilityLabel={a === 'min' ? '最小化' : a === 'max' ? '最大化 / 还原' : '关闭'}
            >
              <Text style={[styles.winBtnText, { color: skin.dark || (wallpaper && ap.wallpaperDim >= 0.3) ? '#fff' : '#37474F' }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <ReminderService />
      <BreakdownHost />
      <CelebrationHost />
      <ConfirmHost />
      <View
        style={[
          styles.sidebar,
          collapsed && styles.sidebarCollapsed,
          { backgroundColor: hexAlpha(skin.sidebar, (wallpaper ? Math.max(0.55, ap.contentOpacity) : 1) * winA) },
          skin.border ? { borderRightWidth: 1, borderRightColor: skin.border } : null,
        ]}
      >
        <View style={[styles.logoRow, collapsed && { justifyContent: 'center' }]}>
          {!collapsed && <Text style={[styles.logo, { color: skin.logo }]}>MyPlan</Text>}
          <TouchableOpacity onPress={toggleSidebar} style={styles.collapseBtn} accessibilityLabel={collapsed ? '展开侧边栏' : '收起侧边栏'}>
            <Text style={[styles.collapseText, { color: skin.navText }]}>{collapsed ? '»' : '«'}</Text>
          </TouchableOpacity>
        </View>
        {NAVS.map((item) => {
          const on = activeKey === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.navItem, collapsed && styles.navItemCollapsed, on && { backgroundColor: skin.navActiveBg }]}
              onPress={() => setActiveKey(item.key)}
              accessibilityLabel={item.name}
            >
              <Text style={[styles.navIcon, collapsed && { marginRight: 0 }]}>{item.icon}</Text>
              {!collapsed && (
                <Text style={[styles.navText, { color: on ? skin.navActiveText : skin.navText }, on && styles.navTextActive]}>
                  {item.name}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      <View nativeID="myplan-content" style={[styles.content, { backgroundColor: contentBg }, width < 700 && { padding: 16 }]}>
        <ErrorBoundary key={activeKey} name={activeKey}>
          {renderPage()}
        </ErrorBoundary>
      </View>
    </View>
  );
}

/** #RRGGBB + 不透明度 → rgba() */
function hexAlpha(hex: string, a: number): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const styles = StyleSheet.create({
  // web-only 值：'100vh' / 'auto' 不在 RN 类型联合里，运行时取值与原来完全一致
  container: { flex: 1, flexDirection: 'row', height: '100vh' as unknown as number },
  sidebar: {
    width: 220,
    backgroundColor: '#101523',
    paddingTop: 32,
    paddingHorizontal: 16,
    zIndex: 1,
  },
  sidebarCollapsed: { width: 68, paddingHorizontal: 8 },
  // 右边留出 150px 给系统的 最小化 / 最大化 / 关闭 按钮
  winBtns: { position: 'absolute', top: 0, right: 0, flexDirection: 'row', zIndex: 60 },
  winBtn: { width: 46, height: 30, alignItems: 'center', justifyContent: 'center' },
  winBtnClose: {},
  winBtnText: { fontSize: 13 },
  dragBar: { position: 'absolute', top: 0, left: 0, right: 150, height: 30, zIndex: 50 },
  wallLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  logoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 },
  logo: { color: '#fff', fontSize: 24, fontWeight: '700' },
  collapseBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  collapseText: { fontSize: 20, fontWeight: '700' },
  navItemCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  navItemActive: { backgroundColor: 'rgba(255,255,255,0.1)' },
  navIcon: { fontSize: 20, marginRight: 12 },
  navText: { color: '#c7d0e0', fontSize: 16, fontWeight: '500' },
  navTextActive: { color: '#fff', fontWeight: '700' },
  content: { flex: 1, backgroundColor: '#f7f8fa', padding: 32, overflow: 'auto' as unknown as 'scroll', zIndex: 1 },
  mobileMask: {
    flex: 1,
    backgroundColor: '#101523',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh' as unknown as number,
  },
  mobileMaskText: { color: '#fff', fontSize: 20, textAlign: 'center', padding: 32 },
});
