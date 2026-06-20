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
  hasTimelineSupport,
  SaveFileTimelineData,
  LevelSaveData,
  MultiLevelSaveData,
  createEmptyLevelSave,
  createInitialMultiLevelData,
  migrateLegacySaveToMultiLevel,
} from "./saveManager";
import {
  loadTimeline,
  recordSpawn,
  recordMove,
  recordMerge,
  recordSubmitOrder,
  recordClaimOffline,
  recordImportSave,
  recordReset,
  recordOrganize,
  getTimelineRecords,
  getTimelineSummary,
  getSaveFileTimelineData,
  loadTimelineFromSaveData,
  resetTimeline,
  formatTimelineRecord,
  formatTimelineRecordDetailed,
  type FormattedTimelineRecord,
  TimelineRecord,
  TimelineSummary,
  MAX_TIMELINE_RECORDS,
  MAX_REPLAY_HISTORY_DAYS,
  TIMELINE_VERSION,
  setTimelineLevelId,
} from "./timelineManager";
import {
  DESSERTS,
  Dessert,
  LevelConfig,
  LEVEL_CONFIGS,
  LEVEL_ORDER,
  getLevelConfig,
  CURRENT_LEVEL_KEY,
  LEVEL_SAVE_KEY,
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
  EventMergeRecord,
  EventOrderRecord,
  EventReplayData,
  EventCoinSource,
  EventShardSource,
  ACHIEVEMENT_DEFS,
  AchievementState,
  AchievementDef,
  createInitialAchievementState,
  checkAchievementCompletion,
  SynthesisPlan,
  calculateSynthesisPlan,
} from "./gameConfig";
import {
  GameState,
  Order,
  OrderItem,
  RecentlyUnlocked,
  UnlockHint,
  findNextMergeHint,
  createInitialBoard,
  generateOrder,
  generateOrders,
  countDessertsOnBoard,
  removeDessertsFromBoard,
  getOrderLevelTotals,
  canSubmitOrder,
  getOrderProgress,
  formatUnlockTime,
  getNextUnlockHint,
  submitOrder,
} from "./gameBoardUtils";
import { useGameProgress, OfflineReward, loadMultiLevelSaves, loadRecentlyUnlocked, saveRecentlyUnlocked } from "./hooks/useGameProgress";
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
const ACHIEVEMENT_KEY = game.id + "-achievements";

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

function loadAchievementState(): AchievementState {
  try {
    const saved = localStorage.getItem(ACHIEVEMENT_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const initial = createInitialAchievementState();
      const progress = { ...initial.progress };
      for (const def of ACHIEVEMENT_DEFS) {
        if (parsed.progress && parsed.progress[def.id]) {
          progress[def.id] = {
            current: parsed.progress[def.id].current ?? 0,
            completed: parsed.progress[def.id].completed ?? false,
            claimed: parsed.progress[def.id].claimed ?? false,
          };
        }
      }
      return {
        progress,
        streak: typeof parsed.streak === "number" ? parsed.streak : 0,
        lastPlayDate: parsed.lastPlayDate ?? null,
        bestMaxLevel: typeof parsed.bestMaxLevel === "number" ? parsed.bestMaxLevel : 1,
        bestOrdersCompleted: typeof parsed.bestOrdersCompleted === "number" ? parsed.bestOrdersCompleted : 0,
        bestStepsRemaining: typeof parsed.bestStepsRemaining === "number" ? parsed.bestStepsRemaining : 0,
        bestShardEarnings: typeof parsed.bestShardEarnings === "number" ? parsed.bestShardEarnings : 0,
      };
    }
  } catch (e) {
    console.error("Failed to load achievement state:", e);
  }
  return createInitialAchievementState();
}

