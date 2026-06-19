import React, { useState, useEffect, useCallback, useRef } from "react";
import "./styles.css";

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

const DESSERTS = [
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

const BOARD_SIZE = 25;
const STORAGE_KEY = game.id + "-save";
const OFFLINE_DATA_KEY = game.id + "-offline";
const POINTER_MOVE_THRESHOLD = 5;
const MAX_ORDERS = 3;
const MIN_ORDER_ITEMS = 1;
const MAX_ORDER_ITEMS = 3;
const MAX_OFFLINE_HOURS = 8;
const BASE_EARNINGS_PER_MINUTE = 2;
const SPAWN_COST = 10;
const SPAWN_COOLDOWN_SECONDS = 5;
const SPAWN_MIN_LEVEL = 1;
const SPAWN_MAX_LEVEL = 3;
const INITIAL_COINS = 50;
const INITIAL_SPAWN_COUNT = 6;
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

function createInitialBoard(): (number | null)[] {
  const initialBoard = Array(BOARD_SIZE).fill(null);
  for (let i = 0; i < INITIAL_SPAWN_COUNT; i++) {
    initialBoard[i] = 1;
  }
  return initialBoard;
}

function loadGameState(): GameState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const loadedBoard = parsed.board || Array(BOARD_SIZE).fill(null);
      const hasExistingBoard = loadedBoard.some((cell: number | null) => cell !== null);
      const loadedCoins = typeof parsed.coins === "number" ? parsed.coins : -1;
      const isNewGame = !hasExistingBoard && (loadedCoins <= 0);

      return {
        board: isNewGame ? createInitialBoard() : loadedBoard,
        coins: isNewGame ? INITIAL_COINS : Math.max(loadedCoins, 0),
        maxLevel: parsed.maxLevel || 1,
        unlockedLevels: parsed.unlockedLevels || [1],
        unlockTimes: parsed.unlockTimes || { 1: new Date().toISOString() },
      };
    }
  } catch (e) {
    console.error("Failed to load game state:", e);
  }
  return {
    board: createInitialBoard(),
    coins: INITIAL_COINS,
    maxLevel: 1,
    unlockedLevels: [1],
    unlockTimes: { 1: new Date().toISOString() },
  };
}

