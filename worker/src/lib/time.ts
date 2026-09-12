/**
 * 北京时间工具
 *
 * 背景：D1 运行在 UTC，`datetime('now','localtime')` 在 D1 中等于 UTC，
 * 直接照搬旧 SQL 会让所有「今天」的判定偏移 8 小时。
 *
 * 因此本项目统一约定：
 *   - 所有时间戳以「北京时间字符串」`YYYY-MM-DD HH:MM:SS` 存储，
 *     与历史数据（PHP 用 date_default_timezone_set('Asia/Shanghai') 写入）格式一致；
 *   - 写入时由本模块显式计算并绑定，不依赖 SQLite 的时区函数；
 *   - 「今天」的查询使用范围谓词（start <= t < end），从而能命中索引，
 *     而不是对列套 DATE() 函数导致全表扫描。
 */

/** 北京时间相对 UTC 的固定偏移（毫秒）。中国不实行夏令时，故为常量。 */
export const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 可注入的时钟，便于测试固定时间点 */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * 把 UTC 毫秒时间戳格式化为北京时间字符串 `YYYY-MM-DD HH:MM:SS`。
 * 做法是先整体平移 8 小时，再用 UTC 取值器读取「北京墙上时间」。
 */
export function toBeijingStamp(epochMs: number): string {
  const d = new Date(epochMs + CST_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** 北京时间日期部分 `YYYY-MM-DD` */
export function toBeijingDate(epochMs: number): string {
  return toBeijingStamp(epochMs).slice(0, 10);
}

/** 时间戳字符串比较即可正确排序（格式定长且高位在前） */
export interface DayBounds {
  /** 北京时间当天 00:00:00 */
  start: string;
  /** 北京时间次日 00:00:00（开区间上界） */
  end: string;
  /** 北京时间当天日期 YYYY-MM-DD */
  today: string;
}

/**
 * 计算给定瞬间所在的「北京自然日」边界。
 * 用于替换 `DATE(col) = date('now','localtime')` 这类无法命中索引的写法。
 */
export function beijingDayBounds(epochMs: number): DayBounds {
  const shifted = new Date(epochMs + CST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();

  // 北京当天 00:00 对应的 UTC 毫秒
  const startMs = Date.UTC(y, m, d) - CST_OFFSET_MS;

  return {
    start: toBeijingStamp(startMs),
    end: toBeijingStamp(startMs + DAY_MS),
    today: `${y}-${pad(m + 1)}-${pad(d)}`,
  };
}

/** 当前北京时间字符串 */
export function nowStamp(clock: Clock = systemClock): string {
  return toBeijingStamp(clock());
}

/** 当前北京自然日边界 */
export function todayBounds(clock: Clock = systemClock): DayBounds {
  return beijingDayBounds(clock());
}

/** N 天后的北京时间字符串（用于会话过期等） */
export function stampAfterDays(days: number, clock: Clock = systemClock): string {
  return toBeijingStamp(clock() + days * DAY_MS);
}
