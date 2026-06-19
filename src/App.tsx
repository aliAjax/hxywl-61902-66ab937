import React, { useState, useEffect, useCallback, useRef } from "react";
import "./styles.css";
import {
  SAVE_VERSION,
  AUTO_SAVE_INTERVAL,
  SaveFileGameData,
  SaveFile,
  ValidateResult,
  validateSaveFile,
  sanitizeSaveData,
  createSaveFile,
  parseSaveFromString,
  downloadSaveFile,
  readFileAsText,
} from "./saveManager";
import {
  DESSERTS,
  Dessert,
  BOARD_SIZE,
  STORAGE_KEY,
  OFFLINE_DATA_KEY,
  MAX_ORDERS,
  MIN_ORDER_ITEMS,
  MAX_ORDER_ITEMS,
  MAX_OFFLINE_HOURS,
  BASE_EARNINGS_PER_MINUTE,
  SPAWN_COST,
  SPAWN_COOLDOWN_SECONDS,
  SPAWN_MIN_LEVEL,
  SPAWN_MAX_LEVEL,
  INITIAL_COINS,
  INITIAL_SPAWN_COUNT,
  EVENT_MAX_STEPS,
  EVENT_INITIAL_COINS,
  EVENT_ORDER_COUNT,
  EVENT_BOARD_SIZE,
  EVENT_SPAWN_COST,
  EVENT_SPAWN_COOLDOWN,
  calculateMergeReward,
  calculateBaseEarningsRate,
  calculateOrderItemReward,
  calculateEventOrderReward,
  calculateEventResult as calculateEventResultImpl,
  getMergeCostToLevel,
} from "./gameConfig";
import SimulationPanel from "./SimulationPanel";

const game = {
  "id": "hxywl-61902",
  "port": 61902,
  "title": "甜品合成店",
  "tagline": "拖拽合成甜品，完成订单并解锁图鉴",
  "palette": [
    "#db2777",
    "#f59e0b",
    "#16a34a"
  ],
  "stats": [
    "金币",
    "订单",
    "图鉴",
    "最高等级"
  ],
  "actions": [
    "生成甜品",
    "自动整理",
    "领取收益"
  ],
  "mode": "merge"
};
const EVENT_SHARDS_KEY = game.id + "-shards";
const EVENT_HIGH_SCORE_KEY = game.id + "-event-highscore";
const RECENTLY_UNLOCKED_KEY = game.id + "-recently-unlocked";

interface EventOrder {
  id: number;
  items: OrderItem[];
  reward: { coins: number; shards: number };
  completed: boolean;
}

interface EventStats {
  merges: number;
  ordersCompleted: number;
  maxLevel: number;
  totalCoinReward: number;
}

interface EventResult {
  coins: number;
  shards: number;
  maxLevel: number;
  merges: number;
  ordersCompleted: number;
  rank: "S" | "A" | "B" | "C";
}

const TUTORIAL_KEY = game.id + "-tutorial";

type TutorialStep = 
  | "welcome"
  | "spawn"
  | "merge"
  | "order"
  | "collection"
  | "offline"
  | "completed";

interface TutorialState {
  currentStep: TutorialStep;
  completedSteps: TutorialStep[];
  hasSpawned: boolean;
  hasMerged: boolean;
  hasCompletedOrder: boolean;
  hasViewedCollection: boolean;
  hasClaimedOffline: boolean;
}

const TUTORIAL_STEPS: { step: TutorialStep; title: string; description: string; highlight: string }[] = [
  {
    step: "welcome",
    title: "👋 欢迎来到甜品合成店！",
    description: "在这里，你可以通过合成甜品创造出更高级的美味，完成订单赚取金币，收集全部10种甜品图鉴。让我们开始吧！",
    highlight: "none"
  },
  {
    step: "spawn",
    title: "🍰 生成甜品",
    description: "点击下方的「生成甜品」按钮，或者点击棋盘上的空格，就能生成新的甜品。每次生成消耗10金币，试试吧！",
    highlight: "spawn-button"
  },
  {
    step: "merge",
    title: "✨ 拖拽合成",
    description: "拖动一个甜品到另一个相同等级的甜品上，它们就会合成为更高级的甜品！合成成功还会获得金币奖励哦~",
    highlight: "board"
  },
  {
    step: "order",
    title: "📋 完成订单",
    description: "右侧面板有顾客的订单，当你有足够的甜品时，点击「提交」按钮就能完成订单获得丰厚奖励！",
    highlight: "orders"
  },
  {
    step: "collection",
    title: "📖 查看图鉴",
    description: "点击图鉴中已解锁的甜品，可以查看它的详细信息。看看你已经收集了多少种甜品吧！",
    highlight: "collection"
  },
  {
    step: "offline",
    title: "🌙 离线收益",
    description: "即使你离开了游戏，甜品店也会持续营业赚取金币。下次进入时记得点击「领取收益」领取哦！",
    highlight: "offline-button"
  }
];

const POINTER_MOVE_THRESHOLD = 5;
let orderIdCounter = 0;

interface GameState {
  board: (number | null)[];
  coins: number;
  maxLevel: number;
  unlockedLevels: number[];
  unlockTimes: { [key: number]: string };
}

interface OfflineData {
  lastLeaveTime: number;
  lastClaimTime: number;
  maxLevelAtLeave: number;
  baseEarningsRate: number;
}

interface OfflineReward {
  coins: number;
  offlineMinutes: number;
  maxLevel: number;
  isValid: boolean;
  reason?: "first" | "rollback" | "too_short" | "already_claimed";
  earningsPerMinute: number;
  capMinutes: number;
  actualOfflineMinutes: number;
}

interface OrderItem {
  level: number;
  count: number;
  collected: number;
}

interface Order {
  id: number;
  items: OrderItem[];
  reward: number;
  completed: boolean;
}

interface DragState {
  isDragging: boolean;
  sourceIndex: number | null;
  pointerStartX: number;
  pointerStartY: number;
  currentX: number;
  currentY: number;
  pointerId: number | null;
  hasMoved: boolean;
}

interface FeedbackState {
  type: "success" | "fail" | null;
  indices: number[];
  timestamp: number;
}

function findNextMergeHint(currentBoard: (number | null)[]): { sourceIndex: number; targetIndex: number; level: number } | null {
  const levelIndices = new Map<number, number[]>();
  for (let i = 0; i < currentBoard.length; i++) {
    const cell = currentBoard[i];
    if (cell !== null && cell < DESSERTS.length) {
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

function createInitialBoard(): (number | null)[] {
  const initialBoard = Array(BOARD_SIZE).fill(null);
  for (let i = 0; i < INITIAL_SPAWN_COUNT; i++) {
    initialBoard[i] = 1;
  }
  return initialBoard;
}

function createFallbackGameData(): SaveFileGameData {
  return {
    board: createInitialBoard(),
    coins: INITIAL_COINS,
    maxLevel: 1,
    unlockedLevels: [1],
    unlockTimes: { 1: new Date().toISOString() },
    orders: [],
    spawnCooldownEnd: 0,
  };
}

function loadGameState(): { state: GameState; orders: Order[]; loadedFromSave: boolean; spawnCooldownEnd: number } {
  const fallback = createFallbackGameData();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      
      let gameData: SaveFileGameData;
      if (parsed.data && typeof parsed.data === "object") {
        gameData = parsed.data as SaveFileGameData;
      } else {
        gameData = {
          board: parsed.board || Array(BOARD_SIZE).fill(null),
          coins: typeof parsed.coins === "number" ? parsed.coins : -1,
          maxLevel: parsed.maxLevel || 1,
          unlockedLevels: parsed.unlockedLevels || [1],
          unlockTimes: parsed.unlockTimes || { 1: new Date().toISOString() },
          orders: parsed.orders || [],
          spawnCooldownEnd: parsed.spawnCooldownEnd || 0,
        };
      }

      const validateResult = validateSaveFile({
        version: parsed.version || "0.9.0",
        gameId: parsed.gameId || "hxywl-61902",
        timestamp: parsed.timestamp || Date.now(),
        data: gameData,
      });

      if (validateResult.isValid) {
        const sanitized = sanitizeSaveData(gameData, fallback);
        const loadedBoard = sanitized.board;
        const hasExistingBoard = loadedBoard.some((cell) => cell !== null);
        const loadedCoins = sanitized.coins;
        const isNewGame = !hasExistingBoard && loadedCoins <= 0;

        const finalOrders = sanitized.orders && sanitized.orders.length > 0
          ? (sanitized.orders as Order[])
          : generateOrders(sanitized.unlockedLevels);

        return {
          state: {
            board: isNewGame ? createInitialBoard() : loadedBoard,
            coins: isNewGame ? INITIAL_COINS : Math.max(loadedCoins, 0),
            maxLevel: sanitized.maxLevel,
            unlockedLevels: sanitized.unlockedLevels,
            unlockTimes: sanitized.unlockTimes,
          },
          orders: finalOrders,
          loadedFromSave: true,
          spawnCooldownEnd: sanitized.spawnCooldownEnd ?? 0,
        };
      } else {
        console.warn("存档校验存在问题:", validateResult.errors, validateResult.warnings);
        try {
          const sanitized = sanitizeSaveData(gameData, fallback);
          return {
            state: {
              board: sanitized.board,
              coins: Math.max(sanitized.coins, 0),
              maxLevel: sanitized.maxLevel,
              unlockedLevels: sanitized.unlockedLevels,
              unlockTimes: sanitized.unlockTimes,
            },
            orders: (sanitized.orders as Order[]) && sanitized.orders.length > 0
              ? (sanitized.orders as Order[])
              : generateOrders(sanitized.unlockedLevels),
            loadedFromSave: true,
            spawnCooldownEnd: sanitized.spawnCooldownEnd ?? 0,
          };
        } catch (innerE) {
          console.error("修复损坏存档失败，使用新存档:", innerE);
        }
      }
    }
  } catch (e) {
    console.error("加载存档失败，使用默认初始值:", e);
  }
  return {
    state: {
      board: createInitialBoard(),
      coins: INITIAL_COINS,
      maxLevel: 1,
      unlockedLevels: [1],
      unlockTimes: { 1: new Date().toISOString() },
    },
    orders: generateOrders([1]),
    loadedFromSave: false,
    spawnCooldownEnd: 0,
  };
}

function saveGameState(state: GameState, orders: Order[], spawnCooldownEnd: number): void {
  try {
    const gameData: SaveFileGameData = {
      board: state.board,
      coins: state.coins,
      maxLevel: state.maxLevel,
      unlockedLevels: state.unlockedLevels,
      unlockTimes: state.unlockTimes,
      orders: orders.map(o => ({
        id: o.id,
        reward: o.reward,
        completed: o.completed,
        items: o.items.map(it => ({ ...it })),
      })),
      spawnCooldownEnd: spawnCooldownEnd || 0,
    };
    const saveFile = createSaveFile(gameData, false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saveFile));
  } catch (e) {
    console.error("保存存档失败:", e);
  }
}

function loadOfflineData(): OfflineData | null {
  try {
    const saved = localStorage.getItem(OFFLINE_DATA_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        lastLeaveTime: parsed.lastLeaveTime || 0,
        lastClaimTime: parsed.lastClaimTime || 0,
        maxLevelAtLeave: parsed.maxLevelAtLeave || 1,
        baseEarningsRate: parsed.baseEarningsRate || BASE_EARNINGS_PER_MINUTE,
      };
    }
  } catch (e) {
    console.error("Failed to load offline data:", e);
  }
  return null;
}

function saveOfflineData(data: OfflineData): void {
  localStorage.setItem(OFFLINE_DATA_KEY, JSON.stringify(data));
}

function hasUnclaimedReward(): boolean {
  const offlineData = loadOfflineData();
  if (!offlineData || offlineData.lastLeaveTime === 0) return false;
  return offlineData.lastClaimTime < offlineData.lastLeaveTime;
}

function calculateOfflineReward(): OfflineReward {
  const offlineData = loadOfflineData();
  const now = Date.now();
  const maxOfflineMinutes = MAX_OFFLINE_HOURS * 60;
  const fallbackMaxLevel = offlineData?.maxLevelAtLeave || 1;
  const fallbackRate = calculateBaseEarningsRate(fallbackMaxLevel);

  if (!offlineData || offlineData.lastLeaveTime === 0) {
    return {
      coins: 0,
      offlineMinutes: 0,
      maxLevel: fallbackMaxLevel,
      isValid: false,
      reason: "first",
      earningsPerMinute: fallbackRate,
      capMinutes: maxOfflineMinutes,
      actualOfflineMinutes: 0,
    };
  }

  if (now < offlineData.lastLeaveTime) {
    return {
      coins: 0,
      offlineMinutes: 0,
      maxLevel: offlineData.maxLevelAtLeave,
      isValid: false,
      reason: "rollback",
      earningsPerMinute: offlineData.baseEarningsRate,
      capMinutes: maxOfflineMinutes,
      actualOfflineMinutes: 0,
    };
  }

  if (offlineData.lastClaimTime >= offlineData.lastLeaveTime) {
    return {
      coins: 0,
      offlineMinutes: 0,
      maxLevel: offlineData.maxLevelAtLeave,
      isValid: false,
      reason: "already_claimed",
      earningsPerMinute: offlineData.baseEarningsRate,
      capMinutes: maxOfflineMinutes,
      actualOfflineMinutes: 0,
    };
  }

  const offlineMs = now - offlineData.lastLeaveTime;
  const actualMinutes = Math.floor(offlineMs / 60000);

  if (actualMinutes < 1) {
    return {
      coins: 0,
      offlineMinutes: 0,
      maxLevel: offlineData.maxLevelAtLeave,
      isValid: false,
      reason: "too_short",
      earningsPerMinute: offlineData.baseEarningsRate,
      capMinutes: maxOfflineMinutes,
      actualOfflineMinutes: actualMinutes,
    };
  }

  const cappedMinutes = Math.min(actualMinutes, maxOfflineMinutes);
  const coins = Math.floor(cappedMinutes * offlineData.baseEarningsRate);

  return {
    coins,
    offlineMinutes: cappedMinutes,
    maxLevel: offlineData.maxLevelAtLeave,
    isValid: true,
    earningsPerMinute: offlineData.baseEarningsRate,
    capMinutes: maxOfflineMinutes,
    actualOfflineMinutes: actualMinutes,
  };
}

function recordLeaveTime(maxLevel: number): void {
  const existing = loadOfflineData();
  const offlineData: OfflineData = {
    lastLeaveTime: Date.now(),
    lastClaimTime: existing?.lastClaimTime || 0,
    maxLevelAtLeave: maxLevel,
    baseEarningsRate: calculateBaseEarningsRate(maxLevel),
  };
  saveOfflineData(offlineData);
}

function markAsClaimed(): void {
  const offlineData = loadOfflineData();
  if (offlineData) {
    offlineData.lastClaimTime = Date.now();
    saveOfflineData(offlineData);
  }
}

