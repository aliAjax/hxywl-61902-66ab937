export const SAVE_VERSION = "1.1.0";
export const MIN_TIMELINE_SAVE_VERSION = "1.1.0";

import type {
  TimelineRecord,
  SaveFileTimelineData,
} from "./timelineManager";

export type {
  TimelineRecord,
  SaveFileTimelineData,
};
export const SAVE_FILE_PREFIX = "dessert-shop-save";
export const AUTO_SAVE_INTERVAL = 10000;

export interface SaveFileOrderItem {
  level: number;
  count: number;
  collected: number;
}

export interface SaveFileOrder {
  id: number;
  items: SaveFileOrderItem[];
  reward: number;
  completed: boolean;
}

export interface SaveFileGameData {
  coins: number;
  board: (number | null)[];
  maxLevel: number;
  unlockedLevels: number[];
  unlockTimes: { [key: number]: string };
  orders: SaveFileOrder[];
  spawnCooldownEnd: number;
  timeline?: SaveFileTimelineData | null;
}

export interface SaveFileMeta {
  exportTime?: string;
  deviceInfo?: string;
  compatibleVersion?: string;
}

export interface SaveFile {
  version: string;
  gameId: string;
  timestamp: number;
  data: SaveFileGameData;
  meta?: SaveFileMeta;
}

export interface ValidateResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface LoadResult {
  success: boolean;
  data: SaveFileGameData | null;
  errors: string[];
  usedFallback: boolean;
}

const VALID_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isValidVersionFormat(version: string): boolean {
  if (!version || typeof version !== "string") return false;
  return SEMVER_PATTERN.test(version);
}

export function compareVersions(v1: string, v2: string): number {
  if (!isValidVersionFormat(v1) || !isValidVersionFormat(v2)) {
    return -1;
  }
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);
  const len = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

export function isCompatibleVersion(version: string): boolean {
  if (!isValidVersionFormat(version)) return false;
  const result = compareVersions(version, "1.0.0");
  return result >= 0;
}

export function hasTimelineSupport(version: string): boolean {
  if (!isValidVersionFormat(version)) return false;
  const result = compareVersions(version, MIN_TIMELINE_SAVE_VERSION);
  return result >= 0;
}