function saveAchievementState(state: AchievementState): void {
  try {
    localStorage.setItem(ACHIEVEMENT_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save achievement state:", e);
  }
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
  const progress = useGameProgress();
  const {
    currentLevelId,
    currentConfig,
    setCurrentLevelId,
    board,
    setBoard,
    coins,
    setCoins,
    maxLevel,
    setMaxLevel,
    unlockedLevels,
    setUnlockedLevels,
    unlockTimes,
    setUnlockTimes,
    orders,
    setOrders,
    spawnCooldownEnd,
    setSpawnCooldownEnd,
    spawnCooldown,
    setSpawnCooldown,
    boardRef,
    coinsRef,
    maxLevelRef,
    unlockedLevelsRef,
    unlockTimesRef,
    ordersRef,
    spawnCooldownEndRef,
    spawnCooldownRef,
    mergeHint,
    setMergeHint,
    mergeHintRef,
    showMergeHint,
    setShowMergeHint,
    showMergeHintRef,
    synthesisPlan,
    setSynthesisPlan,
    synthesisPlanRef,
    showSynthesisPlan,
    setShowSynthesisPlan,
    recentlyUnlocked,
    setRecentlyUnlocked,
    lastSaveTime,
    setLastSaveTime,
    autoSaveActive,
    setAutoSaveActive,
    switchLevel: progressSwitchLevel,
    recalcMergeHint,
    recalcSynthesisPlan,
    dismissUnlockCelebration,
    doManualSave,
    formatLastSaveTime,
    handleExportSave: progressHandleExportSave,
    applyImportedSave: progressApplyImportedSave,
    handleImportFileSelect: progressHandleImportFileSelect,
    handleResetProgress: progressHandleResetProgress,
    hasUnclaimedReward,
    calculateOfflineReward: progressCalculateOfflineReward,
    recordLeaveTime: progressRecordLeaveTime,
    markAsClaimed,
  } = progress;
  const currentDesserts = currentConfig.desserts;

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
  const [eventMergeRecords, setEventMergeRecords] = useState<EventMergeRecord[]>([]);
  const [eventOrderRecords, setEventOrderRecords] = useState<EventOrderRecord[]>([]);
  const [eventReplayData, setEventReplayData] = useState<EventReplayData | null>(null);
  const [showEventReplay, setShowEventReplay] = useState<boolean>(false);
  const [replayActiveTab, setReplayActiveTab] = useState<number>(0);
  const [achievementState, setAchievementState] = useState<AchievementState>(loadAchievementState());
  const [newlyCompletedAchievements, setNewlyCompletedAchievements] = useState<string[]>([]);
  const [showAchievementPanel, setShowAchievementPanel] = useState<boolean>(false);
  const eventMergeRecordsRef = useRef<EventMergeRecord[]>([]);
  const eventOrderRecordsRef = useRef<EventOrderRecord[]>([]);
  const eventMergeIdCounterRef = useRef<number>(0);
  const eventOrderIdCounterRef = useRef<number>(0);
  const achievementStateRef = useRef<AchievementState>(achievementState);
  achievementStateRef.current = achievementState;

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

  const [eventMergeHint, setEventMergeHint] = useState<{ sourceIndex: number; targetIndex: number; level: number } | null>(null);
  const eventMergeHintRef = useRef<{ sourceIndex: number; targetIndex: number; level: number } | null>(null);

  const [showOfflineModal, setShowOfflineModal] = useState<boolean>(false);
  const [offlineReward, setOfflineReward] = useState<OfflineReward | null>(null);

  const [tutorial, setTutorial] = useState<TutorialState>(initialTutorial);
  const [showTutorial, setShowTutorial] = useState<boolean>(!isTutorialCompleted() && initialTutorial.currentStep !== "completed");
  const tutorialRef = useRef<TutorialState>(tutorial);
  tutorialRef.current = tutorial;

  const [showSavePanel, setShowSavePanel] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [showImportResult, setShowImportResult] = useState<{
    type: "success" | "error" | "warning";
    title: string;
    message: string;
    details: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showTimelinePanel, setShowTimelinePanel] = useState<boolean>(false);
  const [timelineRecords, setTimelineRecords] = useState<TimelineRecord[]>([]);
  const [timelineSummary, setTimelineSummary] = useState<TimelineSummary | null>(null);
  const [timelineRefreshTrigger, setTimelineRefreshTrigger] = useState<number>(0);

  const [showLevelSelector, setShowLevelSelector] = useState<boolean>(false);

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

  dragRef.current = drag;
  hoverRef.current = hoverIndex;
  eventMergeHintRef.current = eventMergeHint;
  eventBoardRef.current = eventBoard;
  eventCoinsRef.current = eventCoins;
  eventStepsLeftRef.current = eventStepsLeft;
  eventStatsRef.current = eventStats;
  eventOrdersRef.current = eventOrders;
  eventSpawnCooldownRef.current = eventSpawnCooldown;
  eventMergeRecordsRef.current = eventMergeRecords;
  eventOrderRecordsRef.current = eventOrderRecords;

  const showToast = useCallback((message: string): void => {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const switchLevel = useCallback((newLevelId: string): void => {
    progressSwitchLevel(newLevelId);
    setShowLevelSelector(false);
    showToast(`🔀 已切换到 ${getLevelConfig(newLevelId).name}`);
  }, [progressSwitchLevel, showToast]);

  const refreshTimeline = useCallback((): void => {
    setTimelineRecords(getTimelineRecords());
    setTimelineSummary(getTimelineSummary());
    setTimelineRefreshTrigger((prev) => prev + 1);
  }, []);

  const recalcEventMergeHint = useCallback((newBoard: (number | null)[]): void => {
    const hint = findNextMergeHint(newBoard);
    setEventMergeHint(hint);
  }, []);

  useEffect(() => {
    if (eventMode && eventBoard.length > 0) {
      recalcEventMergeHint(eventBoard);
    }
  }, [eventBoard, eventMode, recalcEventMergeHint]);

  useEffect(() => {
    const handleTestSetBoard = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { board, coins, maxLevel, unlockedLevels, spawnCooldownEnd, orders } = customEvent.detail;
      if (board) setBoard(board);
      if (coins !== undefined) setCoins(coins);
      if (maxLevel) setMaxLevel(maxLevel);
      if (unlockedLevels) setUnlockedLevels(unlockedLevels);
      if (spawnCooldownEnd !== undefined) setSpawnCooldownEnd(spawnCooldownEnd);
      if (orders) setOrders(orders);
    };
    window.addEventListener("test-set-board", handleTestSetBoard);
    return () => window.removeEventListener("test-set-board", handleTestSetBoard);
  }, [setBoard, setCoins, setMaxLevel, setUnlockedLevels, setSpawnCooldownEnd, setOrders]);

  const handleExportSave = useCallback((): void => {
    progressHandleExportSave(showToast);
    setShowSavePanel(false);
  }, [progressHandleExportSave, showToast]);

  const handleImportFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    await progressHandleImportFileSelect(
      e, 
      showToast, 
      refreshTimeline, 
      setShowImportResult, 
      setShowImportModal, 
      fileInputRef
    );
  }, [progressHandleImportFileSelect, showToast, refreshTimeline]);

  const handleResetProgress = useCallback((): void => {
    progressHandleResetProgress(
      showToast, 
      refreshTimeline, 
      setShowTutorial, 
      setTutorial, 
      setShowResetConfirm, 
      setShowSavePanel
    );
  }, [progressHandleResetProgress, showToast, refreshTimeline]);

  useEffect(() => {
    saveTutorialState(tutorial);
  }, [tutorial]);

  useEffect(() => {
    saveEventShards(eventShards);
  }, [eventShards]);

  useEffect(() => {
    saveAchievementState(achievementState);
  }, [achievementState]);

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
    setEventMergeRecords([]);
    setEventOrderRecords([]);
    setEventReplayData(null);
    eventMergeRecordsRef.current = [];
    eventOrderRecordsRef.current = [];
    eventMergeIdCounterRef.current = 0;
    eventOrderIdCounterRef.current = 0;

    setAchievementState((prev) => {
      const today = new Date().toISOString().split("T")[0];
      const lastDate = prev.lastPlayDate;
      let newStreak = prev.streak;
      if (lastDate !== today) {
        if (lastDate) {
          const lastDateObj = new Date(lastDate);
          const todayObj = new Date(today);
          const diffDays = Math.floor((todayObj.getTime() - lastDateObj.getTime()) / 86400000);
          if (diffDays === 1) {
            newStreak = prev.streak + 1;
          } else {
            newStreak = 1;
          }
        } else {
          newStreak = 1;
        }
      }

      const updated = { ...prev };
      updated.progress = { ...prev.progress };
      updated.streak = newStreak;
      updated.lastPlayDate = today;

      checkAchievementCompletion(updated, "streak", newStreak);

      return updated;
    });

    setShowEventEntry(false);
    setEventMode(true);
    showToast("🎮 限时挑战开始！加油！");
  }, [showToast]);

  const buildEventReplayData = useCallback((): EventReplayData => {
    const merges = eventMergeRecordsRef.current;
    const orders = eventOrderRecordsRef.current;
    const finalBoard = [...eventBoardRef.current];
    const remainingCoins = eventCoinsRef.current;
    const totalStepsUsed = EVENT_MAX_STEPS - eventStepsLeftRef.current;

    const mergeCoinTotal = merges.reduce((sum, m) => sum + m.coinReward, 0);
    const orderCoinTotal = orders.reduce((sum, o) => sum + o.coinReward, 0);
    const orderShardTotal = orders.reduce((sum, o) => sum + o.shardReward, 0);

    const coinSources: EventCoinSource[] = [
      { source: "merge", amount: mergeCoinTotal, count: merges.length },
      { source: "order", amount: orderCoinTotal, count: orders.length },
      { source: "remaining", amount: remainingCoins, count: 1 },
    ];

    const levelBonusShards = Math.floor(eventStatsRef.current.maxLevel / 2);
    const orderBonusShards = eventStatsRef.current.ordersCompleted;

    const shardSources: EventShardSource[] = [
      { source: "order", amount: orderShardTotal, count: orders.length },
      { source: "level_bonus", amount: levelBonusShards, count: 1 },
      { source: "order_bonus", amount: orderBonusShards, count: 1 },
    ];

    return {
      merges: [...merges],
      orders: [...orders],
      coinSources,
      shardSources,
      finalBoard,
      remainingCoins,
      totalStepsUsed,
    };
  }, []);

  const claimAchievementReward = useCallback((achievementId: string): void => {
    const def = ACHIEVEMENT_DEFS.find(d => d.id === achievementId);
    if (!def) return;
    setAchievementState((prev) => {
      const entry = prev.progress[achievementId];
      if (!entry || !entry.completed || entry.claimed) return prev;
      return {
        ...prev,
        progress: {
          ...prev.progress,
          [achievementId]: { ...entry, claimed: true },
        },
      };
    });
    setEventShards((prev) => prev + def.shardReward);
    showToast(`🏆 成就奖励已领取！+${def.shardReward}💎 碎片`);
  }, [showToast]);

  const endEvent = useCallback((): void => {
    const result = calculateEventResult(eventStatsRef.current, eventCoinsRef.current, eventShardsEarned);
    setEventResult(result);

    const replayData = buildEventReplayData();
    setEventReplayData(replayData);
    setReplayActiveTab(0);
    setShowEventReplay(true);

    setCoins((prev: number) => prev + result.coins);
    setEventShards((prev: number) => prev + result.shards);

    const score = eventStatsRef.current.merges * 10 + eventStatsRef.current.ordersCompleted * 50 + eventStatsRef.current.maxLevel * 20;
    if (score > eventHighScore) {
      setEventHighScore(score);
      saveEventHighScore(score);
    }

    const stepsRemaining = eventStepsLeftRef.current;
    const maxLevel = eventStatsRef.current.maxLevel;
    const ordersCompleted = eventStatsRef.current.ordersCompleted;
    const shardsEarned = eventShardsEarned + Math.floor(maxLevel / 2) + ordersCompleted;

    setAchievementState((prev) => {
      const updated = { ...prev };
      updated.progress = { ...prev.progress };
      updated.bestMaxLevel = Math.max(prev.bestMaxLevel, maxLevel);
      updated.bestOrdersCompleted = Math.max(prev.bestOrdersCompleted, ordersCompleted);
      updated.bestStepsRemaining = Math.max(prev.bestStepsRemaining, stepsRemaining);
      updated.bestShardEarnings = Math.max(prev.bestShardEarnings, shardsEarned);

      const allNewlyCompleted: string[] = [];

      const maxLevelCompletions = checkAchievementCompletion(updated, "maxLevel", maxLevel);
      allNewlyCompleted.push(...maxLevelCompletions);

      const ordersCompletions = checkAchievementCompletion(updated, "ordersCompleted", ordersCompleted);
      allNewlyCompleted.push(...ordersCompletions);

      const stepsCompletions = checkAchievementCompletion(updated, "stepsRemaining", stepsRemaining);
      allNewlyCompleted.push(...stepsCompletions);

      const shardsCompletions = checkAchievementCompletion(updated, "shardEarnings", shardsEarned);
      allNewlyCompleted.push(...shardsCompletions);

      if (allNewlyCompleted.length > 0) {
        setNewlyCompletedAchievements(allNewlyCompleted);
      }

      return updated;
    });

    setEventMode(false);
  }, [eventShardsEarned, eventHighScore, buildEventReplayData]);

  const exitEvent = useCallback((): void => {
    setEventMode(false);
    setEventBoard([]);
    showToast("👋 已退出活动，主线进度已保留");
  }, [showToast]);

  const retryEvent = useCallback((): void => {
    setShowEventReplay(false);
    setTimeout(() => {
      startEvent();
    }, 100);
  }, [startEvent]);

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
        const currentMaxLevel = eventStatsRef.current.maxLevel;
        const isNewMaxLevel = newLevel > currentMaxLevel;

        setEventMergeHint(null);

        setEventBoard(newBoard);
        setEventCoins((prev) => prev + coinReward);

        setEventStats((prev) => ({
          ...prev,
          merges: prev.merges + 1,
          maxLevel: Math.max(prev.maxLevel, newLevel),
          totalCoinReward: prev.totalCoinReward + coinReward,
        }));

        const mergeRecord: EventMergeRecord = {
          id: ++eventMergeIdCounterRef.current,
          type: "merge",
          timestamp: Date.now(),
          stepNumber: EVENT_MAX_STEPS - eventStepsLeftRef.current + 1,
          sourceLevel,
          targetLevel: newLevel,
          coinReward,
          isNewMaxLevel,
        };
        setEventMergeRecords((prev) => [...prev, mergeRecord]);

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

    const orderRecord: EventOrderRecord = {
      id: ++eventOrderIdCounterRef.current,
      type: "order",
      timestamp: Date.now(),
      stepNumber: EVENT_MAX_STEPS - eventStepsLeftRef.current + 1,
      orderId: order.id,
      items: order.items.map((item) => ({ level: item.level, count: item.count })),
      coinReward: order.reward.coins,
      shardReward: order.reward.shards,
    };
    setEventOrderRecords((prev) => [...prev, orderRecord]);

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

    recordClaimOffline(offlineReward.coins, offlineReward.offlineMinutes, offlineReward.maxLevel);
    refreshTimeline();

    showToast(`🎉 离线收益领取成功！+${offlineReward.coins} 金币`);
    advanceTutorialStep("offline");
  }, [offlineReward, showToast, advanceTutorialStep, refreshTimeline]);

  const checkOfflineReward = useCallback((): void => {
    const reward = progressCalculateOfflineReward();
    setOfflineReward(reward);
    if (reward.isValid && hasUnclaimedReward()) {
      setShowOfflineModal(true);
    }
  }, [progressCalculateOfflineReward, hasUnclaimedReward]);

  useEffect(() => {
    checkOfflineReward();
  }, [checkOfflineReward]);

  useEffect(() => {
    const handleBeforeUnload = (): void => {
      progressRecordLeaveTime();
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") {
        progressRecordLeaveTime();
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
  }, [checkOfflineReward, progressRecordLeaveTime]);

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
    const cooldownSec = currentConfig.spawnCooldownSeconds;
    const newEnd = Date.now() + cooldownSec * 1000;
    spawnCooldownEndRef.current = newEnd;
    setSpawnCooldownEnd(newEnd);
    spawnCooldownRef.current = cooldownSec;
    setSpawnCooldown(cooldownSec);
  }, [currentConfig]);

  const getSpawnStatus = useCallback((): SpawnStatus => {
    const now = Date.now();
    const isCooldown = spawnCooldownEndRef.current > now;
    const hasNoCoins = coinsRef.current < currentConfig.spawnCost;
    const emptyIndex = getRandomEmptyCell(boardRef.current);
    const isBoardFull = emptyIndex === null;
    if (isCooldown) return "cooldown";
    if (isBoardFull) return "board_full";
    if (hasNoCoins) return "no_coins";
    return "ready";
  }, [getRandomEmptyCell, currentConfig]);

  const spawnDessert = useCallback((targetLevel?: number, freeSpawn: boolean = false): boolean => {
    if (isSpawningRef.current) {
      return false;
    }
    const spawnCost = currentConfig.spawnCost;
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

    if (!freeSpawn && coinsRef.current < spawnCost) {
      showToast(`💰 金币不足！需要 ${spawnCost} 金币`);
      return false;
    }

    try {
      isSpawningRef.current = true;
      const maxSpawnLevel = Math.min(maxLevelRef.current, currentConfig.spawnMaxLevel);
      const levelRange = maxSpawnLevel - currentConfig.spawnMinLevel + 1;
      const level = targetLevel || Math.min(
        Math.floor(Math.random() * levelRange) + currentConfig.spawnMinLevel,
        currentConfig.desserts.length
      );

      if (!freeSpawn) {
        setCoins((prev: number) => prev - spawnCost);
      }
      const newBoard = [...boardRef.current];
      newBoard[emptyIndex] = level;
      setBoard(newBoard);

      if (!freeSpawn) {
        startSpawnCooldown();
      }

      const dessert = currentConfig.desserts[level - 1];
      showToast(`🍰 生成了 ${dessert.emoji} ${dessert.name}！${freeSpawn ? "" : `-${spawnCost}💰`}`);
      
      recordSpawn(level, emptyIndex, spawnCost, freeSpawn);
      refreshTimeline();
      
      if (!freeSpawn) {
        advanceTutorialStep("spawn");
      }
      
      return true;
    } finally {
      setTimeout(() => {
        isSpawningRef.current = false;
      }, 50);
    }
  }, [getRandomEmptyCell, showToast, startSpawnCooldown, advanceTutorialStep, refreshTimeline, currentConfig]);

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
    const boardSize = currentConfig.boardSize;
    const desserts = currentConfig.desserts;
    if (sourceIndex === targetIndex || sourceIndex < 0 || sourceIndex >= boardSize
        || targetIndex < 0 || targetIndex >= boardSize) {
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
      recordMove(sourceIndex, targetIndex, sourceLevel);
      refreshTimeline();
      return true;
    }

    if (sourceLevel === targetLevel) {
      const newLevel = sourceLevel + 1;
      if (newLevel > desserts.length) {
        showToast("⭐ 已达到最高等级！");
        triggerFailFeedback([sourceIndex, targetIndex]);
        return false;
      } else {
        const coinReward = calculateMergeReward(newLevel, false, currentConfig);
        const newBoard = [...boardRef.current];
        newBoard[targetIndex] = newLevel;
        newBoard[sourceIndex] = null;

        setShowMergeHint(false);
        showMergeHintRef.current = false;

        const isNewMaxLevel = newLevel > maxLevelRef.current;

        setBoard(newBoard);
        setCoins((prev: number) => prev + coinReward);
        triggerSuccessFeedback(targetIndex);
        showToast(`✨ 合成${desserts[newLevel - 1].name}！+${coinReward}金币`);

        recordMerge(sourceIndex, targetIndex, sourceLevel, newLevel, coinReward, isNewMaxLevel);
        refreshTimeline();

        if (isNewMaxLevel) {
          setMaxLevel(newLevel);
          setTimeout(() => showToast(`🎉 解锁新等级：${desserts[newLevel - 1].name}！`), 800);
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
          const nextHint = findNextMergeHint(newBoard, currentConfig);
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
  }, [showToast, triggerSuccessFeedback, triggerFailFeedback, advanceTutorialStep, refreshTimeline, currentConfig]);

  const getCellIndexFromPoint = useCallback((clientX: number, clientY: number, isEvent: boolean): number | null => {
    const cells = isEvent ? eventCellRefs.current : cellRefs.current;
    const boardSize = isEvent ? EVENT_BOARD_SIZE : currentConfig.boardSize;
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
      const boardSize = isEventBoard ? EVENT_BOARD_SIZE : currentConfig.boardSize;
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
      const boardSize = isEventBoard ? EVENT_BOARD_SIZE : currentConfig.boardSize;
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

      if (coinsRef.current < currentConfig.spawnCost) {
        showToast(`💰 金币不足！需要 ${currentConfig.spawnCost} 金币`);
        return;
      }

      try {
        isSpawningRef.current = true;
        const maxSpawnLevel = Math.min(maxLevelRef.current, currentConfig.spawnMaxLevel);
        const levelRange = maxSpawnLevel - currentConfig.spawnMinLevel + 1;
        const level = Math.floor(Math.random() * levelRange) + currentConfig.spawnMinLevel;

        setCoins((prev: number) => prev - currentConfig.spawnCost);
        const newBoard = [...boardRef.current];
        newBoard[index] = level;
        setBoard(newBoard);

        startSpawnCooldown();

        const dessert = currentDesserts[level - 1];
        showToast(`🍰 生成了 ${dessert.emoji} ${dessert.name}！-${currentConfig.spawnCost}💰`);
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
  }, [getCellIndexFromPoint, performMerge, eventPerformMerge, eventSpawnDessert, showToast, advanceTutorialStep, eventMode, currentConfig]);

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

    recordSubmitOrder(order.id, order.items, order.reward);
    refreshTimeline();

    showToast(`🎉 订单完成！+${order.reward}金币`);
    advanceTutorialStep("order");

    setTimeout(() => {
      setOrders((prev: Order[]) => {
        const remaining = prev.filter((o: Order) => !o.completed);
        const newOrders = generateOrders(unlockedLevelsRef.current, currentConfig);
        const needed = currentConfig.maxOrders - remaining.length;
        return [...remaining, ...newOrders.slice(0, needed)];
      });
    }, 1500);
  }, [showToast, advanceTutorialStep, refreshTimeline, currentConfig]);

  const handleRefreshOrders = useCallback((): void => {
    if (unlockedLevelsRef.current.length === 0) {
      showToast("❌ 没有解锁的甜品，无法生成订单！");
      return;
    }
    setOrders(generateOrders(unlockedLevelsRef.current, currentConfig));
    showToast("📋 订单已刷新！");
  }, [showToast, currentConfig]);

  const organizeBoard = useCallback((): void => {
    const boardSize = currentConfig.boardSize;
    const newBoard = Array(boardSize).fill(null);
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
    
    recordOrganize(nonNullCells.length);
    refreshTimeline();
    
    setTimeout(() => {
      const nextHint = findNextMergeHint(newBoard, currentConfig);
      if (nextHint) {
        setMergeHint(nextHint);
        setShowMergeHint(true);
        showMergeHintRef.current = true;
      }
    }, 300);
    
    showToast("🧹 整理完成！相同等级甜品已聚拢");
  }, [showToast, refreshTimeline, currentConfig]);

  const handleAction = (action: string): void => {
    if (action === "生成甜品") {
      spawnDessert();
    } else if (action === "自动整理") {
      organizeBoard();
    } else if (action === "领取收益") {
      const reward = progressCalculateOfflineReward();
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

      {showLevelSelector && (
        <div className="modal-overlay" onClick={() => setShowLevelSelector(false)}>
          <div className="modal-content level-selector-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowLevelSelector(false)}>×</button>
            <div className="level-selector-icon">🗺️</div>
            <h2 className="level-selector-title">选择关卡</h2>
            <p className="level-selector-subtitle">每个关卡拥有独立的甜品、棋盘和进度</p>
            <div className="level-selector-list">
              {LEVEL_ORDER.map((levelId) => {
                const cfg = getLevelConfig(levelId);
                const isActive = levelId === currentLevelId;
                const multiData = loadMultiLevelSaves();
                const levelSave = multiData.levels[levelId];
                return (
                  <button
                    key={levelId}
                    className={`level-selector-card ${isActive ? "active" : ""}`}
                    onClick={() => switchLevel(levelId)}
                  >
                    <div className="level-card-header">
                      <span className="level-card-icon">{cfg.icon}</span>
                      <span className="level-card-name">{cfg.name}</span>
                      {isActive && <span className="level-card-badge">当前</span>}
                    </div>
                    <p className="level-card-desc">{cfg.description}</p>
                    <div className="level-card-stats">
                      <span>棋盘 {cfg.boardSize}格</span>
                      <span>生成 {cfg.spawnCost}💰</span>
                      <span>离线 ×{cfg.offlineEarningsMultiplier}</span>
                    </div>
                    <div className="level-card-progress">
                      {levelSave ? (
                        <>
                          <span>Lv.{levelSave.maxLevel}/{cfg.desserts.length}</span>
                          <span>💰{levelSave.coins}</span>
                          <span>📖{levelSave.unlockedLevels.length}/{cfg.desserts.length}</span>
                        </>
                      ) : (
                        <span>尚未开始</span>
                      )}
                    </div>
                    <div className="level-card-desserts">
                      {cfg.desserts.slice(0, 5).map((d) => (
                        <span key={d.level} className="level-card-dessert-emoji">{d.emoji}</span>
                      ))}
                      {cfg.desserts.length > 5 && <span className="level-card-dessert-more">+{cfg.desserts.length - 5}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="level-selector-shared-info">
              <h4>🌐 全局共享</h4>
              <p>活动碎片 💎 · 成就系统 🏆 · 连续签到 🔥</p>
              <h4>🔒 关卡独立</h4>
              <p>棋盘 · 金币 · 图鉴进度 · 订单 · 离线收益</p>
            </div>
          </div>
        </div>
      )}

      {recentlyUnlocked && !recentlyUnlocked.seen && (() => {
        const dessert = currentDesserts[recentlyUnlocked.level - 1];
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
                const nextHint = getNextUnlockHint(unlockedLevels, board, currentConfig);
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

      {showTimelinePanel && (
        <div className="modal-overlay" onClick={() => setShowTimelinePanel(false)}>
          <div className="modal-content timeline-panel-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowTimelinePanel(false)}>×</button>
            <div className="timeline-panel-icon">📜</div>
            <h2 className="timeline-panel-title">操作时间线</h2>
            
            {timelineSummary && (
              <div className="timeline-summary">
                <div className="timeline-summary-row">
                  <span className="timeline-summary-label">总记录数</span>
                  <span className="timeline-summary-value">{timelineSummary.totalActions} / {MAX_TIMELINE_RECORDS}</span>
                </div>
                <div className="timeline-summary-row">
                  <span className="timeline-summary-label">记录周期</span>
                  <span className="timeline-summary-value">最近 {MAX_REPLAY_HISTORY_DAYS} 天</span>
                </div>
                <div className="timeline-summary-row">
                  <span className="timeline-summary-label">数据版本</span>
                  <span className="timeline-summary-value">v{TIMELINE_VERSION}</span>
                </div>
                <div className="timeline-stats">
                  <span className="timeline-stat">🎯 生成: {timelineSummary.totalSpawns}</span>
                  <span className="timeline-stat">📦 移动: {timelineSummary.totalMoves}</span>
                  <span className="timeline-stat">✨ 合成: {timelineSummary.totalMerges}</span>
                  <span className="timeline-stat">📋 订单: {timelineSummary.totalOrders}</span>
                </div>
              </div>
            )}

            <div className="timeline-records-container">
              {timelineRecords.length === 0 ? (
                <div className="timeline-empty">
                  <div className="timeline-empty-icon">📭</div>
                  <p>暂无操作记录</p>
                  <small>开始游戏后，你的操作将记录在这里</small>
                </div>
              ) : (
                <div className="timeline-records-list">
                  {[...timelineRecords].reverse().map((record, index) => {
                    const formatted = formatTimelineRecordDetailed(record);
                    return (
                      <div key={`${record.timestamp}-${index}`} className="timeline-record-item">
                        <div className="timeline-record-icon">{formatted.icon}</div>
                        <div className="timeline-record-content">
                          <div className="timeline-record-title">{formatted.title}</div>
                          <div className="timeline-record-desc">{formatted.description}</div>
                        </div>
                        <div className="timeline-record-time">
                          {new Date(record.timestamp).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="timeline-footer">
              <button
                className="timeline-action-btn"
                onClick={() => { refreshTimeline(); showToast("🔄 时间线已刷新"); }}
              >
                <span>🔄</span> 刷新
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
                      Lv.{offlineReward.maxLevel} {currentDesserts[Math.min(offlineReward.maxLevel - 1, currentDesserts.length - 1)]?.emoji} {currentDesserts[Math.min(offlineReward.maxLevel - 1, currentDesserts.length - 1)]?.name}
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
                      Lv.{offlineReward.maxLevel} {currentDesserts[Math.min(offlineReward.maxLevel - 1, currentDesserts.length - 1)]?.emoji}
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
              const dessert = currentDesserts[selectedDessert - 1];
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

            <div className="event-entry-achievements">
              <div className="event-achievements-header" onClick={() => setShowAchievementPanel(!showAchievementPanel)}>
                <span className="event-achievements-title">🏆 活动成就</span>
                <span className="event-achievements-toggle">{showAchievementPanel ? "收起 ▲" : "展开 ▼"}</span>
              </div>
              {showAchievementPanel && (
                <div className="event-achievements-list">
                  {ACHIEVEMENT_DEFS.map((def) => {
                    const entry = achievementState.progress[def.id];
                    const isCompleted = entry?.completed ?? false;
                    const isClaimed = entry?.claimed ?? false;
                    const current = entry?.current ?? 0;
                    const progressPercent = Math.min(100, Math.round((current / def.threshold) * 100));
                    return (
                      <div key={def.id} className={`achievement-card ${isCompleted ? (isClaimed ? "achievement-claimed" : "achievement-claimable") : "achievement-in-progress"}`}>
                        <div className="achievement-icon">{def.icon}</div>
                        <div className="achievement-info">
                          <div className="achievement-name">{def.name}</div>
                          <div className="achievement-desc">{def.description}</div>
                          <div className="achievement-progress-bar">
                            <div className="achievement-progress-fill" style={{ width: `${progressPercent}%` }} />
                            <span className="achievement-progress-text">{current}/{def.threshold}</span>
                          </div>
                        </div>
                        <div className="achievement-reward">
                          {isClaimed ? (
                            <span className="achievement-claimed-badge">✅ 已领取</span>
                          ) : isCompleted ? (
                            <button className="achievement-claim-btn" onClick={(e) => { e.stopPropagation(); claimAchievementReward(def.id); }}>
                              🎁 +{def.shardReward}💎
                            </button>
                          ) : (
                            <span className="achievement-shard-amount">+{def.shardReward}💎</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="event-rules">
              <h4>🎮 挑战规则</h4>
              <ul>
                <li>每步操作（生成、合成、移动、整理、提交订单）消耗 1 步</li>
                <li>完成活动订单可获得金币和图鉴碎片奖励</li>
                <li>合成越高级甜品，最终奖励越丰厚</li>
                <li>活动棋盘与主线独立，退出不影响主线进度</li>
                <li>完成成就可领取图鉴碎片奖励</li>
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

      {showEventReplay && eventReplayData && eventResult && (
        <div className="modal-overlay event-replay-overlay">
          <div className="modal-content event-replay-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowEventReplay(false)}>×</button>
            
            <div className="event-replay-header">
              <div className={`event-rank-badge rank-${eventResult.rank}`}>
                {eventResult.rank}
              </div>
              <h2 className="event-replay-title">活动结算复盘</h2>
              <p className="event-replay-subtitle">
                用时 {eventReplayData.totalStepsUsed} 步 · 最高等级 Lv.{eventResult.maxLevel}
              </p>
            </div>

            <div className="event-replay-summary">
              <div className="replay-summary-item">
                <span className="replay-summary-icon">🧁</span>
                <span className="replay-summary-value">{eventResult.merges}</span>
                <span className="replay-summary-label">合成次数</span>
              </div>
              <div className="replay-summary-item">
                <span className="replay-summary-icon">📋</span>
                <span className="replay-summary-value">{eventResult.ordersCompleted}</span>
                <span className="replay-summary-label">完成订单</span>
              </div>
              <div className="replay-summary-item">
                <span className="replay-summary-icon">💰</span>
                <span className="replay-summary-value">+{eventResult.coins}</span>
                <span className="replay-summary-label">金币奖励</span>
              </div>
              <div className="replay-summary-item">
                <span className="replay-summary-icon">💎</span>
                <span className="replay-summary-value">+{eventResult.shards}</span>
                <span className="replay-summary-label">碎片奖励</span>
              </div>
            </div>

            <div className="event-replay-tabs">
              <div 
                className={`replay-tab ${replayActiveTab === 0 ? 'active' : ''}`}
                onClick={() => setReplayActiveTab(0)}
              >
                关键合成
              </div>
              <div 
                className={`replay-tab ${replayActiveTab === 1 ? 'active' : ''}`}
                onClick={() => setReplayActiveTab(1)}
              >
                订单完成
              </div>
              <div 
                className={`replay-tab ${replayActiveTab === 2 ? 'active' : ''}`}
                onClick={() => setReplayActiveTab(2)}
              >
                收益来源
              </div>
              <div 
                className={`replay-tab ${replayActiveTab === 3 ? 'active' : ''}`}
                onClick={() => setReplayActiveTab(3)}
              >
                🏆 成就
              </div>
            </div>

            <div className="event-replay-content">
              {replayActiveTab === 0 && (
                <div className="replay-section">
                  <h3 className="replay-section-title">✨ 关键合成时间线</h3>
                  {eventReplayData.merges.length > 0 ? (
                    <div className="replay-timeline">
                      {[...eventReplayData.merges].reverse().map((merge) => {
                        const dessert = DESSERTS[merge.targetLevel - 1];
                        return (
                          <div key={merge.id} className={`replay-timeline-item ${merge.isNewMaxLevel ? 'milestone' : ''}`}>
                            <div className="replay-timeline-step">第 {merge.stepNumber} 步</div>
                            <div className="replay-timeline-content">
                              <div className="replay-merge-info">
                                <span className="replay-merge-arrow">
                                  {DESSERTS[merge.sourceLevel - 1]?.emoji} ×2 → {dessert?.emoji}
                                </span>
                                <span className="replay-merge-name">{dessert?.name}</span>
                                {merge.isNewMaxLevel && (
                                  <span className="replay-new-record">🎉 新纪录!</span>
                                )}
                              </div>
                              <div className="replay-merge-reward">+{merge.coinReward} 💰</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="replay-empty">本次活动没有合成记录</div>
                  )}
                </div>
              )}

              {replayActiveTab === 1 && (
                <div className="replay-section">
                  <h3 className="replay-section-title">📦 完成订单列表</h3>
                  {eventReplayData.orders.length > 0 ? (
                    <div className="replay-orders-list">
                      {eventReplayData.orders.map((order) => (
                        <div key={order.id} className="replay-order-item">
                          <div className="replay-order-header">
                            <span className="replay-order-step">第 {order.stepNumber} 步</span>
                            <span className="replay-order-rewards">
                              +{order.coinReward}💰 +{order.shardReward}💎
                            </span>
                          </div>
                          <div className="replay-order-items">
                            {order.items.map((item, idx) => {
                              const dessert = DESSERTS[item.level - 1];
                              return (
                                <span key={idx} className="replay-order-item-tag">
                                  {dessert?.emoji} {dessert?.name} ×{item.count}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="replay-empty">本次活动没有完成订单</div>
                  )}
                </div>
              )}

              {replayActiveTab === 2 && (
                <div className="replay-section">
                  <h3 className="replay-section-title">📊 收益来源明细</h3>
                  
                  <div className="replay-income-section">
                    <h4 className="replay-income-title">💰 金币来源</h4>
                    <div className="replay-income-list">
                      {eventReplayData.coinSources.map((source, idx) => (
                        <div key={idx} className="replay-income-item">
                          <span className="replay-income-label">
                            {source.source === 'merge' && '🧁 合成奖励'}
                            {source.source === 'order' && '📋 订单奖励'}
                            {source.source === 'remaining' && '💰 剩余金币'}
                            {source.count > 1 && ` (${source.count}次)`}
                          </span>
                          <span className="replay-income-amount">+{source.amount}</span>
                        </div>
                      ))}
                      <div className="replay-income-total">
                        <span>总计</span>
                        <span>{eventResult.coins}</span>
                      </div>
                    </div>
                  </div>

                  <div className="replay-income-section">
                    <h4 className="replay-income-title">💎 碎片来源</h4>
                    <div className="replay-income-list">
                      {eventReplayData.shardSources.map((source, idx) => (
                        <div key={idx} className="replay-income-item">
                          <span className="replay-income-label">
                            {source.source === 'order' && '📋 订单奖励'}
                            {source.source === 'level_bonus' && '⭐ 等级奖励'}
                            {source.source === 'order_bonus' && '🏆 完成数量奖励'}
                          </span>
                          <span className="replay-income-amount">+{source.amount}</span>
                        </div>
                      ))}
                      <div className="replay-income-total">
                        <span>总计</span>
                        <span>{eventResult.shards}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {replayActiveTab === 3 && (
                <div className="replay-section">
                  <h3 className="replay-section-title">🏆 成就进度</h3>
                  {newlyCompletedAchievements.length > 0 && (
                    <div className="achievement-newly-completed-banner">
                      🎉 本次挑战解锁了 {newlyCompletedAchievements.length} 个新成就！
                    </div>
                  )}
                  <div className="replay-achievements-list">
                    {ACHIEVEMENT_DEFS.map((def) => {
                      const entry = achievementState.progress[def.id];
                      const isCompleted = entry?.completed ?? false;
                      const isClaimed = entry?.claimed ?? false;
                      const current = entry?.current ?? 0;
                      const progressPercent = Math.min(100, Math.round((current / def.threshold) * 100));
                      const isNewlyCompleted = newlyCompletedAchievements.includes(def.id);
                      return (
                        <div key={def.id} className={`achievement-card ${isCompleted ? (isClaimed ? "achievement-claimed" : "achievement-claimable") : "achievement-in-progress"} ${isNewlyCompleted ? "achievement-new" : ""}`}>
                          <div className="achievement-icon">{def.icon}</div>
                          <div className="achievement-info">
                            <div className="achievement-name">
                              {def.name}
                              {isNewlyCompleted && <span className="achievement-new-badge">NEW</span>}
                            </div>
                            <div className="achievement-desc">{def.description}</div>
                            <div className="achievement-progress-bar">
                              <div className="achievement-progress-fill" style={{ width: `${progressPercent}%` }} />
                              <span className="achievement-progress-text">{current}/{def.threshold}</span>
                            </div>
                          </div>
                          <div className="achievement-reward">
                            {isClaimed ? (
                              <span className="achievement-claimed-badge">✅ 已领取</span>
                            ) : isCompleted ? (
                              <button className="achievement-claim-btn" onClick={(e) => { e.stopPropagation(); claimAchievementReward(def.id); }}>
                                🎁 +{def.shardReward}💎
                              </button>
                            ) : (
                              <span className="achievement-shard-amount">+{def.shardReward}💎</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="event-replay-actions">
              <button 
                className="event-replay-btn event-replay-close" 
                onClick={() => setShowEventReplay(false)}
              >
                返回主页
              </button>
              <button 
                className="event-replay-btn event-replay-retry" 
                onClick={retryEvent}
              >
                🔄 重新挑战
              </button>
            </div>
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
                ? `linear-gradient(145deg, ${currentDesserts[board[drag.sourceIndex]! - 1].color}dd, ${currentDesserts[board[drag.sourceIndex]! - 1].color}99)`
                : undefined,
          }}
        >
          <span className="dessert-emoji">
            {eventMode && eventBoard[drag.sourceIndex]
              ? DESSERTS[eventBoard[drag.sourceIndex]! - 1].emoji
              : board[drag.sourceIndex]
                ? currentDesserts[board[drag.sourceIndex]! - 1].emoji
                : null}
          </span>
          <span className="dessert-level">
            Lv.{eventMode ? eventBoard[drag.sourceIndex] : board[drag.sourceIndex]}
          </span>
        </div>
      )}

      <section className="hero">
        <p>{game.id} · H5Game · Port {game.port}</p>
        <h1>{currentConfig.icon} {currentConfig.name}</h1>
        <span>{currentConfig.description}</span>
        <button className="level-switch-btn" onClick={() => setShowLevelSelector(true)}>
          🗺️ 切换关卡
        </button>
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
                   index === 2 ? `${unlockedLevels.length}/${currentDesserts.length}` :
                   `${maxLevel}级 ${currentDesserts[Math.min(maxLevel - 1, currentDesserts.length - 1)]?.emoji}`}
                </strong>
              </article>
            ))}
            <article className="event-entry-article" onClick={() => setShowEventEntry(true)}>
              <small>🎯 限时活动</small>
              <strong className="event-entry-text">点击进入 →</strong>
            </article>
            <SimulationPanel currentMaxLevel={maxLevel} currentCoins={coins} currentLevelId={currentLevelId} />
            <article className="save-entry-article" onClick={() => setShowSavePanel(true)}>
              <small>💾 存档管理</small>
              <strong className="save-entry-text">
                {autoSaveActive ? `保存于${formatLastSaveTime()}` : "自动保存已暂停"}
              </strong>
            </article>
            <article className="timeline-entry-article" onClick={() => { setShowTimelinePanel(true); refreshTimeline(); }}>
              <small>📜 操作时间线</small>
              <strong className="timeline-entry-text">
                {timelineSummary ? `${timelineSummary.totalActions} 条记录` : "暂无记录"}
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
            const dessert = cell ? currentDesserts[cell - 1] : null;
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
              ✨ 可合成：{currentDesserts[mergeHint.level - 1].emoji} {currentDesserts[mergeHint.level - 1].name} × 2 → {currentDesserts[Math.min(mergeHint.level, currentDesserts.length)].emoji} {currentDesserts[Math.min(mergeHint.level, currentDesserts.length)].name}
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
                          const dessert = currentDesserts[level - 1];
                          const available = board.filter(c => c === level).length;
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
          <p>✨ <strong>合成规则：</strong>相同等级甜品合并升级，不同等级无法合成。每次生成消耗 {currentConfig.spawnCost} 金币，冷却 {currentConfig.spawnCooldownSeconds} 秒，产出 Lv.{currentConfig.spawnMinLevel}-{currentConfig.spawnMaxLevel} 甜品。</p>
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
                        const dessert = currentDesserts[level - 1];
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

          <div className="synthesis-plan-panel">
            <div className="synthesis-plan-header">
              <div className="synthesis-plan-title">
                <span className="synthesis-plan-title-icon">🧭</span>
                <span>合成规划</span>
              </div>
              <button
                className="synthesis-plan-refresh-btn"
                onClick={() => recalcSynthesisPlan(board, unlockedLevels, orders)}
              >
                🔄 刷新
              </button>
            </div>

            {synthesisPlan.nextTargetLevel !== null && synthesisPlan.nextTargetDessert !== null && (
              <div className="synthesis-plan-section">
                <div className="synthesis-plan-section-title">
                  <span>🎯</span>
                  <span>下一个解锁目标</span>
                </div>
                <div className={`synthesis-plan-target-card ${synthesisPlan.shortfallLv1Value === 0 ? "complete" : ""}`}>
                  <span className="synthesis-plan-target-dessert">
                    {synthesisPlan.nextTargetDessert.emoji}
                  </span>
                  <div className="synthesis-plan-target-name">
                    {synthesisPlan.nextTargetDessert.name}
                  </div>
                  <span className="synthesis-plan-target-level">
                    Lv.{synthesisPlan.nextTargetLevel}
                  </span>
                  <div className="synthesis-plan-progress-section">
                    <div className="synthesis-plan-progress-bar">
                      <div
                        className="synthesis-plan-progress-fill"
                        style={{
                          width: `${Math.min(100, synthesisPlan.targetLv1Value > 0
                            ? (synthesisPlan.totalLv1Value / synthesisPlan.targetLv1Value) * 100
                            : 0)}%`,
                        }}
                      />
                      <span className="synthesis-plan-progress-text">
                        {synthesisPlan.shortfallLv1Value === 0
                          ? "材料已就绪 ✓"
                          : `${Math.round((synthesisPlan.totalLv1Value / synthesisPlan.targetLv1Value) * 100)}%`}
                      </span>
                    </div>
                    <div className="synthesis-plan-shortfall-text">
                      {synthesisPlan.shortfallLv1Value === 0 ? (
                        <strong>可以直接合成解锁！</strong>
                      ) : (
                        <>
                          还需约 <strong>{synthesisPlan.shortfallLv1Value}</strong> 个 Lv.1 甜品
                          （或 <strong>{Math.ceil(synthesisPlan.shortfallLv1Value / 2)}</strong> 个 Lv.2 甜品）
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {synthesisPlan.isAllUnlocked && (
              <div className="synthesis-plan-section">
                <div className="synthesis-plan-empty">
                  🏆 恭喜！所有甜品已全部解锁！
                </div>
              </div>
            )}

            <div className="synthesis-plan-section">
              <div className="synthesis-plan-reachable">
                <div className="synthesis-plan-reachable-label">
                  <span>⭐</span>
                  <span>当前材料最高可合到</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span className="synthesis-plan-reachable-dessert">
                    {synthesisPlan.maxReachableLevel > 0 && synthesisPlan.maxReachableLevel <= currentDesserts.length
                      ? currentDesserts[synthesisPlan.maxReachableLevel - 1]?.emoji
                      : "❓"}
                  </span>
                  <span className="synthesis-plan-reachable-value">
                    Lv.{synthesisPlan.maxReachableLevel}
                  </span>
                </div>
              </div>
            </div>

            {synthesisPlan.boardCounts.length > 0 && (
              <div className="synthesis-plan-section">
                <div className="synthesis-plan-section-title">
                  <span>📊</span>
                  <span>棋盘材料分布</span>
                </div>
                <div className="synthesis-plan-level-list">
                  {synthesisPlan.boardCounts
                    .filter((c) => c.count > 0)
                    .sort((a, b) => b.level - a.level)
                    .map((levelCount) => {
                      const dessert = levelCount.dessert;
                      const effectiveEntry = synthesisPlan.effectiveCounts.find(
                        (e) => e.level === levelCount.level
                      );
                      const carriedUp = effectiveEntry?.carriedUp ?? 0;
                      const hasCarry = carriedUp > 0;
                      const isTargetLevel = synthesisPlan.nextTargetLevel !== null &&
                        levelCount.level === synthesisPlan.nextTargetLevel - 1;
                      return (
                        <div key={levelCount.level} className="synthesis-plan-level-row">
                          <span className="synthesis-plan-level-emoji">{dessert.emoji}</span>
                          <span className="synthesis-plan-level-name">
                            Lv.{levelCount.level} {dessert.name}
                          </span>
                          <span className="synthesis-plan-level-count">
                            ×{levelCount.count}
                          </span>
                          {hasCarry && (
                            <span className="synthesis-plan-carry-tag">
                              可合成 {carriedUp} 个 Lv.{levelCount.level + 1}
                            </span>
                          )}
                          {isTargetLevel && levelCount.count >= 2 && (
                            <span className="synthesis-plan-carry-tag" style={{ color: '#22c55e', background: 'rgba(34, 197, 94, 0.15)' }}>
                              可解锁 ✓
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="synthesis-plan-section">
              <div className="synthesis-plan-section-title">
                <span>✨</span>
                <span>优先合成建议</span>
              </div>
              {synthesisPlan.suggestions.length > 0 ? (
                <div className="synthesis-plan-suggestion-list">
                  {synthesisPlan.suggestions.slice(0, 4).map((suggestion, idx) => {
                    const dessert = suggestion.dessert;
                    const resultDessert = currentDesserts[suggestion.level];
                    const isHighPriority = idx === 0;
                    return (
                      <div
                        key={suggestion.level}
                        className={`synthesis-plan-suggestion-item ${isHighPriority ? "high" : ""}`}
                      >
                        <div className="synthesis-plan-suggestion-header">
                          <div className="synthesis-plan-suggestion-dessert">
                            <span className="synthesis-plan-suggestion-emoji">{dessert.emoji}</span>
                            <span className="synthesis-plan-suggestion-name">{dessert.name}</span>
                          </div>
                          <span className="synthesis-plan-suggestion-pairs">
                            {suggestion.pairs} 对可合
                          </span>
                        </div>
                        <div className="synthesis-plan-suggestion-reason">
                          合成 →
                          <span className="synthesis-plan-suggestion-arrow"> </span>
                          <span className="synthesis-plan-suggestion-result">
                            {resultDessert?.emoji ?? "✨"} {resultDessert?.name ?? "更高级甜品"}
                          </span>
                          <br />
                          <span style={{ color: "#94a3b8" }}>{suggestion.reason}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="synthesis-plan-empty">
                  棋盘上暂无可以合成的甜品
                </div>
              )}
            </div>
          </div>

          <div className="collection-panel">
            <div className="collection-header">
              <h3>📖 甜品图鉴</h3>
              <span className="collection-progress">
                {unlockedLevels.length}/{currentDesserts.length}
              </span>
            </div>
            {(() => {
              const nextHint = getNextUnlockHint(unlockedLevels, board, currentConfig);
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
              if (unlockedLevels.length >= currentDesserts.length) {
                return (
                  <div className="next-unlock-hint-card next-unlock-complete">
                    <span>🏆 恭喜！图鉴已全部收集！</span>
                  </div>
                );
              }
              return null;
            })()}
            <div className="collection-grid">
              {currentDesserts.map((dessert) => {
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
                          const prevDessert = dessert.level > 1 ? currentDesserts[dessert.level - 2] : null;
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
                const totalMs = currentConfig.spawnCooldownSeconds * 1000;
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
                            <div className="spawn-queue-level">Lv.{currentConfig.spawnMinLevel} - Lv.{currentConfig.spawnMaxLevel}</div>
                            <div className="spawn-queue-desc">
                              {isReady && `点击生成 · 消耗 ${currentConfig.spawnCost}💰`}
                              {isCooldown && `下一个生成 · 还需 ${spawnCooldown}s`}
                              {isNoCoins && `需要 ${currentConfig.spawnCost}💰 · 当前 ${coins}💰`}
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
                        {isReady && `消耗 ${currentConfig.spawnCost} 金币 · Lv.${currentConfig.spawnMinLevel}-${currentConfig.spawnMaxLevel}`}
                        {isCooldown && "冷却完成后自动解锁"}
                        {isNoCoins && `需要 ${currentConfig.spawnCost} 金币 · 当前 ${coins} 金币`}
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
          🎮 <strong>新手指引（必看）：</strong>开局免费送 {currentConfig.initialCoins} 金币和 {currentConfig.initialSpawnCount} 个{currentDesserts[0]?.name}！先<strong>拖拽两个相同等级的甜品叠在一起</strong>合成更高级甜品，每次合成立即获得金币。有了金币就可以继续生成甜品啦~<br />
          🍰 <strong>生成甜品：</strong>点击"生成甜品"按钮或棋盘空格，消耗 {currentConfig.spawnCost} 金币，冷却 {currentConfig.spawnCooldownSeconds} 秒，产出 Lv.{currentConfig.spawnMinLevel}-{currentConfig.spawnMaxLevel} 的低等级甜品。<br />
          ⭐ <strong>合成奖励：</strong>两个 Lv.N 甜品合成一个 Lv.N+1 甜品，获得 (N+1)×{currentConfig.mergeRewardCoefficient} 金币。等级越高奖励越丰厚！<br />
          📋 <strong>订单系统：</strong>完成订单栏中的订单可获得额外金币奖励。提交棋盘中对应数量的甜品即可完成订单，完成后会自动刷新新订单。<br />
          🧹 <strong>自动整理：</strong>棋盘满或杂乱时，点击"自动整理"将相同等级甜品聚拢，方便拖拽合成。<br />
          💾 <strong>存档机制：</strong>所有游戏数据自动保存到浏览器本地，刷新页面后进度不会丢失。<br />
          🎯 <strong>终极目标：</strong>尽可能合成更高级的甜品，完成订单获得额外奖励，收集全部 {currentDesserts.length} 种甜品图鉴！
        </p>
      </section>
    </main>
  );
}

export default App;
