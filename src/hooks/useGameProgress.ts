import React, { useState, useEffect, useCallback, useRef } from "react";
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
  SaveFileTimelineData,
  LevelSaveData,
  MultiLevelSaveData,
  createEmptyLevelSave,
  createInitialMultiLevelData,
  migrateLegacySaveToMultiLevel,
} from "../saveManager";
import {
  loadTimelineFromSaveData,
  getSaveFileTimelineData,
  setTimelineLevelId,
  getTimelineRecords,
  getTimelineSummary,
  resetTimeline,
  recordImportSave,
  recordReset,
} from "../timelineManager";
import {
  getLevelConfig,
  LEVEL_CONFIGS,
  CURRENT_LEVEL_KEY,
  LEVEL_SAVE_KEY,
  STORAGE_KEY,
  OFFLINE_DATA_KEY,
  calculateBaseEarningsRate,
  calculateSynthesisPlan,
  SynthesisPlan,
  LevelConfig,
  calculateMergeReward,
  DESSERTS,
} from "../gameConfig";
import {
  GameState,
  Order,
  RecentlyUnlocked,
  findNextMergeHint,
  createInitialBoard,
  generateOrders,
} from "../gameBoardUtils";

const RECENTLY_UNLOCKED_KEY = "hxywl-61902-recently-unlocked";

interface OfflineData {
  lastLeaveTime: number;
  lastClaimTime: number;
  maxLevelAtLeave: number;
  baseEarningsRate: number;
}

export interface OfflineReward {
  coins: number;
  offlineMinutes: number;
  maxLevel: number;
  isValid: boolean;
  reason?: "first" | "rollback" | "too_short" | "already_claimed";
  earningsPerMinute: number;
  capMinutes: number;
  actualOfflineMinutes: number;
}

function loadCurrentLevelId(): string {
  try {
    const saved = localStorage.getItem(CURRENT_LEVEL_KEY);
    if (saved && LEVEL_CONFIGS[saved]) return saved;
  } catch (e) {}
  return "classic";
}

function saveCurrentLevelId(levelId: string): void {
  try {
    localStorage.setItem(CURRENT_LEVEL_KEY, levelId);
  } catch (e) {}
}

export function loadMultiLevelSaves(): MultiLevelSaveData {
  try {
    const saved = localStorage.getItem(LEVEL_SAVE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        parsed &&
        parsed.levels &&
        typeof parsed.currentLevel === "string"
      ) {
        for (const levelId of Object.keys(LEVEL_CONFIGS)) {
          if (!parsed.levels[levelId]) {
            parsed.levels[levelId] = createEmptyLevelSave(levelId);
          }
        }
        return parsed as MultiLevelSaveData;
      }
    }
  } catch (e) {
    console.error("Failed to load multi-level saves:", e);
  }
  try {
    const legacySaved = localStorage.getItem(STORAGE_KEY);
    if (legacySaved) {
      const parsed = JSON.parse(legacySaved);
      let gameData: SaveFileGameData;
      if (parsed.data && typeof parsed.data === "object") {
        gameData = parsed.data as SaveFileGameData;
      } else {
        gameData = {
          board:
            parsed.board ||
            Array(LEVEL_CONFIGS.classic.boardSize).fill(null),
          coins:
            typeof parsed.coins === "number"
              ? parsed.coins
              : LEVEL_CONFIGS.classic.initialCoins,
          maxLevel: parsed.maxLevel || 1,
          unlockedLevels: parsed.unlockedLevels || [1],
          unlockTimes: parsed.unlockTimes || {
            1: new Date().toISOString(),
          },
          orders: parsed.orders || [],
          spawnCooldownEnd: parsed.spawnCooldownEnd || 0,
        };
      }
      const multiData = migrateLegacySaveToMultiLevel(gameData);
      saveMultiLevelSaves(multiData);
      return multiData;
    }
  } catch (e) {
    console.error("Failed to migrate legacy save:", e);
  }
  return createInitialMultiLevelData();
}