export function validateSaveFile(save: unknown): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (save === null || save === undefined) {
    errors.push("存档内容为空");
    return { isValid: false, errors, warnings };
  }

  if (typeof save !== "object") {
    errors.push("存档格式错误，应为 JSON 对象");
    return { isValid: false, errors, warnings };
  }

  const s = save as Record<string, unknown>;

  if (s.gameId && typeof s.gameId === "string" && s.gameId !== "hxywl-61902") {
    errors.push(`存档游戏ID不匹配，当前存档属于: ${s.gameId}`);
  }

  if (!s.version || typeof s.version !== "string") {
    errors.push("存档缺少版本号");
  } else if (!isValidVersionFormat(s.version)) {
    errors.push(`存档版本格式非法: "${s.version}"，应为 "主版本.次版本.修订号" 格式（如 "1.0.0"）`);
  } else if (!isCompatibleVersion(s.version)) {
    errors.push(`存档版本 ${s.version} 与当前游戏版本不兼容，最低要求版本为 1.0.0`);
  }

  if (s.timestamp !== undefined && (typeof s.timestamp !== "number" || isNaN(s.timestamp))) {
    warnings.push("存档时间戳格式异常");
  }

  if (!s.data || typeof s.data !== "object") {
    errors.push("存档缺少游戏数据部分");
    return { isValid: false, errors, warnings };
  }

  const data = s.data as Record<string, unknown>;

  if (data.coins === undefined || typeof data.coins !== "number" || isNaN(data.coins)) {
    errors.push("金币数据缺失或格式错误");
  } else if (!Number.isInteger(data.coins)) {
    errors.push("金币必须为整数，不能包含小数");
  } else if (!Number.isSafeInteger(data.coins)) {
    errors.push("金币数值超出安全整数范围");
  } else if (data.coins < 0) {
    errors.push("金币数量不能为负数");
  } else if (data.coins > Number.MAX_SAFE_INTEGER / 100) {
    warnings.push("金币数量异常庞大");
  }

  if (!Array.isArray(data.board)) {
    errors.push("棋盘数据格式错误");
  } else {
    if (data.board.length !== 25) {
      errors.push(`棋盘大小错误: 应为25格，实际${data.board.length}格`);
    }
    for (let i = 0; i < data.board.length; i++) {
      const cell = data.board[i];
      if (cell !== null && cell !== undefined) {
        if (typeof cell !== "number" || !Number.isInteger(cell)) {
          errors.push(`棋盘第${i + 1}格数据类型错误`);
        } else if (!VALID_LEVELS.includes(cell)) {
          errors.push(`棋盘第${i + 1}格等级 ${cell} 超出有效范围`);
        }
      }
    }
  }

  if (data.maxLevel === undefined || typeof data.maxLevel !== "number" || isNaN(data.maxLevel)) {
    errors.push("最高等级数据缺失或格式错误");
  } else if (!Number.isInteger(data.maxLevel)) {
    errors.push("最高等级应为整数");
  } else if (data.maxLevel < 1 || data.maxLevel > 10) {
    errors.push(`最高等级 ${data.maxLevel} 超出有效范围`);
  }

  if (!Array.isArray(data.unlockedLevels)) {
    errors.push("图鉴数据格式错误");
  } else {
    if (data.unlockedLevels.length === 0) {
      errors.push("图鉴不能为空，至少应包含等级1");
    }
    const seen = new Set<number>();
    for (let i = 0; i < data.unlockedLevels.length; i++) {
      const lv = data.unlockedLevels[i];
      if (typeof lv !== "number" || !Number.isInteger(lv)) {
        errors.push(`图鉴第${i + 1}项数据类型错误`);
      } else if (!VALID_LEVELS.includes(lv)) {
        errors.push(`图鉴等级 ${lv} 超出有效范围`);
      } else if (seen.has(lv)) {
        warnings.push(`图鉴存在重复等级: ${lv}`);
      }
      seen.add(lv);
    }
    if (data.maxLevel && typeof data.maxLevel === "number") {
      const maxLv = data.maxLevel;
      for (let checkLv = 1; checkLv <= maxLv; checkLv++) {
        if (!seen.has(checkLv)) {
          errors.push(`等级 ${checkLv} 在最高等级 ${maxLv} 之内，但未在图鉴中解锁`);
        }
      }
    }
    if (!seen.has(1)) {
      errors.push("图鉴中缺少基础等级1");
    }
  }

  if (data.unlockTimes !== undefined) {
    if (typeof data.unlockTimes !== "object" || data.unlockTimes === null) {
      warnings.push("解锁时间数据格式异常，已忽略");
    } else {
      const ut = data.unlockTimes as Record<string, unknown>;
      for (const key of Object.keys(ut)) {
        const lv = Number(key);
        if (!VALID_LEVELS.includes(lv)) {
          warnings.push(`解锁时间存在未知等级: ${key}`);
        }
        const timeStr = ut[key];
        if (typeof timeStr !== "string" || isNaN(Date.parse(timeStr))) {
          warnings.push(`等级 ${key} 的解锁时间格式异常`);
        }
      }
    }
  }

  if (data.orders === undefined) {
    errors.push("存档缺少订单数据");
  } else if (!Array.isArray(data.orders)) {
    errors.push("订单数据格式错误，应为数组");
  } else {
    const orderIdSet = new Set<number>();
    for (let i = 0; i < data.orders.length; i++) {
      const order = data.orders[i] as Record<string, unknown>;
      const orderPrefix = `第${i + 1}个订单`;

      if (!order || typeof order !== "object") {
        errors.push(`${orderPrefix}不是有效的对象`);
        continue;
      }

      if (order.id === undefined) {
        errors.push(`${orderPrefix}缺少必填字段 id`);
      } else if (typeof order.id !== "number" || !Number.isInteger(order.id)) {
        errors.push(`${orderPrefix}的 id 必须为整数`);
      } else if (!Number.isSafeInteger(order.id)) {
        errors.push(`${orderPrefix}的 id 超出安全整数范围`);
      } else {
        if (orderIdSet.has(order.id)) {
          errors.push(`${orderPrefix}的 id (${order.id}) 与其他订单重复`);
        }
        orderIdSet.add(order.id);
      }

      if (order.completed === undefined) {
        errors.push(`${orderPrefix}缺少必填字段 completed`);
      } else if (typeof order.completed !== "boolean") {
        errors.push(`${orderPrefix}的 completed 必须为布尔值`);
      }

      if (order.reward === undefined) {
        errors.push(`${orderPrefix}缺少必填字段 reward`);
      } else if (typeof order.reward !== "number" || isNaN(order.reward)) {
        errors.push(`${orderPrefix}的 reward 格式错误`);
      } else if (!Number.isInteger(order.reward)) {
        errors.push(`${orderPrefix}的 reward 必须为整数`);
      } else if (!Number.isSafeInteger(order.reward)) {
        errors.push(`${orderPrefix}的 reward 超出安全整数范围`);
      } else if (order.reward < 0) {
        errors.push(`${orderPrefix}的 reward 不能为负数`);
      }

      if (order.items === undefined) {
        errors.push(`${orderPrefix}缺少必填字段 items`);
      } else if (!Array.isArray(order.items)) {
        errors.push(`${orderPrefix}的 items 必须为数组`);
      } else if (order.items.length === 0) {
        errors.push(`${orderPrefix}的 items 不能为空，至少需要1项物品`);
      } else {
        for (let j = 0; j < order.items.length; j++) {
          const item = order.items[j] as Record<string, unknown>;
          const itemPrefix = `${orderPrefix}第${j + 1}项`;

          if (!item || typeof item !== "object") {
            errors.push(`${itemPrefix}不是有效的对象`);
            continue;
          }

          if (item.level === undefined) {
            errors.push(`${itemPrefix}缺少必填字段 level`);
          } else if (typeof item.level !== "number" || !Number.isInteger(item.level)) {
            errors.push(`${itemPrefix}的 level 必须为整数`);
          } else if (!VALID_LEVELS.includes(item.level)) {
            errors.push(`${itemPrefix}的 level (${item.level}) 超出有效范围 1-10`);
          }

          if (item.count === undefined) {
            errors.push(`${itemPrefix}缺少必填字段 count`);
          } else if (typeof item.count !== "number" || !Number.isInteger(item.count)) {
            errors.push(`${itemPrefix}的 count 必须为整数`);
          } else if (!Number.isSafeInteger(item.count)) {
            errors.push(`${itemPrefix}的 count 超出安全整数范围`);
          } else if (item.count < 1) {
            errors.push(`${itemPrefix}的 count 不能小于1`);
          }

          if (item.collected === undefined) {
            warnings.push(`${itemPrefix}缺少可选字段 collected，默认值为0`);
          } else if (typeof item.collected !== "number" || !Number.isInteger(item.collected)) {
            errors.push(`${itemPrefix}的 collected 必须为整数`);
          } else if (!Number.isSafeInteger(item.collected)) {
            errors.push(`${itemPrefix}的 collected 超出安全整数范围`);
          } else if (item.collected < 0) {
            errors.push(`${itemPrefix}的 collected 不能为负数`);
          } else if (typeof item.count === "number" && Number.isInteger(item.count) && item.collected > item.count) {
            errors.push(`${itemPrefix}的 collected (${item.collected}) 不能超过 count (${item.count})`);
          }

          if (order.completed === true
              && typeof item.count === "number" && Number.isInteger(item.count)
              && typeof item.collected === "number" && Number.isInteger(item.collected)
              && item.collected < item.count) {
            warnings.push(`${orderPrefix}已标记为完成，但 ${itemPrefix}的 collected (${item.collected}) 未达到 count (${item.count})`);
          }
        }
      }
    }
  }

  if (data.spawnCooldownEnd !== undefined) {
    if (typeof data.spawnCooldownEnd !== "number" || isNaN(data.spawnCooldownEnd)) {
      warnings.push("生成冷却结束时间格式异常，已忽略");
    } else if (!Number.isFinite(data.spawnCooldownEnd)) {
      warnings.push("生成冷却结束时间超出有效范围，已忽略");
    } else if (data.spawnCooldownEnd < 0) {
      warnings.push("生成冷却结束时间不能为负数，已重置");
    }
  }

  if (data.timeline !== undefined && data.timeline !== null) {
    const tl = data.timeline as Record<string, unknown>;
    if (typeof tl !== "object" || tl === null) {
      warnings.push("时间线数据格式异常，已忽略");
    } else {
      if (tl.version !== undefined && typeof tl.version !== "string") {
        warnings.push("时间线版本格式异常，已忽略");
      }
      if (tl.startTime !== undefined && typeof tl.startTime !== "number") {
        warnings.push("时间线开始时间格式异常，已忽略");
      }
      if (tl.records !== undefined) {
        if (!Array.isArray(tl.records)) {
          warnings.push("时间线记录格式错误，已忽略");
        } else if (tl.records.length > 10000) {
          warnings.push(`时间线记录数量过多 (${tl.records.length})，导入时将被裁剪`);
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

export function sanitizeSaveData(data: SaveFileGameData, fallbackData: SaveFileGameData): SaveFileGameData {
  const result: SaveFileGameData = { ...fallbackData };

  if (typeof data.coins === "number" && !isNaN(data.coins) && data.coins >= 0 && Number.isFinite(data.coins)) {
    result.coins = Math.floor(data.coins);
  }

  if (Array.isArray(data.board)) {
    const board: (number | null)[] = [];
    for (let i = 0; i < 25; i++) {
      const cell = data.board[i];
      if (cell === null || cell === undefined) {
        board.push(null);
      } else if (typeof cell === "number" && Number.isInteger(cell) && VALID_LEVELS.includes(cell)) {
        board.push(cell);
      } else {
        board.push(null);
      }
    }
    result.board = board;
  }

  if (typeof data.maxLevel === "number" && !isNaN(data.maxLevel) && Number.isInteger(data.maxLevel)) {
    result.maxLevel = Math.max(1, Math.min(10, data.maxLevel));
  }

  if (Array.isArray(data.unlockedLevels)) {
    const levels = new Set<number>();
    for (const lv of data.unlockedLevels) {
      if (typeof lv === "number" && Number.isInteger(lv) && VALID_LEVELS.includes(lv)) {
        levels.add(lv);
      }
    }
    if (!levels.has(1)) levels.add(1);
    for (let checkLv = 1; checkLv <= result.maxLevel; checkLv++) {
      levels.add(checkLv);
    }
    result.unlockedLevels = Array.from(levels).sort((a, b) => a - b);
  }

  if (data.unlockTimes && typeof data.unlockTimes === "object") {
    const times: { [key: number]: string } = {};
    for (const lv of result.unlockedLevels) {
      const saved = data.unlockTimes[lv];
      if (typeof saved === "string" && !isNaN(Date.parse(saved))) {
        times[lv] = saved;
      } else if (fallbackData.unlockTimes[lv]) {
        times[lv] = fallbackData.unlockTimes[lv];
      } else {
        times[lv] = new Date().toISOString();
      }
    }
    result.unlockTimes = times;
  }

  if (Array.isArray(data.orders)) {
    const orders: SaveFileOrder[] = [];
    for (const order of data.orders) {
      if (order && typeof order === "object") {
        const items: SaveFileOrderItem[] = [];
        if (Array.isArray(order.items)) {
          for (const item of order.items) {
            if (item && typeof item === "object" && typeof item.level === "number" && VALID_LEVELS.includes(item.level)) {
              items.push({
                level: item.level,
                count: typeof item.count === "number" && item.count >= 1 ? Math.floor(item.count) : 1,
                collected: typeof item.collected === "number" ? Math.max(0, Math.floor(item.collected)) : 0,
              });
            }
          }
        }
        if (items.length > 0) {
          orders.push({
            id: typeof order.id === "number" ? Math.floor(order.id) : Date.now() + Math.random(),
            items,
            reward: typeof order.reward === "number" && order.reward >= 0 ? Math.floor(order.reward) : items.reduce((s, it) => s + it.level * it.count * 15, 0),
            completed: typeof order.completed === "boolean" ? order.completed : false,
          });
        }
      }
    }
    result.orders = orders;
  }

  if (typeof data.spawnCooldownEnd === "number" && !isNaN(data.spawnCooldownEnd) && Number.isFinite(data.spawnCooldownEnd) && data.spawnCooldownEnd >= 0) {
    result.spawnCooldownEnd = Math.floor(data.spawnCooldownEnd);
  } else {
    result.spawnCooldownEnd = fallbackData.spawnCooldownEnd ?? 0;
  }

  if (data.timeline && typeof data.timeline === "object") {
    const tl = data.timeline as unknown as Record<string, unknown>;
    result.timeline = {
      version: typeof tl.version === "string" ? tl.version : "1.1.0",
      startTime: typeof tl.startTime === "number" ? tl.startTime : Date.now(),
      records: Array.isArray(tl.records) ? tl.records.slice(0, 500) as TimelineRecord[] : [],
    };
  }

  return result;
}

export function createSaveFile(data: SaveFileGameData, includeMeta: boolean = true): SaveFile {
  const save: SaveFile = {
    version: SAVE_VERSION,
    gameId: "hxywl-61902",
    timestamp: Date.now(),
    data: {
      coins: data.coins,
      board: [...data.board],
      maxLevel: data.maxLevel,
      unlockedLevels: [...data.unlockedLevels],
      unlockTimes: { ...data.unlockTimes },
      orders: data.orders.map(o => ({
        id: o.id,
        reward: o.reward,
        completed: o.completed,
        items: o.items.map(it => ({ ...it })),
      })),
      spawnCooldownEnd: data.spawnCooldownEnd ?? 0,
      timeline: data.timeline ? {
        version: data.timeline.version,
        startTime: data.timeline.startTime,
        records: data.timeline.records.slice(0, 500),
      } : undefined,
    },
  };
  if (includeMeta) {
    save.meta = {
      exportTime: new Date().toISOString(),
      deviceInfo: typeof navigator !== "undefined" ? `${navigator.platform || "Unknown"} - ${navigator.userAgent.slice(0, 100)}` : undefined,
      compatibleVersion: "1.0.0",
    };
  }
  return save;
}

export function exportSaveToString(save: SaveFile): string {
  return JSON.stringify(save, null, 2);
}

export function parseSaveFromString(str: string): { success: boolean; save: SaveFile | null; error: string } {
  try {
    const parsed = JSON.parse(str);
    return { success: true, save: parsed as SaveFile, error: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, save: null, error: `JSON解析失败: ${msg}` };
  }
}

export function generateSaveFileName(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${SAVE_FILE_PREFIX}-v${SAVE_VERSION}-${dateStr}.json`;
}

export function downloadSaveFile(save: SaveFile): void {
  const content = exportSaveToString(save);
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = generateSaveFileName();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file: File): Promise<{ success: boolean; content: string; error: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({ success: true, content: String(reader.result || ""), error: "" });
    };
    reader.onerror = () => {
      resolve({ success: false, content: "", error: "文件读取失败" });
    };
    reader.readAsText(file);
  });
}
