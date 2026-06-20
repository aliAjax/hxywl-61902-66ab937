import {
  DESSERTS,
  MAX_DESSERT_LEVEL,
  BOARD_SIZE,
  INITIAL_COINS,
  SPAWN_COST,
  SPAWN_COOLDOWN_SECONDS,
  SPAWN_MIN_LEVEL,
  SPAWN_MAX_LEVEL,
  MAX_ORDERS,
  MAX_OFFLINE_HOURS,
  calculateMergeReward,
  calculateOfflineEarnings,
  calculateBaseEarningsRate,
  calculateOrderReward,
  getMergeCostToLevel,
  generateSimOrders,
  generateEventSimOrders,
  calculateEventResult,
  EVENT_MAX_STEPS,
  EVENT_INITIAL_COINS,
  EVENT_SPAWN_COST,
  calculateEventOrderReward,
  SimOrder,
  SimOrderItem,
  EventSimOrder,
  LevelConfig,
  getLevelConfig,
  LEVEL_CONFIGS,
} from "./gameConfig";

export interface SimulationParams {
  levelId: string;
  startLevel: number;
  targetLevel: number;
  startCoins: number;
  spawnsPerMinute: number;
  mergeEfficiency: number;
  ordersCompletedPerHour: number;
  dailyPlayHours: number;
  offlineHoursPerDay: number;
  offlineEarningRateMultiplier: number;
  eventFrequencyPerWeek: number;
  eventParticipationRate: number;
  eventSkillLevel: number;
  eventShardCoinValue: number;
  randomSeed?: number;
}

export interface LevelProgress {
  level: number;
  timeToReachMinutes: number;
  cumulativeTimeMinutes: number;
  totalCoinsAtUnlock: number;
  mergesPerformed: number;
  spawnsPerformed: number;
  ordersCompleted: number;
  offlineCoinsEarned: number;
  eventCoinsEarned: number;
  mergeCoinsEarned: number;
  orderCoinsEarned: number;
  spawnCoinsSpent: number;
}

export interface SimulationResult {
  success: boolean;
  totalTimeMinutes: number;
  totalTimeFormatted: string;
  levelProgress: LevelProgress[];
  summary: {
    totalMerges: number;
    totalSpawns: number;
    totalOrdersCompleted: number;
    totalMergeCoins: number;
    totalOrderCoins: number;
    totalOfflineCoins: number;
    totalEventCoins: number;
    totalSpawnCoinsSpent: number;
    netCoinsGained: number;
    eventsParticipated: number;
    eventsAttempted: number;
  };
  bottleneckAnalysis: string[];
  recommendations: string[];
  paramsUsed: SimulationParams;
}

export const DEFAULT_PARAMS: SimulationParams = {
  levelId: "classic",
  startLevel: 1,
  targetLevel: 10,
  startCoins: INITIAL_COINS,
  spawnsPerMinute: 8,
  mergeEfficiency: 0.85,
  ordersCompletedPerHour: 12,
  dailyPlayHours: 2,
  offlineHoursPerDay: 4,
  offlineEarningRateMultiplier: 1.0,
  eventFrequencyPerWeek: 3,
  eventParticipationRate: 0.8,
  eventSkillLevel: 0.7,
  eventShardCoinValue: 50,
};

export function createDefaultParams(): SimulationParams {
  return { ...DEFAULT_PARAMS };
}

