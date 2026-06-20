export interface Dessert {
  emoji: string;
  name: string;
  level: number;
  color: string;
}

export interface SimOrderItem {
  level: number;
  count: number;
}

export interface SimOrder {
  items: SimOrderItem[];
  reward: number;
}

export interface EventSimOrder {
  items: SimOrderItem[];
  reward: { coins: number; shards: number };
}

export type EventActionType = "merge" | "order" | "spawn" | "move" | "organize";

export interface EventMergeRecord {
  id: number;
  type: "merge";
  timestamp: number;
  stepNumber: number;
  sourceLevel: number;
  targetLevel: number;
  coinReward: number;
  isNewMaxLevel: boolean;
}

export interface EventOrderRecord {
  id: number;
  type: "order";
  timestamp: number;
  stepNumber: number;
  orderId: number;
  items: { level: number; count: number }[];
  coinReward: number;
  shardReward: number;
}

export interface EventCoinSource {
  source: "merge" | "order" | "remaining";
  amount: number;
  count: number;
}

export interface EventShardSource {
  source: "order" | "level_bonus" | "order_bonus";
  amount: number;
  count: number;
}

export interface EventReplayData {
  merges: EventMergeRecord[];
  orders: EventOrderRecord[];
  coinSources: EventCoinSource[];
  shardSources: EventShardSource[];
  finalBoard: (number | null)[];
  remainingCoins: number;
  totalStepsUsed: number;
}

export const DESSERTS: Dessert[] = [
  { emoji: "🍬", name: "糖果", level: 1, color: "#f9a8d4" },
  { emoji: "🍪", name: "曲奇", level: 2, color: "#fbbf24" },
  { emoji: "🍩", name: "甜甜圈", level: 3, color: "#fb923c" },
  { emoji: "🧁", name: "纸杯蛋糕", level: 4, color: "#f472b6" },
  { emoji: "🍰", name: "蛋糕", level: 5, color: "#ec4899" },
  { emoji: "🍮", name: "布丁", level: 6, color: "#a855f7" },
  { emoji: "🎂", name: "生日蛋糕", level: 7, color: "#8b5cf6" },
  { emoji: "🍨", name: "冰淇淋", level: 8, color: "#06b6d4" },
  { emoji: "🥧", name: "派", level: 9, color: "#10b981" },
  { emoji: "🍫", name: "巧克力", level: 10, color: "#78350f" },
];

export const MAX_DESSERT_LEVEL = DESSERTS.length;

export const GAME_ID = "hxywl-61902";
export const STORAGE_KEY = GAME_ID + "-save";
export const OFFLINE_DATA_KEY = GAME_ID + "-offline";

export const BOARD_SIZE = 25;
export const INITIAL_COINS = 50;
export const INITIAL_SPAWN_COUNT = 6;
export const SPAWN_COST = 10;
export const SPAWN_COOLDOWN_SECONDS = 5;
export const SPAWN_MIN_LEVEL = 1;
export const SPAWN_MAX_LEVEL = 3;

export const MAX_ORDERS = 3;
export const MIN_ORDER_ITEMS = 1;
export const MAX_ORDER_ITEMS = 3;

export const MAX_OFFLINE_HOURS = 8;
export const BASE_EARNINGS_PER_MINUTE = 2;

export const MERGE_REWARD_COEFFICIENT = 10;
export const ORDER_REWARD_COEFFICIENT = 15;

export const EVENT_MAX_STEPS = 25;
export const EVENT_INITIAL_COINS = 200;
export const EVENT_ORDER_COUNT = 3;
export const EVENT_BOARD_SIZE = 16;
export const EVENT_SPAWN_COST = 8;
export const EVENT_SPAWN_COOLDOWN = 3;
export const EVENT_MERGE_REWARD_COEFFICIENT = 15;
export const EVENT_ORDER_COIN_COEFFICIENT = 25;
export const EVENT_ORDER_SHARD_COEFFICIENT = 1;
export const EVENT_SHARD_DIVISOR = 3;
export const EVENT_MERGE_BONUS = 5;
export const EVENT_ORDER_BONUS = 50;
export const EVENT_LEVEL_BONUS_COEFFICIENT = 30;

