/**
 * 干支纪年 / 纪月 / 纪日（如：丙午年 己亥月 壬寅日）。
 * - 年：以立春为界；月：以「节」（立春、惊蛰、清明…小寒）为界，月干按五虎遁；
 * - 日：以 2000-01-01 为戊午日推算（60 天一轮）。
 * 节气日期用 21 世纪通用公式（寿星公式），2000–2099 年准确到日。
 */
const GAN = '甲乙丙丁戊己庚辛壬癸';
const ZHI = '子丑寅卯辰巳午未申酉戌亥';

// 每个月的「节」在几号：[公历月, C 值]；对应的地支月：寅卯辰巳午未申酉戌亥子丑
const JIE: { month: number; c: number; zhi: number }[] = [
  { month: 1, c: 5.4055, zhi: 1 }, // 小寒 → 丑月
  { month: 2, c: 3.87, zhi: 2 }, // 立春 → 寅月
  { month: 3, c: 5.63, zhi: 3 }, // 惊蛰 → 卯月
  { month: 4, c: 4.81, zhi: 4 }, // 清明 → 辰月
  { month: 5, c: 5.52, zhi: 5 }, // 立夏 → 巳月
  { month: 6, c: 5.678, zhi: 6 }, // 芒种 → 午月
  { month: 7, c: 7.108, zhi: 7 }, // 小暑 → 未月
  { month: 8, c: 7.5, zhi: 8 }, // 立秋 → 申月
  { month: 9, c: 7.646, zhi: 9 }, // 白露 → 酉月
  { month: 10, c: 8.318, zhi: 10 }, // 寒露 → 戌月
  { month: 11, c: 7.438, zhi: 11 }, // 立冬 → 亥月
  { month: 12, c: 7.18, zhi: 0 }, // 大雪 → 子月
];

/** 某年某月「节」是几号 */
export function jieDay(year: number, month: number): number {
  const j = JIE[month - 1];
  const y = year % 100;
  const leapBase = month <= 2 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
  let d = Math.floor(y * 0.2422 + j.c) - leapBase;
  // 公式已知的个别例外
  if (year === 2019 && month === 1) d -= 1; // 小寒
  if (year === 2082 && month === 1) d += 1;
  if (year === 2026 && month === 2) d = 4;
  return d;
}

const gz = (i: number) => GAN[((i % 10) + 10) % 10] + ZHI[((i % 12) + 12) % 12];

export type GanZhi = { year: string; month: string; day: string };

export function ganzhiOf(date: string): GanZhi {
  const [y, m, d] = date.split('-').map(Number);
  // 日柱
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2000, 0, 1)) / 86400000);
  const dayIdx = (((54 + days) % 60) + 60) % 60;
  // 年柱：立春前算上一年
  const lichun = jieDay(y, 2);
  const gy = m < 2 || (m === 2 && d < lichun) ? y - 1 : y;
  const yearIdx = (((gy - 4) % 60) + 60) % 60; // 1984 甲子
  // 月柱：本月的节之前算上个月
  const monthZhi = d >= jieDay(y, m) ? JIE[m - 1].zhi : JIE[(m + 10) % 12].zhi;
  // 五虎遁：甲己之年丙作首（寅月天干）
  const yinGan = [2, 4, 6, 8, 0][yearIdx % 10 % 5];
  const offset = (monthZhi - 2 + 12) % 12; // 从寅月数起
  const monthGan = (yinGan + offset) % 10;
  return {
    year: gz(yearIdx) + '年',
    month: GAN[monthGan] + ZHI[monthZhi] + '月',
    day: GAN[dayIdx % 10] + ZHI[dayIdx % 12] + '日',
  };
}