function formatTime(totalMinutes: number): string {
  if (totalMinutes < 60) {
    return `${Math.round(totalMinutes)} 分钟`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hours < 24) {
    return `${hours} 小时 ${mins} 分钟`;
  }
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days} 天 ${remainHours} 小时 ${mins} 分钟`;
}

function randomRange(min: number, max: number, rng: () => number): number {
  return min + rng() * (max - min);
}

function randomInt(min: number, max: number, rng: () => number): number {
  return Math.floor(randomRange(min, max + 1, rng));
}

function createRng(seed?: number): () => number {
  let s = seed ?? Date.now();
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function runSimulation(params: SimulationParams): SimulationResult {
  const rng = createRng(params.randomSeed);
  const config = getLevelConfig(params.levelId);
  const maxDessertLevel = config.desserts.length;

  if (params.targetLevel <= params.startLevel) {
    return {
      success: true,
      totalTimeMinutes: 0,
      totalTimeFormatted: "0 分钟",
      levelProgress: [],
      summary: {
        totalMerges: 0,
        totalSpawns: 0,
        totalOrdersCompleted: 0,
        totalMergeCoins: 0,
        totalOrderCoins: 0,
        totalOfflineCoins: 0,
        totalEventCoins: 0,
        totalSpawnCoinsSpent: 0,
        netCoinsGained: 0,
        eventsParticipated: 0,
        eventsAttempted: 0,
      },
      bottleneckAnalysis: [],
      recommendations: ["起始等级已达到或超过目标等级"],
      paramsUsed: { ...params },
    };
  }

  if (params.targetLevel > maxDessertLevel) {
    params.targetLevel = maxDessertLevel;
  }

  const levelProgress: LevelProgress[] = [];
  let totalTime = 0;
  let currentLevel = params.startLevel;
  let coins = params.startCoins;
  let totalMerges = 0;
  let totalSpawns = 0;
  let totalOrdersCompleted = 0;
  let totalMergeCoins = 0;
  let totalOrderCoins = 0;
  let totalOfflineCoins = 0;
  let totalEventCoins = 0;
  let totalSpawnCoinsSpent = 0;
  let eventsParticipated = 0;
  let eventsAttempted = 0;

  for (let targetLvl = params.startLevel + 1; targetLvl <= params.targetLevel; targetLvl++) {
    const lvlStart = {
      time: totalTime,
      coins,
      merges: totalMerges,
      spawns: totalSpawns,
      orders: totalOrdersCompleted,
      offline: totalOfflineCoins,
      event: totalEventCoins,
      mergeCoins: totalMergeCoins,
      orderCoins: totalOrderCoins,
      spawnSpent: totalSpawnCoinsSpent,
    };

    const costInfo = getMergeCostToLevel(targetLvl, currentLevel);
    const unlockedLevels = Array.from({ length: currentLevel }, (_, i) => i + 1);
    let requiredSpawns = Math.ceil(costInfo.spawnsNeeded / Math.max(0.3, params.mergeEfficiency));
    let spawnCostTotal = requiredSpawns * config.spawnCost;
    let additionalCoinsNeeded = Math.max(0, spawnCostTotal - coins);
    const effectiveMergeReward = calculateMergeReward(targetLvl, false, config);
    let additionalMerges = Math.ceil(costInfo.mergesNeeded / Math.max(0.3, params.mergeEfficiency));

    let lvlTime = 0;

    while (additionalCoinsNeeded > 0 || requiredSpawns > 0) {
      const simTickMinutes = 1;
      const spawnsThisTick = Math.min(
        Math.floor(params.spawnsPerMinute * simTickMinutes),
        Math.max(0, requiredSpawns)
      );
      const spawnCostThisTick = spawnsThisTick * config.spawnCost;

      if (coins >= spawnCostThisTick) {
        coins -= spawnCostThisTick;
        totalSpawnCoinsSpent += spawnCostThisTick;
        requiredSpawns -= spawnsThisTick;
        totalSpawns += spawnsThisTick;
      } else {
        const affordableSpawns = Math.floor(coins / config.spawnCost);
        if (affordableSpawns > 0) {
          const affordableCost = affordableSpawns * config.spawnCost;
          coins -= affordableCost;
          totalSpawnCoinsSpent += affordableCost;
          requiredSpawns -= affordableSpawns;
          totalSpawns += affordableSpawns;
        }
      }

      const mergesThisTick = Math.min(
        Math.floor(params.spawnsPerMinute * simTickMinutes * 0.7 * params.mergeEfficiency),
        Math.max(0, additionalMerges)
      );
      for (let m = 0; m < mergesThisTick; m++) {
        const mergeLevel = Math.min(currentLevel, randomInt(1, currentLevel, rng));
        const reward = calculateMergeReward(mergeLevel + 1, false, config);
        coins += reward;
        totalMergeCoins += reward;
        additionalMerges--;
        totalMerges++;
        additionalCoinsNeeded = Math.max(0, additionalCoinsNeeded - reward);
      }

      const ordersThisTick = Math.floor(params.ordersCompletedPerHour / 60 * simTickMinutes * (1 + rng() * 0.3));
      for (let o = 0; o < ordersThisTick; o++) {
        const orders = generateSimOrders(unlockedLevels, 1);
        if (orders.length > 0) {
          const reward = orders[0].reward;
          coins += reward;
          totalOrderCoins += reward;
          totalOrdersCompleted++;
          additionalCoinsNeeded = Math.max(0, additionalCoinsNeeded - reward);
        }
      }

      lvlTime += simTickMinutes;
      totalTime += simTickMinutes;

      if (lvlTime % 60 === 0) {
        const dayMinutes = params.dailyPlayHours * 60;
        if (lvlTime % dayMinutes === 0 && params.offlineHoursPerDay > 0) {
          const offlineMinutes = params.offlineHoursPerDay * 60;
          const offlineRate = calculateBaseEarningsRate(currentLevel, config) * params.offlineEarningRateMultiplier;
          const cappedOffline = Math.min(offlineMinutes, config.maxOfflineHours * 60);
          const offlineCoins = Math.floor(cappedOffline * offlineRate);
          coins += offlineCoins;
          totalOfflineCoins += offlineCoins;
          additionalCoinsNeeded = Math.max(0, additionalCoinsNeeded - offlineCoins);
          totalTime += cappedOffline;
          lvlTime += cappedOffline;
        }
      }

      const weekMinutes = 7 * 24 * 60;
      if (params.eventFrequencyPerWeek > 0 &&
          totalTime >= weekMinutes * (eventsAttempted + 1) / params.eventFrequencyPerWeek) {
        eventsAttempted++;
        if (rng() < params.eventParticipationRate) {
          eventsParticipated++;
          const eventResult = simulateEvent(
            currentLevel,
            params.eventSkillLevel,
            rng,
            config
          );
          const eventCoins = eventResult.coins + eventResult.shards * params.eventShardCoinValue;
          coins += eventCoins;
          totalEventCoins += eventCoins;
          additionalCoinsNeeded = Math.max(0, additionalCoinsNeeded - eventCoins);
        }
      }

      if (lvlTime > 365 * 24 * 60) {
        return {
          success: false,
          totalTimeMinutes: totalTime,
          totalTimeFormatted: formatTime(totalTime),
          levelProgress,
          summary: {
            totalMerges,
            totalSpawns,
            totalOrdersCompleted,
            totalMergeCoins,
            totalOrderCoins,
            totalOfflineCoins,
            totalEventCoins,
            totalSpawnCoinsSpent,
            netCoinsGained: coins - params.startCoins,
            eventsParticipated,
            eventsAttempted,
          },
          bottleneckAnalysis: ["模拟时间超过一年，参数可能过于保守或经济不平衡"],
          recommendations: [
            "考虑提高每日游戏时长",
            "增加订单完成速度",
            "检查是否有更高效率的合成策略",
          ],
          paramsUsed: { ...params },
        };
      }
    }

    coins += effectiveMergeReward;
    totalMergeCoins += effectiveMergeReward;
    totalMerges++;
    currentLevel = targetLvl;

    levelProgress.push({
      level: targetLvl,
      timeToReachMinutes: totalTime - lvlStart.time,
      cumulativeTimeMinutes: totalTime,
      totalCoinsAtUnlock: coins,
      mergesPerformed: totalMerges - lvlStart.merges,
      spawnsPerformed: totalSpawns - lvlStart.spawns,
      ordersCompleted: totalOrdersCompleted - lvlStart.orders,
      offlineCoinsEarned: totalOfflineCoins - lvlStart.offline,
      eventCoinsEarned: totalEventCoins - lvlStart.event,
      mergeCoinsEarned: totalMergeCoins - lvlStart.mergeCoins,
      orderCoinsEarned: totalOrderCoins - lvlStart.orderCoins,
      spawnCoinsSpent: totalSpawnCoinsSpent - lvlStart.spawnSpent,
    });
  }

  const bottleneckAnalysis: string[] = [];
  const recommendations: string[] = [];

  for (const prog of levelProgress) {
    if (prog.level >= 7 && prog.timeToReachMinutes > 24 * 60) {
      bottleneckAnalysis.push(
        `Lv.${prog.level} 解锁耗时 ${formatTime(prog.timeToReachMinutes)}，可能存在经济瓶颈`
      );
    }
  }

  if (totalSpawnCoinsSpent > totalMergeCoins + totalOrderCoins) {
    bottleneckAnalysis.push("生成甜品的总成本超过了合成和订单奖励，经济循环可能为负");
    recommendations.push("考虑降低生成成本或提高合成/订单奖励");
  }

  if (params.dailyPlayHours < 1 && params.targetLevel >= 6) {
    recommendations.push("每天游戏时间较短，建议增加游戏时长或提升游戏效率");
  }

  if (params.mergeEfficiency < 0.6) {
    recommendations.push("合成效率偏低，可以尝试更有规划的合成策略");
  }

  if (params.eventParticipationRate < 0.5 && params.eventFrequencyPerWeek >= 2) {
    recommendations.push("活动奖励丰厚，建议增加活动参与率");
  }

  if (params.ordersCompletedPerHour < 6) {
    recommendations.push("订单是重要的金币来源，尝试更高效地完成订单");
  }

  if (bottleneckAnalysis.length === 0) {
    bottleneckAnalysis.push("经济平衡良好，没有检测到严重瓶颈");
  }

  if (recommendations.length === 0) {
    recommendations.push("参数设置合理，当前策略可持续");
  }

  return {
    success: true,
    totalTimeMinutes: totalTime,
    totalTimeFormatted: formatTime(totalTime),
    levelProgress,
    summary: {
      totalMerges,
      totalSpawns,
      totalOrdersCompleted,
      totalMergeCoins,
      totalOrderCoins,
      totalOfflineCoins,
      totalEventCoins,
      totalSpawnCoinsSpent,
      netCoinsGained: coins - params.startCoins,
      eventsParticipated,
      eventsAttempted,
    },
    bottleneckAnalysis,
    recommendations,
    paramsUsed: { ...params },
  };
}

function simulateEvent(
  currentMaxLevel: number,
  skillLevel: number,
  rng: () => number,
  config: LevelConfig
): { coins: number; shards: number } {
  let stepsLeft = EVENT_MAX_STEPS;
  let eventCoins = EVENT_INITIAL_COINS;
  let merges = 0;
  let ordersCompleted = 0;
  let maxLevel = Math.max(1, Math.floor(currentMaxLevel * skillLevel * 0.8));
  let shardsEarned = 0;
  const maxDessertLevel = config.desserts.length;

  const orders = generateEventSimOrders();

  while (stepsLeft > 0) {
    const action = rng();

    if (action < 0.4 && eventCoins >= EVENT_SPAWN_COST) {
      eventCoins -= EVENT_SPAWN_COST;
      stepsLeft--;
    } else if (action < 0.75 && stepsLeft > 0) {
      stepsLeft--;
      merges++;
      const level = Math.min(maxLevel, Math.floor(randomRange(1, maxLevel + 1, rng)));
      const reward = calculateMergeReward(level + 1, true);
      eventCoins += reward;
      if (level + 1 > maxLevel && level + 1 <= maxDessertLevel) {
        maxLevel = level + 1;
      }
    } else if (stepsLeft > 0) {
      const availableOrders = orders.filter((o: EventSimOrder) => true);
      if (availableOrders.length > 0 && rng() < skillLevel) {
        stepsLeft--;
        const idx = Math.floor(rng() * availableOrders.length);
        const order = availableOrders[idx];
        const reward = calculateEventOrderReward(order.items);
        eventCoins += reward.coins;
        shardsEarned += reward.shards;
        ordersCompleted++;
      } else {
        stepsLeft--;
      }
    }
  }

  maxLevel = Math.min(maxLevel, maxDessertLevel);
  return calculateEventResult(merges, ordersCompleted, maxLevel, eventCoins, shardsEarned);
}

export function getEconomicSnapshot(level: number, config?: LevelConfig): {
  spawnCost: number;
  averageMergeReward: number;
  averageOrderReward: number;
  offlineHourlyRate: number;
  costToNextLevel: {
    spawns: number;
    minCost: number;
    merges: number;
  } | null;
  efficiencyBreakEven: number;
} {
  const cfg = config || getLevelConfig("classic");
  const maxDessertLevel = cfg.desserts.length;
  const unlockLevels = Array.from({ length: level }, (_, i) => i + 1);
  const sampleOrders = generateSimOrders(unlockLevels, 20);
  const avgOrderReward = sampleOrders.reduce((sum: number, o: SimOrder) => sum + o.reward, 0) / Math.max(1, sampleOrders.length);

  const avgMergeReward = level >= 2
    ? Array.from({ length: level - 1 }, (_, i) => calculateMergeReward(i + 2, false, cfg))
        .reduce((a: number, b: number) => a + b, 0) / (level - 1)
    : calculateMergeReward(2, false, cfg);

  const costToNext = level < maxDessertLevel
    ? getMergeCostToLevel(level + 1, level, cfg)
    : null;

  const spawnsPerMerge = 2;
  const avgSpawnsCostPerMerge = spawnsPerMerge * cfg.spawnCost;
  const efficiencyBreakEven = avgSpawnsCostPerMerge / Math.max(1, avgMergeReward + avgOrderReward * 0.2);

  return {
    spawnCost: cfg.spawnCost,
    averageMergeReward: Math.round(avgMergeReward),
    averageOrderReward: Math.round(avgOrderReward),
    offlineHourlyRate: calculateBaseEarningsRate(level, cfg) * 60,
    costToNextLevel: costToNext ? {
      spawns: costToNext.spawnsNeeded,
      minCost: costToNext.minSpawnCost,
      merges: costToNext.mergesNeeded,
    } : null,
    efficiencyBreakEven: Math.round(efficiencyBreakEven * 100) / 100,
  };
}

export function compareScenarios(
  baseParams: SimulationParams,
  variants: Partial<SimulationParams>[]
): { name: string; result: SimulationResult; diff: { minutes: number; pct: number } }[] {
  const baseResult = runSimulation(baseParams);
  return variants.map((variant, idx) => {
    const modifiedParams: SimulationParams = { ...baseParams, ...variant };
    const result = runSimulation(modifiedParams);
    const timeDiff = result.totalTimeMinutes - baseResult.totalTimeMinutes;
    const pct = baseResult.totalTimeMinutes > 0
      ? (timeDiff / baseResult.totalTimeMinutes) * 100
      : 0;
    return {
      name: `方案 ${idx + 1}`,
      result,
      diff: {
        minutes: timeDiff,
        pct: Math.round(pct * 10) / 10,
      },
    };
  });
}