export function calculateMergeReward(level: number, isEvent: boolean = false): number {
  const coefficient = isEvent ? EVENT_MERGE_REWARD_COEFFICIENT : MERGE_REWARD_COEFFICIENT;
  return level * coefficient;
}

export function calculateBaseEarningsRate(maxLevel: number): number {
  return BASE_EARNINGS_PER_MINUTE * maxLevel;
}

export function calculateOfflineEarnings(maxLevel: number, offlineMinutes: number): number {
  const rate = calculateBaseEarningsRate(maxLevel);
  const cappedMinutes = Math.min(offlineMinutes, MAX_OFFLINE_HOURS * 60);
  return Math.floor(cappedMinutes * rate);
}

export function calculateOrderItemReward(level: number, count: number): number {
  return level * count * ORDER_REWARD_COEFFICIENT;
}

export function calculateOrderReward(items: SimOrderItem[]): number {
  return items.reduce((sum, item) => sum + calculateOrderItemReward(item.level, item.count), 0);
}

export function calculateEventOrderReward(items: SimOrderItem[]): { coins: number; shards: number } {
  let coins = 0;
  let shards = 0;
  for (const item of items) {
    coins += item.level * item.count * EVENT_ORDER_COIN_COEFFICIENT;
    shards += item.level * item.count * EVENT_ORDER_SHARD_COEFFICIENT;
  }
  return { coins, shards: Math.ceil(shards / EVENT_SHARD_DIVISOR) };
}

export function getDessertsUpToLevel(maxLevel: number): Dessert[] {
  return DESSERTS.filter(d => d.level <= maxLevel);
}

export function getMergeCostToLevel(targetLevel: number, currentLevel: number = 1): { spawnsNeeded: number; mergesNeeded: number; minSpawnCost: number } {
  if (targetLevel <= currentLevel) {
    return { spawnsNeeded: 0, mergesNeeded: 0, minSpawnCost: 0 };
  }
  const levelsToMerge = targetLevel - currentLevel;
  const dessertsNeededAtCurrent = Math.pow(2, levelsToMerge);
  const mergesNeeded = dessertsNeededAtCurrent - 1;
  const spawnsNeeded = dessertsNeededAtCurrent;
  return {
    spawnsNeeded,
    mergesNeeded,
    minSpawnCost: spawnsNeeded * SPAWN_COST
  };
}

export function generateSimOrder(unlockedLevels: number[]): SimOrder {
  const actualMaxItems = Math.min(MAX_ORDER_ITEMS, unlockedLevels.length);
  const actualMinItems = Math.min(MIN_ORDER_ITEMS, actualMaxItems);
  const numItems = Math.floor(Math.random() * (actualMaxItems - actualMinItems + 1)) + actualMinItems;
  const levelCounts = new Map<number, number>();

  for (let i = 0; i < numItems; i++) {
    const level = unlockedLevels[Math.floor(Math.random() * unlockedLevels.length)];
    const count = Math.floor(Math.random() * 2) + 1;
    levelCounts.set(level, (levelCounts.get(level) || 0) + count);
  }

  const items: SimOrderItem[] = [];
  for (const [level, count] of levelCounts) {
    items.push({ level, count });
  }

  return {
    items,
    reward: calculateOrderReward(items)
  };
}

export function generateSimOrders(unlockedLevels: number[], count: number = MAX_ORDERS): SimOrder[] {
  if (unlockedLevels.length === 0) return [];
  const orders: SimOrder[] = [];
  for (let i = 0; i < count; i++) {
    orders.push(generateSimOrder(unlockedLevels));
  }
  return orders;
}

export function generateEventSimOrders(): EventSimOrder[] {
  const orders: EventSimOrder[] = [];
  for (let i = 0; i < EVENT_ORDER_COUNT; i++) {
    const levelRange = Math.min(5, 3 + Math.floor(i));
    const numItems = Math.floor(Math.random() * 2) + 1;
    const levelCounts = new Map<number, number>();
    for (let j = 0; j < numItems; j++) {
      const level = Math.floor(Math.random() * levelRange) + 2;
      const count = Math.floor(Math.random() * 2) + 1;
      levelCounts.set(level, (levelCounts.get(level) || 0) + count);
    }
    const items: SimOrderItem[] = [];
    for (const [level, count] of levelCounts) {
      items.push({ level, count });
    }
    orders.push({
      items,
      reward: calculateEventOrderReward(items)
    });
  }
  return orders;
}

