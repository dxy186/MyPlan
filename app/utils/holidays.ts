import AsyncStorage from '@react-native-async-storage/async-storage';

// 远程 JSON 数据地址（主用+备用）
const REMOTE_URL =
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json';
const FALLBACK_URL =
  'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json';

// 缓存键
const CACHE_KEY_PREFIX = '@holiday_cache_';

interface HolidayDay {
  name: string;
  date: string; // YYYY-MM-DD
  isOffDay: boolean; // true:放假, false:调休上班
}

interface HolidayData {
  year: number;
  days: HolidayDay[];
}

/**
 * 从远程拉取某年节假日数据（自动尝试备用地址）
 */
async function fetchRemoteHolidays(year: number): Promise<HolidayData | null> {
  const url = REMOTE_URL.replace('{year}', String(year));
  const fallback = FALLBACK_URL.replace('{year}', String(year));

  const tryFetch = async (u: string) => {
    try {
      const res = await fetch(u, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data: { year: number; days: any[] } = await res.json();
      // 统一数据格式
      const days: HolidayDay[] = data.days.map((d: any) => ({
        name: d.name,
        date: d.date,
        isOffDay: !!d.isOffDay,
      }));
      return { year: data.year, days };
    } catch {
      return null;
    }
  };

  const result = await tryFetch(url);
  if (result) return result;
  return tryFetch(fallback);
}

/**
 * 获取某年节假日数据（优先使用本地缓存，后台更新）
 */
export async function getHolidayData(year: number): Promise<HolidayData | null> {
  const cacheKey = CACHE_KEY_PREFIX + year;
  try {
    // 先读缓存
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsed: HolidayData = JSON.parse(cached);
      // 后台异步拉取最新数据（不阻塞界面）
      fetchRemoteHolidays(year).then(fresh => {
        if (fresh) {
          AsyncStorage.setItem(cacheKey, JSON.stringify(fresh));
        }
      });
      return parsed;
    }
    // 无缓存，直接拉取
    const fresh = await fetchRemoteHolidays(year);
    if (fresh) {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(fresh));
    }
    return fresh;
  } catch {
    return null;
  }
}

/**
 * 判断一个日期是“休”还是“班”
 * 返回 'holiday'（放假/休假）, 'workday'（调休上班）, 或 null（普通日期）
 */
export async function checkDateType(
  dateStr: string
): Promise<'holiday' | 'workday' | null> {
  const year = parseInt(dateStr.split('-')[0], 10);
  const data = await getHolidayData(year);
  if (!data) return null;

  const day = data.days.find(d => d.date === dateStr);
  if (!day) return null;
  return day.isOffDay ? 'holiday' : 'workday';
}

/**
 * 初始化所有相关年份的数据（供页面加载时调用，避免每次都要等待）
 */
export async function prefetchHolidays(years: number[]) {
  const promises = years.map(year => getHolidayData(year));
  await Promise.allSettled(promises);
}