// 简易农历转换 (支持 1900-2100)
// 直接传入 "YYYY-MM-DD" 字符串即可

const lunarInfo = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  ];
  
  const lunarMonthNames = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  const lunarDayNames = [
    '初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
    '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
    '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十',
  ];
  
  function getLunarYearDays(year) {
    let sum = 348;
    for (let i = 0x8000; i > 0x8; i >>= 1) {
      sum += (lunarInfo[year - 1900] & i) ? 1 : 0;
    }
    const leap = lunarInfo[year - 1900] & 0xf;
    if (leap) {
      const leapMonthDays = (lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
      sum += leapMonthDays;
    }
    return sum;
  }
  
  function getLunarMonthDays(year, month) {
    return (lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29;
  }
  
  function getLeapMonth(year) {
    return lunarInfo[year - 1900] & 0xf;
  }
  
  export function solarToLunar(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const baseDate = new Date(1900, 0, 31);
    const targetDate = new Date(y, m - 1, d);
    let offset = Math.floor((targetDate.getTime() - baseDate.getTime()) / 86400000);
  
    let year = 1900;
    let month = 1;
    let day = 1;
    let isLeap = false;
  
    // 算年份
    while (offset > 0) {
      const yearDays = getLunarYearDays(year);
      if (offset < yearDays) break;
      offset -= yearDays;
      year++;
    }
  
    const leapMonth = getLeapMonth(year);
    let leap = false;
  
    // 算月份
    for (month = 1; month <= 12 && offset > 0; month++) {
      if (leapMonth > 0 && month === leapMonth + 1 && !leap) {
        --month;
        leap = true;
        const leapDays = (lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
        if (offset < leapDays) break;
        offset -= leapDays;
        leap = false;
      } else {
        const monthDays = getLunarMonthDays(year, month);
        if (offset < monthDays) break;
        offset -= monthDays;
      }
    }
  
    day = offset + 1;
    isLeap = leap;
  
    const monthName = (isLeap ? '闰' : '') + lunarMonthNames[month - 1];
    const dayName = lunarDayNames[day - 1];
  
    return {
      year,
      month: monthName,
      day: dayName,        // 如 "初三"
      isLeap,
    };
  }