export function saveMultiLevelSaves(data: MultiLevelSaveData): void {
  try {
    localStorage.setItem(LEVEL_SAVE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error("Failed to save multi-level data:", e);
  }
}

function createFallbackGameData(config?: LevelConfig): SaveFileGameData {
  const c = config || LEVEL_CONFIGS.classic;
  return {
    board: createInitialBoard(c),
    coins: c.initialCoins,
    maxLevel: 1,
    unlockedLevels: [1],
    unlockTimes: { 1: new Date().toISOString() },
    orders: [],
    spawnCooldownEnd: 0,
  };
}

export interface LoadGameResult {
  state: GameState;
  orders: Order[];
  loadedFromSave: boolean;
  spawnCooldownEnd: number;
  timelineData: SaveFileTimelineData | null;
}

function loadGameState(levelId: string): LoadGameResult {
  const config = getLevelConfig(levelId);
  const fallback = createFallbackGameData(config);
  const multiData = loadMultiLevelSaves();
  const levelSave = multiData.levels[levelId];
  if (levelSave) {
    const boardSize = config.boardSize;
    let loadedBoard = levelSave.board;
    if (loadedBoard.length !== boardSize) {
      const newBoard: (number | null)[] = Array(boardSize).fill(null);
      for (
        let i = 0;
        i < Math.min(loadedBoard.length, boardSize);
        i++
      ) {
        newBoard[i] = loadedBoard[i];
      }
      loadedBoard = newBoard;
    }
    const hasExistingBoard = loadedBoard.some(
      (cell) => cell !== null
    );
    const loadedCoins = levelSave.coins;
    const isNewGame = !hasExistingBoard && loadedCoins <= 0;
    const finalOrders =
      levelSave.orders && levelSave.orders.length > 0
        ? (levelSave.orders as Order[])
        : generateOrders(levelSave.unlockedLevels, config);
    return {
      state: {
        board: isNewGame ? createInitialBoard(config) : loadedBoard,
        coins: isNewGame ? config.initialCoins : Math.max(loadedCoins, 0),
        maxLevel: levelSave.maxLevel,
        unlockedLevels: levelSave.unlockedLevels,
        unlockTimes: levelSave.unlockTimes,
      },
      orders: finalOrders,
      loadedFromSave: true,
      spawnCooldownEnd: levelSave.spawnCooldownEnd ?? 0,
      timelineData: multiData.globalTimeline || null,
    };
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);

      let gameData: SaveFileGameData;
      if (parsed.data && typeof parsed.data === "object") {
        gameData = parsed.data as SaveFileGameData;
      } else {
        gameData = {
          board: parsed.board || Array(config.boardSize).fill(null),
          coins: typeof parsed.coins === "number" ? parsed.coins : -1,
          maxLevel: parsed.maxLevel || 1,
          unlockedLevels: parsed.unlockedLevels || [1],
          unlockTimes: parsed.unlockTimes || {
            1: new Date().toISOString(),
          },
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
        const hasExistingBoard = loadedBoard.some(
          (cell) => cell !== null
        );
        const loadedCoins = sanitized.coins;
        const isNewGame = !hasExistingBoard && loadedCoins <= 0;

        const finalOrders =
          sanitized.orders && sanitized.orders.length > 0
            ? (sanitized.orders as Order[])
            : generateOrders(sanitized.unlockedLevels, config);

        return {
          state: {
            board: isNewGame ? createInitialBoard(config) : loadedBoard,
            coins: isNewGame
              ? config.initialCoins
              : Math.max(loadedCoins, 0),
            maxLevel: sanitized.maxLevel,
            unlockedLevels: sanitized.unlockedLevels,
            unlockTimes: sanitized.unlockTimes,
          },
          orders: finalOrders,
          loadedFromSave: true,
          spawnCooldownEnd: sanitized.spawnCooldownEnd ?? 0,
          timelineData: sanitized.timeline || null,
        };
      } else {
        console.warn(
          "存档校验存在问题:",
          validateResult.errors,
          validateResult.warnings
        );
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
            orders:
              (sanitized.orders as Order[]) &&
              sanitized.orders.length > 0
                ? (sanitized.orders as Order[])
                : generateOrders(sanitized.unlockedLevels, config),
            loadedFromSave: true,
            spawnCooldownEnd: sanitized.spawnCooldownEnd ?? 0,
            timelineData: sanitized.timeline || null,
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
      board: createInitialBoard(config),
      coins: config.initialCoins,
      maxLevel: 1,
      unlockedLevels: [1],
      unlockTimes: { 1: new Date().toISOString() },
    },
    orders: generateOrders([1], config),
    loadedFromSave: false,
    spawnCooldownEnd: 0,
    timelineData: null,
  };
}

function saveGameState(
  state: GameState,
  orders: Order[],
  spawnCooldownEnd: number,
  levelId: string = "classic"
): void {
  try {
    const timelineData = getSaveFileTimelineData();
    const gameData: SaveFileGameData = {
      board: state.board,
      coins: state.coins,
      maxLevel: state.maxLevel,
      unlockedLevels: state.unlockedLevels,
      unlockTimes: state.unlockTimes,
      orders: orders.map((o) => ({
        id: o.id,
        reward: o.reward,
        completed: o.completed,
        items: o.items.map((it) => ({ ...it })),
      })),
      spawnCooldownEnd: spawnCooldownEnd || 0,
      timeline: timelineData || undefined,
    };
    const saveFile = createSaveFile(gameData, false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saveFile));

    const multiData = loadMultiLevelSaves();
    const config = getLevelConfig(levelId);
    multiData.currentLevel = levelId;
    multiData.levels[levelId] = {
      coins: state.coins,
      board: state.board,
      maxLevel: state.maxLevel,
      unlockedLevels: state.unlockedLevels,
      unlockTimes: state.unlockTimes,
      orders: orders.map((o) => ({
        id: o.id,
        reward: o.reward,
        completed: o.completed,
        items: o.items.map((it) => ({ ...it })),
      })),
      spawnCooldownEnd: spawnCooldownEnd || 0,
      offlineLastLeaveTime:
        multiData.levels[levelId]?.offlineLastLeaveTime || 0,
      offlineLastClaimTime:
        multiData.levels[levelId]?.offlineLastClaimTime || 0,
    };
    multiData.globalTimeline = timelineData || null;
    saveMultiLevelSaves(multiData);
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
        baseEarningsRate:
          parsed.baseEarningsRate ||
          LEVEL_CONFIGS.classic.baseEarningsPerMinute,
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

export function loadRecentlyUnlocked(): RecentlyUnlocked | null {
  try {
    const saved = localStorage.getItem(RECENTLY_UNLOCKED_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        parsed &&
        typeof parsed.level === "number" &&
        typeof parsed.timestamp === "string"
      ) {
        return parsed as RecentlyUnlocked;
      }
    }
  } catch (e) {
    console.error("Failed to load recently unlocked:", e);
  }
  return null;
}

export function saveRecentlyUnlocked(data: RecentlyUnlocked | null): void {
  try {
    if (data) {
      localStorage.setItem(
        RECENTLY_UNLOCKED_KEY,
        JSON.stringify(data)
      );
    } else {
      localStorage.removeItem(RECENTLY_UNLOCKED_KEY);
    }
  } catch (e) {
    console.error("Failed to save recently unlocked:", e);
  }
}

export interface UseGameProgressResult {
  currentLevelId: string;
  currentConfig: LevelConfig;
  setCurrentLevelId: React.Dispatch<React.SetStateAction<string>>;

  board: (number | null)[];
  setBoard: React.Dispatch<React.SetStateAction<(number | null)[]>>;
  coins: number;
  setCoins: React.Dispatch<React.SetStateAction<number>>;
  maxLevel: number;
  setMaxLevel: React.Dispatch<React.SetStateAction<number>>;
  unlockedLevels: number[];
  setUnlockedLevels: React.Dispatch<React.SetStateAction<number[]>>;
  unlockTimes: { [key: number]: string };
  setUnlockTimes: React.Dispatch<
    React.SetStateAction<{ [key: number]: string }>
  >;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  spawnCooldownEnd: number;
  setSpawnCooldownEnd: React.Dispatch<React.SetStateAction<number>>;
  spawnCooldown: number;
  setSpawnCooldown: React.Dispatch<React.SetStateAction<number>>;

  boardRef: React.MutableRefObject<(number | null)[]>;
  coinsRef: React.MutableRefObject<number>;
  maxLevelRef: React.MutableRefObject<number>;
  unlockedLevelsRef: React.MutableRefObject<number[]>;
  unlockTimesRef: React.MutableRefObject<{ [key: number]: string }>;
  ordersRef: React.MutableRefObject<Order[]>;
  spawnCooldownEndRef: React.MutableRefObject<number>;
  spawnCooldownRef: React.MutableRefObject<number>;

  mergeHint: { sourceIndex: number; targetIndex: number; level: number } | null;
  setMergeHint: React.Dispatch<
    React.SetStateAction<
      { sourceIndex: number; targetIndex: number; level: number } | null
    >
  >;
  mergeHintRef: React.MutableRefObject<
    { sourceIndex: number; targetIndex: number; level: number } | null
  >;
  showMergeHint: boolean;
  setShowMergeHint: React.Dispatch<React.SetStateAction<boolean>>;
  showMergeHintRef: React.MutableRefObject<boolean>;

  synthesisPlan: SynthesisPlan;
  setSynthesisPlan: React.Dispatch<React.SetStateAction<SynthesisPlan>>;
  synthesisPlanRef: React.MutableRefObject<SynthesisPlan>;
  showSynthesisPlan: boolean;
  setShowSynthesisPlan: React.Dispatch<React.SetStateAction<boolean>>;

  recentlyUnlocked: RecentlyUnlocked | null;
  setRecentlyUnlocked: React.Dispatch<
    React.SetStateAction<RecentlyUnlocked | null>
  >;

  lastSaveTime: number;
  setLastSaveTime: React.Dispatch<React.SetStateAction<number>>;
  autoSaveActive: boolean;
  setAutoSaveActive: React.Dispatch<React.SetStateAction<boolean>>;

  switchLevel: (newLevelId: string) => void;
  recalcMergeHint: (newBoard: (number | null)[]) => void;
  recalcSynthesisPlan: (
    newBoard: (number | null)[],
    newUnlockedLevels: number[],
    newOrders: Order[]
  ) => void;
  dismissUnlockCelebration: () => void;
  doManualSave: () => void;
  formatLastSaveTime: () => string;
  handleExportSave: (showToast?: (msg: string) => void) => void;
  applyImportedSave: (
    save: SaveFile,
    validation: ValidateResult,
    showToast: (msg: string) => void,
    refreshTimeline: () => void
  ) => void;
  handleImportFileSelect: (
    e: React.ChangeEvent<HTMLInputElement>,
    showToast: (msg: string) => void,
    refreshTimeline: () => void,
    setShowImportResult: (
      result: {
        type: "success" | "error" | "warning";
        title: string;
        message: string;
        details: string[];
      } | null
    ) => void,
    setShowImportModal: (show: boolean) => void,
    fileInputRef: React.MutableRefObject<HTMLInputElement | null>
  ) => Promise<void>;
  handleResetProgress: (
    showToast: (msg: string) => void,
    refreshTimeline: () => void,
    setShowTutorial: (show: boolean) => void,
    setTutorial: React.Dispatch<React.SetStateAction<any>>,
    setShowResetConfirm: (show: boolean) => void,
    setShowSavePanel: (show: boolean) => void
  ) => void;

  hasUnclaimedReward: () => boolean;
  calculateOfflineReward: () => OfflineReward;
  recordLeaveTime: () => void;
  markAsClaimed: () => void;
}

export function useGameProgress(): UseGameProgressResult {
  const initialLevelId = loadCurrentLevelId();

  const [currentLevelId, setCurrentLevelId] = useState<string>(initialLevelId);
  const currentConfig = getLevelConfig(currentLevelId);

  const [initialLoaded] = useState(() => {
    setTimelineLevelId(initialLevelId);
    return loadGameState(initialLevelId);
  });
  const initialState = initialLoaded.state;

  useEffect(() => {
    loadTimelineFromSaveData(initialLoaded.timelineData);
  }, [initialLoaded.timelineData]);

  const [board, setBoard] = useState<(number | null)[]>(initialState.board);
  const [coins, setCoins] = useState<number>(initialState.coins);
  const [maxLevel, setMaxLevel] = useState<number>(initialState.maxLevel);
  const [unlockedLevels, setUnlockedLevels] = useState<number[]>(
    initialState.unlockedLevels
  );
  const [unlockTimes, setUnlockTimes] = useState<{ [key: number]: string }>(
    initialState.unlockTimes
  );
  const [orders, setOrders] = useState<Order[]>(initialLoaded.orders);
  const initialCooldownEnd = initialLoaded.spawnCooldownEnd;
  const initialRemainingMs = Math.max(0, initialCooldownEnd - Date.now());
  const initialRemainingSeconds = Math.ceil(initialRemainingMs / 1000);
  const [spawnCooldownEnd, setSpawnCooldownEnd] =
    useState<number>(initialCooldownEnd);
  const [spawnCooldown, setSpawnCooldown] = useState<number>(
    initialRemainingSeconds
  );
  const spawnCooldownEndRef = useRef<number>(initialCooldownEnd);
  const spawnCooldownRef = useRef<number>(initialRemainingSeconds);

  const [mergeHint, setMergeHint] = useState<{
    sourceIndex: number;
    targetIndex: number;
    level: number;
  } | null>(findNextMergeHint(initialState.board));
  const mergeHintRef = useRef<{
    sourceIndex: number;
    targetIndex: number;
    level: number;
  } | null>(mergeHint);

  const [showMergeHint, setShowMergeHint] = useState<boolean>(true);
  const showMergeHintRef = useRef<boolean>(true);

  const initialSynthesisPlan = calculateSynthesisPlan(
    initialState.board,
    initialState.unlockedLevels,
    []
  );
  const [synthesisPlan, setSynthesisPlan] =
    useState<SynthesisPlan>(initialSynthesisPlan);
  const synthesisPlanRef = useRef<SynthesisPlan>(initialSynthesisPlan);
  synthesisPlanRef.current = synthesisPlan;

  const [showSynthesisPlan, setShowSynthesisPlan] = useState<boolean>(true);

  const [recentlyUnlocked, setRecentlyUnlocked] = useState<
    RecentlyUnlocked | null
  >(loadRecentlyUnlocked());

  const [lastSaveTime, setLastSaveTime] = useState<number>(Date.now());
  const [autoSaveActive, setAutoSaveActive] = useState<boolean>(true);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const boardRef = useRef<(number | null)[]>(board);
  const coinsRef = useRef<number>(coins);
  const maxLevelRef = useRef<number>(maxLevel);
  const unlockedLevelsRef = useRef<number[]>(unlockedLevels);
  const unlockTimesRef = useRef<{ [key: number]: string }>(unlockTimes);
  const ordersRef = useRef<Order[]>(orders);

  boardRef.current = board;
  coinsRef.current = coins;
  maxLevelRef.current = maxLevel;
  unlockedLevelsRef.current = unlockedLevels;
  unlockTimesRef.current = unlockTimes;
  ordersRef.current = orders;
  spawnCooldownRef.current = spawnCooldown;
  spawnCooldownEndRef.current = spawnCooldownEnd;
  mergeHintRef.current = mergeHint;
  showMergeHintRef.current = showMergeHint;

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
      spawnCooldownEndRef.current,
      currentLevelId
    );
    setLastSaveTime(Date.now());
  }, [currentLevelId]);

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
      spawnCooldownEnd,
      currentLevelId
    );
    setLastSaveTime(Date.now());
  }, [
    board,
    coins,
    maxLevel,
    unlockedLevels,
    unlockTimes,
    orders,
    spawnCooldownEnd,
    currentLevelId,
  ]);

  const recalcMergeHint = useCallback(
    (newBoard: (number | null)[]): void => {
      const hint = findNextMergeHint(newBoard, currentConfig);
      setMergeHint(hint);
    },
    [currentConfig]
  );

  const recalcSynthesisPlan = useCallback(
    (
      newBoard: (number | null)[],
      newUnlockedLevels: number[],
      newOrders: Order[]
    ): void => {
      const plan = calculateSynthesisPlan(
        newBoard,
        newUnlockedLevels,
        newOrders,
        currentConfig
      );
      setSynthesisPlan(plan);
    },
    [currentConfig]
  );

  useEffect(() => {
    recalcMergeHint(board);
  }, [board, recalcMergeHint]);

  useEffect(() => {
    recalcSynthesisPlan(board, unlockedLevels, orders);
  }, [board, orders, unlockedLevels, recalcSynthesisPlan]);

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

  const switchLevel = useCallback(
    (newLevelId: string, showToast?: (msg: string) => void): void => {
      if (newLevelId === currentLevelId) {
        return;
      }
      saveGameState(
        {
          board: boardRef.current,
          coins: coinsRef.current,
          maxLevel: maxLevelRef.current,
          unlockedLevels: unlockedLevelsRef.current,
          unlockTimes: unlockTimesRef.current,
        },
        ordersRef.current,
        spawnCooldownEndRef.current,
        currentLevelId
      );
      saveCurrentLevelId(newLevelId);
      setTimelineLevelId(newLevelId);
      setCurrentLevelId(newLevelId);
      const newConfig = getLevelConfig(newLevelId);
      const newLoaded = loadGameState(newLevelId);

      const newCooldownEnd = newLoaded.spawnCooldownEnd;
      const now = Date.now();
      const newRemainingMs = Math.max(0, newCooldownEnd - now);
      const newRemainingSeconds = Math.ceil(newRemainingMs / 1000);

      setBoard(newLoaded.state.board);
      setCoins(newLoaded.state.coins);
      setMaxLevel(newLoaded.state.maxLevel);
      setUnlockedLevels(newLoaded.state.unlockedLevels);
      setUnlockTimes(newLoaded.state.unlockTimes);
      setOrders(
        newLoaded.orders.length > 0
          ? newLoaded.orders
          : generateOrders([1], newConfig)
      );
      setSpawnCooldownEnd(newCooldownEnd);
      setSpawnCooldown(newRemainingSeconds);
      spawnCooldownEndRef.current = newCooldownEnd;
      spawnCooldownRef.current = newRemainingSeconds;

      const hint = findNextMergeHint(newLoaded.state.board, newConfig);
      setMergeHint(hint);
      const plan = calculateSynthesisPlan(
        newLoaded.state.board,
        newLoaded.state.unlockedLevels,
        newLoaded.orders,
        newConfig
      );
      setSynthesisPlan(plan);
      if (showToast) {
        showToast(`🔀 已切换到 ${newConfig.name}`);
      }
    },
    [currentLevelId]
  );

  const dismissUnlockCelebration = useCallback((): void => {
    const updated = recentlyUnlocked
      ? { ...recentlyUnlocked, seen: true }
      : null;
    saveRecentlyUnlocked(updated);
    setRecentlyUnlocked(updated);
  }, [recentlyUnlocked]);

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

  const handleExportSave = useCallback(
    (showToast?: (msg: string) => void): void => {
      try {
        const timelineData = getSaveFileTimelineData();
        const gameData: SaveFileGameData = {
          board: boardRef.current,
          coins: coinsRef.current,
          maxLevel: maxLevelRef.current,
          unlockedLevels: unlockedLevelsRef.current,
          unlockTimes: unlockTimesRef.current,
          orders: ordersRef.current.map((o) => ({
            id: o.id,
            reward: o.reward,
            completed: o.completed,
            items: o.items.map((it) => ({ ...it })),
          })),
          spawnCooldownEnd: spawnCooldownEndRef.current || 0,
          timeline: timelineData || undefined,
        };
        const saveFile = createSaveFile(gameData, true);
        downloadSaveFile(saveFile);
        if (showToast) {
          showToast("💾 存档已导出到本地文件");
        }
      } catch (e) {
        console.error("导出存档失败:", e);
        if (showToast) {
          showToast("❌ 导出存档失败，请重试");
        }
      }
    },
    []
  );

  const applyImportedSave = useCallback(
    (
      save: SaveFile,
      validation: ValidateResult,
      showToast: (msg: string) => void,
      refreshTimeline: () => void
    ): void => {
      try {
        const fallback: SaveFileGameData = {
          board: boardRef.current,
          coins: coinsRef.current,
          maxLevel: maxLevelRef.current,
          unlockedLevels: unlockedLevelsRef.current,
          unlockTimes: unlockTimesRef.current,
          orders: ordersRef.current,
          spawnCooldownEnd: spawnCooldownEndRef.current || 0,
        };

        const sanitized = sanitizeSaveData(save.data, fallback);
        const newOrders: Order[] =
          sanitized.orders.length > 0
            ? (sanitized.orders as Order[])
            : generateOrders(sanitized.unlockedLevels);

        const importedCooldownEnd = sanitized.spawnCooldownEnd ?? 0;
        const now = Date.now();
        const remainingMs = Math.max(0, importedCooldownEnd - now);
        const remainingSeconds = Math.ceil(remainingMs / 1000);

        loadTimelineFromSaveData(sanitized.timeline || null);

        setBoard(sanitized.board);
        setCoins(Math.max(sanitized.coins, 0));
        setMaxLevel(sanitized.maxLevel);
        setUnlockedLevels(sanitized.unlockedLevels);
        setUnlockTimes(sanitized.unlockTimes);
        setOrders(newOrders);
        setSpawnCooldownEnd(importedCooldownEnd);
        setSpawnCooldown(remainingSeconds);
        spawnCooldownEndRef.current = importedCooldownEnd;
        spawnCooldownRef.current = remainingSeconds;

        recordImportSave(
          save.version,
          save.timestamp,
          sanitized.coins,
          sanitized.maxLevel
        );
        refreshTimeline();

        doManualSave();

        const saveDate = new Date(save.timestamp).toLocaleString("zh-CN");
        if (validation.warnings.length > 0) {
          if (showToast) {
            showToast(
              `⚠️ 导入成功（存在警告）。保存时间：${saveDate}`
            );
          }
        } else {
          if (showToast) {
            showToast(
              `✅ 存档导入成功！进度已恢复到 ${saveDate}`
            );
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (showToast) {
          showToast(`❌ 应用存档失败: ${msg}`);
        }
      }
    },
    [doManualSave]
  );

  const handleImportFileSelect = useCallback(
    async (
      e: React.ChangeEvent<HTMLInputElement>,
      showToast: (msg: string) => void,
      refreshTimeline: () => void,
      setShowImportResult: (
        result: {
          type: "success" | "error" | "warning";
          title: string;
          message: string;
          details: string[];
        } | null
      ) => void,
      setShowImportModal: (show: boolean) => void,
      fileInputRef: React.MutableRefObject<HTMLInputElement | null>
    ): Promise<void> => {
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
            message:
              parseResult.error || "文件内容无法解析为有效的 JSON",
            details: [],
          });
          return;
        }

        const save = parseResult.save;
        const validation = validateSaveFile(save);

        if (validation.isValid) {
          applyImportedSave(save, validation, showToast, refreshTimeline);
          const saveDate = new Date(save.timestamp).toLocaleString(
            "zh-CN"
          );
          if (validation.warnings.length > 0) {
            setShowImportResult({
              type: "warning",
              title: "导入成功（存在警告）",
              message: `存档已恢复。保存时间：${saveDate}\n但检测到 ${validation.warnings.length} 个非关键问题：`,
              details: validation.warnings,
            });
          } else {
            const desserts = currentConfig.desserts;
            setShowImportResult({
              type: "success",
              title: "存档导入成功！",
              message: `进度已成功恢复到 ${saveDate}。\n金币：${save.data.coins}，最高等级：Lv.${save.data.maxLevel}，图鉴：${save.data.unlockedLevels.length}/${desserts.length}`,
              details: [],
            });
          }
        } else if (validation.errors.length > 0) {
          setShowImportResult({
            type: "error",
            title: "存档校验失败",
            message: `检测到 ${validation.errors.length} 个错误，无法导入此存档。`,
            details: validation.errors,
          });
        } else {
          applyImportedSave(save, validation, showToast, refreshTimeline);
          const saveDate = new Date(save.timestamp).toLocaleString(
            "zh-CN"
          );
          setShowImportResult({
            type: "warning",
            title: "导入成功（存在警告）",
            message: `存档已恢复。保存时间：${saveDate}\n但检测到 ${validation.warnings.length} 个非关键问题：`,
            details: validation.warnings,
          });
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
      setShowImportModal(false);
    },
    [applyImportedSave, currentConfig]
  );

  const handleResetProgress = useCallback(
    (
      showToast: (msg: string) => void,
      refreshTimeline: () => void,
      setShowTutorial: (show: boolean) => void,
      setTutorial: React.Dispatch<React.SetStateAction<any>>,
      setShowResetConfirm: (show: boolean) => void,
      setShowSavePanel: (show: boolean) => void
    ): void => {
      try {
        resetTimeline();
        recordReset("user_initiated");
        refreshTimeline();

        const TUTORIAL_KEY = "hxywl-61902-tutorial";
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(OFFLINE_DATA_KEY);
        localStorage.removeItem(TUTORIAL_KEY);
        localStorage.removeItem(RECENTLY_UNLOCKED_KEY);

        const newBoard = createInitialBoard(currentConfig);
        const newUnlockedLevels = [1];
        const newUnlockTimes = { 1: new Date().toISOString() };

        setBoard(newBoard);
        setCoins(currentConfig.initialCoins);
        setMaxLevel(1);
        setUnlockedLevels(newUnlockedLevels);
        setUnlockTimes(newUnlockTimes);
        setOrders(generateOrders(newUnlockedLevels, currentConfig));
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

        const multiData = loadMultiLevelSaves();
        multiData.levels[currentLevelId] = createEmptyLevelSave(
          currentLevelId
        );
        saveMultiLevelSaves(multiData);

        showToast("🔄 进度已重置，开始新游戏！");
      } catch (e) {
        console.error("重置进度失败:", e);
        showToast("❌ 重置进度失败，请重试");
      }
      setShowResetConfirm(false);
      setShowSavePanel(false);
    },
    [currentConfig, currentLevelId]
  );

  const hasUnclaimedReward = useCallback((): boolean => {
    const offlineData = loadOfflineData();
    if (!offlineData || offlineData.lastLeaveTime === 0) return false;
    return offlineData.lastClaimTime < offlineData.lastLeaveTime;
  }, []);

  const calculateOfflineReward = useCallback((): OfflineReward => {
    const offlineData = loadOfflineData();
    const now = Date.now();
    const config = currentConfig;
    const maxOfflineMinutes = config.maxOfflineHours * 60;
    const fallbackMaxLevel = offlineData?.maxLevelAtLeave || 1;
    const fallbackRate = calculateBaseEarningsRate(
      fallbackMaxLevel,
      config
    );

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
    const coins = Math.floor(
      cappedMinutes * offlineData.baseEarningsRate
    );

    return {
      coins,
      offlineMinutes: cappedMinutes,
      maxLevel: offlineData.maxLevelAtLeave,
      isValid: true,
      earningsPerMinute: offlineData.baseEarningsRate,
      capMinutes: maxOfflineMinutes,
      actualOfflineMinutes: actualMinutes,
    };
  }, [currentConfig]);

  const recordLeaveTime = useCallback((): void => {
    const existing = loadOfflineData();
    const config = currentConfig;
    const offlineData: OfflineData = {
      lastLeaveTime: Date.now(),
      lastClaimTime: existing?.lastClaimTime || 0,
      maxLevelAtLeave: maxLevelRef.current,
      baseEarningsRate: calculateBaseEarningsRate(
        maxLevelRef.current,
        config
      ),
    };
    saveOfflineData(offlineData);
  }, [currentConfig]);

  const markAsClaimed = useCallback((): void => {
    const offlineData = loadOfflineData();
    if (offlineData) {
      offlineData.lastClaimTime = Date.now();
      saveOfflineData(offlineData);
    }
  }, []);

  return {
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

    switchLevel,
    recalcMergeHint,
    recalcSynthesisPlan,
    dismissUnlockCelebration,
    doManualSave,
    formatLastSaveTime,
    handleExportSave,
    applyImportedSave,
    handleImportFileSelect,
    handleResetProgress,

    hasUnclaimedReward,
    calculateOfflineReward,
    recordLeaveTime,
    markAsClaimed,
  };
}