function saveGameState(state: GameState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function calculateBaseEarningsRate(maxLevel: number): number {
  return BASE_EARNINGS_PER_MINUTE * maxLevel;
}

function hasUnclaimedReward(): boolean {
  const offlineData = loadOfflineData();
  if (!offlineData || offlineData.lastLeaveTime === 0) return false;
  return offlineData.lastClaimTime < offlineData.lastLeaveTime;
}

function calculateOfflineReward(): OfflineReward {
  const offlineData = loadOfflineData();
  const now = Date.now();

  if (!offlineData || offlineData.lastLeaveTime === 0) {
    return { coins: 0, offlineMinutes: 0, maxLevel: 1, isValid: false, reason: "first" };
  }

  if (now < offlineData.lastLeaveTime) {
    return { coins: 0, offlineMinutes: 0, maxLevel: 1, isValid: false, reason: "rollback" };
  }

  if (offlineData.lastClaimTime >= offlineData.lastLeaveTime) {
    return { coins: 0, offlineMinutes: 0, maxLevel: 1, isValid: false, reason: "already_claimed" };
  }

  const offlineMs = now - offlineData.lastLeaveTime;
  const offlineMinutes = Math.floor(offlineMs / 60000);

  if (offlineMinutes < 1) {
    return { coins: 0, offlineMinutes: 0, maxLevel: 1, isValid: false, reason: "too_short" };
  }

  const maxOfflineMinutes = MAX_OFFLINE_HOURS * 60;
  const cappedMinutes = Math.min(offlineMinutes, maxOfflineMinutes);

  const coins = Math.floor(cappedMinutes * offlineData.baseEarningsRate);

  return {
    coins,
    offlineMinutes: cappedMinutes,
    maxLevel: offlineData.maxLevelAtLeave,
    isValid: true,
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
    totalReward += level * count * 15;
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

function App(): React.ReactElement {
  const initialState = loadGameState();
  const initialTutorial = loadTutorialState();
  const [board, setBoard] = useState<(number | null)[]>(initialState.board);
  const [coins, setCoins] = useState<number>(initialState.coins);
  const [maxLevel, setMaxLevel] = useState<number>(initialState.maxLevel);
  const [unlockedLevels, setUnlockedLevels] = useState<number[]>(initialState.unlockedLevels);
  const [unlockTimes, setUnlockTimes] = useState<{ [key: number]: string }>(initialState.unlockTimes);
  const [orders, setOrders] = useState<Order[]>(generateOrders(initialState.unlockedLevels));
  const [toast, setToast] = useState<string | null>(null);
  const [selectedDessert, setSelectedDessert] = useState<number | null>(null);
  const [spawnCooldown, setSpawnCooldown] = useState<number>(0);
  const spawnCooldownRef = useRef<number>(0);
  const spawnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const [showOfflineModal, setShowOfflineModal] = useState<boolean>(false);
  const [offlineReward, setOfflineReward] = useState<OfflineReward | null>(null);

  const [tutorial, setTutorial] = useState<TutorialState>(initialTutorial);
  const [showTutorial, setShowTutorial] = useState<boolean>(!isTutorialCompleted() && initialTutorial.currentStep !== "completed");
  const tutorialRef = useRef<TutorialState>(tutorial);
  tutorialRef.current = tutorial;

  const boardRef = useRef<(number | null)[]>(board);
  const coinsRef = useRef<number>(coins);
  const maxLevelRef = useRef<number>(maxLevel);
  const unlockedLevelsRef = useRef<number[]>(unlockedLevels);
  const unlockTimesRef = useRef<{ [key: number]: string }>(unlockTimes);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<DragState>(drag);
  const hoverRef = useRef<number | null>(null);

  boardRef.current = board;
  coinsRef.current = coins;
  maxLevelRef.current = maxLevel;
  unlockedLevelsRef.current = unlockedLevels;
  unlockTimesRef.current = unlockTimes;
  dragRef.current = drag;
  hoverRef.current = hoverIndex;
  spawnCooldownRef.current = spawnCooldown;

  const showToast = useCallback((message: string): void => {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
  }, []);

  useEffect(() => {
    saveGameState({
      board,
      coins,
      maxLevel,
      unlockedLevels,
      unlockTimes,
    });
  }, [board, coins, maxLevel, unlockedLevels, unlockTimes]);

  useEffect(() => {
    saveTutorialState(tutorial);
  }, [tutorial]);

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

  const startSpawnCooldown = useCallback((): void => {
    if (spawnTimerRef.current) {
      clearInterval(spawnTimerRef.current);
    }
    setSpawnCooldown(SPAWN_COOLDOWN_SECONDS);
    spawnCooldownRef.current = SPAWN_COOLDOWN_SECONDS;
    spawnTimerRef.current = setInterval(() => {
      setSpawnCooldown((prev) => {
        const next = prev - 1;
        spawnCooldownRef.current = next;
        if (next <= 0) {
          if (spawnTimerRef.current) {
            clearInterval(spawnTimerRef.current);
            spawnTimerRef.current = null;
          }
          return 0;
        }
        return next;
      });
    }, 1000);
  }, []);

  const spawnDessert = useCallback((targetLevel?: number, freeSpawn: boolean = false): boolean => {
    if (spawnCooldownRef.current > 0) {
      showToast(`⏳ 冷却中，请等待 ${spawnCooldownRef.current} 秒`);
      return false;
    }

    if (!freeSpawn && coinsRef.current < SPAWN_COST) {
      showToast(`💰 金币不足！需要 ${SPAWN_COST} 金币`);
      return false;
    }

    const maxSpawnLevel = Math.min(maxLevelRef.current, SPAWN_MAX_LEVEL);
    const levelRange = maxSpawnLevel - SPAWN_MIN_LEVEL + 1;
    const level = targetLevel || Math.min(
      Math.floor(Math.random() * levelRange) + SPAWN_MIN_LEVEL,
      DESSERTS.length
    );
    const emptyIndex = getRandomEmptyCell(boardRef.current);
    if (emptyIndex === null) {
      showToast("🧹 棋盘已满！请点击自动整理或合并甜品");
      return false;
    }

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
        const coinReward = newLevel * 10;
        const newBoard = [...boardRef.current];
        newBoard[targetIndex] = newLevel;
        newBoard[sourceIndex] = null;
        setBoard(newBoard);
        setCoins((prev: number) => prev + coinReward);
        triggerSuccessFeedback(targetIndex);
        showToast(`✨ 合成${DESSERTS[newLevel - 1].name}！+${coinReward}金币`);

        if (newLevel > maxLevelRef.current) {
          setMaxLevel(newLevel);
          setTimeout(() => showToast(`🎉 解锁新等级：${DESSERTS[newLevel - 1].name}！`), 800);
        }
        if (!unlockedLevelsRef.current.includes(newLevel)) {
          setUnlockedLevels((prev: number[]) => [...prev, newLevel].sort((a: number, b: number) => a - b));
          setUnlockTimes((prev: { [key: number]: string }) => ({
            ...prev,
            [newLevel]: new Date().toISOString(),
          }));
        }
        
        advanceTutorialStep("merge");
        
        return true;
      }
    } else {
      triggerFailFeedback([sourceIndex, targetIndex]);
      showToast("❌ 等级不同，无法合成！");
      return false;
    }
  }, [showToast, triggerSuccessFeedback, triggerFailFeedback, advanceTutorialStep]);

  const getCellIndexFromPoint = useCallback((clientX: number, clientY: number): number | null => {
    const cells = cellRefs.current;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const rect = cell.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right
          && clientY >= rect.top && clientY <= rect.bottom) {
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
      if (!boardEl || boardEl !== boardRefEl.current) return;

      const idxStr = cellEl.getAttribute("data-index");
      if (idxStr === null) return;
      const index = Number(idxStr);
      if (isNaN(index) || index < 0 || index >= BOARD_SIZE) return;
      if (boardRef.current[index] === null) return;

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

      const hovered = getCellIndexFromPoint(e.clientX, e.clientY);
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

      const targetIndex = getCellIndexFromPoint(e.clientX, e.clientY);

      if (d.hasMoved && targetIndex !== null && d.sourceIndex !== null) {
        performMerge(d.sourceIndex, targetIndex);
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
      if (!boardEl || boardEl !== boardRefEl.current) return;
      const idxStr = cellEl.getAttribute("data-index");
      if (idxStr === null) return;
      const index = Number(idxStr);
      if (isNaN(index) || index < 0 || index >= BOARD_SIZE) return;
      if (boardRef.current[index] !== null) return;

      if (spawnCooldownRef.current > 0) {
        showToast(`⏳ 冷却中，请等待 ${spawnCooldownRef.current} 秒`);
        return;
      }

      if (coinsRef.current < SPAWN_COST) {
        showToast(`💰 金币不足！需要 ${SPAWN_COST} 金币`);
        return;
      }

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
  }, [getCellIndexFromPoint, performMerge, showToast, advanceTutorialStep]);

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
    setBoard(newBoard);
    showToast("🧹 整理完成！相同等级甜品已聚拢");
  }, [showToast]);

  const handleAction = (action: string): void => {
    if (action === "生成甜品") {
      spawnDessert();
    } else if (action === "自动整理") {
      organizeBoard();
    } else if (action === "领取收益") {
      const reward = calculateOfflineReward();
      if (reward.isValid) {
        setOfflineReward(reward);
        setShowOfflineModal(true);
      } else if (reward.reason === "too_short") {
        showToast("⏳ 离线时间太短啦，再多等一会儿吧~");
      } else if (reward.reason === "first") {
        showToast("👋 欢迎来到甜品合成店！合成甜品赚取金币吧~");
      } else if (reward.reason === "rollback") {
        showToast("⚠️ 检测到时间异常，请检查系统时间");
      } else if (reward.reason === "already_claimed") {
        showToast("✅ 本期离线收益已领取，稍后再来吧~");
      } else {
        showToast("💰 暂时没有可领取的收益");
      }
      advanceTutorialStep("offline");
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

      {showOfflineModal && offlineReward && offlineReward.isValid && (
        <div className="modal-overlay" onClick={() => setShowOfflineModal(false)}>
          <div className="modal-content offline-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowOfflineModal(false)}>×</button>
            <div className="offline-icon">
              <span className="offline-emoji">🌙</span>
            </div>
            <h2 className="offline-title">离线收益</h2>
            <p className="offline-subtitle">甜品店在你休息时也在努力营业~</p>
            
            <div className="offline-info">
              <div className="offline-info-row">
                <span className="offline-info-label">离线时长</span>
                <span className="offline-info-value">
                  {formatOfflineDuration(offlineReward.offlineMinutes)}
                </span>
              </div>
              <div className="offline-info-row">
                <span className="offline-info-label">当前最高等级</span>
                <span className="offline-info-value">
                  Lv.{offlineReward.maxLevel} {DESSERTS[Math.min(offlineReward.maxLevel - 1, DESSERTS.length - 1)]?.emoji}
                </span>
              </div>
              <div className="offline-info-row">
                <span className="offline-info-label">收益速度</span>
                <span className="offline-info-value">
                  {calculateBaseEarningsRate(offlineReward.maxLevel)} 金币/分钟
                </span>
              </div>
            </div>

            <div className="offline-divider"></div>

            <div className="offline-reward-section">
              <span className="offline-reward-label">获得金币</span>
              <span className="offline-reward-coins">
                💰 +{offlineReward.coins.toLocaleString()}
              </span>
            </div>

            {offlineReward.offlineMinutes >= MAX_OFFLINE_HOURS * 60 && (
              <p className="offline-cap-hint">
                ⚡ 已达最高离线时长 ({MAX_OFFLINE_HOURS}小时)
              </p>
            )}

            <button className="offline-claim-btn" onClick={claimOfflineReward}>
              🎁 立即领取
            </button>
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

      {drag.isDragging && drag.sourceIndex !== null && drag.hasMoved && board[drag.sourceIndex] && (
        <div
          className="drag-floating-element"
          style={{
            left: drag.currentX - 32,
            top: drag.currentY - 32,
            background: `linear-gradient(145deg, ${DESSERTS[board[drag.sourceIndex]! - 1].color}dd, ${DESSERTS[board[drag.sourceIndex]! - 1].color}99)`,
          }}
        >
          <span className="dessert-emoji">{DESSERTS[board[drag.sourceIndex]! - 1].emoji}</span>
          <span className="dessert-level">Lv.{board[drag.sourceIndex]}</span>
        </div>
      )}

      <section className="hero">
        <p>{game.id} · H5Game · Port {game.port}</p>
        <h1>{game.title}</h1>
        <span>{game.tagline}</span>
      </section>

      <section className="hud">
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
      </section>

      <section className={"playground " + game.mode}>
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
        </div>

        <aside className="side-panel">
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
                        {!isUnlocked && (
                          <div className="collection-locked-hint">未解锁</div>
                        )}
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
                const isOnCooldown = spawnCooldown > 0;
                const canAfford = coins >= SPAWN_COST;
                const isDisabled = isOnCooldown || !canAfford;
                return (
                  <button
                    key={action}
                    className={`action-spawn ${isOnCooldown ? "on-cooldown" : ""} ${!canAfford ? "cannot-afford" : ""} tutorial-spawn-button`}
                    onClick={() => handleAction(action)}
                    disabled={isDisabled}
                  >
                    <span className="action-main-text">{action}</span>
                    <span className="action-sub-text">
                      {isOnCooldown
                        ? `⏳ 冷却中 ${spawnCooldown}s`
                        : `💰 消耗 ${SPAWN_COST} 金币 · Lv.${SPAWN_MIN_LEVEL}-${SPAWN_MAX_LEVEL}`}
                    </span>
                    {isOnCooldown && (
                      <div
                        className="cooldown-progress"
                        style={{ width: `${(spawnCooldown / SPAWN_COOLDOWN_SECONDS) * 100}%` }}
                      />
                    )}
                  </button>
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
