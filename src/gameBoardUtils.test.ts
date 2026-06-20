import { describe, it, expect, beforeEach } from "vitest";
import {
  createInitialBoard,
  generateOrder,
  generateOrders,
  countDessertsOnBoard,
  removeDessertsFromBoard,
  canSubmitOrder,
  getOrderProgress,
  submitOrder,
  findNextMergeHint,
  getNextUnlockHint,
  formatUnlockTime,
  resetOrderIdCounter,
  type Order,
} from "./gameBoardUtils";
import { LEVEL_CONFIGS } from "./gameConfig";

describe("游戏棋盘工具 - 核心功能", () => {
  beforeEach(() => {
    resetOrderIdCounter();
  });

  describe("createInitialBoard", () => {
    it("应为经典模式创建25格棋盘，包含6个1级甜品", () => {
      const board = createInitialBoard();
      expect(board.length).toBe(25);
      const level1Count = board.filter(cell => cell === 1).length;
      expect(level1Count).toBe(6);
      const nullCount = board.filter(cell => cell === null).length;
      expect(nullCount).toBe(19);
    });

    it("应为饮品模式创建20格棋盘", () => {
      const board = createInitialBoard(LEVEL_CONFIGS.beverage);
      expect(board.length).toBe(20);
      const level1Count = board.filter(cell => cell === 1).length;
      expect(level1Count).toBe(5);
    });

    it("初始甜品应放在棋盘开头位置", () => {
      const board = createInitialBoard();
      for (let i = 0; i < 6; i++) {
        expect(board[i]).toBe(1);
      }
      for (let i = 6; i < 25; i++) {
        expect(board[i]).toBeNull();
      }
    });
  });

  describe("generateOrder", () => {
    it("应为已解锁等级生成有效订单", () => {
      const unlockedLevels = [1, 2, 3];
      const order = generateOrder(unlockedLevels);
      expect(order.id).toBe(1);
      expect(order.items.length).toBeGreaterThanOrEqual(1);
      expect(order.items.length).toBeLessThanOrEqual(3);
      expect(order.reward).toBeGreaterThan(0);
      expect(order.completed).toBe(false);

      for (const item of order.items) {
        expect(unlockedLevels).toContain(item.level);
        expect(item.count).toBeGreaterThanOrEqual(1);
        expect(item.collected).toBe(0);
      }
    });

    it("订单ID应自动递增", () => {
      const unlockedLevels = [1, 2];
      const order1 = generateOrder(unlockedLevels);
      const order2 = generateOrder(unlockedLevels);
      expect(order2.id).toBe(order1.id + 1);
    });

    it("只有1级解锁时订单只能包含1级", () => {
      const order = generateOrder([1]);
      for (const item of order.items) {
        expect(item.level).toBe(1);
      }
    });

    it("订单奖励应与物品等级和数量匹配", () => {
      const order = generateOrder([1, 2, 3]);
      let expectedReward = 0;
      for (const item of order.items) {
        expectedReward += item.level * item.count * 15;
      }
      expect(order.reward).toBe(expectedReward);
    });
  });

  describe("generateOrders", () => {
    it("应为经典模式生成3个订单", () => {
      const orders = generateOrders([1, 2, 3]);
      expect(orders.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(orders[i].id).toBe(i + 1);
      }
    });

    it("应为饮品模式生成3个订单", () => {
      const orders = generateOrders([1, 2, 3], LEVEL_CONFIGS.beverage);
      expect(orders.length).toBe(3);
    });

    it("已解锁等级为空时应返回空数组", () => {
      const orders = generateOrders([]);
      expect(orders).toEqual([]);
    });
  });

  describe("countDessertsOnBoard", () => {
    it("应正确统计指定等级的甜品数量", () => {
      const board = [1, 2, 1, null, 3, 1, null, 2];
      expect(countDessertsOnBoard(board, 1)).toBe(3);
      expect(countDessertsOnBoard(board, 2)).toBe(2);
      expect(countDessertsOnBoard(board, 3)).toBe(1);
      expect(countDessertsOnBoard(board, 4)).toBe(0);
    });

    it("空棋盘应返回0", () => {
      const board = Array(25).fill(null);
      expect(countDessertsOnBoard(board, 1)).toBe(0);
    });
  });

  describe("removeDessertsFromBoard", () => {
    it("应从棋盘中移除指定数量的甜品", () => {
      const board = [1, 2, 1, 1, null, 2, 1];
      const result = removeDessertsFromBoard(board, 1, 3);
      const remaining = result.filter(cell => cell === 1).length;
      expect(remaining).toBe(1);
      expect(result.filter(cell => cell === 2).length).toBe(2);
    });

    it("应从前往后移除甜品", () => {
      const board = [1, null, 1, null, 1];
      const result = removeDessertsFromBoard(board, 1, 2);
      expect(result[0]).toBeNull();
      expect(result[2]).toBeNull();
      expect(result[4]).toBe(1);
    });

    it("移除数量超过现有数量时应移除全部", () => {
      const board = [1, 2, 1];
      const result = removeDessertsFromBoard(board, 1, 10);
      expect(result.filter(cell => cell === 1).length).toBe(0);
      expect(result[1]).toBe(2);
    });

    it("不应修改原棋盘数组", () => {
      const original = [1, 2, 1];
      const result = removeDessertsFromBoard(original, 1, 1);
      expect(original).toEqual([1, 2, 1]);
      expect(result).not.toBe(original);
    });
  });

  describe("canSubmitOrder", () => {
    it("棋盘有足够甜品时应返回true", () => {
      const board = [1, 1, 2, 2, 2, 3];
      const order: Order = {
        id: 1,
        items: [
          { level: 1, count: 2, collected: 0 },
          { level: 2, count: 3, collected: 0 },
        ],
        reward: 100,
        completed: false,
      };
      expect(canSubmitOrder(board, order)).toBe(true);
    });

    it("棋盘甜品不足时应返回false", () => {
      const board = [1, 2, 2];
      const order: Order = {
        id: 1,
        items: [
          { level: 1, count: 2, collected: 0 },
        ],
        reward: 50,
        completed: false,
      };
      expect(canSubmitOrder(board, order)).toBe(false);
    });

    it("空订单应返回true", () => {
      const board: (number | null)[] = [];
      const order: Order = {
        id: 1,
        items: [],
        reward: 0,
        completed: false,
      };
      expect(canSubmitOrder(board, order)).toBe(true);
    });
  });

  describe("getOrderProgress", () => {
    it("应正确计算订单完成进度", () => {
      const board = [1, 1, 2, 2, 2];
      const order: Order = {
        id: 1,
        items: [
          { level: 1, count: 2, collected: 0 },
          { level: 2, count: 2, collected: 0 },
        ],
        reward: 100,
        completed: false,
      };
      const progress = getOrderProgress(board, order);
      expect(progress.totalItems).toBe(4);
      expect(progress.completedItems).toBe(4);
      expect(progress.percent).toBe(100);
    });

    it("部分完成时应正确计算百分比", () => {
      const board = [1, null, 2, null];
      const order: Order = {
        id: 1,
        items: [
          { level: 1, count: 2, collected: 0 },
          { level: 2, count: 2, collected: 0 },
        ],
        reward: 100,
        completed: false,
      };
      const progress = getOrderProgress(board, order);
      expect(progress.totalItems).toBe(4);
      expect(progress.completedItems).toBe(2);
      expect(progress.percent).toBe(50);
    });

    it("超额完成时不应超过100%", () => {
      const board = [1, 1, 1, 1];
      const order: Order = {
        id: 1,
        items: [{ level: 1, count: 2, collected: 0 }],
        reward: 50,
        completed: false,
      };
      const progress = getOrderProgress(board, order);
      expect(progress.percent).toBe(100);
    });

    it("空订单应返回0%", () => {
      const board: (number | null)[] = [];
      const order: Order = {
        id: 1,
        items: [],
        reward: 0,
        completed: false,
      };
      const progress = getOrderProgress(board, order);
      expect(progress.percent).toBe(0);
      expect(progress.totalItems).toBe(0);
    });
  });

  describe("submitOrder", () => {
    it("成功提交时应移除棋盘中的甜品并标记成功", () => {
      const board = [1, 1, 2, 2, 3, null];
      const order: Order = {
        id: 1,
        items: [
          { level: 1, count: 2, collected: 0 },
          { level: 2, count: 1, collected: 0 },
        ],
        reward: 100,
        completed: false,
      };
      const result = submitOrder(board, order);
      expect(result.success).toBe(true);
      expect(result.newBoard.filter(cell => cell === 1).length).toBe(0);
      expect(result.newBoard.filter(cell => cell === 2).length).toBe(1);
      expect(result.newBoard.filter(cell => cell === 3).length).toBe(1);
    });

    it("提交失败时应返回原棋盘并标记失败", () => {
      const board = [1, 2];
      const order: Order = {
        id: 1,
        items: [{ level: 1, count: 3, collected: 0 }],
        reward: 100,
        completed: false,
      };
      const result = submitOrder(board, order);
      expect(result.success).toBe(false);
      expect(result.newBoard).toEqual(board);
    });

    it("不应修改原棋盘数组", () => {
      const original = [1, 1, 2];
      const order: Order = {
        id: 1,
        items: [{ level: 1, count: 1, collected: 0 }],
        reward: 50,
        completed: false,
      };
      const result = submitOrder(original, order);
      expect(original).toEqual([1, 1, 2]);
      expect(result.newBoard).not.toBe(original);
    });
  });

  describe("findNextMergeHint", () => {
    it("应找到最高等级的可合并对", () => {
      const board = [1, 1, 3, 2, 3, null, 2, 2];
      const hint = findNextMergeHint(board);
      expect(hint).not.toBeNull();
      expect(hint!.level).toBe(3);
    });

    it("没有可合并对时应返回null", () => {
      const board = [1, 2, 3, null, 4, null];
      const hint = findNextMergeHint(board);
      expect(hint).toBeNull();
    });

    it("空棋盘应返回null", () => {
      const board = Array(25).fill(null);
      const hint = findNextMergeHint(board);
      expect(hint).toBeNull();
    });

    it("多个相同等级时应返回前两个位置", () => {
      const board = [null, 2, null, 2, null, 2];
      const hint = findNextMergeHint(board);
      expect(hint!.sourceIndex).toBe(1);
      expect(hint!.targetIndex).toBe(3);
    });

    it("应考虑不同关卡的甜品数量", () => {
      const board = [1, 1, 5, 5, 3];
      const hint = findNextMergeHint(board, LEVEL_CONFIGS.beverage);
      expect(hint).not.toBeNull();
      expect(hint!.level).toBe(5);
    });
  });

  describe("getNextUnlockHint", () => {
    it("应正确计算下一等级解锁提示", () => {
      const unlockedLevels = [1, 2, 3];
      const board = [3, 3, 2, 2, 1, null, null];
      const hint = getNextUnlockHint(unlockedLevels, board);
      expect(hint).not.toBeNull();
      expect(hint!.nextLevel).toBe(4);
      expect(hint!.parentDessert.level).toBe(3);
      expect(hint!.spawnsNeeded).toBe(2);
      expect(hint!.mergesNeeded).toBe(1);
      expect(hint!.minCost).toBe(20);
    });

    it("已有两个父级甜品时应显示可立即合成", () => {
      const unlockedLevels = [1, 2, 3];
      const board = [3, 3, null, null];
      const hint = getNextUnlockHint(unlockedLevels, board);
      expect(hint!.canMergeOnBoard).toBe(true);
      expect(hint!.parentEffectiveCount).toBe(2);
    });

    it("已解锁所有等级时应返回null", () => {
      const allLevels = Array.from({ length: 10 }, (_, i) => i + 1);
      const board: (number | null)[] = [];
      const hint = getNextUnlockHint(allLevels, board);
      expect(hint).toBeNull();
    });

    it("应正确计算低级甜品向上折算", () => {
      const unlockedLevels = [1, 2, 3];
      const board = [2, 2, 2, 2, null];
      const hint = getNextUnlockHint(unlockedLevels, board);
      expect(hint!.canMergeOnBoard).toBe(true);
      expect(hint!.parentEffectiveCount).toBe(2);
    });

    it("应考虑不同关卡的配置", () => {
      const unlockedLevels = [1, 2, 3];
      const board = [3, 3, null];
      const hint = getNextUnlockHint(unlockedLevels, board, LEVEL_CONFIGS.beverage);
      expect(hint!.minCost).toBe(16);
    });
  });

  describe("formatUnlockTime", () => {
    it("刚刚解锁应显示'刚刚解锁'", () => {
      const now = new Date().toISOString();
      expect(formatUnlockTime(now)).toBe("刚刚解锁");
    });

    it("几分钟前解锁应显示分钟数", () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(formatUnlockTime(fiveMinutesAgo)).toBe("5分钟前解锁");
    });

    it("几小时前解锁应显示小时数", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      expect(formatUnlockTime(twoHoursAgo)).toBe("2小时前解锁");
    });

    it("几天前解锁应显示天数", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatUnlockTime(threeDaysAgo)).toBe("3天前解锁");
    });

    it("超过7天应显示具体日期", () => {
      const oldDate = new Date("2024-01-15T10:30:00Z");
      const result = formatUnlockTime(oldDate.toISOString());
      expect(result).toContain("月");
      expect(result).toContain("日");
      expect(result).toContain(":");
    });
  });
});