function loadTutorialState(): TutorialState {
  try {
    const saved = localStorage.getItem(TUTORIAL_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        currentStep: parsed.currentStep || "welcome",
        completedSteps: parsed.completedSteps || [],
        hasSpawned: parsed.hasSpawned || false,
        hasMerged: parsed.hasMerged || false,
        hasCompletedOrder: parsed.hasCompletedOrder || false,
        hasViewedCollection: parsed.hasViewedCollection || false,
        hasClaimedOffline: parsed.hasClaimedOffline || false,
      };
    }
  } catch (e) {
    console.error("Failed to load tutorial state:", e);
  }
  return {
    currentStep: "welcome",
    completedSteps: [],
    hasSpawned: false,
    hasMerged: false,
    hasCompletedOrder: false,
    hasViewedCollection: false,
    hasClaimedOffline: false,
  };
}

function saveTutorialState(state: TutorialState): void {
  localStorage.setItem(TUTORIAL_KEY, JSON.stringify(state));
}

function isTutorialCompleted(): boolean {
  try {
    const saved = localStorage.getItem(TUTORIAL_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return parsed.currentStep === "completed" || (parsed.completedSteps && parsed.completedSteps.includes("completed"));
    }
  } catch (e) {
    console.error("Failed to check tutorial completion:", e);
  }
  return false;
}

function generateOrder(unlockedLevels: number[]): Order {
  const actualMaxItems = Math.min(MAX_ORDER_ITEMS, unlockedLevels.length);
  const actualMinItems = Math.min(MIN_ORDER_ITEMS, actualMaxItems);
  const numItems = Math.floor(Math.random() * (actualMaxItems - actualMinItems + 1)) + actualMinItems;
  const items: OrderItem[] = [];
  let totalReward = 0;
  const levelCounts = new Map<number, number>();

  for (let i = 0; i < numItems; i++) {
    const level = unlockedLevels[Math.floor(Math.random() * unlockedLevels.length)];
    const count = Math.floor(Math.random() * 2) + 1;
    levelCounts.set(level, (levelCounts.get(level) || 0) + count);
  }

  for (const [level, count] of levelCounts) {
    items.push({ level, count, collected: 0 });
    totalReward += calculateOrderItemReward(level, count);
  }

  return {
    id: ++orderIdCounter,
    items,
    reward: totalReward,
    completed: false,
  };
}

function generateOrders(unlockedLevels: number[], count: number = MAX_ORDERS): Order[] {
  if (unlockedLevels.length === 0) return [];
  const orders: Order[] = [];
  for (let i = 0; i < count; i++) {
    orders.push(generateOrder(unlockedLevels));
  }
  return orders;
}

function countDessertsOnBoard(board: (number | null)[], level: number): number {
  return board.filter(cell => cell === level).length;
}

