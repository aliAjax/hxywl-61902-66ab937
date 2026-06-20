import { DESSERTS, BOARD_SIZE } from "./gameConfig";

export const TIMELINE_VERSION = "1.1.0";
export const TIMELINE_STORAGE_KEY = "hxywl-61902-timeline";
export const MAX_TIMELINE_RECORDS = 500;
export const MAX_REPLAY_HISTORY_DAYS = 7;

export type TimelineActionType =
  | "spawn"
  | "move"
  | "merge"
  | "submit_order"
  | "claim_offline"
  | "import_save"
  | "reset"
  | "organize";

export interface TimelineRecordBase {
  id: number;
  type: TimelineActionType;
  timestamp: number;
  gameVersion: string;
}

export interface TimelineSpawnRecord extends TimelineRecordBase {
  type: "spawn";
  level: number;
  index: number;
  cost: number;
  freeSpawn: boolean;
}

export interface TimelineMoveRecord extends TimelineRecordBase {
  type: "move";
  sourceIndex: number;
  targetIndex: number;
  level: number;
}

export interface TimelineMergeRecord extends TimelineRecordBase {
  type: "merge";
  sourceIndex: number;
  targetIndex: number;
  sourceLevel: number;
  targetLevel: number;
  coinReward: number;
  isNewMaxLevel: boolean;
}

export interface TimelineSubmitOrderRecord extends TimelineRecordBase {
  type: "submit_order";
  orderId: number;
  items: { level: number; count: number }[];
  coinReward: number;
}

export interface TimelineClaimOfflineRecord extends TimelineRecordBase {
  type: "claim_offline";
  coins: number;
  offlineMinutes: number;
  maxLevel: number;
}

export interface TimelineImportSaveRecord extends TimelineRecordBase {
  type: "import_save";
  saveVersion: string;
  saveTimestamp: number;
  coinsAfterImport: number;
  maxLevelAfterImport: number;
}

export interface TimelineResetRecord extends TimelineRecordBase {
  type: "reset";
  reason: "user_initiated" | "save_corrupted";
}

export interface TimelineOrganizeRecord extends TimelineRecordBase {
  type: "organize";
  itemsMoved: number;
}

export type TimelineRecord =
  | TimelineSpawnRecord
  | TimelineMoveRecord
  | TimelineMergeRecord
  | TimelineSubmitOrderRecord
  | TimelineClaimOfflineRecord
  | TimelineImportSaveRecord
  | TimelineResetRecord
  | TimelineOrganizeRecord;

export interface TimelineData {
  version: string;
  records: TimelineRecord[];
  lastRecordId: number;
  startTime: number;
}

export interface SaveFileTimelineData {
  version: string;
  startTime: number;
  records: TimelineRecord[];
}

export interface TimelineSummary {
  totalActions: number;
  totalSpawns: number;
  totalMerges: number;
  totalMoves: number;
  totalOrders: number;
  totalCoinsFromMerges: number;
  totalCoinsFromOrders: number;
  totalOfflineCoins: number;
  maxLevelReached: number;
  sessionDurationMinutes: number;
}

let recordIdCounter = 0;
let currentTimeline: TimelineData | null = null;

export function createInitialTimeline(): TimelineData {
  return {
    version: TIMELINE_VERSION,
    records: [],
    lastRecordId: 0,
    startTime: Date.now(),
  };
}

export function loadTimeline(): TimelineData {
  try {
    const saved = localStorage.getItem(TIMELINE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (isValidTimelineData(parsed)) {
        recordIdCounter = parsed.lastRecordId || 0;
        currentTimeline = parsed;
        pruneOldRecords(currentTimeline);
        return currentTimeline;
      }
    }
  } catch (e) {
    console.error("加载时间线失败:", e);
  }
  const newTimeline = createInitialTimeline();
  currentTimeline = newTimeline;
  saveTimeline(newTimeline);
  return newTimeline;
}

export function saveTimeline(timeline: TimelineData): void {
  try {
    pruneOldRecords(timeline);
    localStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(timeline));
    currentTimeline = timeline;
  } catch (e) {
    console.error("保存时间线失败:", e);
  }
}

export function isValidTimelineData(data: unknown): data is TimelineData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (!d.version || typeof d.version !== "string") return false;
  if (!Array.isArray(d.records)) return false;
  if (typeof d.lastRecordId !== "number") return false;
  if (typeof d.startTime !== "number") return false;
  return true;
}

export function pruneOldRecords(timeline: TimelineData): void {
  const now = Date.now();
  const cutoffTime = now - MAX_REPLAY_HISTORY_DAYS * 24 * 60 * 60 * 1000;

  timeline.records = timeline.records.filter(
    (r) => r.timestamp >= cutoffTime
  );

  if (timeline.records.length > MAX_TIMELINE_RECORDS) {
    const excess = timeline.records.length - MAX_TIMELINE_RECORDS;
    timeline.records = timeline.records.slice(excess);
  }
}

