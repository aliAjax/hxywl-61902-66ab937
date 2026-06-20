import { describe, it, expect } from "vitest";
import {
  runSimulation,
  createDefaultParams,
  getEconomicSnapshot,
  compareScenarios,
  DEFAULT_PARAMS,
  type SimulationParams,
} from "./economicSimulator";
import { LEVEL_CONFIGS } from "./gameConfig";

describe("经济模拟器 - 核心功能", () => {
  describe("createDefaultParams", () => {
    it("应创建默认参数对象", () => {
      const params = createDefaultParams();
      expect(params).toEqual(DEFAULT_PARAMS);
      expect(params.startLevel).toBe(1);
      expect(params.targetLevel).toBe(10);
      expect(params.startCoins).toBe(50);
    });

    it("返回的对象应该是副本而非引用", () => {
      const params1 = createDefaultParams();
      const params2 = createDefaultParams();
      params1.startCoins = 999;
      expect(params2.startCoins).toBe(50);
    });
  });

  describe("runSimulation - 基本边界情况", () => {
    it("起始等级等于目标等级时应立即返回成功", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 5,
        targetLevel: 5,
      };
      const result = runSimulation(params);
      expect(result.success).toBe(true);
      expect(result.totalTimeMinutes).toBe(0);
      expect(result.summary.totalMerges).toBe(0);
      expect(result.recommendations).toContain("起始等级已达到或超过目标等级");
    });

    it("起始等级超过目标等级时应立即返回成功", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 8,
        targetLevel: 5,
      };
      const result = runSimulation(params);
      expect(result.success).toBe(true);
      expect(result.totalTimeMinutes).toBe(0);
    });

    it("目标等级超过最大甜品等级时应自动调整", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 999,
      };
      const result = runSimulation(params);
      expect(result.success).toBe(true);
      const maxLevel = Math.max(...result.levelProgress.map(p => p.level));
      expect(maxLevel).toBeLessThanOrEqual(LEVEL_CONFIGS.classic.desserts.length);
    });
  });

  describe("runSimulation - 经济平衡验证", () => {
    it("从1级到5级的模拟应成功完成", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 5,
        randomSeed: 42,
      };
      const result = runSimulation(params);
      expect(result.success).toBe(true);
      expect(result.levelProgress.length).toBe(4);
      expect(result.levelProgress[0].level).toBe(2);
      expect(result.levelProgress[3].level).toBe(5);
      expect(result.summary.totalMerges).toBeGreaterThan(0);
      expect(result.summary.totalSpawns).toBeGreaterThan(0);
    });

    it("模拟结果应包含所有等级的进度记录", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 6,
        randomSeed: 123,
      };
      const result = runSimulation(params);
      expect(result.success).toBe(true);
      for (let i = 2; i <= 6; i++) {
        const progress = result.levelProgress.find(p => p.level === i);
        expect(progress).toBeDefined();
        expect(progress!.cumulativeTimeMinutes).toBeGreaterThan(0);
      }
    });

    it("净收益应等于总收入减去总支出", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 4,
        randomSeed: 456,
      };
      const result = runSimulation(params);
      expect(result.success).toBe(true);
      const totalIncome =
        result.summary.totalMergeCoins +
        result.summary.totalOrderCoins +
        result.summary.totalOfflineCoins +
        result.summary.totalEventCoins;
      const calculatedNet = totalIncome - result.summary.totalSpawnCoinsSpent;
      expect(result.summary.netCoinsGained).toBe(calculatedNet);
    });

    it("高效参数应比低效参数更快完成", () => {
      const baseParams: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 5,
        randomSeed: 789,
      };

      const efficientParams: SimulationParams = {
        ...baseParams,
        mergeEfficiency: 0.95,
        spawnsPerMinute: 15,
        dailyPlayHours: 8,
      };

      const inefficientParams: SimulationParams = {
        ...baseParams,
        mergeEfficiency: 0.5,
        spawnsPerMinute: 3,
        dailyPlayHours: 1,
      };

      const efficientResult = runSimulation(efficientParams);
      const inefficientResult = runSimulation(inefficientParams);

      expect(efficientResult.success).toBe(true);
      expect(inefficientResult.success).toBe(true);
      expect(efficientResult.totalTimeMinutes).toBeLessThan(inefficientResult.totalTimeMinutes);
    });
  });

  describe("runSimulation - 瓶颈分析", () => {
    it("低效率参数应触发瓶颈警告", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 8,
        mergeEfficiency: 0.4,
        dailyPlayHours: 0.5,
        randomSeed: 101,
      };
      const result = runSimulation(params);
      expect(result.success).toBe(true);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it("参数设置合理时应给出正面反馈", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 4,
        mergeEfficiency: 0.9,
        randomSeed: 102,
      };
      const result = runSimulation(params);
      expect(result.success).toBe(true);
      expect(result.bottleneckAnalysis).toContain("经济平衡良好，没有检测到严重瓶颈");
    });
  });

  describe("getEconomicSnapshot", () => {
    it("应为1级返回正确的经济快照", () => {
      const snapshot = getEconomicSnapshot(1);
      expect(snapshot.spawnCost).toBe(10);
      expect(snapshot.averageMergeReward).toBeGreaterThan(0);
      expect(snapshot.averageOrderReward).toBeGreaterThan(0);
      expect(snapshot.offlineHourlyRate).toBeGreaterThan(0);
      expect(snapshot.costToNextLevel).not.toBeNull();
      expect(snapshot.efficiencyBreakEven).toBeGreaterThan(0);
    });

    it("最高等级的 costToNextLevel 应为 null", () => {
      const maxLevel = LEVEL_CONFIGS.classic.desserts.length;
      const snapshot = getEconomicSnapshot(maxLevel);
      expect(snapshot.costToNextLevel).toBeNull();
    });

    it("升级所需信息应正确计算", () => {
      const snapshot = getEconomicSnapshot(3);
      expect(snapshot.costToNextLevel).not.toBeNull();
      expect(snapshot.costToNextLevel!.spawns).toBe(2);
      expect(snapshot.costToNextLevel!.minCost).toBe(20);
      expect(snapshot.costToNextLevel!.merges).toBe(1);
    });

    it("不同关卡配置应返回不同快照", () => {
      const classicSnapshot = getEconomicSnapshot(3, LEVEL_CONFIGS.classic);
      const beverageSnapshot = getEconomicSnapshot(3, LEVEL_CONFIGS.beverage);
      expect(classicSnapshot.spawnCost).not.toBe(beverageSnapshot.spawnCost);
      expect(classicSnapshot.offlineHourlyRate).not.toBe(beverageSnapshot.offlineHourlyRate);
    });
  });

  describe("compareScenarios", () => {
    it("应正确比较不同参数方案", () => {
      const baseParams = createDefaultParams();
      baseParams.startLevel = 1;
      baseParams.targetLevel = 5;
      baseParams.randomSeed = 2024;

      const variants = [
        { mergeEfficiency: 0.95 },
        { dailyPlayHours: 4 },
        { spawnsPerMinute: 12 },
      ];

      const results = compareScenarios(baseParams, variants);
      expect(results.length).toBe(3);
      expect(results[0].name).toBe("方案 1");
      expect(results[0].result.success).toBe(true);
    });

    it("更好的参数应显示负的时间差异", () => {
      const baseParams = createDefaultParams();
      baseParams.startLevel = 1;
      baseParams.targetLevel = 7;
      baseParams.mergeEfficiency = 0.3;
      baseParams.dailyPlayHours = 1;
      baseParams.randomSeed = 2025;

      const variants = [
        { mergeEfficiency: 0.95, dailyPlayHours: 4 },
      ];

      const results = compareScenarios(baseParams, variants);
      expect(results[0].diff.minutes).toBeLessThan(0);
      expect(results[0].diff.pct).toBeLessThan(0);
    });
  });

  describe("离线收益计算", () => {
    it("离线收益应计入总收益", () => {
      const paramsWithOffline: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 9,
        offlineHoursPerDay: 12,
        dailyPlayHours: 1,
        spawnsPerMinute: 2,
        mergeEfficiency: 0.4,
        ordersCompletedPerHour: 3,
        randomSeed: 3001,
      };

      const paramsNoOffline: SimulationParams = {
        ...paramsWithOffline,
        offlineHoursPerDay: 0,
        randomSeed: 3001,
      };

      const resultWithOffline = runSimulation(paramsWithOffline);
      const resultNoOffline = runSimulation(paramsNoOffline);

      expect(resultWithOffline.summary.totalOfflineCoins).toBeGreaterThan(0);
      expect(resultNoOffline.summary.totalOfflineCoins).toBe(0);
    });
  });

  describe("活动系统模拟", () => {
    it("高活动参与率应获得更多活动收益", () => {
      const paramsHighParticipation: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 6,
        eventFrequencyPerWeek: 3,
        eventParticipationRate: 0.9,
        randomSeed: 4001,
      };

      const paramsLowParticipation: SimulationParams = {
        ...paramsHighParticipation,
        eventParticipationRate: 0.1,
        randomSeed: 4001,
      };

      const resultHigh = runSimulation(paramsHighParticipation);
      const resultLow = runSimulation(paramsLowParticipation);

      expect(resultHigh.summary.totalEventCoins).toBeGreaterThanOrEqual(resultLow.summary.totalEventCoins);
      expect(resultHigh.summary.eventsParticipated).toBeGreaterThanOrEqual(resultLow.summary.eventsParticipated);
    });

    it("零活动频率应无活动收益", () => {
      const params: SimulationParams = {
        ...createDefaultParams(),
        startLevel: 1,
        targetLevel: 5,
        eventFrequencyPerWeek: 0,
        randomSeed: 4002,
      };

      const result = runSimulation(params);
      expect(result.summary.eventsParticipated).toBe(0);
      expect(result.summary.eventsAttempted).toBe(0);
      expect(result.summary.totalEventCoins).toBe(0);
    });
  });
});
