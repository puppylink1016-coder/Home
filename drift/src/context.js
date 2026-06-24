const TIME_PERIODS = [
  [0, '深夜'],
  [5, '凌晨'],
  [7, '清晨'],
  [9, '上午'],
  [11, '中午'],
  [13, '下午'],
  [17, '傍晚'],
  [19, '晚上'],
  [23, '深夜'],
];

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function getTimePeriod(hour) {
  for (let i = TIME_PERIODS.length - 1; i >= 0; i--) {
    if (hour >= TIME_PERIODS[i][0]) return TIME_PERIODS[i][1];
  }
  return '深夜';
}

export function getTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const minute = String(now.getMinutes()).padStart(2, '0');
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekday = WEEKDAYS[now.getDay()];
  const period = getTimePeriod(hour);

  return {
    time: `${hour}:${minute}`,
    date: `${year}年${month}月${day}日`,
    weekday,
    period,
    formatted: `${year}年${month}月${day}日 ${weekday} ${period}${hour}:${minute}`,
  };
}