export function recordAction<T extends TimelineRecord>(
  partial: Omit<T, "id" | "timestamp" | "gameVersion">
): T {
  if (!currentTimeline) {
    loadTimeline();
  }

  const record = {
    ...partial,
    id: ++recordIdCounter,
    timestamp: Date.now(),
    gameVersion: TIMELINE_VERSION,
  } as T;

  if (currentTimeline) {
    currentTimeline.records.push(record);
    currentTimeline.lastRecordId = recordIdCounter;
    pruneOldRecords(currentTimeline);
    saveTimeline(currentTimeline);
  }

  return record;
}

export function recordSpawn(
  level: number,
  index: number,
  cost: number,
  freeSpawn: boolean = false
): TimelineSpawnRecord {
  return recordAction<TimelineSpawnRecord>({
    type: "spawn",
    level,
    index,
    cost,
    freeSpawn,
  });
}

export function recordMove(
  sourceIndex: number,
  targetIndex: number,
  level: number
): TimelineMoveRecord {
  return recordAction<TimelineMoveRecord>({
    type: "move",
    sourceIndex,
    targetIndex,
    level,
  });
}

export function recordMerge(
  sourceIndex: number,
  targetIndex: number,
  sourceLevel: number,
  targetLevel: number,
  coinReward: number,
  isNewMaxLevel: boolean
): TimelineMergeRecord {
  return recordAction<TimelineMergeRecord>({
    type: "merge",
    sourceIndex,
    targetIndex,
    sourceLevel,
    targetLevel,
    coinReward,
    isNewMaxLevel,
  });
}

export function recordSubmitOrder(
  orderId: number,
  items: { level: number; count: number }[],
  coinReward: number
): TimelineSubmitOrderRecord {
  return recordAction<TimelineSubmitOrderRecord>({
    type: "submit_order",
    orderId,
    items: [...items],
    coinReward,
  });
}

export function recordClaimOffline(
  coins: number,
  offlineMinutes: number,
  maxLevel: number
): TimelineClaimOfflineRecord {
  return recordAction<TimelineClaimOfflineRecord>({
    type: "claim_offline",
    coins,
    offlineMinutes,
    maxLevel,
  });
}

export function recordImportSave(
  saveVersion: string,
  saveTimestamp: number,
  coinsAfterImport: number,
  maxLevelAfterImport: number
): TimelineImportSaveRecord {
  return recordAction<TimelineImportSaveRecord>({
    type: "import_save",
    saveVersion,
    saveTimestamp,
    coinsAfterImport,
    maxLevelAfterImport,
  });
}

export function recordReset(
  reason: "user_initiated" | "save_corrupted" = "user_initiated"
): TimelineResetRecord {
  const record = recordAction<TimelineResetRecord>({
    type: "reset",
    reason,
  });

  if (currentTimeline) {
    currentTimeline.startTime = Date.now();
  }

  return record;
}

export function recordOrganize(itemsMoved: number): TimelineOrganizeRecord {
  return recordAction<TimelineOrganizeRecord>({
    type: "organize",
    itemsMoved,
  });
}

export function getTimelineRecords(
  startIndex?: number,
  limit?: number
): TimelineRecord[] {
  if (!currentTimeline) loadTimeline();
  const records = currentTimeline?.records || [];
  if (startIndex !== undefined && limit !== undefined) {
    return records.slice(startIndex, startIndex + limit);
  }
  return [...records];
}

export function getTimelineSummary(): TimelineSummary {
  if (!currentTimeline) loadTimeline();
  const records = currentTimeline?.records || [];

  const summary: TimelineSummary = {
    totalActions: records.length,
    totalSpawns: 0,
    totalMerges: 0,
    totalMoves: 0,
    totalOrders: 0,
    totalCoinsFromMerges: 0,
    totalCoinsFromOrders: 0,
    totalOfflineCoins: 0,
    maxLevelReached: 1,
    sessionDurationMinutes: 0,
  };

  for (const record of records) {
    switch (record.type) {
      case "spawn":
        summary.totalSpawns++;
        break;
      case "merge":
        summary.totalMerges++;
        summary.totalCoinsFromMerges += record.coinReward;
        if (record.targetLevel > summary.maxLevelReached) {
          summary.maxLevelReached = record.targetLevel;
        }
        break;
      case "move":
        summary.totalMoves++;
        break;
      case "submit_order":
        summary.totalOrders++;
        summary.totalCoinsFromOrders += record.coinReward;
        break;
      case "claim_offline":
        summary.totalOfflineCoins += record.coins;
        break;
    }
  }

  if (currentTimeline) {
    const durationMs = Date.now() - currentTimeline.startTime;
    summary.sessionDurationMinutes = Math.floor(durationMs / 60000);
  }

  return summary;
}

export function clearTimeline(): void {
  localStorage.removeItem(TIMELINE_STORAGE_KEY);
  currentTimeline = null;
  recordIdCounter = 0;
}

export function resetTimeline(): TimelineData {
  clearTimeline();
  return loadTimeline();
}

export function getSaveFileTimelineData(): SaveFileTimelineData | null {
  if (!currentTimeline) loadTimeline();
  if (!currentTimeline) return null;
  return {
    version: currentTimeline.version,
    startTime: currentTimeline.startTime,
    records: [...currentTimeline.records],
  };
}