export type AchievementCategory = "maxLevel" | "ordersCompleted" | "stepsRemaining" | "shardEarnings" | "streak";

export interface AchievementDef {
  id: string;
  category: AchievementCategory;
  name: string;
  description: string;
  icon: string;
  threshold: number;
  shardReward: number;
}

export interface AchievementProgressEntry {
  current: number;
  completed: boolean;
  claimed: boolean;
}

export interface AchievementState {
  progress: { [achievementId: string]: AchievementProgressEntry };
  streak: number;
  lastPlayDate: string | null;
  bestMaxLevel: number;
  bestOrdersCompleted: number;
  bestStepsRemaining: number;
  bestShardEarnings: number;
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: "maxLevel_3", category: "maxLevel", name: "合成新手", description: "在活动中达到 Lv.3", icon: "🧁", threshold: 3, shardReward: 2 },
  { id: "maxLevel_5", category: "maxLevel", name: "合成达人", description: "在活动中达到 Lv.5", icon: "🍰", threshold: 5, shardReward: 5 },
  { id: "maxLevel_7", category: "maxLevel", name: "合成大师", description: "在活动中达到 Lv.7", icon: "🎂", threshold: 7, shardReward: 10 },
  { id: "orders_1", category: "ordersCompleted", name: "订单新手", description: "单局完成 1 个订单", icon: "📋", threshold: 1, shardReward: 2 },
  { id: "orders_2", category: "ordersCompleted", name: "订单能手", description: "单局完成 2 个订单", icon: "📦", threshold: 2, shardReward: 5 },
  { id: "orders_3", category: "ordersCompleted", name: "订单达人", description: "单局完成 3 个订单", icon: "🏆", threshold: 3, shardReward: 8 },
  { id: "steps_5", category: "stepsRemaining", name: "步步精算", description: "结束时剩余 5 步以上", icon: "👟", threshold: 5, shardReward: 3 },
  { id: "steps_10", category: "stepsRemaining", name: "步步为营", description: "结束时剩余 10 步以上", icon: "🦶", threshold: 10, shardReward: 6 },
  { id: "shards_5", category: "shardEarnings", name: "碎片收集者", description: "单局获得 5 碎片以上", icon: "💎", threshold: 5, shardReward: 3 },
  { id: "shards_10", category: "shardEarnings", name: "碎片猎人", description: "单局获得 10 碎片以上", icon: "🔮", threshold: 10, shardReward: 6 },
  { id: "shards_15", category: "shardEarnings", name: "碎片大师", description: "单局获得 15 碎片以上", icon: "💠", threshold: 15, shardReward: 10 },
  { id: "streak_3", category: "streak", name: "坚持三日", description: "连续 3 天参与活动", icon: "🔥", threshold: 3, shardReward: 4 },
  { id: "streak_5", category: "streak", name: "五连挑战", description: "连续 5 天参与活动", icon: "⚡", threshold: 5, shardReward: 8 },
  { id: "streak_10", category: "streak", name: "十连传奇", description: "连续 10 天参与活动", icon: "🌟", threshold: 10, shardReward: 15 },
];

export function createInitialAchievementState(): AchievementState {
  const progress: { [achievementId: string]: AchievementProgressEntry } = {};
  for (const def of ACHIEVEMENT_DEFS) {
    progress[def.id] = { current: 0, completed: false, claimed: false };
  }
  return {
    progress,
    streak: 0,
    lastPlayDate: null,
    bestMaxLevel: 1,
    bestOrdersCompleted: 0,
    bestStepsRemaining: 0,
    bestShardEarnings: 0,
  };
}

export function checkAchievementCompletion(state: AchievementState, category: AchievementCategory, value: number): string[] {
  const newlyCompleted: string[] = [];
  for (const def of ACHIEVEMENT_DEFS) {
    if (def.category !== category) continue;
    const entry = state.progress[def.id];
    if (!entry || entry.completed) continue;
    const updated = Math.max(entry.current, value);
    if (updated >= def.threshold) {
      entry.current = updated;
      entry.completed = true;
      newlyCompleted.push(def.id);
    } else {
      entry.current = updated;
    }
  }
  return newlyCompleted;
}