function removeDessertsFromBoard(board: (number | null)[], level: number, count: number): (number | null)[] {
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

function getOrderLevelTotals(order: Order): Map<number, number> {
  const totals = new Map<number, number>();
  for (const item of order.items) {
    totals.set(item.level, (totals.get(item.level) || 0) + item.count);
  }
  return totals;
}

function canSubmitOrder(board: (number | null)[], order: Order): boolean {
  const levelTotals = getOrderLevelTotals(order);
  for (const [level, count] of levelTotals) {
    if (countDessertsOnBoard(board, level) < count) {
      return false;
    }
  }
  return true;
}

function getOrderProgress(board: (number | null)[], order: Order): { percent: number; totalItems: number; completedItems: number } {
  const levelTotals = getOrderLevelTotals(order);
  let totalItems = 0;
  let completedItems = 0;
  for (const [level, count] of levelTotals) {
    totalItems += count;
    completedItems += Math.min(countDessertsOnBoard(board, level), count);
  }
  const percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  return { percent, totalItems, completedItems };
}

function formatUnlockTime(isoString: string): string {
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
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute}解锁`;
}

interface RecentlyUnlocked {
  level: number;
  timestamp: string;
  seen: boolean;
}

function loadRecentlyUnlocked(): RecentlyUnlocked | null {
  try {
    const saved = localStorage.getItem(RECENTLY_UNLOCKED_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.level === "number" && typeof parsed.timestamp === "string") {
        return parsed as RecentlyUnlocked;
      }
    }
  } catch (e) {
    console.error("Failed to load recently unlocked:", e);
  }
  return null;
}

function saveRecentlyUnlocked(data: RecentlyUnlocked | null): void {
  try {
    if (data) {
      localStorage.setItem(RECENTLY_UNLOCKED_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(RECENTLY_UNLOCKED_KEY);
    }
  } catch (e) {
    console.error("Failed to save recently unlocked:", e);
  }
}

interface UnlockHintBoardRow {
  level: number;
  emoji: string;
  name: string;
  onBoard: number;
  needed: number;
  shortfall: number;
  carriedUp: number;
  effectiveCount: number;
}

interface UnlockHint {
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

function getNextUnlockHint(currentUnlockedLevels: number[], currentBoard: (number | null)[]): UnlockHint | null {
  const maxUnlocked = Math.max(...currentUnlockedLevels);
  const nextLevel = maxUnlocked + 1;
  if (nextLevel > DESSERTS.length) return null;
  const parentDessert = DESSERTS[maxUnlocked - 1];
  const nextDessert = DESSERTS[nextLevel - 1];
  const cost = getMergeCostToLevel(nextLevel, maxUnlocked);
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
    const d = DESSERTS[lv - 1];
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
    totalShortfallCost: shortfallLv1Value * SPAWN_COST,
    canMergeOnBoard: parentEffective >= 2,
    parentEffectiveCount: parentEffective,
  };
}

function submitOrder(board: (number | null)[], order: Order): { newBoard: (number | null)[]; success: boolean } {
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

function loadEventShards(): number {
  try {
    const saved = localStorage.getItem(EVENT_SHARDS_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
  } catch (e) {
    console.error("Failed to load event shards:", e);
  }
  return 0;
}

function saveEventShards(shards: number): void {
  localStorage.setItem(EVENT_SHARDS_KEY, String(shards));
}

function loadEventHighScore(): number {
  try {
    const saved = localStorage.getItem(EVENT_HIGH_SCORE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
  } catch (e) {
    console.error("Failed to load event high score:", e);
  }
  return 0;
}

function saveEventHighScore(score: number): void {
  localStorage.setItem(EVENT_HIGH_SCORE_KEY, String(score));
}

function generateEventOrders(): EventOrder[] {
  const orders: EventOrder[] = [];
  for (let i = 0; i < EVENT_ORDER_COUNT; i++) {
    const levelRange = Math.min(5, 3 + Math.floor(i));
    const numItems = Math.floor(Math.random() * 2) + 1;
    const items: OrderItem[] = [];
    const levelCounts = new Map<number, number>();
    for (let j = 0; j < numItems; j++) {
      const level = Math.floor(Math.random() * levelRange) + 2;
      const count = Math.floor(Math.random() * 2) + 1;
      levelCounts.set(level, (levelCounts.get(level) || 0) + count);
    }
    for (const [level, count] of levelCounts) {
      items.push({ level, count, collected: 0 });
    }
    const eventReward = calculateEventOrderReward(items);
    orders.push({
      id: i + 1,
      items,
      reward: eventReward,
      completed: false,
    });
  }
  return orders;
}

function calculateEventResult(
  stats: EventStats,
  eventCoins: number,
  eventShardsEarned: number
): EventResult {
  const totals = calculateEventResultImpl(
    stats.merges,
    stats.ordersCompleted,
    stats.maxLevel,
    eventCoins,
    eventShardsEarned
  );

  let rank: "S" | "A" | "B" | "C" = "C";
  const score = stats.merges * 10 + stats.ordersCompleted * 50 + stats.maxLevel * 20;
  if (score >= 300) rank = "S";
  else if (score >= 200) rank = "A";
  else if (score >= 100) rank = "B";

  return {
    coins: totals.coins,
    shards: totals.shards,
    maxLevel: stats.maxLevel,
    merges: stats.merges,
    ordersCompleted: stats.ordersCompleted,
    rank,
  };
}

type SpawnStatus = "ready" | "cooldown" | "no_coins" | "board_full";

function App(): React.ReactElement {
  const initialLoaded = loadGameState();
  const initialState = initialLoaded.state;
  const [board, setBoard] = useState<(number | null)[]>(initialState.board);
  const [coins, setCoins] = useState<number>(initialState.coins);
  const [maxLevel, setMaxLevel] = useState<number>(initialState.maxLevel);
  const [unlockedLevels, setUnlockedLevels] = useState<number[]>(initialState.unlockedLevels);
  const [unlockTimes, setUnlockTimes] = useState<{ [key: number]: string }>(initialState.unlockTimes);
  const [orders, setOrders] = useState<Order[]>(initialLoaded.orders);
  const initialCooldownEnd = initialLoaded.spawnCooldownEnd;
  const initialRemainingMs = Math.max(0, initialCooldownEnd - Date.now());
  const initialRemainingSeconds = Math.ceil(initialRemainingMs / 1000);
  const [spawnCooldownEnd, setSpawnCooldownEnd] = useState<number>(initialCooldownEnd);
  const [spawnCooldown, setSpawnCooldown] = useState<number>(initialRemainingSeconds);
  const spawnCooldownEndRef = useRef<number>(initialCooldownEnd);
  const spawnCooldownRef = useRef<number>(initialRemainingSeconds);
  const spawnTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSpawningRef = useRef<boolean>(false);
  const initialTutorial = loadTutorialState();
  const [toast, setToast] = useState<string | null>(null);
  const [selectedDessert, setSelectedDessert] = useState<number | null>(null);
  const spawnTimerRef = spawnTickRef;

  const [eventMode, setEventMode] = useState<boolean>(false);
  const [eventBoard, setEventBoard] = useState<(number | null)[]>([]);
  const [eventCoins, setEventCoins] = useState<number>(EVENT_INITIAL_COINS);
  const [eventStepsLeft, setEventStepsLeft] = useState<number>(EVENT_MAX_STEPS);
  const [eventOrders, setEventOrders] = useState<EventOrder[]>([]);
  const [eventStats, setEventStats] = useState<EventStats>({ merges: 0, ordersCompleted: 0, maxLevel: 1, totalCoinReward: 0 });
  const [eventShards, setEventShards] = useState<number>(loadEventShards());
  const [eventShardsEarned, setEventShardsEarned] = useState<number>(0);
  const [eventSpawnCooldown, setEventSpawnCooldown] = useState<number>(0);
  const eventSpawnCooldownRef = useRef<number>(0);
  const eventSpawnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showEventResult, setShowEventResult] = useState<boolean>(false);
  const [eventResult, setEventResult] = useState<EventResult | null>(null);
  const [eventHighScore, setEventHighScore] = useState<number>(loadEventHighScore());
  const [showEventEntry, setShowEventEntry] = useState<boolean>(false);

  const [drag, setDrag] = useState<DragState>({
    isDragging: false,
    sourceIndex: null,
    pointerStartX: 0,
    pointerStartY: 0,
    currentX: 0,
    currentY: 0,
    pointerId: null,
    hasMoved: false,
  });

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>({
    type: null,
    indices: [],
    timestamp: 0,
  });

  const [mergeHint, setMergeHint] = useState<{ sourceIndex: number; targetIndex: number; level: number } | null>(
    findNextMergeHint(initialState.board)
  );
  const mergeHintRef = useRef<{ sourceIndex: number; targetIndex: number; level: number } | null>(mergeHint);

  const [eventMergeHint, setEventMergeHint] = useState<{ sourceIndex: number; targetIndex: number; level: number } | null>(null);
  const eventMergeHintRef = useRef<{ sourceIndex: number; targetIndex: number; level: number } | null>(null);

  const [showMergeHint, setShowMergeHint] = useState<boolean>(true);
  const showMergeHintRef = useRef<boolean>(true);

  const [showOfflineModal, setShowOfflineModal] = useState<boolean>(false);
  const [offlineReward, setOfflineReward] = useState<OfflineReward | null>(null);

  const [tutorial, setTutorial] = useState<TutorialState>(initialTutorial);
  const [showTutorial, setShowTutorial] = useState<boolean>(!isTutorialCompleted() && initialTutorial.currentStep !== "completed");
  const tutorialRef = useRef<TutorialState>(tutorial);
  tutorialRef.current = tutorial;

  const [showSavePanel, setShowSavePanel] = useState<boolean>(false);
  const [recentlyUnlocked, setRecentlyUnlocked] = useState<RecentlyUnlocked | null>(loadRecentlyUnlocked());
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [showImportResult, setShowImportResult] = useState<{
    type: "success" | "error" | "warning";
    title: string;
    message: string;
    details: string[];
  } | null>(null);
  const [lastSaveTime, setLastSaveTime] = useState<number>(Date.now());
  const [autoSaveActive, setAutoSaveActive] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const boardRef = useRef<(number | null)[]>(board);
  const coinsRef = useRef<number>(coins);
  const maxLevelRef = useRef<number>(maxLevel);
  const unlockedLevelsRef = useRef<number[]>(unlockedLevels);
  const unlockTimesRef = useRef<{ [key: number]: string }>(unlockTimes);
  const ordersRef = useRef<Order[]>(orders);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<DragState>(drag);
  const hoverRef = useRef<number | null>(null);
  const eventBoardRef = useRef<(number | null)[]>(eventBoard);
  const eventCoinsRef = useRef<number>(eventCoins);
  const eventStepsLeftRef = useRef<number>(eventStepsLeft);
  const eventStatsRef = useRef<EventStats>(eventStats);
  const eventOrdersRef = useRef<EventOrder[]>(eventOrders);
  const eventBoardRefEl = useRef<HTMLDivElement>(null);
  const eventCellRefs = useRef<(HTMLDivElement | null)[]>([]);

  boardRef.current = board;
  coinsRef.current = coins;
  maxLevelRef.current = maxLevel;
  unlockedLevelsRef.current = unlockedLevels;
  unlockTimesRef.current = unlockTimes;
  ordersRef.current = orders;
  dragRef.current = drag;
  hoverRef.current = hoverIndex;
  spawnCooldownRef.current = spawnCooldown;
  spawnCooldownEndRef.current = spawnCooldownEnd;
  mergeHintRef.current = mergeHint;
  eventMergeHintRef.current = eventMergeHint;
  showMergeHintRef.current = showMergeHint;
  eventBoardRef.current = eventBoard;
  eventCoinsRef.current = eventCoins;
  eventStepsLeftRef.current = eventStepsLeft;
  eventStatsRef.current = eventStats;
  eventOrdersRef.current = eventOrders;
  eventSpawnCooldownRef.current = eventSpawnCooldown;

  const showToast = useCallback((message: string): void => {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const recalcMergeHint = useCallback((newBoard: (number | null)[]): void => {
    const hint = findNextMergeHint(newBoard);
    setMergeHint(hint);
  }, []);

  const recalcEventMergeHint = useCallback((newBoard: (number | null)[]): void => {
    const hint = findNextMergeHint(newBoard);
    setEventMergeHint(hint);
  }, []);

  const dismissUnlockCelebration = useCallback((): void => {
    const updated = recentlyUnlocked ? { ...recentlyUnlocked, seen: true } : null;
    saveRecentlyUnlocked(updated);
    setRecentlyUnlocked(updated);
  }, [recentlyUnlocked]);

  const doManualSave = useCallback((): void => {
    saveGameState(
      {
        board: boardRef.current,
        coins: coinsRef.current,
        maxLevel: maxLevelRef.current,
        unlockedLevels: unlockedLevelsRef.current,
        unlockTimes: unlockTimesRef.current,
      },
      ordersRef.current,
      spawnCooldownEndRef.current
    );
    setLastSaveTime(Date.now());
  }, []);

  useEffect(() => {
    saveGameState(
      {
        board,
        coins,
        maxLevel,
        unlockedLevels,
        unlockTimes,
      },
      orders,
      spawnCooldownEnd
    );
    setLastSaveTime(Date.now());
  }, [board, coins, maxLevel, unlockedLevels, unlockTimes, orders, spawnCooldownEnd]);

  useEffect(() => {
    recalcMergeHint(board);
  }, [board, recalcMergeHint]);

  useEffect(() => {
    if (eventMode && eventBoard.length > 0) {
      recalcEventMergeHint(eventBoard);
    }
  }, [eventBoard, eventMode, recalcEventMergeHint]);

  useEffect(() => {
    if (autoSaveActive) {
      autoSaveTimerRef.current = setInterval(() => {
        doManualSave();
      }, AUTO_SAVE_INTERVAL);
    }
    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [autoSaveActive, doManualSave]);

  const handleExportSave = useCallback((): void => {
    try {
      const gameData: SaveFileGameData = {
        board: boardRef.current,
        coins: coinsRef.current,
        maxLevel: maxLevelRef.current,
        unlockedLevels: unlockedLevelsRef.current,
        unlockTimes: unlockTimesRef.current,
        orders: ordersRef.current.map(o => ({
          id: o.id,
          reward: o.reward,
          completed: o.completed,
          items: o.items.map(it => ({ ...it })),
        })),
      };
      const saveFile = createSaveFile(gameData, true);
      downloadSaveFile(saveFile);
      showToast("💾 存档已导出到本地文件");
    } catch (e) {
      console.error("导出存档失败:", e);
      showToast("❌ 导出存档失败，请重试");
    }
    setShowSavePanel(false);
  }, [showToast]);

  const handleImportFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const readResult = await readFileAsText(file);
      if (!readResult.success) {
        setShowImportResult({
          type: "error",
          title: "文件读取失败",
          message: readResult.error,
          details: [],
        });
        return;
      }

      const parseResult = parseSaveFromString(readResult.content);
      if (!parseResult.success || !parseResult.save) {
        setShowImportResult({
          type: "error",
          title: "存档格式错误",
          message: parseResult.error || "文件内容无法解析为有效的 JSON",
          details: [],
        });
        return;
      }

      const save = parseResult.save;
      const validation = validateSaveFile(save);

      if (validation.isValid) {
        applyImportedSave(save, validation);
      } else if (validation.errors.length > 0) {
        setShowImportResult({
          type: "error",
          title: "存档校验失败",
          message: `检测到 ${validation.errors.length} 个错误，无法导入此存档。`,
          details: validation.errors,
        });
      } else {
        applyImportedSave(save, validation);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setShowImportResult({
        type: "error",
        title: "导入过程发生错误",
        message: msg,
        details: [],
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [showToast]);

  const applyImportedSave = useCallback((save: SaveFile, validation: ValidateResult): void => {
    try {
      const fallback = {
        board: boardRef.current,
        coins: coinsRef.current,
        maxLevel: maxLevelRef.current,
        unlockedLevels: unlockedLevelsRef.current,
        unlockTimes: unlockTimesRef.current,
        orders: ordersRef.current,
      };

      const sanitized = sanitizeSaveData(save.data, fallback);
      const newOrders: Order[] = sanitized.orders.length > 0
        ? (sanitized.orders as Order[])
        : generateOrders(sanitized.unlockedLevels);

      setBoard(sanitized.board);
      setCoins(Math.max(sanitized.coins, 0));
      setMaxLevel(sanitized.maxLevel);
      setUnlockedLevels(sanitized.unlockedLevels);
      setUnlockTimes(sanitized.unlockTimes);
      setOrders(newOrders);

      doManualSave();

      const saveDate = new Date(save.timestamp).toLocaleString('zh-CN');
      if (validation.warnings.length > 0) {
        setShowImportResult({
          type: "warning",
          title: "导入成功（存在警告）",
          message: `存档已恢复。保存时间：${saveDate}\n但检测到 ${validation.warnings.length} 个非关键问题：`,
          details: validation.warnings,
        });
      } else {
        setShowImportResult({
          type: "success",
          title: "存档导入成功！",
          message: `进度已成功恢复到 ${saveDate}。\n金币：${sanitized.coins}，最高等级：Lv.${sanitized.maxLevel}，图鉴：${sanitized.unlockedLevels.length}/${DESSERTS.length}`,
          details: [],
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setShowImportResult({
        type: "error",
        title: "应用存档失败",
        message: `发生错误: ${msg}。当前进度已保留。`,
        details: [],
      });
    }
    setShowImportModal(false);
  }, [doManualSave, showToast]);

  const handleResetProgress = useCallback((): void => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(OFFLINE_DATA_KEY);
      localStorage.removeItem(TUTORIAL_KEY);
      localStorage.removeItem(RECENTLY_UNLOCKED_KEY);

      const newBoard = createInitialBoard();
      const newUnlockedLevels = [1];
      const newUnlockTimes = { 1: new Date().toISOString() };

      setBoard(newBoard);
      setCoins(INITIAL_COINS);
      setMaxLevel(1);
      setUnlockedLevels(newUnlockedLevels);
      setUnlockTimes(newUnlockTimes);
      setOrders(generateOrders(newUnlockedLevels));
      setRecentlyUnlocked(null);
      setTutorial({
        currentStep: "welcome",
        completedSteps: [],
        hasSpawned: false,
        hasMerged: false,
        hasCompletedOrder: false,
        hasViewedCollection: false,
        hasClaimedOffline: false,
      });
      setShowTutorial(true);
      setLastSaveTime(Date.now());

      showToast("🔄 进度已重置，开始新游戏！");
    } catch (e) {
      console.error("重置进度失败:", e);
      showToast("❌ 重置进度失败，请重试");
    }
    setShowResetConfirm(false);
    setShowSavePanel(false);
  }, [showToast]);

  const formatLastSaveTime = useCallback((): string => {
    const diff = Date.now() - lastSaveTime;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}小时前`;
    if (minutes > 0) return `${minutes}分钟前`;
    if (seconds < 5) return "刚刚";
    return `${seconds}秒前`;
  }, [lastSaveTime]);

  useEffect(() => {
    saveTutorialState(tutorial);
  }, [tutorial]);

  useEffect(() => {
    saveEventShards(eventShards);
  }, [eventShards]);

  const getCurrentTutorialStep = useCallback(() => {
    return TUTORIAL_STEPS.find(s => s.step === tutorial.currentStep) || null;
  }, [tutorial.currentStep]);

  const advanceTutorialStep = useCallback((completedAction: TutorialStep): void => {
    if (!showTutorial) return;

    setTutorial((prev) => {
      const newCompletedSteps = prev.completedSteps.includes(completedAction)
        ? prev.completedSteps
        : [...prev.completedSteps, completedAction];

      let newState = { ...prev, completedSteps: newCompletedSteps };

      switch (completedAction) {
        case "spawn":
          newState.hasSpawned = true;
          break;
        case "merge":
          newState.hasMerged = true;
          break;
        case "order":
          newState.hasCompletedOrder = true;
          break;
        case "collection":
          newState.hasViewedCollection = true;
          break;
        case "offline":
          newState.hasClaimedOffline = true;
          break;
      }

      const stepOrder: TutorialStep[] = ["welcome", "spawn", "merge", "order", "collection", "offline", "completed"];
      const currentIndex = stepOrder.indexOf(prev.currentStep);
      
      if (prev.currentStep === completedAction || 
          (completedAction === "spawn" && prev.currentStep === "spawn") ||
          (completedAction === "merge" && prev.currentStep === "merge") ||
          (completedAction === "order" && prev.currentStep === "order") ||
          (completedAction === "collection" && prev.currentStep === "collection") ||
          (completedAction === "offline" && prev.currentStep === "offline")) {
        const nextIndex = currentIndex + 1;
        if (nextIndex < stepOrder.length - 1) {
          newState.currentStep = stepOrder[nextIndex];
        } else {
          newState.currentStep = "completed";
        }
      }

      if (newState.currentStep === "completed") {
        setTimeout(() => setShowTutorial(false), 500);
      }

      return newState;
    });
  }, [showTutorial]);

  const goToNextTutorialStep = useCallback((): void => {
    setTutorial((prev) => {
      const stepOrder: TutorialStep[] = ["welcome", "spawn", "merge", "order", "collection", "offline", "completed"];
      const currentIndex = stepOrder.indexOf(prev.currentStep);
      const nextIndex = currentIndex + 1;

      if (nextIndex >= stepOrder.length - 1) {
        setTimeout(() => setShowTutorial(false), 300);
        return { ...prev, currentStep: "completed", completedSteps: [...prev.completedSteps, prev.currentStep] };
      }

      return {
        ...prev,
        currentStep: stepOrder[nextIndex],
        completedSteps: [...prev.completedSteps, prev.currentStep],
      };
    });
  }, []);

  const skipTutorial = useCallback((): void => {
    setTutorial((prev) => ({
      ...prev,
      currentStep: "completed",
      completedSteps: [...prev.completedSteps, "welcome", "spawn", "merge", "order", "collection", "offline", "completed"],
      hasSpawned: true,
      hasMerged: true,
      hasCompletedOrder: true,
      hasViewedCollection: true,
      hasClaimedOffline: true,
    }));
    setShowTutorial(false);
    showToast("👌 已跳过新手引导");
  }, [showToast]);

  const startEvent = useCallback((): void => {
    const initialEventBoard = Array(EVENT_BOARD_SIZE).fill(null);
    for (let i = 0; i < 4; i++) {
      initialEventBoard[i] = 1;
    }
    setEventBoard(initialEventBoard);
    setEventCoins(EVENT_INITIAL_COINS);
    setEventStepsLeft(EVENT_MAX_STEPS);
    setEventOrders(generateEventOrders());
    setEventStats({ merges: 0, ordersCompleted: 0, maxLevel: 1, totalCoinReward: 0 });
    setEventShardsEarned(0);
    setEventSpawnCooldown(0);
    setShowEventEntry(false);
    setEventMode(true);
    showToast("🎮 限时挑战开始！加油！");
  }, [showToast]);

  const endEvent = useCallback((): void => {
    const result = calculateEventResult(eventStatsRef.current, eventCoinsRef.current, eventShardsEarned);
    setEventResult(result);
    setShowEventResult(true);

    setCoins((prev: number) => prev + result.coins);
    setEventShards((prev: number) => prev + result.shards);

    const score = eventStatsRef.current.merges * 10 + eventStatsRef.current.ordersCompleted * 50 + eventStatsRef.current.maxLevel * 20;
    if (score > eventHighScore) {
      setEventHighScore(score);
      saveEventHighScore(score);
    }

    setEventMode(false);
  }, [eventShardsEarned, eventHighScore]);

  const exitEvent = useCallback((): void => {
    setEventMode(false);
    setEventBoard([]);
    showToast("👋 已退出活动，主线进度已保留");
  }, [showToast]);

  const consumeEventStep = useCallback((): boolean => {
    if (eventStepsLeftRef.current <= 0) {
      showToast("⏰ 步数已用完！");
      return false;
    }
    setEventStepsLeft((prev) => prev - 1);
    return true;
  }, [showToast]);

  const eventStartSpawnCooldown = useCallback((): void => {
    if (eventSpawnTimerRef.current) {
      clearInterval(eventSpawnTimerRef.current);
    }
    setEventSpawnCooldown(EVENT_SPAWN_COOLDOWN);
    eventSpawnCooldownRef.current = EVENT_SPAWN_COOLDOWN;
    eventSpawnTimerRef.current = setInterval(() => {
      setEventSpawnCooldown((prev) => {
        const next = prev - 1;
        eventSpawnCooldownRef.current = next;
        if (next <= 0) {
          if (eventSpawnTimerRef.current) {
            clearInterval(eventSpawnTimerRef.current);
            eventSpawnTimerRef.current = null;
          }
          return 0;
        }
        return next;
      });
    }, 1000);
  }, []);

  const eventSpawnDessert = useCallback((): boolean => {
    if (eventSpawnCooldownRef.current > 0) {
      showToast(`⏳ 冷却中，请等待 ${eventSpawnCooldownRef.current} 秒`);
      return false;
    }
    if (!consumeEventStep()) return false;
    if (eventCoinsRef.current < EVENT_SPAWN_COST) {
      showToast(`💰 金币不足！需要 ${EVENT_SPAWN_COST} 金币`);
      setEventStepsLeft((prev) => prev + 1);
      return false;
    }

    const level = Math.floor(Math.random() * 3) + 1;
    const emptyIndices: number[] = [];
    eventBoardRef.current.forEach((cell, index) => {
      if (cell === null) emptyIndices.push(index);
    });
    if (emptyIndices.length === 0) {
      showToast("🧹 棋盘已满！请合并甜品");
      setEventStepsLeft((prev) => prev + 1);
      return false;
    }

    const emptyIndex = emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
    setEventCoins((prev) => prev - EVENT_SPAWN_COST);
    const newBoard = [...eventBoardRef.current];
    newBoard[emptyIndex] = level;
    setEventBoard(newBoard);
    eventStartSpawnCooldown();

    const dessert = DESSERTS[level - 1];
    showToast(`🍰 生成了 ${dessert.emoji} ${dessert.name}！-${EVENT_SPAWN_COST}💰`);
    return true;
  }, [consumeEventStep, showToast, eventStartSpawnCooldown]);

  const eventPerformMerge = useCallback((sourceIndex: number, targetIndex: number): boolean => {
    if (sourceIndex === targetIndex || sourceIndex < 0 || sourceIndex >= EVENT_BOARD_SIZE
        || targetIndex < 0 || targetIndex >= EVENT_BOARD_SIZE) {
      return false;
    }

    const sourceLevel = eventBoardRef.current[sourceIndex];
    const targetLevel = eventBoardRef.current[targetIndex];

    if (sourceLevel === null) return false;

    if (targetLevel === null) {
      if (!consumeEventStep()) return false;
      const newBoard = [...eventBoardRef.current];
      newBoard[targetIndex] = sourceLevel;
      newBoard[sourceIndex] = null;
      setEventBoard(newBoard);
      showToast("📦 甜品已移动");
      return true;
    }

    if (sourceLevel === targetLevel) {
      if (!consumeEventStep()) return false;
      const newLevel = sourceLevel + 1;
      if (newLevel > DESSERTS.length) {
        showToast("⭐ 已达到最高等级！");
        setEventStepsLeft((prev) => prev + 1);
        return false;
      } else {
        const coinReward = calculateMergeReward(newLevel, true);
        const newBoard = [...eventBoardRef.current];
        newBoard[targetIndex] = newLevel;
        newBoard[sourceIndex] = null;

        setEventMergeHint(null);

        setEventBoard(newBoard);
        setEventCoins((prev) => prev + coinReward);

        setEventStats((prev) => ({
          ...prev,
          merges: prev.merges + 1,
          maxLevel: Math.max(prev.maxLevel, newLevel),
          totalCoinReward: prev.totalCoinReward + coinReward,
        }));

        showToast(`✨ 合成${DESSERTS[newLevel - 1].name}！+${coinReward}金币`);

        setTimeout(() => {
          const nextHint = findNextMergeHint(newBoard);
          if (nextHint) {
            setEventMergeHint(nextHint);
          }
        }, 500);

        return true;
      }
    } else {
      showToast("❌ 等级不同，无法合成！");
      return false;
    }
  }, [consumeEventStep, showToast]);

  const eventCanSubmitOrder = useCallback((order: EventOrder): boolean => {
    for (const item of order.items) {
      const count = eventBoardRef.current.filter(cell => cell === item.level).length;
      if (count < item.count) return false;
    }
    return true;
  }, []);

  const eventSubmitOrder = useCallback((order: EventOrder): void => {
    if (order.completed) {
      showToast("该订单已完成！");
      return;
    }
    if (!eventCanSubmitOrder(order)) {
      showToast("❌ 棋盘中的甜品不足，无法提交！");
      return;
    }
    if (!consumeEventStep()) return;

    let newBoard = [...eventBoardRef.current];
    for (const item of order.items) {
      let removed = 0;
      for (let i = 0; i < newBoard.length && removed < item.count; i++) {
        if (newBoard[i] === item.level) {
          newBoard[i] = null;
          removed++;
        }
      }
    }

    setEventBoard(newBoard);
    setEventCoins((prev) => prev + order.reward.coins);
    setEventShardsEarned((prev) => prev + order.reward.shards);
    setEventOrders((prev) =>
      prev.map((o) => o.id === order.id ? { ...o, completed: true } : o)
    );
    setEventStats((prev) => ({
      ...prev,
      ordersCompleted: prev.ordersCompleted + 1,
      totalCoinReward: prev.totalCoinReward + order.reward.coins,
    }));

    showToast(`🎉 订单完成！+${order.reward.coins}💰 +${order.reward.shards}💎`);
  }, [eventCanSubmitOrder, consumeEventStep, showToast]);

  const eventOrganizeBoard = useCallback((): void => {
    if (!consumeEventStep()) return;
    const newBoard = Array(EVENT_BOARD_SIZE).fill(null);
    const nonNullCells = eventBoardRef.current.filter((cell) => cell !== null) as number[];
    const levelCounts = new Map<number, number>();
    nonNullCells.forEach((level) => {
      levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
    });
    const sortedLevels = Array.from(levelCounts.entries()).sort((a, b) => a[0] - b[0]);
    let currentIndex = 0;
    for (const [level, count] of sortedLevels) {
      for (let i = 0; i < count; i++) {
        newBoard[currentIndex++] = level;
      }
    }
    setEventMergeHint(null);
    setEventBoard(newBoard);
    
    setTimeout(() => {
      const nextHint = findNextMergeHint(newBoard);
      if (nextHint) {
        setEventMergeHint(nextHint);
      }
    }, 300);
    
    showToast("🧹 整理完成！");
  }, [consumeEventStep, showToast]);

  useEffect(() => {
    if (eventMode && eventStepsLeft <= 0) {
      setTimeout(() => {
        endEvent();
      }, 500);
    }
  }, [eventStepsLeft, eventMode, endEvent]);

  const formatOfflineDuration = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) {
      return `${hours} 小时`;
    }
    return `${hours} 小时 ${mins} 分钟`;
  };

  const claimOfflineReward = useCallback((): void => {
    if (!offlineReward || !offlineReward.isValid) return;
    if (!hasUnclaimedReward()) return;

    setCoins((prev: number) => prev + offlineReward.coins);
    markAsClaimed();
    setShowOfflineModal(false);
    showToast(`🎉 离线收益领取成功！+${offlineReward.coins} 金币`);
    advanceTutorialStep("offline");
  }, [offlineReward, showToast, advanceTutorialStep]);

  const checkOfflineReward = useCallback((): void => {
    const reward = calculateOfflineReward();
    setOfflineReward(reward);
    if (reward.isValid && hasUnclaimedReward()) {
      setShowOfflineModal(true);
    }
  }, []);

  useEffect(() => {
    checkOfflineReward();
  }, [checkOfflineReward]);

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      recordLeaveTime(maxLevelRef.current);
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        recordLeaveTime(maxLevelRef.current);
      } else if (document.visibilityState === "visible") {
        checkOfflineReward();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkOfflineReward]);

  useEffect(() => {
    return () => {
      if (spawnTimerRef.current) {
        clearInterval(spawnTimerRef.current);
        spawnTimerRef.current = null;
      }
    };
  }, []);

  const getRandomEmptyCell = useCallback((currentBoard: (number | null)[]): number | null => {
    const emptyIndices: number[] = [];
    currentBoard.forEach((cell, index) => {
      if (cell === null) emptyIndices.push(index);
    });
    if (emptyIndices.length === 0) return null;
    return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  }, []);

  const updateSpawnCooldownFromTimestamp = useCallback((): void => {
    const now = Date.now();
    const end = spawnCooldownEndRef.current;
    const remainingMs = Math.max(0, end - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    if (remainingSeconds !== spawnCooldownRef.current) {
      spawnCooldownRef.current = remainingSeconds;
      setSpawnCooldown(remainingSeconds);
    }
  }, []);

  useEffect(() => {
    updateSpawnCooldownFromTimestamp();
    if (spawnTickRef.current) {
      clearInterval(spawnTickRef.current);
    }
    spawnTickRef.current = setInterval(() => {
      updateSpawnCooldownFromTimestamp();
      const end = spawnCooldownEndRef.current;
      if (Date.now() >= end && spawnTickRef.current) {
        clearInterval(spawnTickRef.current);
        spawnTickRef.current = null;
      }
    }, 200);
    return () => {
      if (spawnTickRef.current) {
        clearInterval(spawnTickRef.current);
        spawnTickRef.current = null;
      }
    };
  }, [spawnCooldownEnd, updateSpawnCooldownFromTimestamp]);

  const startSpawnCooldown = useCallback((): void => {
    const newEnd = Date.now() + SPAWN_COOLDOWN_SECONDS * 1000;
    spawnCooldownEndRef.current = newEnd;
    setSpawnCooldownEnd(newEnd);
    spawnCooldownRef.current = SPAWN_COOLDOWN_SECONDS;
    setSpawnCooldown(SPAWN_COOLDOWN_SECONDS);
  }, []);

  const getSpawnStatus = useCallback((): SpawnStatus => {
    const now = Date.now();
    const isCooldown = spawnCooldownEndRef.current > now;
    const hasNoCoins = coinsRef.current < SPAWN_COST;
    const emptyIndex = getRandomEmptyCell(boardRef.current);
    const isBoardFull = emptyIndex === null;
    if (isCooldown) return "cooldown";
    if (isBoardFull) return "board_full";
    if (hasNoCoins) return "no_coins";
    return "ready";
  }, [getRandomEmptyCell]);

  const spawnDessert = useCallback((targetLevel?: number, freeSpawn: boolean = false): boolean => {
    if (isSpawningRef.current) {
      return false;
    }
    const now = Date.now();
    if (!freeSpawn && spawnCooldownEndRef.current > now) {
      const remainingMs = spawnCooldownEndRef.current - now;
      const remainingSec = Math.ceil(remainingMs / 1000);
      showToast(`⏳ 冷却中，请等待 ${remainingSec} 秒`);
      return false;
    }

    const emptyIndex = getRandomEmptyCell(boardRef.current);
    if (emptyIndex === null) {
      showToast("🧹 棋盘已满！请点击自动整理或合并甜品");
      return false;
    }

    if (!freeSpawn && coinsRef.current < SPAWN_COST) {
      showToast(`💰 金币不足！需要 ${SPAWN_COST} 金币`);
      return false;
    }

    try {
      isSpawningRef.current = true;
      const maxSpawnLevel = Math.min(maxLevelRef.current, SPAWN_MAX_LEVEL);
      const levelRange = maxSpawnLevel - SPAWN_MIN_LEVEL + 1;
      const level = targetLevel || Math.min(
        Math.floor(Math.random() * levelRange) + SPAWN_MIN_LEVEL,
        DESSERTS.length
      );

      if (!freeSpawn) {
        setCoins((prev: number) => prev - SPAWN_COST);
      }
      const newBoard = [...boardRef.current];
      newBoard[emptyIndex] = level;
      setBoard(newBoard);

      if (!freeSpawn) {
        startSpawnCooldown();
      }

      const dessert = DESSERTS[level - 1];
      showToast(`🍰 生成了 ${dessert.emoji} ${dessert.name}！${freeSpawn ? "" : `-${SPAWN_COST}💰`}`);
      
      if (!freeSpawn) {
        advanceTutorialStep("spawn");
      }
      
      return true;
    } finally {
      setTimeout(() => {
        isSpawningRef.current = false;
      }, 50);
    }
  }, [getRandomEmptyCell, showToast, startSpawnCooldown, advanceTutorialStep]);

  const triggerSuccessFeedback = useCallback((index: number): void => {
    setFeedback({
      type: "success",
      indices: [index],
      timestamp: Date.now(),
    });
    setTimeout(() => {
      setFeedback((prev) => {
        if (Date.now() - prev.timestamp >= 550) {
          return { type: null, indices: [], timestamp: 0 };
        }
        return prev;
      });
    }, 600);
  }, []);

  const triggerFailFeedback = useCallback((indices: [number, number]): void => {
    setFeedback({
      type: "fail",
      indices,
      timestamp: Date.now(),
    });
    setTimeout(() => {
      setFeedback((prev) => {
        if (Date.now() - prev.timestamp >= 450) {
          return { type: null, indices: [], timestamp: 0 };
        }
        return prev;
      });
    }, 500);
  }, []);

  const performMerge = useCallback((sourceIndex: number, targetIndex: number): boolean => {
    if (sourceIndex === targetIndex || sourceIndex < 0 || sourceIndex >= BOARD_SIZE
        || targetIndex < 0 || targetIndex >= BOARD_SIZE) {
      return false;
    }

    const sourceLevel = boardRef.current[sourceIndex];
    const targetLevel = boardRef.current[targetIndex];

    if (sourceLevel === null) {
      return false;
    }

    if (targetLevel === null) {
      const newBoard = [...boardRef.current];
      newBoard[targetIndex] = sourceLevel;
      newBoard[sourceIndex] = null;
      setBoard(newBoard);
      showToast("📦 甜品已移动");
      return true;
    }

    if (sourceLevel === targetLevel) {
      const newLevel = sourceLevel + 1;
      if (newLevel > DESSERTS.length) {
        showToast("⭐ 已达到最高等级！");
        triggerFailFeedback([sourceIndex, targetIndex]);
        return false;
      } else {
        const coinReward = calculateMergeReward(newLevel, false);
        const newBoard = [...boardRef.current];
        newBoard[targetIndex] = newLevel;
        newBoard[sourceIndex] = null;

        setShowMergeHint(false);
        showMergeHintRef.current = false;

        setBoard(newBoard);
        setCoins((prev: number) => prev + coinReward);
        triggerSuccessFeedback(targetIndex);
        showToast(`✨ 合成${DESSERTS[newLevel - 1].name}！+${coinReward}金币`);

        if (newLevel > maxLevelRef.current) {
          setMaxLevel(newLevel);
          setTimeout(() => showToast(`🎉 解锁新等级：${DESSERTS[newLevel - 1].name}！`), 800);
        }
        if (!unlockedLevelsRef.current.includes(newLevel)) {
          const unlockData: RecentlyUnlocked = {
            level: newLevel,
            timestamp: new Date().toISOString(),
            seen: false,
          };
          saveRecentlyUnlocked(unlockData);
          setRecentlyUnlocked(unlockData);
          setUnlockedLevels((prev: number[]) => [...prev, newLevel].sort((a: number, b: number) => a - b));
          setUnlockTimes((prev: { [key: number]: string }) => ({
            ...prev,
            [newLevel]: new Date().toISOString(),
          }));
        }
        
        advanceTutorialStep("merge");

        setTimeout(() => {
          const nextHint = findNextMergeHint(newBoard);
          if (nextHint) {
            setMergeHint(nextHint);
            setShowMergeHint(true);
            showMergeHintRef.current = true;
          }
        }, 700);
        
        return true;
      }
    } else {
      triggerFailFeedback([sourceIndex, targetIndex]);
      showToast("❌ 等级不同，无法合成！");
      return false;
    }
  }, [showToast, triggerSuccessFeedback, triggerFailFeedback, advanceTutorialStep]);

  const getCellIndexFromPoint = useCallback((clientX: number, clientY: number, isEvent: boolean): number | null => {
    const cells = isEvent ? eventCellRefs.current : cellRefs.current;
    const boardSize = isEvent ? EVENT_BOARD_SIZE : BOARD_SIZE;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const rect = cell.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right
          && clientY >= rect.top && clientY <= rect.bottom) {
        if (i >= boardSize) return null;
        return i;
      }
    }
    return null;
  }, []);

  const boardRefEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleGlobalPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0 && e.pointerType === "mouse") return;

      const target = e.target as HTMLElement;
      const cellEl = target.closest?.<HTMLDivElement>(".cell");
      if (!cellEl) return;

      const boardEl = cellEl.closest?.<HTMLDivElement>(".board");
      if (!boardEl) return;

      const isEventBoard = boardEl === eventBoardRefEl.current;
      const isMainBoard = boardEl === boardRefEl.current;
      if (!isEventBoard && !isMainBoard) return;

      const idxStr = cellEl.getAttribute("data-index");
      if (idxStr === null) return;
      const index = Number(idxStr);
      const boardSize = isEventBoard ? EVENT_BOARD_SIZE : BOARD_SIZE;
      const currentBoard = isEventBoard ? eventBoardRef.current : boardRef.current;
      if (isNaN(index) || index < 0 || index >= boardSize) return;
      if (currentBoard[index] === null) return;

      e.preventDefault();
      try {
        cellEl.setPointerCapture?.(e.pointerId);
      } catch {}

      const newDrag: DragState = {
        isDragging: true,
        sourceIndex: index,
        pointerStartX: e.clientX,
        pointerStartY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        pointerId: e.pointerId,
        hasMoved: false,
      };
      dragRef.current = newDrag;
      hoverRef.current = null;
      setDrag(newDrag);
      setHoverIndex(null);
    };

    const handleGlobalPointerMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (!d.isDragging || d.pointerId !== e.pointerId) return;
      e.preventDefault();

      const deltaX = Math.abs(e.clientX - d.pointerStartX);
      const deltaY = Math.abs(e.clientY - d.pointerStartY);
      const hasMoved = d.hasMoved || (deltaX > POINTER_MOVE_THRESHOLD || deltaY > POINTER_MOVE_THRESHOLD);

      const updated: DragState = {
        ...d,
        currentX: e.clientX,
        currentY: e.clientY,
        hasMoved,
      };
      dragRef.current = updated;
      setDrag(updated);

      const hovered = getCellIndexFromPoint(e.clientX, e.clientY, eventMode);
      hoverRef.current = hovered;
      setHoverIndex(hovered);
    };

    const handleGlobalPointerUp = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (!d.isDragging || d.pointerId !== e.pointerId) return;
      e.preventDefault();

      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {}

      const targetIndex = getCellIndexFromPoint(e.clientX, e.clientY, eventMode);

      if (d.hasMoved && targetIndex !== null && d.sourceIndex !== null) {
        if (eventMode) {
          eventPerformMerge(d.sourceIndex, targetIndex);
        } else {
          performMerge(d.sourceIndex, targetIndex);
        }
      } else if (!d.hasMoved && d.sourceIndex !== null) {
        showToast("💡 提示：拖动该甜品到相同等级上即可合成");
      }

      const resetDrag: DragState = {
        isDragging: false,
        sourceIndex: null,
        pointerStartX: 0,
        pointerStartY: 0,
        currentX: 0,
        currentY: 0,
        pointerId: null,
        hasMoved: false,
      };
      dragRef.current = resetDrag;
      hoverRef.current = null;
      setDrag(resetDrag);
      setHoverIndex(null);
    };

    const handleGlobalPointerCancel = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (!d.isDragging || d.pointerId !== e.pointerId) return;

      const resetDrag: DragState = {
        isDragging: false,
        sourceIndex: null,
        pointerStartX: 0,
        pointerStartY: 0,
        currentX: 0,
        currentY: 0,
        pointerId: null,
        hasMoved: false,
      };
      dragRef.current = resetDrag;
      hoverRef.current = null;
      setDrag(resetDrag);
      setHoverIndex(null);
    };

    const handleGlobalClick = (e: MouseEvent): void => {
      if (dragRef.current.isDragging) return;
      const target = e.target as HTMLElement;
      const cellEl = target.closest?.<HTMLDivElement>(".cell");
      if (!cellEl) return;
      const boardEl = cellEl.closest?.<HTMLDivElement>(".board");
      if (!boardEl) return;

      const isEventBoard = boardEl === eventBoardRefEl.current;
      const isMainBoard = boardEl === boardRefEl.current;
      if (!isEventBoard && !isMainBoard) return;

      const idxStr = cellEl.getAttribute("data-index");
      if (idxStr === null) return;
      const index = Number(idxStr);
      const boardSize = isEventBoard ? EVENT_BOARD_SIZE : BOARD_SIZE;
      const currentBoard = isEventBoard ? eventBoardRef.current : boardRef.current;
      if (isNaN(index) || index < 0 || index >= boardSize) return;
      if (currentBoard[index] !== null) return;

      if (isEventBoard) {
        eventSpawnDessert();
        return;
      }

      if (isSpawningRef.current) {
        return;
      }
      const now = Date.now();
      if (spawnCooldownEndRef.current > now) {
        const remainingMs = spawnCooldownEndRef.current - now;
        const remainingSec = Math.ceil(remainingMs / 1000);
        showToast(`⏳ 冷却中，请等待 ${remainingSec} 秒`);
        return;
      }

      if (coinsRef.current < SPAWN_COST) {
        showToast(`💰 金币不足！需要 ${SPAWN_COST} 金币`);
        return;
      }

      try {
        isSpawningRef.current = true;
        const maxSpawnLevel = Math.min(maxLevelRef.current, SPAWN_MAX_LEVEL);
        const levelRange = maxSpawnLevel - SPAWN_MIN_LEVEL + 1;
        const level = Math.floor(Math.random() * levelRange) + SPAWN_MIN_LEVEL;

        setCoins((prev: number) => prev - SPAWN_COST);
        const newBoard = [...boardRef.current];
        newBoard[index] = level;
        setBoard(newBoard);

        startSpawnCooldown();

        const dessert = DESSERTS[level - 1];
        showToast(`🍰 生成了 ${dessert.emoji} ${dessert.name}！-${SPAWN_COST}💰`);
        advanceTutorialStep("spawn");
      } finally {
        setTimeout(() => {
          isSpawningRef.current = false;
        }, 50);
      }
    };

    document.addEventListener("pointerdown", handleGlobalPointerDown, true);
    window.addEventListener("pointermove", handleGlobalPointerMove, { passive: false });
    window.addEventListener("pointerup", handleGlobalPointerUp, { passive: false });
    window.addEventListener("pointercancel", handleGlobalPointerCancel, { passive: false });
    document.addEventListener("click", handleGlobalClick, true);

    return () => {
      document.removeEventListener("pointerdown", handleGlobalPointerDown, true);
      window.removeEventListener("pointermove", handleGlobalPointerMove);
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerCancel);
      document.removeEventListener("click", handleGlobalClick, true);
    };
  }, [getCellIndexFromPoint, performMerge, eventPerformMerge, eventSpawnDessert, showToast, advanceTutorialStep, eventMode]);

  const handleSubmitOrder = useCallback((order: Order): void => {
    if (order.completed) {
      showToast("该订单已完成！");
      return;
    }

    if (!canSubmitOrder(boardRef.current, order)) {
      showToast("❌ 棋盘中的甜品不足，无法提交！");
      return;
    }

    const { newBoard, success } = submitOrder(boardRef.current, order);
    if (!success) {
      showToast("❌ 提交失败！");
      return;
    }

    setBoard(newBoard);
    setCoins((prev: number) => prev + order.reward);
    setOrders((prev: Order[]) =>
      prev.map((o: Order) =>
        o.id === order.id ? { ...o, completed: true } : o
      )
    );

    showToast(`🎉 订单完成！+${order.reward}金币`);
    advanceTutorialStep("order");

    setTimeout(() => {
      setOrders((prev: Order[]) => {
        const remaining = prev.filter((o: Order) => !o.completed);
        const newOrders = generateOrders(unlockedLevelsRef.current, MAX_ORDERS - remaining.length);
        return [...remaining, ...newOrders];
      });
    }, 1500);
  }, [showToast, advanceTutorialStep]);

  const handleRefreshOrders = useCallback((): void => {
    if (unlockedLevelsRef.current.length === 0) {
      showToast("❌ 没有解锁的甜品，无法生成订单！");
      return;
    }
    setOrders(generateOrders(unlockedLevelsRef.current));
    showToast("📋 订单已刷新！");
  }, [showToast]);

  const organizeBoard = useCallback((): void => {
    const newBoard = Array(BOARD_SIZE).fill(null);
    const nonNullCells = boardRef.current.filter((cell: number | null) => cell !== null) as number[];
    const levelCounts = new Map<number, number>();
    nonNullCells.forEach((level) => {
      levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
    });
    const sortedLevels = Array.from(levelCounts.entries()).sort((a, b) => a[0] - b[0]);
    let currentIndex = 0;
    for (const [level, count] of sortedLevels) {
      for (let i = 0; i < count; i++) {
        newBoard[currentIndex++] = level;
      }
    }
    setShowMergeHint(false);
    showMergeHintRef.current = false;
    setBoard(newBoard);
    
    setTimeout(() => {
      const nextHint = findNextMergeHint(newBoard);
      if (nextHint) {
        setMergeHint(nextHint);
        setShowMergeHint(true);
        showMergeHintRef.current = true;
      }
    }, 300);
    
    showToast("🧹 整理完成！相同等级甜品已聚拢");
  }, [showToast]);

  const handleAction = (action: string): void => {
    if (action === "生成甜品") {
      spawnDessert();
    } else if (action === "自动整理") {
      organizeBoard();
    } else if (action === "领取收益") {
      const reward = calculateOfflineReward();
      setOfflineReward(reward);
      setShowOfflineModal(true);
    }
  };

  const completedOrders = orders.filter((o: Order) => o.completed).length;

  useEffect(() => {
    const hasAnyDessert = board.some((cell: number | null) => cell !== null);
    if (!hasAnyDessert) {
      setBoard(createInitialBoard());
    }
  }, []);

  const getCellClass = (index: number): string => {
    const classes: string[] = ["cell"];
    classes.push(board[index] ? "has-dessert" : "empty");

    if (mergeHint && showMergeHint && !drag.isDragging && feedback.type === null) {
      if (index === mergeHint.sourceIndex) {
        classes.push("merge-hint", "merge-hint-source");
      } else if (index === mergeHint.targetIndex) {
        classes.push("merge-hint", "merge-hint-target");
      }
    }

    if (drag.isDragging && drag.sourceIndex === index) {
      classes.push("pointer-dragging-source");
    }
    if (drag.isDragging && hoverIndex === index && drag.sourceIndex !== index) {
      const sourceLevel = drag.sourceIndex !== null ? board[drag.sourceIndex] : null;
      const targetLevel = board[index];
      if (targetLevel === null) {
        classes.push("pointer-drop-ok");
      } else if (sourceLevel !== null && sourceLevel === targetLevel) {
        classes.push("pointer-drop-ok");
      } else {
        classes.push("pointer-drop-no");
      }
    }
    if (feedback.type === "success" && feedback.indices.includes(index)) {
      classes.push("merge-success");
    }
    if (feedback.type === "fail" && feedback.indices.includes(index)) {
      classes.push("merge-fail");
    }
    return classes.join(" ");
  };

  const getEventCellClass = (index: number): string => {
    const classes: string[] = ["cell"];
    classes.push(eventBoard[index] ? "has-dessert" : "empty");

    if (eventMergeHint && !drag.isDragging) {
      if (index === eventMergeHint.sourceIndex) {
        classes.push("merge-hint", "merge-hint-source", "event-merge-hint");
      } else if (index === eventMergeHint.targetIndex) {
        classes.push("merge-hint", "merge-hint-target", "event-merge-hint");
      }
    }

    if (drag.isDragging && drag.sourceIndex === index) {
      classes.push("pointer-dragging-source");
    }
    if (drag.isDragging && hoverIndex === index && drag.sourceIndex !== index) {
      const sourceLevel = drag.sourceIndex !== null ? eventBoard[drag.sourceIndex] : null;
      const targetLevel = eventBoard[index];
      if (targetLevel === null) {
        classes.push("pointer-drop-ok");
      } else if (sourceLevel !== null && sourceLevel === targetLevel) {
        classes.push("pointer-drop-ok");
      } else {
        classes.push("pointer-drop-no");
      }
    }
    return classes.join(" ");
  };

  const getDragOffset = (): { x: number; y: number } => {
    if (!drag.isDragging || drag.sourceIndex === null) return { x: 0, y: 0 };
    const cell = cellRefs.current[drag.sourceIndex];
    if (!cell) return { x: 0, y: 0 };
    const rect = cell.getBoundingClientRect();
    return {
      x: drag.currentX - (rect.left + rect.width / 2),
      y: drag.currentY - (rect.top + rect.height / 2),
    };
  };

  const dragOffset = getDragOffset();

  const currentTutorialStep = getCurrentTutorialStep();
  const tutorialHighlight = currentTutorialStep?.highlight || "none";

  const isHighlighted = (element: string): boolean => {
    if (!showTutorial) return false;
    return tutorialHighlight === element;
  };

  const mainClass = `game-shell ${showTutorial ? "tutorial-active" : ""} ${
    isHighlighted("spawn-button") ? "tutorial-highlight-spawn" : ""
  } ${
    isHighlighted("board") ? "tutorial-highlight-board" : ""
  } ${
    isHighlighted("orders") ? "tutorial-highlight-orders" : ""
  } ${
    isHighlighted("collection") ? "tutorial-highlight-collection" : ""
  } ${
    isHighlighted("offline-button") ? "tutorial-highlight-offline" : ""
  }`;

  return (
    <main className={mainClass}>
      {toast && <div className="toast">{toast}</div>}

      {recentlyUnlocked && !recentlyUnlocked.seen && (() => {
        const dessert = DESSERTS[recentlyUnlocked.level - 1];
        if (!dessert) return null;
        return (
          <div className="modal-overlay" onClick={dismissUnlockCelebration}>
            <div className="modal-content unlock-celebration-modal" onClick={(e) => e.stopPropagation()}>
              <div className="unlock-celebration-particles">
                {[...Array(12)].map((_, i) => (
                  <span key={i} className="unlock-particle" style={{
                    left: `${8 + (i % 4) * 28}%`,
                    top: `${10 + Math.floor(i / 4) * 30}%`,
                    animationDelay: `${i * 0.1}s`,
                  }}>
                    {["✨", "⭐", "🎉", "🌟"][i % 4]}
                  </span>
                ))}
              </div>
              <div className="unlock-celebration-badge">
                <span className="unlock-celebration-badge-text">NEW</span>
              </div>
              <div
                className="unlock-celebration-icon"
                style={{ background: `linear-gradient(145deg, ${dessert.color}cc, ${dessert.color}88)` }}
              >
                <span className="unlock-celebration-emoji">{dessert.emoji}</span>
              </div>
              <h2 className="unlock-celebration-title">🎉 新甜品解锁！</h2>
              <div className="unlock-celebration-name">{dessert.name}</div>
              <div className="unlock-celebration-level">等级 Lv.{dessert.level}</div>
              <div className="unlock-celebration-divider"></div>
              <div className="unlock-celebration-info">
                <div className="unlock-celebration-row">
                  <span className="unlock-celebration-label">合成价值</span>
                  <span className="unlock-celebration-value">+{dessert.level * 10} 💰</span>
                </div>
                <div className="unlock-celebration-row">
                  <span className="unlock-celebration-label">订单价值</span>
                  <span className="unlock-celebration-value">+{dessert.level * 15} 💰/个</span>
                </div>
                <div className="unlock-celebration-row">
                  <span className="unlock-celebration-label">解锁时间</span>
                  <span className="unlock-celebration-value">{new Date(recentlyUnlocked.timestamp).toLocaleString('zh-CN')}</span>
                </div>
              </div>
              {(() => {
                const nextHint = getNextUnlockHint(unlockedLevels, board);
                if (nextHint) {
                  return (
                    <div className="unlock-celebration-next-hint">
                      <span className="unlock-next-arrow">👆</span>
                      <span>下一个: {nextHint.nextDessert.emoji} {nextHint.nextDessert.name}</span>
                      <span className="unlock-next-detail">
                        需合成2个 {nextHint.parentDessert.emoji} {nextHint.parentDessert.name}
                        {nextHint.canMergeOnBoard
                          ? " (棋盘已满足 ✓)"
                          : ` (折算 ${nextHint.parentEffectiveCount}/2，还差${nextHint.totalShortfallSpawns}个Lv.1)`}
                      </span>
                    </div>
                  );
                }
                return (
                  <div className="unlock-celebration-next-hint unlock-celebration-complete">
                    🏆 恭喜！你已收集全部图鉴！
                  </div>
                );
              })()}
              <button className="unlock-celebration-btn" onClick={dismissUnlockCelebration}>
                太棒了！ 🎊
              </button>
            </div>
          </div>
        );
      })()}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleImportFileSelect}
      />

      {showImportResult && (
        <div className="modal-overlay" onClick={() => setShowImportResult(null)}>
          <div className="modal-content import-result-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowImportResult(null)}>×</button>
            <div className={`import-result-icon import-result-${showImportResult.type}`}>
              {showImportResult.type === "success" ? "✅" : showImportResult.type === "warning" ? "⚠️" : "❌"}
            </div>
            <h2 className="import-result-title">{showImportResult.title}</h2>
            <p className="import-result-message">{showImportResult.message}</p>
            {showImportResult.details && showImportResult.details.length > 0 && (
              <div className="import-result-details">
                <ul>
                  {showImportResult.details.map((detail, idx) => (
                    <li key={idx}>{detail}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              className="import-result-close-btn" onClick={() => setShowImportResult(null)}>
              确定
            </button>
          </div>
        </div>
      )}

      {showSavePanel && (
        <div className="modal-overlay" onClick={() => setShowSavePanel(false)}>
          <div className="modal-content save-panel-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSavePanel(false)}>×</button>
            <div className="save-panel-icon">💾</div>
            <h2 className="save-panel-title">存档管理</h2>
            <div className="save-panel-info">
              <div className="info-row">
              <span className="info-label">当前存档版本</span>
                <span className="info-value">v{SAVE_VERSION}</span>
              </div>
              <div className="info-row">
                <span className="info-label">上次保存</span>
                <span className="info-value">{formatLastSaveTime()}</span>
              </div>
              <div className="info-row">
                <span className="info-label">自动保存</span>
                <span className={`info-value ${autoSaveActive ? "text-success" : "text-warning"}`}>
                  {autoSaveActive ? "已开启" : "已暂停"}
                </span>
              </div>
            </div>
            <div className="save-panel-actions">
              <button
                className="save-action-btn save-action-save"
                onClick={() => { doManualSave(); showToast("💾 已手动保存进度"); }}
              >
                <span className="save-action-icon">📝</span>
                <span>手动保存</span>
              </button>
              <button
                className="save-action-btn save-action-export"
                onClick={handleExportSave}
              >
                <span className="save-action-icon">📤</span>
                <span>导出存档</span>
              </button>
              <button
                className="save-action-btn save-action-import"
                onClick={() => {
                  setShowImportModal(true);
                  setShowSavePanel(false);
                }}
              >
                <span className="save-action-icon">📥</span>
                <span>导入存档</span>
              </button>
              <button
                className={`save-action-btn save-action-auto ${autoSaveActive ? 'is-active' : ''}`}
                onClick={() => setAutoSaveActive(!autoSaveActive)}
              >
                <span className="save-action-icon">
                  {autoSaveActive ? "⏸️" : "▶️"}
                </span>
                <span>{autoSaveActive ? "暂停自动保存" : "恢复自动保存"}</span>
              </button>
              <button
                className="save-action-btn save-action-reset"
                onClick={() => setShowResetConfirm(true)}
              >
                <span className="save-action-icon">🔄</span>
                <span>重置进度</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content import-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowImportModal(false)}>×</button>
            <div className="import-modal-icon">📥</div>
            <h2 className="import-modal-title">导入存档</h2>
            <p className="import-modal-desc">
              选择之前导出的存档文件（.json格式）进行恢复。<br />
              <strong>注意：导入后当前进度将被覆盖，建议先导出备份。</strong>
            </p>
            <div className="import-requirements">
              <h4>✅ 合法存档要求：</h4>
              <ul>
                <li>存档版本需与当前游戏版本兼容</li>
                <li>金币数量为非负整数</li>
                <li>棋盘大小为 5×5 共 25 格，格内等级在 1-10 或为空</li>
                <li>订单和图鉴数据结构完整，等级范围有效</li>
              </ul>
            </div>
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              id="save-file-input"
              onChange={handleImportFileSelect}
            />
            <label htmlFor="save-file-input" className="import-file-btn">
              <span className="import-file-icon">📁</span>
              <span>选择存档文件</span>
            </label>
            <p className="import-modal-hint">损坏的存档将被拒绝，当前进度将保留</p>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div className="modal-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="modal-content reset-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowResetConfirm(false)}>×</button>
            <div className="reset-confirm-icon">⚠️</div>
            <h2 className="reset-confirm-title">确认重置进度？</h2>
            <div className="reset-confirm-warning">
              <p>此操作将<strong>永久删除</strong>以下所有数据：</p>
              <ul>
                <li>💰 当前金币</li>
                <li>🎮 棋盘进度</li>
                <li>📖 甜品图鉴解锁状态</li>
                <li>📋 订单进度</li>
                <li>🌙 离线收益记录</li>
                <li>📚 新手引导进度</li>
              </ul>
            </div>
            <div className="reset-confirm-buttons">
              <button
                className="reset-cancel-btn"
                onClick={() => setShowResetConfirm(false)}
              >
                取消
              </button>
              <button
                className="reset-confirm-btn"
                onClick={handleResetProgress}
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      {showTutorial && currentTutorialStep && tutorial.currentStep !== "completed" && (
        <div className="tutorial-overlay">
          <div className="tutorial-dialog" onClick={(e) => e.stopPropagation()}>
            <button className="tutorial-skip" onClick={skipTutorial}>跳过引导</button>
            <div className="tutorial-progress">
              {TUTORIAL_STEPS.filter(s => s.step !== "completed").map((s, idx) => (
                <div
                  key={s.step}
                  className={`tutorial-progress-dot ${
                    tutorial.completedSteps.includes(s.step) ? "completed" :
                    s.step === tutorial.currentStep ? "active" : ""
                  }`}
                />
              ))}
            </div>
            <h2 className="tutorial-title">{currentTutorialStep.title}</h2>
            <p className="tutorial-description">{currentTutorialStep.description}</p>
            
            {tutorial.currentStep === "welcome" && (
              <button className="tutorial-next-btn" onClick={goToNextTutorialStep}>
                开始学习 🚀
              </button>
            )}
            
            {tutorial.currentStep === "spawn" && !tutorial.hasSpawned && (
              <div className="tutorial-hint">
                <span className="tutorial-gesture">👆</span>
                <p>点击下方高亮的「生成甜品」按钮</p>
              </div>
            )}
            
            {tutorial.currentStep === "merge" && !tutorial.hasMerged && (
              <div className="tutorial-hint">
                <span className="tutorial-gesture tutorial-drag-gesture">✋</span>
                <p>拖动一个甜品到另一个相同等级的甜品上</p>
              </div>
            )}
            
            {tutorial.currentStep === "order" && !tutorial.hasCompletedOrder && (
              <div className="tutorial-hint">
                <span className="tutorial-gesture">👆</span>
                <p>当订单材料充足时，点击「提交」按钮</p>
              </div>
            )}
            
            {tutorial.currentStep === "collection" && !tutorial.hasViewedCollection && (
              <div className="tutorial-hint">
                <span className="tutorial-gesture">👆</span>
                <p>点击图鉴中已解锁的甜品查看详情</p>
              </div>
            )}
            
            {tutorial.currentStep === "offline" && !tutorial.hasClaimedOffline && (
              <div className="tutorial-hint">
                <span className="tutorial-gesture">👆</span>
                <p>点击上方高亮的「领取收益」按钮，了解离线收益功能</p>
              </div>
            )}

            {tutorial.hasSpawned && tutorial.currentStep === "spawn" && (
              <button className="tutorial-next-btn" onClick={goToNextTutorialStep}>
                下一步 →
              </button>
            )}
            {tutorial.hasMerged && tutorial.currentStep === "merge" && (
              <button className="tutorial-next-btn" onClick={goToNextTutorialStep}>
                下一步 →
              </button>
            )}
            {tutorial.hasCompletedOrder && tutorial.currentStep === "order" && (
              <button className="tutorial-next-btn" onClick={goToNextTutorialStep}>
                下一步 →
              </button>
            )}
            {tutorial.hasViewedCollection && tutorial.currentStep === "collection" && (
              <button className="tutorial-next-btn" onClick={goToNextTutorialStep}>
                下一步 →
              </button>
            )}
            {tutorial.hasClaimedOffline && tutorial.currentStep === "offline" && (
              <button className="tutorial-next-btn" onClick={goToNextTutorialStep}>
                完成引导 🎉
              </button>
            )}
          </div>
        </div>
      )}

      {showOfflineModal && offlineReward && (
        <div className="modal-overlay" onClick={() => setShowOfflineModal(false)}>
          <div className={`modal-content offline-modal ${offlineReward.isValid ? "offline-valid" : "offline-invalid offline-" + offlineReward.reason}`} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowOfflineModal(false)}>×</button>
            {offlineReward.isValid ? (
              <>
                <div className="offline-icon">
                  <span className="offline-emoji">🌙</span>
                </div>
                <h2 className="offline-title">离线收益</h2>
                <p className="offline-subtitle">甜品店在你休息时也在努力营业~</p>
                
                <div className="offline-info">
                  <div className="offline-info-row">
                    <span className="offline-info-label">离线时长</span>
                    <span className="offline-info-value">
                      {formatOfflineDuration(offlineReward.actualOfflineMinutes)}
                    </span>
                  </div>
                  <div className="offline-info-row">
                    <span className="offline-info-label">最高甜品等级</span>
                    <span className="offline-info-value">
                      Lv.{offlineReward.maxLevel} {DESSERTS[Math.min(offlineReward.maxLevel - 1, DESSERTS.length - 1)]?.emoji} {DESSERTS[Math.min(offlineReward.maxLevel - 1, DESSERTS.length - 1)]?.name}
                    </span>
                  </div>
                  <div className="offline-info-row">
                    <span className="offline-info-label">每分钟收益</span>
                    <span className="offline-info-value">
                      {offlineReward.earningsPerMinute} 金币/分钟
                    </span>
                  </div>
                  <div className="offline-info-row">
                    <span className="offline-info-label">封顶时长</span>
                    <span className="offline-info-value">
                      {formatOfflineDuration(offlineReward.capMinutes)}
                    </span>
                  </div>
                  {offlineReward.actualOfflineMinutes > offlineReward.capMinutes && (
                    <div className="offline-info-row offline-info-note">
                      <span className="offline-info-label">已达封顶</span>
                      <span className="offline-info-value offline-capped-text">
                        超出 {formatOfflineDuration(offlineReward.actualOfflineMinutes - offlineReward.capMinutes)} 不计入
                      </span>
                    </div>
                  )}
                </div>

                <div className="offline-divider"></div>

                <div className="offline-reward-section">
                  <span className="offline-reward-label">最终金币</span>
                  <span className="offline-reward-coins">
                    💰 +{offlineReward.coins.toLocaleString()}
                  </span>
                </div>

                {offlineReward.offlineMinutes >= offlineReward.capMinutes && (
                  <p className="offline-cap-hint">
                    ⚡ 已达最高离线时长（{MAX_OFFLINE_HOURS}小时），超出部分不再计算
                  </p>
                )}

                <button className="offline-claim-btn" onClick={claimOfflineReward}>
                  🎁 立即领取
                </button>
              </>
            ) : (
              <>
                <div className={`offline-icon offline-icon-${offlineReward.reason}`}>
                  <span className="offline-emoji">
                    {offlineReward.reason === "first" ? "👋" :
                     offlineReward.reason === "rollback" ? "⚠️" :
                     offlineReward.reason === "too_short" ? "⏳" :
                     offlineReward.reason === "already_claimed" ? "✅" : "💰"}
                  </span>
                </div>
                <h2 className="offline-title">
                  {offlineReward.reason === "first" ? "欢迎来到甜品店" :
                   offlineReward.reason === "rollback" ? "时间异常" :
                   offlineReward.reason === "too_short" ? "离线时间太短" :
                   offlineReward.reason === "already_claimed" ? "已领取完毕" : "暂无收益"}
                </h2>
                <p className="offline-subtitle">
                  {offlineReward.reason === "first" && "开始合成甜品赚取你的第一桶金吧~"}
                  {offlineReward.reason === "rollback" && "检测到系统时间被回拨，请检查设备时间设置"}
                  {offlineReward.reason === "too_short" && "再多等一会儿，收益会更丰厚哦~"}
                  {offlineReward.reason === "already_claimed" && "本期收益已领取，稍后再来吧~"}
                </p>

                <div className="offline-info">
                  <div className="offline-info-row">
                    <span className="offline-info-label">当前最高等级</span>
                    <span className="offline-info-value">
                      Lv.{offlineReward.maxLevel} {DESSERTS[Math.min(offlineReward.maxLevel - 1, DESSERTS.length - 1)]?.emoji}
                    </span>
                  </div>
                  <div className="offline-info-row">
                    <span className="offline-info-label">每分钟收益</span>
                    <span className="offline-info-value">
                      {offlineReward.earningsPerMinute} 金币/分钟
                    </span>
                  </div>
                  <div className="offline-info-row">
                    <span className="offline-info-label">封顶时长</span>
                    <span className="offline-info-value">
                      {formatOfflineDuration(offlineReward.capMinutes)}
                    </span>
                  </div>
                  {offlineReward.reason === "too_short" && (
                    <div className="offline-info-row">
                      <span className="offline-info-label">已离线</span>
                      <span className="offline-info-value offline-warn-text">
                        不足 1 分钟
                      </span>
                    </div>
                  )}
                </div>

                <div className="offline-reason-detail">
                  {offlineReward.reason === "first" && (
                    <p>🎮 首次进入游戏，先去合成甜品赚取金币吧！下次离开再回来就能领取离线收益啦~</p>
                  )}
                  {offlineReward.reason === "rollback" && (
                    <p>🔒 为了保护你的游戏进度，系统检测到时间异常后将暂停离线收益。请将设备时间调整为正确的当前时间，重新进入游戏后即可恢复。</p>
                  )}
                  {offlineReward.reason === "too_short" && (
                    <p>💡 离线收益需要至少累计 1 分钟才会开始计算。请关闭游戏或切换到后台，稍等片刻再回来查看~</p>
                  )}
                  {offlineReward.reason === "already_claimed" && (
                    <p>✨ 本期离线收益已成功领取！关闭游戏或切换到后台，离开一段时间后再次打开即可获得新的离线收益。</p>
                  )}
                </div>

                <button className="offline-claim-btn offline-ok-btn" onClick={() => setShowOfflineModal(false)}>
                  我知道了
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {selectedDessert !== null && (
        <div className="modal-overlay" onClick={() => setSelectedDessert(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedDessert(null)}>×</button>
            {(() => {
              const dessert = DESSERTS[selectedDessert - 1];
              const unlockTime = unlockTimes[selectedDessert];
              return (
                <>
                  <div
                    className="modal-icon"
                    style={{ background: `linear-gradient(145deg, ${dessert.color}88, ${dessert.color}44)` }}
                  >
                    <span className="modal-emoji">{dessert.emoji}</span>
                  </div>
                  <h2 className="modal-name">{dessert.name}</h2>
                  <div className="modal-level">等级 Lv.{dessert.level}</div>
                  <div className="modal-divider"></div>
                  <div className="modal-info">
                    <div className="info-row">
                      <span className="info-label">解锁状态</span>
                      <span className="info-value unlocked-text">✅ 已解锁</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">首次解锁</span>
                      <span className="info-value">
                        {unlockTime ? new Date(unlockTime).toLocaleString('zh-CN') : '-'}
                      </span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">合成价值</span>
                      <span className="info-value">+{dessert.level * 10} 💰</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">订单价值</span>
                      <span className="info-value">+{dessert.level * 15} 💰/个</span>
                    </div>
                  </div>
                  <p className="modal-description">
                    {dessert.level <= 2 && "基础甜品，通过合成两个相同的低级甜品获得。"}
                    {dessert.level > 2 && dessert.level <= 5 && "中级甜品，需要多次合成才能获得，价值更高。"}
                    {dessert.level > 5 && dessert.level <= 8 && "高级甜品，非常稀有，是合成大师的象征。"}
                    {dessert.level > 8 && "传说级甜品，只有最顶尖的合成师才能解锁！"}
                  </p>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {showEventEntry && !eventMode && (
        <div className="modal-overlay" onClick={() => setShowEventEntry(false)}>
          <div className="modal-content event-entry-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowEventEntry(false)}>×</button>
            <div className="event-entry-icon">🎯</div>
            <h2 className="event-entry-title">限时合成挑战</h2>
            <p className="event-entry-subtitle">在限定步数内合成最高级甜品！</p>
            
            <div className="event-info-grid">
              <div className="event-info-item">
                <span className="event-info-label">🎮 步数限制</span>
                <span className="event-info-value">{EVENT_MAX_STEPS} 步</span>
              </div>
              <div className="event-info-item">
                <span className="event-info-label">💰 初始金币</span>
                <span className="event-info-value">{EVENT_INITIAL_COINS}</span>
              </div>
              <div className="event-info-item">
                <span className="event-info-label">💎 图鉴碎片</span>
                <span className="event-info-value">当前: {eventShards}</span>
              </div>
              <div className="event-info-item">
                <span className="event-info-label">🏆 历史最高分</span>
                <span className="event-info-value">{eventHighScore}</span>
              </div>
            </div>

            <div className="event-rules">
              <h4>🎮 挑战规则</h4>
              <ul>
                <li>每步操作（生成、合成、移动、整理、提交订单）消耗 1 步</li>
                <li>完成活动订单可获得金币和图鉴碎片奖励</li>
                <li>合成越高级甜品，最终奖励越丰厚</li>
                <li>活动棋盘与主线独立，退出不影响主线进度</li>
              </ul>
            </div>

            <button className="event-start-btn" onClick={startEvent}>
              🚀 开始挑战
            </button>
          </div>
        </div>
      )}

      {showEventResult && eventResult && (
        <div className="modal-overlay">
          <div className="modal-content event-result-modal" onClick={(e) => e.stopPropagation()}>
            <div className={`event-rank-badge rank-${eventResult.rank}`}>
              {eventResult.rank}
            </div>
            <h2 className="event-result-title">挑战结束！</h2>
            
            <div className="event-result-stats">
              <div className="event-result-row">
                <span>🧁 合成次数</span>
                <span className="event-result-value">{eventResult.merges}</span>
              </div>
              <div className="event-result-row">
                <span>📋 完成订单</span>
                <span className="event-result-value">{eventResult.ordersCompleted}</span>
              </div>
              <div className="event-result-row">
                <span>⭐ 最高等级</span>
                <span className="event-result-value">Lv.{eventResult.maxLevel} {DESSERTS[Math.min(eventResult.maxLevel - 1, DESSERTS.length - 1)]?.emoji}</span>
              </div>
            </div>

            <div className="event-result-rewards">
              <h4>🎁 获得奖励</h4>
              <div className="event-reward-item">
                <span>💰 金币</span>
                <span className="event-reward-coins">+{eventResult.coins}</span>
              </div>
              <div className="event-reward-item">
                <span>💎 图鉴碎片</span>
                <span className="event-reward-shards">+{eventResult.shards}</span>
              </div>
            </div>

            <button className="event-start-btn" onClick={() => setShowEventResult(false)}>
              太棒了！
            </button>
          </div>
        </div>
      )}

      {drag.isDragging && drag.sourceIndex !== null && drag.hasMoved && (
        <div
          className="drag-floating-element"
          style={{
            left: drag.currentX - 32,
            top: drag.currentY - 32,
            background: eventMode && eventBoard[drag.sourceIndex]
              ? `linear-gradient(145deg, ${DESSERTS[eventBoard[drag.sourceIndex]! - 1].color}dd, ${DESSERTS[eventBoard[drag.sourceIndex]! - 1].color}99)`
              : board[drag.sourceIndex]
                ? `linear-gradient(145deg, ${DESSERTS[board[drag.sourceIndex]! - 1].color}dd, ${DESSERTS[board[drag.sourceIndex]! - 1].color}99)`
                : undefined,
          }}
        >
          <span className="dessert-emoji">
            {eventMode && eventBoard[drag.sourceIndex]
              ? DESSERTS[eventBoard[drag.sourceIndex]! - 1].emoji
              : board[drag.sourceIndex]
                ? DESSERTS[board[drag.sourceIndex]! - 1].emoji
                : null}
          </span>
          <span className="dessert-level">
            Lv.{eventMode ? eventBoard[drag.sourceIndex] : board[drag.sourceIndex]}
          </span>
        </div>
      )}

      <section className="hero">
        <p>{game.id} · H5Game · Port {game.port}</p>
        <h1>{game.title}</h1>
        <span>{game.tagline}</span>
      </section>

      <section className="hud">
        {!eventMode ? (
          <>
            {game.stats.map((stat: string, index: number) => (
              <article key={stat}>
                <small>{stat}</small>
                <strong>
                  {index === 0 ? coins :
                   index === 1 ? `${completedOrders}/${orders.length}` :
                   index === 2 ? `${unlockedLevels.length}/${DESSERTS.length}` :
                   `${maxLevel}级 ${DESSERTS[Math.min(maxLevel - 1, DESSERTS.length - 1)]?.emoji}`}
                </strong>
              </article>
            ))}
            <article className="event-entry-article" onClick={() => setShowEventEntry(true)}>
              <small>🎯 限时活动</small>
              <strong className="event-entry-text">点击进入 →</strong>
            </article>
            <SimulationPanel currentMaxLevel={maxLevel} currentCoins={coins} />
            <article className="save-entry-article" onClick={() => setShowSavePanel(true)}>
              <small>💾 存档管理</small>
              <strong className="save-entry-text">
                {autoSaveActive ? `保存于${formatLastSaveTime()}` : "自动保存已暂停"}
              </strong>
            </article>
          </>
        ) : (
          <>
            <article className="event-hud-article">
              <small>💰 活动金币</small>
              <strong>{eventCoins}</strong>
            </article>
            <article className="event-hud-article">
              <small>👣 剩余步数</small>
              <strong className={eventStepsLeft <= 5 ? "steps-warning" : ""}>{eventStepsLeft}/{EVENT_MAX_STEPS}</strong>
            </article>
            <article className="event-hud-article">
              <small>⭐ 最高等级</small>
              <strong>Lv.{eventStats.maxLevel}</strong>
            </article>
            <article className="event-hud-article">
              <small>💎 碎片</small>
              <strong>{eventShardsEarned}</strong>
            </article>
          </>
        )}
      </section>

      <section className={"playground " + game.mode}>
        {!eventMode ? (
        <div
          className="board merge-board tutorial-board"
          ref={boardRefEl}
        >
          {board.map((cell: number | null, index: number) => {
            const dessert = cell ? DESSERTS[cell - 1] : null;
            return (
              <div
                key={index}
                data-index={index}
                ref={(el) => { cellRefs.current[index] = el; }}
                className={getCellClass(index)}
                style={dessert ? {
                  background: `linear-gradient(145deg, ${dessert.color}88, ${dessert.color}44)`,
                } : {}}
              >
                {dessert && (
                  <>
                    <span className="dessert-emoji">{dessert.emoji}</span>
                    <span className="dessert-level">Lv.{cell}</span>
                  </>
                )}
                {!dessert && <span className="empty-hint">+</span>}
              </div>
            );
          })}
          {mergeHint && !drag.isDragging && feedback.type === null && (
            <div className="merge-hint-banner">
              ✨ 可合成：{DESSERTS[mergeHint.level - 1].emoji} {DESSERTS[mergeHint.level - 1].name} × 2 → {DESSERTS[Math.min(mergeHint.level, DESSERTS.length)].emoji} {DESSERTS[Math.min(mergeHint.level, DESSERTS.length)].name}
            </div>
          )}
        </div>
        ) : (
        <div
          className="board event-board merge-board"
          ref={eventBoardRefEl}
        >
          {eventBoard.map((cell: number | null, index: number) => {
            const dessert = cell ? DESSERTS[cell - 1] : null;
            return (
              <div
                key={index}
                data-index={index}
                ref={(el) => { eventCellRefs.current[index] = el; }}
                className={getEventCellClass(index)}
                style={dessert ? {
                  background: `linear-gradient(145deg, ${dessert.color}88, ${dessert.color}44)`,
                } : {}}
              >
                {dessert && (
                  <>
                    <span className="dessert-emoji">{dessert.emoji}</span>
                    <span className="dessert-level">Lv.{cell}</span>
                  </>
                )}
                {!dessert && <span className="empty-hint">+</span>}
              </div>
            );
          })}
          {eventMergeHint && !drag.isDragging && (
            <div className="merge-hint-banner event-merge-hint-banner">
              ✨ 可合成：{DESSERTS[eventMergeHint.level - 1].emoji} {DESSERTS[eventMergeHint.level - 1].name} × 2 → {DESSERTS[Math.min(eventMergeHint.level, DESSERTS.length)].emoji} {DESSERTS[Math.min(eventMergeHint.level, DESSERTS.length)].name}
            </div>
          )}
        </div>
        )}

        <aside className={`side-panel ${eventMode ? "event-side-panel" : ""}`}>
          {eventMode && (
            <>
              <div className="event-exit-section">
                <button className="event-exit-btn" onClick={exitEvent}>
                  ← 返回主线
                </button>
              </div>
              <h2 className="event-panel-title">🎯 限时挑战</h2>
              <p className="event-panel-desc">
                在 <strong>{EVENT_MAX_STEPS}</strong> 步内尽可能合成更高级甜品并完成订单！
              </p>

              <div className="event-progress-bar">
                <div
                  className="event-progress-fill"
                  style={{ width: `${(eventStepsLeft / EVENT_MAX_STEPS) * 100}%` }}
                />
                <span className="event-progress-text">{eventStepsLeft} / {EVENT_MAX_STEPS} 步</span>
              </div>

              <div className="orders-panel">
                <div className="orders-header">
                  <h3>📋 活动订单</h3>
                </div>
                {eventOrders.map((order: EventOrder) => {
                  const totalItems = order.items.reduce((sum, item) => sum + item.count, 0);
                  const completedItems = order.items.reduce(
                    (sum, item) => sum + Math.min(eventBoard.filter(c => c === item.level).length, item.count),
                    0
                  );
                  const progressPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
                  return (
                    <div key={order.id} className={`order-card ${order.completed ? "completed" : ""}`}>
                      <div className="order-items">
                        {order.items.map(({ level, count }, idx: number) => {
                          const dessert = DESSERTS[level - 1];
                          const available = eventBoard.filter(c => c === level).length;
                          const hasEnough = available >= count;
                          return (
                            <div key={idx} className={`order-item-row ${hasEnough ? "available" : "unavailable"}`}>
                              <span className="order-dessert">
                                <span className="order-emoji">{dessert?.emoji}</span>
                                <span className="order-name">{dessert?.name}</span>
                              </span>
                              <span className="order-count">
                                <span className={hasEnough ? "count-ok" : "count-missing"}>
                                  {available}/{count}
                                </span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {!order.completed && (
                        <div className="order-progress-section">
                          <div className="order-progress-bar event-order-progress">
                            <div
                              className="order-progress-fill event-order-progress-fill"
                              style={{ width: `${progressPercent}%` }}
                            />
                            <span className="order-progress-text">
                              {completedItems}/{totalItems} · {progressPercent}%
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="order-footer">
                        <span className="order-reward">+{order.reward.coins}💰 +{order.reward.shards}💎</span>
                        {!order.completed && (
                          <button
                            className={`submit-btn ${eventCanSubmitOrder(order) ? "can-submit" : "cannot-submit"}`}
                            onClick={() => eventSubmitOrder(order)}
                            disabled={!eventCanSubmitOrder(order)}
                          >
                            {eventCanSubmitOrder(order) ? "✅ 提交" : "❌ 材料不足"}
                          </button>
                        )}
                        {order.completed && (
                          <span className="completed-badge">🎉 已完成</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="actions">
                <button
                  className={`action-spawn ${eventSpawnCooldown > 0 ? "on-cooldown" : ""} ${eventCoins < EVENT_SPAWN_COST ? "cannot-afford" : ""}`}
                  onClick={eventSpawnDessert}
                  disabled={eventSpawnCooldown > 0 || eventCoins < EVENT_SPAWN_COST || eventStepsLeft <= 0}
                >
                  <span className="action-main-text">生成甜品</span>
                  <span className="action-sub-text">
                    {eventSpawnCooldown > 0
                      ? `⏳ 冷却中 ${eventSpawnCooldown}s`
                      : `💰 ${EVENT_SPAWN_COST} 金币 · 消耗1步`}
                  </span>
                  {eventSpawnCooldown > 0 && (
                    <div
                      className="cooldown-progress"
                      style={{ width: `${(eventSpawnCooldown / EVENT_SPAWN_COOLDOWN) * 100}%` }}
                    />
                  )}
                </button>
                <button onClick={eventOrganizeBoard} disabled={eventStepsLeft <= 0}>
                  🧹 自动整理 (消耗1步)
                </button>
                <button onClick={endEvent} className="event-end-btn">
                  🏁 结束挑战
                </button>
              </div>
            </>
          )}

          {!eventMode && (
          <>
          <h2>核心玩法</h2>
          <p>🎯 <strong>新手指引：</strong>先拖动两个相同等级的甜品叠在一起合成更高级甜品，可立即获得金币奖励！有了金币后再点击"生成甜品"按钮或空格继续生产。</p>
          <p>✨ <strong>合成规则：</strong>相同等级甜品合并升级，不同等级无法合成。每次生成消耗 {SPAWN_COST} 金币，冷却 {SPAWN_COOLDOWN_SECONDS} 秒，产出 Lv.{SPAWN_MIN_LEVEL}-{SPAWN_MAX_LEVEL} 甜品。</p>
          <p>🧹 <strong>棋盘管理：</strong>棋盘满时请点击"自动整理"聚拢相同等级，方便后续拖拽合成。</p>

          <div className="orders-panel tutorial-orders-panel">
            <div className="orders-header">
              <h3>📋 当前订单</h3>
              <button className="refresh-btn" onClick={handleRefreshOrders}>🔄 刷新</button>
            </div>
            {orders.length === 0 ? (
              <div className="empty-orders">
                <p>🎯 暂无可用订单</p>
                <p className="empty-orders-hint">合成更多甜品解锁新订单吧！</p>
              </div>
            ) : (
              orders.map((order: Order) => {
                const levelTotals = getOrderLevelTotals(order);
                const mergedItems = Array.from(levelTotals.entries()).map(([level, count]) => ({ level, count }));
                const progress = getOrderProgress(board, order);
                return (
                  <div key={order.id} className={`order-card ${order.completed ? "completed" : ""}`}>
                    <div className="order-items">
                      {mergedItems.map(({ level, count }, idx: number) => {
                        const dessert = DESSERTS[level - 1];
                        const available = countDessertsOnBoard(board, level);
                        const hasEnough = available >= count;
                        return (
                          <div key={idx} className={`order-item-row ${hasEnough ? "available" : "unavailable"}`}>
                            <span className="order-dessert">
                              <span className="order-emoji">{dessert?.emoji}</span>
                              <span className="order-name">{dessert?.name}</span>
                            </span>
                            <span className="order-count">
                              <span className={hasEnough ? "count-ok" : "count-missing"}>
                                {available}/{count}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {!order.completed && (
                      <div className="order-progress-section">
                        <div className="order-progress-bar">
                          <div
                            className="order-progress-fill"
                            style={{ width: `${progress.percent}%` }}
                          />
                          <span className="order-progress-text">
                            {progress.completedItems}/{progress.totalItems} · {progress.percent}%
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="order-footer">
                      <span className="order-reward">+{order.reward}💰</span>
                      {!order.completed && (
                        <button
                          className={`submit-btn ${canSubmitOrder(board, order) ? "can-submit" : "cannot-submit"}`}
                          onClick={() => handleSubmitOrder(order)}
                          disabled={!canSubmitOrder(board, order)}
                        >
                          {canSubmitOrder(board, order) ? "✅ 提交" : "❌ 材料不足"}
                        </button>
                      )}
                      {order.completed && (
                        <span className="completed-badge">🎉 已完成</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="collection-panel">
            <div className="collection-header">
              <h3>📖 甜品图鉴</h3>
              <span className="collection-progress">
                {unlockedLevels.length}/{DESSERTS.length}
              </span>
            </div>
            {(() => {
              const nextHint = getNextUnlockHint(unlockedLevels, board);
              if (nextHint) {
                return (
                  <div className="next-unlock-hint-card">
                    <div className="next-unlock-hint-header">
                      <span className="next-unlock-hint-arrow">🔮</span>
                      <span className="next-unlock-hint-title">下一个解锁目标</span>
                    </div>
                    <div className="next-unlock-hint-target">
                      <span className="next-unlock-hint-emoji">{nextHint.nextDessert.emoji}</span>
                      <span className="next-unlock-hint-name">{nextHint.nextDessert.name}</span>
                      <span className="next-unlock-hint-level">Lv.{nextHint.nextLevel}</span>
                    </div>
                    <div className="next-unlock-hint-conditions">
                      <div className="next-unlock-condition">
                        <span className="next-unlock-condition-label">合成条件</span>
                        <span className="next-unlock-condition-value">
                          2× {nextHint.parentDessert.emoji} {nextHint.parentDessert.name}
                        </span>
                      </div>
                      <div className="next-unlock-condition">
                        <span className="next-unlock-condition-label">折算后进度</span>
                        <span className="next-unlock-condition-value">
                          {(() => {
                            const parent = nextHint.boardProgress.find(p => p.level === nextHint.parentDessert.level);
                            const statusClass = nextHint.canMergeOnBoard ? "next-unlock-ok" : "next-unlock-missing";
                            const rawHint = parent && parent.onBoard !== nextHint.parentEffectiveCount
                              ? ` (棋盘 ${parent.onBoard} + 折算)`
                              : "";
                            return (
                              <span>
                                <span className={statusClass}>{nextHint.parentEffectiveCount}/2</span>
                                <span style={{ fontSize: '10px', color: '#64748b', marginLeft: '4px' }}>{rawHint}</span>
                              </span>
                            );
                          })()}
                        </span>
                      </div>
                      <div className="next-unlock-condition">
                        <span className="next-unlock-condition-label">理论生成</span>
                        <span className="next-unlock-condition-value">{nextHint.spawnsNeeded} 次</span>
                      </div>
                      <div className="next-unlock-condition">
                        <span className="next-unlock-condition-label">理论合成</span>
                        <span className="next-unlock-condition-value">{nextHint.mergesNeeded} 次</span>
                      </div>
                      <div className="next-unlock-condition">
                        <span className="next-unlock-condition-label">最低花费</span>
                        <span className="next-unlock-condition-value">💰 {nextHint.minCost}</span>
                      </div>
                      <div className="next-unlock-condition">
                        <span className="next-unlock-condition-label">差值补充</span>
                        <span className="next-unlock-condition-value">
                          {nextHint.canMergeOnBoard
                            ? <span className="next-unlock-ok">棋盘已满足 ✓</span>
                            : <span className="next-unlock-missing">还需 {nextHint.totalShortfallSpawns} 个 Lv.1 (💰{nextHint.totalShortfallCost})</span>}
                        </span>
                      </div>
                    </div>
                    {nextHint.boardProgress.length > 1 && (
                      <div className="next-unlock-board-breakdown">
                        <div className="next-unlock-breakdown-title">📋 棋盘各级甜品（折算后）</div>
                        {nextHint.boardProgress.map((bp) => {
                          const hasCarry = bp.carriedUp > 0;
                          const displayCount = bp.level === nextHint.parentDessert.level ? bp.effectiveCount : bp.effectiveCount;
                          const displayNeeded = bp.level === nextHint.parentDessert.level ? 2 : 0;
                          const isOk = bp.level === nextHint.parentDessert.level
                            ? bp.effectiveCount >= 2
                            : true;
                          const percent = displayNeeded > 0
                            ? Math.min(100, (displayCount / displayNeeded) * 100)
                            : (hasCarry ? 100 : Math.min(100, bp.onBoard * 20));
                          return (
                            <div key={bp.level} className="next-unlock-breakdown-row">
                              <span className="next-unlock-breakdown-emoji">{bp.emoji}</span>
                              <span className="next-unlock-breakdown-name">{bp.name}</span>
                              <span className="next-unlock-breakdown-bar-wrap">
                                <span
                                  className="next-unlock-breakdown-bar-fill"
                                  style={{ width: `${percent}%` }}
                                />
                              </span>
                              <span className={`next-unlock-breakdown-count ${isOk ? "next-unlock-ok" : "next-unlock-missing"}`}>
                                {bp.level === nextHint.parentDessert.level
                                  ? `${displayCount}/2`
                                  : (hasCarry
                                      ? `${bp.onBoard}→+${bp.carriedUp}`
                                      : `${bp.onBoard}`)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
              if (unlockedLevels.length >= DESSERTS.length) {
                return (
                  <div className="next-unlock-hint-card next-unlock-complete">
                    <span>🏆 恭喜！图鉴已全部收集！</span>
                  </div>
                );
              }
              return null;
            })()}
            <div className="collection-grid">
              {DESSERTS.map((dessert) => {
                const isUnlocked = unlockedLevels.includes(dessert.level);
                const unlockTime = unlockTimes[dessert.level];
                return (
                  <div
                    key={dessert.level}
                    className={`collection-item ${isUnlocked ? "unlocked" : "locked"} tutorial-collection-item`}
                    onClick={() => {
                      if (isUnlocked) {
                        setSelectedDessert(dessert.level);
                        advanceTutorialStep("collection");
                      }
                    }}
                    title={isUnlocked ? `${dessert.name} - 点击查看详情` : "??? 未解锁"}
                  >
                    <div className="collection-item-inner">
                      <div
                        className="collection-icon"
                        style={isUnlocked ? { background: `linear-gradient(145deg, ${dessert.color}88, ${dessert.color}44)` } : {}}
                      >
                        <span className="collection-emoji">{isUnlocked ? dessert.emoji : "❓"}</span>
                      </div>
                      <div className="collection-info">
                        <div className="collection-level">Lv.{dessert.level}</div>
                        <div className="collection-name">{isUnlocked ? dessert.name : "???"}</div>
                        {isUnlocked && unlockTime && (
                          <div className="collection-time">{formatUnlockTime(unlockTime)}</div>
                        )}
                        {!isUnlocked && (() => {
                          const prevDessert = dessert.level > 1 ? DESSERTS[dessert.level - 2] : null;
                          return (
                            <div className="collection-locked-hint">
                              {prevDessert ? `2× ${prevDessert.emoji} 合成` : "生成获取"}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="actions">
            {game.actions.map((action: string) => {
              if (action === "生成甜品") {
                const spawnStatus = getSpawnStatus();
                const now = Date.now();
                const totalMs = SPAWN_COOLDOWN_SECONDS * 1000;
                const remainingMs = Math.max(0, spawnCooldownEnd - now);
                const elapsedMs = Math.max(0, totalMs - remainingMs);
                const cooldownPercent = spawnStatus === "cooldown"
                  ? Math.min(100, (elapsedMs / totalMs) * 100)
                  : (remainingMs === 0 ? 100 : 0);
                const isBoardFull = spawnStatus === "board_full";
                const isCooldown = spawnStatus === "cooldown";
                const isNoCoins = spawnStatus === "no_coins";
                const isReady = spawnStatus === "ready";
                const isDisabled = !isReady;
                return (
                  <div key="spawn-wrapper" className="spawn-wrapper">
                    <div className="spawn-queue-card">
                      <div className="spawn-queue-header">
                        <span className="spawn-queue-title">📦 生成队列</span>
                        <span className={`spawn-status-pill ${spawnStatus}`}>
                          {isReady && "✅ 可生成"}
                          {isCooldown && `⏳ 冷却 ${spawnCooldown}s`}
                          {isNoCoins && "💰 金币不足"}
                          {isBoardFull && "🧹 棋盘已满"}
                        </span>
                      </div>
                      <div className="spawn-queue-content">
                        <div className="spawn-queue-item">
                          <div className="spawn-queue-emojis">
                            <span>🍬</span>
                            <span>🍪</span>
                            <span>🧁</span>
                          </div>
                          <div className="spawn-queue-info">
                            <div className="spawn-queue-level">Lv.{SPAWN_MIN_LEVEL} - Lv.{SPAWN_MAX_LEVEL}</div>
                            <div className="spawn-queue-desc">
                              {isReady && `点击生成 · 消耗 ${SPAWN_COST}💰`}
                              {isCooldown && `下一个生成 · 还需 ${spawnCooldown}s`}
                              {isNoCoins && `需要 ${SPAWN_COST}💰 · 当前 ${coins}💰`}
                              {isBoardFull && "棋盘无空位，请整理或合并"}
                            </div>
                          </div>
                        </div>
                      </div>
                      {isCooldown && (
                        <div className="spawn-queue-progress">
                          <div
                            className="spawn-queue-progress-bar"
                            style={{ width: `${cooldownPercent}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <button
                      key={action}
                      className={`action-spawn tutorial-spawn-button ${isCooldown ? "on-cooldown" : ""} ${isNoCoins ? "cannot-afford" : ""} ${isBoardFull ? "board-full" : ""} ${isReady ? "is-ready" : ""}`}
                      onClick={() => handleAction(action)}
                      disabled={isDisabled}
                    >
                      <span className="action-main-text">
                        {isReady && "🎯 生成甜品"}
                        {isCooldown && `⏳ 冷却中 ${spawnCooldown}s`}
                        {isNoCoins && "💰 金币不足"}
                        {isBoardFull && "🧹 棋盘已满"}
                      </span>
                      <span className="action-sub-text">
                        {isReady && `消耗 ${SPAWN_COST} 金币 · Lv.${SPAWN_MIN_LEVEL}-${SPAWN_MAX_LEVEL}`}
                        {isCooldown && "冷却完成后自动解锁"}
                        {isNoCoins && `需要 ${SPAWN_COST} 金币 · 当前 ${coins} 金币`}
                        {isBoardFull && "请合并甜品或点击自动整理"}
                      </span>
                      {isCooldown && (
                        <div
                          className="cooldown-progress"
                          style={{ width: `${cooldownPercent}%` }}
                        />
                      )}
                    </button>
                  </div>
                );
              }
              if (action === "领取收益") {
                return (
                  <button key={action} className="tutorial-offline-button" onClick={() => handleAction(action)}>{action}</button>
                );
              }
              return (
                <button key={action} onClick={() => handleAction(action)}>{action}</button>
              );
            })}
          </div>
          </>
          )}
        </aside>
      </section>

      <section className="result-panel">
        <h2>游戏说明</h2>
        <p>
          🎮 <strong>新手指引（必看）：</strong>开局免费送 {INITIAL_COINS} 金币和 {INITIAL_SPAWN_COUNT} 个糖果！先<strong>拖拽两个相同等级的甜品叠在一起</strong>合成更高级甜品，每次合成立即获得金币。有了金币就可以继续生成甜品啦~<br />
          🍰 <strong>生成甜品：</strong>点击"生成甜品"按钮或棋盘空格，消耗 {SPAWN_COST} 金币，冷却 {SPAWN_COOLDOWN_SECONDS} 秒，产出 Lv.{SPAWN_MIN_LEVEL}-{SPAWN_MAX_LEVEL} 的低等级甜品。<br />
          ⭐ <strong>合成奖励：</strong>两个 Lv.N 甜品合成一个 Lv.N+1 甜品，获得 (N+1)×10 金币。等级越高奖励越丰厚！<br />
          📋 <strong>订单系统：</strong>完成订单栏中的订单可获得额外金币奖励。提交棋盘中对应数量的甜品即可完成订单，完成后会自动刷新新订单。<br />
          🧹 <strong>自动整理：</strong>棋盘满或杂乱时，点击"自动整理"将相同等级甜品聚拢，方便拖拽合成。<br />
          💾 <strong>存档机制：</strong>所有游戏数据自动保存到浏览器本地，刷新页面后进度不会丢失。<br />
          🎯 <strong>终极目标：</strong>尽可能合成更高级的甜品，完成订单获得额外奖励，收集全部 10 种甜品图鉴！
        </p>
      </section>
    </main>
  );
}

export default App;