export function loadTimelineFromSaveData(
  data: SaveFileTimelineData | undefined | null
): TimelineData {
  if (!data || !isValidTimelineData({ ...data, lastRecordId: 0 })) {
    return createInitialTimeline();
  }

  const timeline: TimelineData = {
    version: data.version || TIMELINE_VERSION,
    records: Array.isArray(data.records) ? [...data.records] : [],
    lastRecordId: 0,
    startTime: data.startTime || Date.now(),
  };

  for (const record of timeline.records) {
    if (record.id > timeline.lastRecordId) {
      timeline.lastRecordId = record.id;
    }
  }
  recordIdCounter = timeline.lastRecordId;

  pruneOldRecords(timeline);
  currentTimeline = timeline;
  saveTimeline(timeline);
  return timeline;
}

export function formatTimelineRecord(record: TimelineRecord): string {
  const time = new Date(record.timestamp).toLocaleTimeString("zh-CN");
  switch (record.type) {
    case "spawn": {
      const dessert = DESSERTS[record.level - 1];
      return `${time} 🍰 生成 ${dessert?.emoji}${dessert?.name || `Lv.${record.level}`} #${record.index + 1} ${record.freeSpawn ? "(免费)" : `-${record.cost}💰`}`;
    }
    case "move": {
      const dessert = DESSERTS[record.level - 1];
      return `${time} 📦 移动 ${dessert?.emoji || ""} #${record.sourceIndex + 1} → #${record.targetIndex + 1}`;
    }
    case "merge": {
      const source = DESSERTS[record.sourceLevel - 1];
      const target = DESSERTS[record.targetLevel - 1];
      return `${time} ✨ 合成 ${source?.emoji}+${source?.emoji} → ${target?.emoji}${target?.name} +${record.coinReward}💰${record.isNewMaxLevel ? " 🎉新等级!" : ""}`;
    }
    case "submit_order": {
      return `${time} 📋 提交订单 #${record.orderId} +${record.coinReward}💰`;
    }
    case "claim_offline": {
      return `${time} 🌙 领取离线收益 +${record.coins}💰 (${record.offlineMinutes}分钟)`;
    }
    case "import_save": {
      return `${time} 📥 导入存档 v${record.saveVersion} (${new Date(record.saveTimestamp).toLocaleString("zh-CN")})`;
    }
    case "reset": {
      return `${time} 🔄 重置游戏 (${record.reason === "user_initiated" ? "用户主动" : "存档损坏"})`;
    }
    case "organize": {
      return `${time} 🧹 整理棋盘 (移动${record.itemsMoved}个甜品)`;
    }
    default:
      return `${time} [未知操作]`;
  }
}

export interface FormattedTimelineRecord {
  icon: string;
  title: string;
  description: string;
}

export function formatTimelineRecordDetailed(record: TimelineRecord): FormattedTimelineRecord {
  switch (record.type) {
    case "spawn": {
      const dessert = DESSERTS[record.level - 1];
      return {
        icon: "🎯",
        title: `生成 ${dessert?.emoji || ""}${dessert?.name || `Lv.${record.level}`}`,
        description: `位置 #${record.index + 1} ${record.freeSpawn ? "(免费)" : `-${record.cost}💰`}`,
      };
    }
    case "move": {
      const dessert = DESSERTS[record.level - 1];
      return {
        icon: "📦",
        title: `移动 ${dessert?.emoji || ""}${dessert?.name || `Lv.${record.level}`}`,
        description: `#${record.sourceIndex + 1} → #${record.targetIndex + 1}`,
      };
    }
    case "merge": {
      const source = DESSERTS[record.sourceLevel - 1];
      const result = DESSERTS[record.targetLevel - 1];
      return {
        icon: "✨",
        title: `合成 ${result?.emoji || ""}${result?.name || `Lv.${record.targetLevel}`}`,
        description: `${source?.emoji || ""}+${source?.emoji || ""} → +${record.coinReward}💰${record.isNewMaxLevel ? " 🎉新等级!" : ""}`,
      };
    }
    case "submit_order": {
      return {
        icon: "📋",
        title: "提交订单",
        description: `订单 #${record.orderId} +${record.coinReward}💰`,
      };
    }
    case "claim_offline": {
      return {
        icon: "🌙",
        title: "领取离线收益",
        description: `+${record.coins}💰 (${record.offlineMinutes}分钟)`,
      };
    }
    case "import_save": {
      return {
        icon: "📥",
        title: "导入存档",
        description: `v${record.saveVersion} · ${new Date(record.saveTimestamp).toLocaleDateString("zh-CN")}`,
      };
    }
    case "reset": {
      return {
        icon: "🔄",
        title: "重置游戏",
        description: `${record.reason === "user_initiated" ? "用户主动重置" : "存档损坏重置"}`,
      };
    }
    case "organize": {
      return {
        icon: "🧹",
        title: "整理棋盘",
        description: `移动${record.itemsMoved}个甜品`,
      };
    }
    default:
      return {
        icon: "❓",
        title: "未知操作",
        description: "",
      };
  }
}
