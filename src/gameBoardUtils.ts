import {
  DESSERTS,
  Dessert,
  LevelConfig,
  LEVEL_CONFIGS,
  getMergeCostToLevel,
  calculateOrderItemReward,
} from "./gameConfig";

export interface GameState {
  board: (number | null)[];
  coins: number;
  maxLevel: number;
  unlockedLevels: number[];
  unlockTimes: { [key: number]: string };
}

export interface OrderItem {
  level: number;
  count: number;
  collected: number;
}

export interface Order {
  id: number;
  items: OrderItem[];
  reward: number;
  completed: boolean;
}

let orderIdCounter = 0;

export function resetOrderIdCounter(): void {
  orderIdCounter = 0;
}

export interface RecentlyUnlocked {
  level: number;
  timestamp: string;
  seen: boolean;
}

export interface UnlockHintBoardRow {
  level: number;
  emoji: string;
  name: string;
  onBoard: number;
  needed: number;
  shortfall: number;
  carriedUp: number;
  effectiveCount: number;
}

export interface UnlockHint {
  nextLevel: number;
  nextDessert: Dessert;
  parentDessert: Dessert;
  spawnsNeeded: number;
  mergesNeeded: number;
  minCost: number;
  boardProgress: UnlockHintBoardRow[];
  totalShortfallSpawns: number;
  totalShortfallCost: number;
  canMergeOnBoard: boolean;
  parentEffectiveCount: number;
}

export function findNextMergeHint(
  currentBoard: (number | null)[],
  config?: LevelConfig
): { sourceIndex: number; targetIndex: number; level: number } | null {
  const desserts = config?.desserts || DESSERTS;
  const levelIndices = new Map<number, number[]>();
  for (let i = 0; i < currentBoard.length; i++) {
    const cell = currentBoard[i];
    if (cell !== null && cell < desserts.length) {
      if (!levelIndices.has(cell)) {
        levelIndices.set(cell, []);
      }
      levelIndices.get(cell)!.push(i);
    }
  }

  const mergeableLevels = Array.from(levelIndices.entries())
    .filter(([, indices]) => indices.length >= 2)
    .map(([level]) => level)
    .sort((a, b) => b - a);

  if (mergeableLevels.length === 0) return null;

  const bestLevel = mergeableLevels[0];
  const indices = levelIndices.get(bestLevel)!;
  return {
    sourceIndex: indices[0],
    targetIndex: indices[1],
    level: bestLevel,
  };
}

export function createInitialBoard(config?: LevelConfig): (number | null)[] {
  const c = config || LEVEL_CONFIGS.classic;
  const initialBoard = Array(c.boardSize).fill(null);
  for (let i = 0; i < c.initialSpawnCount; i++) {
    initialBoard[i] = 1;
  }
  return initialBoard;
}

export function generateOrder(
  unlockedLevels: number[],
  config?: LevelConfig
): Order {
  const c = config || LEVEL_CONFIGS.classic;
  const actualMaxItems = Math.min(c.maxOrderItems, unlockedLevels.length);
  const actualMinItems = Math.min(c.minOrderItems, actualMaxItems);
  const numItems =
    Math.floor(Math.random() * (actualMaxItems - actualMinItems + 1)) +
    actualMinItems;
  const items: OrderItem[] = [];
  let totalReward = 0;
  const levelCounts = new Map<number, number>();

  for (let i = 0; i < numItems; i++) {
    const level =
      unlockedLevels[Math.floor(Math.random() * unlockedLevels.length)];
    const count = Math.floor(Math.random() * 2) + 1;
    levelCounts.set(level, (levelCounts.get(level) || 0) + count);
  }

  for (const [level, count] of levelCounts) {
    items.push({ level, count, collected: 0 });
    totalReward += calculateOrderItemReward(level, count, c);
  }

  return {
    id: ++orderIdCounter,
    items,
    reward: totalReward,
    completed: false,
  };
}

export function generateOrders(
  unlockedLevels: number[],
  config?: LevelConfig
): Order[] {
  const c = config || LEVEL_CONFIGS.classic;
  if (unlockedLevels.length === 0) return [];
  const orders: Order[] = [];
  for (let i = 0; i < c.maxOrders; i++) {
    orders.push(generateOrder(unlockedLevels, c));
  }
  return orders;
}

export function countDessertsOnBoard(
  board: (number | null)[],
  level: number
): number {
  return board.filter((cell) => cell === level).length;
}

export function removeDessertsFromBoard(
  board: (number | null)[],
  level: number,
  count: number
): (number | null)[] {
  const newBoard = [...board];
  let removed = 0;
  for (let i = 0; i < newBoard.length && removed < count; i++) {
    if (newBoard[i] === level) {
      newBoard[i] = null;
      removed++;
    }
  }
  return newBoard;
}

export function getOrderLevelTotals(order: Order): Map<number, number> {
  const totals = new Map<number, number>();
  for (const item of order.items) {
    totals.set(item.level, (totals.get(item.level) || 0) + item.count);
  }
  return totals;
}