export function calculateEventResult(
  merges: number,
  ordersCompleted: number,
  maxLevel: number,
  eventCoins: number,
  eventShardsEarned: number
): { coins: number; shards: number } {
  const mergeBonus = merges * EVENT_MERGE_BONUS;
  const orderBonus = ordersCompleted * EVENT_ORDER_BONUS;
  const levelBonus = (maxLevel - 1) * EVENT_LEVEL_BONUS_COEFFICIENT;
  const totalCoins = eventCoins + mergeBonus + orderBonus + levelBonus;
  const totalShards = eventShardsEarned + Math.floor(maxLevel / 2) + ordersCompleted;
  return { coins: totalCoins, shards: totalShards };
}

export interface LevelCount {
  level: number;
  count: number;
  dessert: Dessert;
}

export interface EffectiveLevelCount extends LevelCount {
  carriedUp: number;
  effectiveCount: number;
}

export interface SynthesisSuggestion {
  level: number;
  dessert: Dessert;
  reason: string;
  priorityScore: number;
  pairs: number;
  sourceIndices: number[];
}

export interface OrderShortfall {
  orderId: number;
  canComplete: boolean;
  missingItems: { level: number; count: number; dessert: Dessert }[];
}

export interface SynthesisPlan {
  nextTargetLevel: number | null;
  nextTargetDessert: Dessert | null;
  isAllUnlocked: boolean;

  boardCounts: LevelCount[];
  effectiveCounts: EffectiveLevelCount[];
  maxReachableLevel: number;

  targetShortfall: {
    level: number;
    needed: number;
    have: number;
    shortfall: number;
    dessert: Dessert;
  }[];

  suggestions: SynthesisSuggestion[];
  orderShortfalls: OrderShortfall[];

  totalLv1Value: number;
  targetLv1Value: number;
  shortfallLv1Value: number;
}

