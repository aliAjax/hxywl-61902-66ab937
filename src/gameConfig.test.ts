import { describe, it, expect } from "vitest";
import {
  calculateMergeReward,
  calculateBaseEarningsRate,
  calculateOfflineEarnings,
  calculateOrderItemReward,
  calculateOrderReward,
  calculateEventOrderReward,
  getMergeCostToLevel,
  getDessertsUpToLevel,
  generateSimOrder,
  generateSimOrders,
  generateEventSimOrders,
  calculateSynthesisPlan,
  calculateEventResult,
  createInitialAchievementState,
  checkAchievementCompletion,
  getLevelConfig,
  LEVEL_CONFIGS,
  DESSERTS,
  type SimOrderItem,
} from "./gameConfig";

describe("游戏配置 - 核心计算", () => {
  describe("calculateMergeReward", () => {
    it("经典模式合成奖励应正确计算", () => {
      expect(calculateMergeReward(2)).toBe(20);
      expect(calculateMergeReward(3)).toBe(30);
      expect(calculateMergeReward(5)).toBe(50);
      expect(calculateMergeReward(10)).toBe(100);
    });

    it("活动模式合成奖励应有更高系数", () => {
      expect(calculateMergeReward(2, true)).toBe(30);
      expect(calculateMergeReward(3, true)).toBe(45);
      expect(calculateMergeReward(5, true)).toBe(75);
    });

    it("饮品模式应有不同的奖励系数", () => {
      const beverageConfig = LEVEL_CONFIGS.beverage;
      expect(calculateMergeReward(2, false, beverageConfig)).toBe(24);
      expect(calculateMergeReward(3, false, beverageConfig)).toBe(36);
    });
  });

  describe("calculateBaseEarningsRate", () => {
    it("经典模式离线收益率应正确计算", () => {
      expect(calculateBaseEarningsRate(1)).toBe(2);
      expect(calculateBaseEarningsRate(5)).toBe(10);
      expect(calculateBaseEarningsRate(10)).toBe(20);
    });

    it("饮品模式应有更高的离线收益", () => {
      const beverageConfig = LEVEL_CONFIGS.beverage;
      expect(calculateBaseEarningsRate(1, beverageConfig)).toBe(4.5);
      expect(calculateBaseEarningsRate(5, beverageConfig)).toBe(22.5);
    });
  });

  describe("calculateOfflineEarnings", () => {
    it("离线收益应根据时间正确计算", () => {
      expect(calculateOfflineEarnings(5, 60)).toBe(600);
      expect(calculateOfflineEarnings(5, 30)).toBe(300);
      expect(calculateOfflineEarnings(10, 120)).toBe(2400);
    });

    it("离线时间超过上限时应被截断", () => {
      const maxMinutes = 8 * 60;
      const result1 = calculateOfflineEarnings(5, maxMinutes);
      const result2 = calculateOfflineEarnings(5, maxMinutes * 2);
      expect(result1).toBe(result2);
    });

    it("饮品模式离线收益更高", () => {
      const beverageConfig = LEVEL_CONFIGS.beverage;
      const classicResult = calculateOfflineEarnings(3, 60);
      const beverageResult = calculateOfflineEarnings(3, 60, beverageConfig);
      expect(beverageResult).toBeGreaterThan(classicResult);
    });
  });

  describe("calculateOrderItemReward", () => {
    it("订单物品奖励应正确计算", () => {
      expect(calculateOrderItemReward(1, 1)).toBe(15);
      expect(calculateOrderItemReward(2, 3)).toBe(90);
      expect(calculateOrderItemReward(5, 2)).toBe(150);
    });

    it("饮品模式订单奖励更高", () => {
      const beverageConfig = LEVEL_CONFIGS.beverage;
      expect(calculateOrderItemReward(2, 1, beverageConfig)).toBe(40);
      expect(calculateOrderItemReward(3, 2, beverageConfig)).toBe(120);
    });
  });

  describe("calculateOrderReward", () => {
    it("多物品订单奖励应为各物品之和", () => {
      const items: SimOrderItem[] = [
        { level: 1, count: 2 },
        { level: 3, count: 1 },
      ];
      expect(calculateOrderReward(items)).toBe(2 * 15 + 3 * 15);
    });

    it("空订单应返回0", () => {
      expect(calculateOrderReward([])).toBe(0);
    });
  });

  describe("calculateEventOrderReward", () => {
    it("活动订单应同时返回金币和碎片", () => {
      const items: SimOrderItem[] = [
        { level: 2, count: 1 },
        { level: 3, count: 2 },
      ];
      const result = calculateEventOrderReward(items);
      expect(result.coins).toBe(2 * 25 + 3 * 2 * 25);
      expect(result.shards).toBeGreaterThan(0);
    });

    it("碎片数量应向上取整", () => {
      const items: SimOrderItem[] = [{ level: 1, count: 1 }];
      const result = calculateEventOrderReward(items);
      expect(result.shards).toBe(1);
    });
  });

  describe("getMergeCostToLevel", () => {
    it("从1级到2级需要2个1级和1次合成", () => {
      const cost = getMergeCostToLevel(2, 1);
      expect(cost.spawnsNeeded).toBe(2);
      expect(cost.mergesNeeded).toBe(1);
      expect(cost.minSpawnCost).toBe(20);
    });

    it("从1级到5级需要16个1级和15次合成", () => {
      const cost = getMergeCostToLevel(5, 1);
      expect(cost.spawnsNeeded).toBe(16);
      expect(cost.mergesNeeded).toBe(15);
      expect(cost.minSpawnCost).toBe(160);
    });

    it("从3级到5级需要4个3级和3次合成", () => {
      const cost = getMergeCostToLevel(5, 3);
      expect(cost.spawnsNeeded).toBe(4);
      expect(cost.mergesNeeded).toBe(3);
      expect(cost.minSpawnCost).toBe(40);
    });

    it("目标等级不高于当前等级应返回0", () => {
      const cost1 = getMergeCostToLevel(3, 5);
      expect(cost1).toEqual({ spawnsNeeded: 0, mergesNeeded: 0, minSpawnCost: 0 });

      const cost2 = getMergeCostToLevel(5, 5);
      expect(cost2).toEqual({ spawnsNeeded: 0, mergesNeeded: 0, minSpawnCost: 0 });
    });

    it("饮品模式生成成本更低", () => {
      const beverageConfig = LEVEL_CONFIGS.beverage;
      const classicCost = getMergeCostToLevel(3, 1);
      const beverageCost = getMergeCostToLevel(3, 1, beverageConfig);
      expect(classicCost.minSpawnCost).toBe(40);
      expect(beverageCost.minSpawnCost).toBe(32);
    });
  });

  describe("getDessertsUpToLevel", () => {
    it("应返回指定等级及以下的所有甜品", () => {
      const desserts = getDessertsUpToLevel(3);
      expect(desserts.length).toBe(3);
      expect(desserts[0].level).toBe(1);
      expect(desserts[2].level).toBe(3);
    });

    it("等级0应返回空数组", () => {
      expect(getDessertsUpToLevel(0)).toEqual([]);
    });

    it("等级超过最大值应返回所有甜品", () => {
      const all = getDessertsUpToLevel(999);
      expect(all.length).toBe(DESSERTS.length);
    });
  });

  describe("generateSimOrder", () => {
    it("应为已解锁等级生成有效模拟订单", () => {
      const order = generateSimOrder([1, 2, 3, 4]);
      expect(order.items.length).toBeGreaterThanOrEqual(1);
      expect(order.items.length).toBeLessThanOrEqual(3);
      expect(order.reward).toBeGreaterThan(0);
      for (const item of order.items) {
        expect([1, 2, 3, 4]).toContain(item.level);
        expect(item.count).toBeGreaterThanOrEqual(1);
      }
    });

    it("只有1级解锁时只能生成1级订单", () => {
      const order = generateSimOrder([1]);
      for (const item of order.items) {
        expect(item.level).toBe(1);
      }
    });
  });

  describe("generateSimOrders", () => {
    it("应生成指定数量的订单", () => {
      const orders = generateSimOrders([1, 2, 3], 5);
      expect(orders.length).toBe(5);
    });

    it("已解锁等级为空时应返回空数组", () => {
      expect(generateSimOrders([])).toEqual([]);
    });

    it("默认应生成3个订单", () => {
      const orders = generateSimOrders([1, 2]);
      expect(orders.length).toBe(3);
    });
  });

  describe("generateEventSimOrders", () => {
    it("应生成3个活动订单", () => {
      const orders = generateEventSimOrders();
      expect(orders.length).toBe(3);
    });

    it("活动订单等级应从2开始", () => {
      const orders = generateEventSimOrders();
      for (const order of orders) {
        for (const item of order.items) {
          expect(item.level).toBeGreaterThanOrEqual(2);
        }
      }
    });
  });

  describe("calculateEventResult", () => {
    it("应正确计算活动总结果", () => {
      const result = calculateEventResult(5, 2, 4, 200, 3);
      expect(result.coins).toBe(200 + 5 * 5 + 2 * 50 + 3 * 30);
      expect(result.shards).toBe(3 + 2 + 2);
    });

    it("最高等级为1时等级奖励为0", () => {
      const result = calculateEventResult(0, 0, 1, 0, 0);
      expect(result.shards).toBe(0);
    });
  });

  describe("calculateSynthesisPlan", () => {
    it("应正确分析棋盘合成计划", () => {
      const board = [1, 1, 2, 2, 3, null, null];
      const unlockedLevels = [1, 2, 3];
      const orders: { id: number; items: { level: number; count: number }[] }[] = [];

      const plan = calculateSynthesisPlan(board, unlockedLevels, orders);
      expect(plan.nextTargetLevel).toBe(4);
      expect(plan.maxReachableLevel).toBe(4);
      expect(plan.suggestions.length).toBe(2);
      expect(plan.suggestions[0].level).toBe(2);
      expect(plan.suggestions[1].level).toBe(1);
    });

    it("已解锁所有等级时nextTargetLevel应为null", () => {
      const allLevels = Array.from({ length: 10 }, (_, i) => i + 1);
      const board = Array(25).fill(null);
      const plan = calculateSynthesisPlan(board, allLevels, []);
      expect(plan.nextTargetLevel).toBeNull();
      expect(plan.isAllUnlocked).toBe(true);
    });

    it("应正确检测订单完成可能性", () => {
      const board = [1, 1, 2, null];
      const unlockedLevels = [1, 2];
      const orders = [
        {
          id: 1,
          items: [
            { level: 1, count: 2 },
            { level: 2, count: 1 },
          ],
        },
      ];

      const plan = calculateSynthesisPlan(board, unlockedLevels, orders);
      expect(plan.orderShortfalls.length).toBe(0);
    });

    it("应正确识别订单缺口", () => {
      const board = [1, 2, null];
      const unlockedLevels = [1, 2, 3];
      const orders = [
        {
          id: 1,
          items: [
            { level: 1, count: 3 },
            { level: 3, count: 1 },
          ],
        },
      ];

      const plan = calculateSynthesisPlan(board, unlockedLevels, orders);
      expect(plan.orderShortfalls.length).toBe(1);
      expect(plan.orderShortfalls[0].missingItems.length).toBe(2);
    });

    it("应考虑不同关卡的甜品配置", () => {
      const board = [1, 1, 5, 5, null];
      const unlockedLevels = [1, 2, 3, 4, 5];
      const orders: { id: number; items: { level: number; count: number }[] }[] = [];
      const beverageConfig = LEVEL_CONFIGS.beverage;

      const plan = calculateSynthesisPlan(board, unlockedLevels, orders, beverageConfig);
      expect(plan.nextTargetLevel).toBe(6);
      expect(plan.nextTargetDessert?.name).toBe("冰沙");
    });
  });

  describe("成就系统", () => {
    it("createInitialAchievementState应创建初始状态", () => {
      const state = createInitialAchievementState();
      expect(state.streak).toBe(0);
      expect(state.bestMaxLevel).toBe(1);
      expect(Object.keys(state.progress).length).toBeGreaterThan(10);
    });

    it("checkAchievementCompletion应正确检测成就完成", () => {
      const state = createInitialAchievementState();
      const completed = checkAchievementCompletion(state, "maxLevel", 5);
      expect(completed).toContain("maxLevel_3");
      expect(completed).toContain("maxLevel_5");
      expect(state.progress["maxLevel_5"].completed).toBe(true);
    });

    it("同一成就不应重复触发完成", () => {
      const state = createInitialAchievementState();
      const completed1 = checkAchievementCompletion(state, "maxLevel", 3);
      const completed2 = checkAchievementCompletion(state, "maxLevel", 4);
      expect(completed1).toContain("maxLevel_3");
      expect(completed2).not.toContain("maxLevel_3");
    });
  });

  describe("关卡配置", () => {
    it("getLevelConfig应返回正确的关卡配置", () => {
      expect(getLevelConfig("classic").id).toBe("classic");
      expect(getLevelConfig("beverage").id).toBe("beverage");
    });

    it("未知关卡应返回经典模式", () => {
      expect(getLevelConfig("unknown").id).toBe("classic");
    });

    it("经典模式应有10种甜品", () => {
      expect(LEVEL_CONFIGS.classic.desserts.length).toBe(10);
    });

    it("饮品模式应有8种甜品", () => {
      expect(LEVEL_CONFIGS.beverage.desserts.length).toBe(8);
    });

    it("各关卡甜品等级应正确连续", () => {
      for (const config of Object.values(LEVEL_CONFIGS)) {
        for (let i = 0; i < config.desserts.length; i++) {
          expect(config.desserts[i].level).toBe(i + 1);
        }
      }
    });
  });
});