export function canSubmitOrder(
  board: (number | null)[],
  order: Order
): boolean {
  const levelTotals = getOrderLevelTotals(order);
  for (const [level, count] of levelTotals) {
    if (countDessertsOnBoard(board, level) < count) {
      return false;
    }
  }
  return true;
}

export function getOrderProgress(
  board: (number | null)[],
  order: Order
): { percent: number; totalItems: number; completedItems: number } {
  const levelTotals = getOrderLevelTotals(order);
  let totalItems = 0;
  let completedItems = 0;
  for (const [level, count] of levelTotals) {
    totalItems += count;
    completedItems += Math.min(countDessertsOnBoard(board, level), count);
  }
  const percent =
    totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  return { percent, totalItems, completedItems };
}

export function formatUnlockTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "刚刚解锁";
  if (diffMins < 60) return `${diffMins}分钟前解锁`;
  if (diffHours < 24) return `${diffHours}小时前解锁`;
  if (diffDays < 7) return `${diffDays}天前解锁`;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  return `${month}月${day}日 ${hour}:${minute}解锁`;
}

export function getNextUnlockHint(
  currentUnlockedLevels: number[],
  currentBoard: (number | null)[],
  config?: LevelConfig
): UnlockHint | null {
  const c = config || LEVEL_CONFIGS.classic;
  const desserts = c.desserts;
  const maxUnlocked = Math.max(...currentUnlockedLevels);
  const nextLevel = maxUnlocked + 1;
  if (nextLevel > desserts.length) return null;
  const parentDessert = desserts[maxUnlocked - 1];
  const nextDessert = desserts[nextLevel - 1];
  const cost = getMergeCostToLevel(nextLevel, maxUnlocked, c);
  const parentLevel = maxUnlocked;

  const levelCounts = new Map<number, number>();
  for (const cell of currentBoard) {
    if (cell !== null && cell >= 1 && cell < nextLevel) {
      levelCounts.set(cell, (levelCounts.get(cell) || 0) + 1);
    }
  }

  const effectiveCounts = new Map<number, number>();
  const carriedUp = new Map<number, number>();
  let carryFromBelow = 0;
  for (let lv = 1; lv <= parentLevel; lv++) {
    const raw = levelCounts.get(lv) || 0;
    const totalAtLevel = raw + carryFromBelow;
    if (lv === parentLevel) {
      effectiveCounts.set(lv, totalAtLevel);
      carriedUp.set(lv, 0);
    } else {
      const carried = Math.floor(totalAtLevel / 2);
      const leftover = totalAtLevel - carried * 2;
      effectiveCounts.set(lv, leftover);
      carriedUp.set(lv, carried);
      carryFromBelow = carried;
    }
  }

  const parentOnBoard = levelCounts.get(parentLevel) || 0;
  const parentEffective = effectiveCounts.get(parentLevel) || 0;
  const parentNeeded = 2;
  const parentShortfall = Math.max(0, parentNeeded - parentEffective);

  const parentLv1Value = Math.pow(2, parentLevel - 1);
  let totalLv1Value = 0;
  for (const [lv, count] of levelCounts.entries()) {
    totalLv1Value += count * Math.pow(2, lv - 1);
  }
  const targetLv1Value = 2 * parentLv1Value;
  const shortfallLv1Value = Math.max(0, targetLv1Value - totalLv1Value);

  const boardProgress: UnlockHintBoardRow[] = [];
  for (let lv = parentLevel; lv >= 1; lv--) {
    const d = desserts[lv - 1];
    const onBoard = levelCounts.get(lv) || 0;
    const needed = lv === parentLevel ? 2 : 0;
    const effective = effectiveCounts.get(lv) || 0;
    const carried = carriedUp.get(lv) || 0;
    boardProgress.push({
      level: lv,
      emoji: d.emoji,
      name: d.name,
      onBoard,
      needed,
      shortfall: lv === parentLevel ? parentShortfall : 0,
      carriedUp: carried,
      effectiveCount: effective,
    });
  }

  return {
    nextLevel,
    nextDessert,
    parentDessert,
    spawnsNeeded: cost.spawnsNeeded,
    mergesNeeded: cost.mergesNeeded,
    minCost: cost.minSpawnCost,
    boardProgress,
    totalShortfallSpawns: shortfallLv1Value,
    totalShortfallCost: shortfallLv1Value * c.spawnCost,
    canMergeOnBoard: parentEffective >= 2,
    parentEffectiveCount: parentEffective,
  };
}

export function submitOrder(
  board: (number | null)[],
  order: Order
): { newBoard: (number | null)[]; success: boolean } {
  if (!canSubmitOrder(board, order)) {
    return { newBoard: board, success: false };
  }

  const levelTotals = getOrderLevelTotals(order);
  let newBoard = [...board];
  for (const [level, count] of levelTotals) {
    newBoard = removeDessertsFromBoard(newBoard, level, count);
  }
  return { newBoard, success: true };
}