export function calculateSynthesisPlan(
  board: (number | null)[],
  unlockedLevels: number[],
  orders: { id: number; items: { level: number; count: number }[] }[]
): SynthesisPlan {
  const maxUnlocked = Math.max(...unlockedLevels, 0);
  const nextLevel = maxUnlocked + 1;
  const isAllUnlocked = maxUnlocked >= DESSERTS.length;
  const nextTargetLevel = isAllUnlocked ? null : nextLevel;
  const nextTargetDessert = isAllUnlocked ? null : DESSERTS[nextLevel - 1];
  const parentLevel = maxUnlocked;

  const levelCounts = new Map<number, number>();
  const levelIndices = new Map<number, number[]>();
  for (let i = 0; i < board.length; i++) {
    const cell = board[i];
    if (cell !== null && cell >= 1 && cell <= DESSERTS.length) {
      levelCounts.set(cell, (levelCounts.get(cell) || 0) + 1);
      if (!levelIndices.has(cell)) {
        levelIndices.set(cell, []);
      }
      levelIndices.get(cell)!.push(i);
    }
  }

  const boardCounts: LevelCount[] = [];
  for (let lv = 1; lv <= DESSERTS.length; lv++) {
    const count = levelCounts.get(lv) || 0;
    if (count > 0 || lv <= maxUnlocked) {
      boardCounts.push({
        level: lv,
        count,
        dessert: DESSERTS[lv - 1],
      });
    }
  }

  const effectiveCounts: EffectiveLevelCount[] = [];
  let carryFromBelow = 0;
  for (let lv = 1; lv <= DESSERTS.length; lv++) {
    const raw = levelCounts.get(lv) || 0;
    const totalAtLevel = raw + carryFromBelow;
    const carried = Math.floor(totalAtLevel / 2);
    const leftover = totalAtLevel - carried * 2;

    effectiveCounts.push({
      level: lv,
      count: raw,
      dessert: DESSERTS[lv - 1],
      carriedUp: carried,
      effectiveCount: leftover,
    });

    carryFromBelow = carried;
  }

  let maxReachableLevel = 0;
  for (let i = effectiveCounts.length - 1; i >= 0; i--) {
    if (effectiveCounts[i].effectiveCount > 0 || effectiveCounts[i].carriedUp > 0) {
      maxReachableLevel = effectiveCounts[i].level + (effectiveCounts[i].carriedUp > 0 ? 1 : 0);
      if (maxReachableLevel > DESSERTS.length) {
        maxReachableLevel = DESSERTS.length;
      }
      break;
    }
  }

  const targetShortfall: SynthesisPlan["targetShortfall"] = [];
  let totalLv1Value = 0;
  let targetLv1Value = 0;
  let shortfallLv1Value = 0;

  if (nextTargetLevel && nextTargetDessert) {
    for (let lv = parentLevel; lv >= 1; lv--) {
      const needed = lv === parentLevel ? 2 : 0;
      const effectiveEntry = effectiveCounts.find(e => e.level === lv);
      const have = effectiveEntry?.effectiveCount || 0;
      const shortfall = Math.max(0, needed - have);

      if (lv === parentLevel || (effectiveEntry && effectiveEntry.count > 0)) {
        targetShortfall.push({
          level: lv,
          needed,
          have,
          shortfall,
          dessert: DESSERTS[lv - 1],
        });
      }
    }

    const parentLv1Value = Math.pow(2, parentLevel - 1);
    targetLv1Value = 2 * parentLv1Value;

    for (const [lv, count] of levelCounts.entries()) {
      totalLv1Value += count * Math.pow(2, lv - 1);
    }

    shortfallLv1Value = Math.max(0, targetLv1Value - totalLv1Value);
  }

  const suggestions: SynthesisSuggestion[] = [];

  const mergeableLevels = Array.from(levelCounts.entries())
    .filter(([, count]) => count >= 2)
    .map(([level]) => level)
    .sort((a, b) => b - a);

  for (const level of mergeableLevels) {
    const dessert = DESSERTS[level - 1];
    const count = levelCounts.get(level) || 0;
    const pairs = Math.floor(count / 2);
    const indices = levelIndices.get(level) || [];

    let priorityScore = level * 10;
    let reason = "";

    if (nextTargetLevel && level === parentLevel) {
      priorityScore += 100;
      reason = "🎯 解锁下一等级的关键材料";
    } else if (nextTargetLevel && level < parentLevel) {
      const distance = parentLevel - level;
      priorityScore += Math.max(0, 50 - distance * 10);
      reason = `📈 可向上折算到 Lv.${parentLevel}，助力解锁`;
    } else {
      reason = `✨ 合成可获得 ${(level + 1) * MERGE_REWARD_COEFFICIENT} 金币`;
    }

    let orderPriority = 0;
    for (const order of orders) {
      for (const item of order.items) {
        if (item.level === level + 1) {
          orderPriority += 30;
          if (reason) reason += " · ";
          reason += "📋 可完成订单";
        }
      }
    }
    priorityScore += orderPriority;

    suggestions.push({
      level,
      dessert,
      reason,
      priorityScore,
      pairs,
      sourceIndices: indices.slice(0, pairs * 2),
    });
  }

  suggestions.sort((a, b) => b.priorityScore - a.priorityScore);

  const orderShortfalls: OrderShortfall[] = orders.map(order => {
    const missingItems: OrderShortfall["missingItems"] = [];
    let canComplete = true;

    for (const item of order.items) {
      const have = levelCounts.get(item.level) || 0;
      if (have < item.count) {
        canComplete = false;
        missingItems.push({
          level: item.level,
          count: item.count - have,
          dessert: DESSERTS[item.level - 1],
        });
      }
    }

    return {
      orderId: order.id,
      canComplete,
      missingItems,
    };
  }).filter(os => !os.canComplete || os.missingItems.length > 0);

  return {
    nextTargetLevel,
    nextTargetDessert,
    isAllUnlocked,
    boardCounts,
    effectiveCounts,
    maxReachableLevel,
    targetShortfall,
    suggestions,
    orderShortfalls,
    totalLv1Value,
    targetLv1Value,
    shortfallLv1Value,
  };
}
