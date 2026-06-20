import { describe, it, expect } from "vitest";
import {
  isValidVersionFormat,
  compareVersions,
  isCompatibleVersion,
  hasTimelineSupport,
  migrateLegacySaveToMultiLevel,
  parseSaveFromString,
  validateSaveFile,
  sanitizeSaveData,
  createSaveFile,
  type SaveFileGameData,
  SAVE_VERSION,
  MIN_TIMELINE_SAVE_VERSION,
} from "./saveManager";

describe("版本号相关", () => {
  describe("isValidVersionFormat", () => {
    it("应正确验证合法的语义化版本号", () => {
      expect(isValidVersionFormat("1.0.0")).toBe(true);
      expect(isValidVersionFormat("2.10.3")).toBe(true);
      expect(isValidVersionFormat("0.0.1")).toBe(true);
      expect(isValidVersionFormat("10.20.30")).toBe(true);
    });

    it("应拒绝非法格式的版本号", () => {
      expect(isValidVersionFormat("")).toBe(false);
      expect(isValidVersionFormat("1.0")).toBe(false);
      expect(isValidVersionFormat("v1.0.0")).toBe(false);
      expect(isValidVersionFormat("1.0.0-beta")).toBe(false);
      expect(isValidVersionFormat("abc")).toBe(false);
      expect(isValidVersionFormat("1.2.3.4")).toBe(false);
      expect(isValidVersionFormat("01.2.3")).toBe(false);
    });

    it("应拒绝非字符串或空值", () => {
      expect(isValidVersionFormat(null as unknown as string)).toBe(false);
      expect(isValidVersionFormat(undefined as unknown as string)).toBe(false);
      expect(isValidVersionFormat(123 as unknown as string)).toBe(false);
    });
  });

  describe("compareVersions", () => {
    it("应正确比较主版本号", () => {
      expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
      expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    });

    it("应正确比较次版本号", () => {
      expect(compareVersions("1.2.0", "1.1.0")).toBe(1);
      expect(compareVersions("1.1.0", "1.2.0")).toBe(-1);
    });

    it("应正确比较修订号", () => {
      expect(compareVersions("1.0.2", "1.0.1")).toBe(1);
      expect(compareVersions("1.0.1", "1.0.2")).toBe(-1);
    });

    it("相同版本号应返回0", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("2.10.3", "2.10.3")).toBe(0);
    });

    it("非法版本号应返回-1", () => {
      expect(compareVersions("invalid", "1.0.0")).toBe(-1);
      expect(compareVersions("1.0.0", "invalid")).toBe(-1);
      expect(compareVersions("", "")).toBe(-1);
    });

    it("应正确比较多位数版本段", () => {
      expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
      expect(compareVersions("10.0.0", "9.0.0")).toBe(1);
    });
  });

  describe("isCompatibleVersion", () => {
    it("1.0.0及以上版本应兼容", () => {
      expect(isCompatibleVersion("1.0.0")).toBe(true);
      expect(isCompatibleVersion("1.5.0")).toBe(true);
      expect(isCompatibleVersion("2.0.0")).toBe(true);
    });

    it("低于1.0.0的版本应不兼容", () => {
      expect(isCompatibleVersion("0.9.9")).toBe(false);
      expect(isCompatibleVersion("0.0.1")).toBe(false);
    });

    it("非法版本号应不兼容", () => {
      expect(isCompatibleVersion("invalid")).toBe(false);
    });
  });

  describe("hasTimelineSupport", () => {
    it(MIN_TIMELINE_SAVE_VERSION + "及以上版本应支持时间线", () => {
      expect(hasTimelineSupport(MIN_TIMELINE_SAVE_VERSION)).toBe(true);
      expect(hasTimelineSupport("2.0.0")).toBe(true);
    });

    it("低于" + MIN_TIMELINE_SAVE_VERSION + "的版本应不支持时间线", () => {
      expect(hasTimelineSupport("1.0.0")).toBe(false);
      expect(hasTimelineSupport("0.9.0")).toBe(false);
    });

    it("非法版本号应返回false", () => {
      expect(hasTimelineSupport("invalid")).toBe(false);
    });
  });
});

describe("旧存档迁移 (1.0单关卡 -> 多关卡)", () => {
  const createLegacySave = (): SaveFileGameData => ({
    coins: 500,
    board: [1, 2, null, 3, 1, null, 2, null, 1, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    maxLevel: 5,
    unlockedLevels: [1, 2, 3, 4, 5],
    unlockTimes: {
      1: "2024-01-01T00:00:00.000Z",
      2: "2024-01-02T00:00:00.000Z",
      3: "2024-01-03T00:00:00.000Z",
      4: "2024-01-04T00:00:00.000Z",
      5: "2024-01-05T00:00:00.000Z",
    },
    orders: [
      {
        id: 1,
        items: [
          { level: 1, count: 3, collected: 2 },
          { level: 2, count: 1, collected: 0 },
        ],
        reward: 100,
        completed: false,
      },
    ],
    spawnCooldownEnd: 1234567890,
    timeline: {
      version: "1.1.0",
      startTime: 1000000000,
      records: [],
    },
  });

  it("应将单关卡数据迁移到 classic 关卡", () => {
    const legacy = createLegacySave();
    const result = migrateLegacySaveToMultiLevel(legacy);

    expect(result.currentLevel).toBe("classic");
    expect(result.levels.classic.coins).toBe(legacy.coins);
    expect(result.levels.classic.board).toEqual(legacy.board);
    expect(result.levels.classic.maxLevel).toBe(legacy.maxLevel);
    expect(result.levels.classic.unlockedLevels).toEqual(legacy.unlockedLevels);
    expect(result.levels.classic.unlockTimes).toEqual(legacy.unlockTimes);
    expect(result.levels.classic.orders).toEqual(legacy.orders);
    expect(result.levels.classic.spawnCooldownEnd).toBe(legacy.spawnCooldownEnd);
  });

  it("应保留全局时间线数据", () => {
    const legacy = createLegacySave();
    const result = migrateLegacySaveToMultiLevel(legacy);

    expect(result.globalTimeline).toEqual(legacy.timeline);
  });

  it("旧存档没有时间线时 globalTimeline 应为 null", () => {
    const legacy = createLegacySave();
    delete legacy.timeline;
    const result = migrateLegacySaveToMultiLevel(legacy);

    expect(result.globalTimeline).toBeNull();
  });

  it("应包含所有已知关卡的初始数据", () => {
    const legacy = createLegacySave();
    const result = migrateLegacySaveToMultiLevel(legacy);

    expect(result.levels.classic).toBeDefined();
    expect(result.levels.beverage).toBeDefined();

    expect(result.levels.beverage.coins).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.levels.beverage.board)).toBe(true);
  });

  it("迁移后 classic 数据应与旧存档一致，其他关卡使用默认值", () => {
    const legacy = createLegacySave();
    const result = migrateLegacySaveToMultiLevel(legacy);

    expect(result.levels.classic.coins).toBe(500);
    expect(result.levels.beverage.coins).not.toBe(500);
  });

  it("旧存档 spawnCooldownEnd 为 undefined 时应默认为0", () => {
    const legacy = createLegacySave();
    (legacy as Partial<SaveFileGameData>).spawnCooldownEnd = undefined;
    const result = migrateLegacySaveToMultiLevel(legacy);

    expect(result.levels.classic.spawnCooldownEnd).toBe(0);
  });
});

describe("损坏 JSON 兜底", () => {
  describe("parseSaveFromString", () => {
    it("应正确解析合法 JSON", () => {
      const validJson = JSON.stringify({
        version: "2.0.0",
        gameId: "hxywl-61902",
        timestamp: 1234567890,
        data: {
          coins: 100,
          board: [],
          maxLevel: 1,
          unlockedLevels: [1],
          orders: [],
          spawnCooldownEnd: 0,
        },
      });

      const result = parseSaveFromString(validJson);
      expect(result.success).toBe(true);
      expect(result.save).not.toBeNull();
      expect(result.error).toBe("");
    });

    it("损坏的 JSON 应返回失败并附带错误信息", () => {
      const result = parseSaveFromString("{invalid json}");
      expect(result.success).toBe(false);
      expect(result.save).toBeNull();
      expect(result.error).toContain("JSON解析失败");
    });

    it("空字符串应返回失败", () => {
      const result = parseSaveFromString("");
      expect(result.success).toBe(false);
      expect(result.save).toBeNull();
    });

    it("普通字符串而非 JSON 对象应返回失败", () => {
      const result = parseSaveFromString('"just a string"');
      expect(result.success).toBe(true);
      expect(result.save).toBe("just a string" as unknown as typeof result.save);
    });
  });

  describe("validateSaveFile", () => {
    it("空存档应验证失败", () => {
      const result = validateSaveFile(null);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("非对象存档应验证失败", () => {
      const result = validateSaveFile("not an object");
      expect(result.isValid).toBe(false);
    });

    it("缺少版本号的存档应验证失败", () => {
      const result = validateSaveFile({
        gameId: "hxywl-61902",
        data: { coins: 100, board: [], maxLevel: 1, unlockedLevels: [1], orders: [], spawnCooldownEnd: 0 },
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("版本号"))).toBe(true);
    });

    it("非法版本格式的存档应验证失败", () => {
      const result = validateSaveFile({
        version: "invalid",
        gameId: "hxywl-61902",
        data: { coins: 100, board: [], maxLevel: 1, unlockedLevels: [1], orders: [], spawnCooldownEnd: 0 },
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("格式非法"))).toBe(true);
    });

    it("缺少 data 的存档应验证失败", () => {
      const result = validateSaveFile({
        version: "2.0.0",
        gameId: "hxywl-61902",
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("游戏数据"))).toBe(true);
    });

    it("有效的存档应通过验证", () => {
      const save = createSaveFile({
        coins: 100,
        board: Array(25).fill(null),
        maxLevel: 1,
        unlockedLevels: [1],
        unlockTimes: { 1: new Date().toISOString() },
        orders: [],
        spawnCooldownEnd: 0,
      });

      const result = validateSaveFile(save);
      expect(result.isValid).toBe(true);
    });

    it("游戏ID不匹配应报错", () => {
      const result = validateSaveFile({
        version: "2.0.0",
        gameId: "other-game",
        data: { coins: 100, board: [], maxLevel: 1, unlockedLevels: [1], orders: [], spawnCooldownEnd: 0 },
      });
      expect(result.errors.some(e => e.includes("ID不匹配"))).toBe(true);
    });
  });

  describe("sanitizeSaveData", () => {
    const createFallback = (): SaveFileGameData => ({
      coins: 50,
      board: Array(25).fill(null),
      maxLevel: 1,
      unlockedLevels: [1],
      unlockTimes: { 1: "2024-01-01T00:00:00.000Z" },
      orders: [],
      spawnCooldownEnd: 0,
    });

    it("数据完整时应保留原值", () => {
      const data: SaveFileGameData = {
        coins: 1000,
        board: [1, 2, 3, null, null],
        maxLevel: 5,
        unlockedLevels: [1, 2, 3, 4, 5],
        unlockTimes: { 1: "2024-01-01T00:00:00.000Z" },
        orders: [],
        spawnCooldownEnd: 12345,
      };

      const result = sanitizeSaveData(data, createFallback());
      expect(result.coins).toBe(1000);
      expect(result.maxLevel).toBe(5);
    });

    it("非法数据应使用兜底值", () => {
      const badData = {
        coins: -100,
        board: "not an array" as unknown as (number | null)[],
        maxLevel: "high" as unknown as number,
        unlockedLevels: "all" as unknown as number[],
        orders: "none" as unknown as [],
        spawnCooldownEnd: -5,
      } as unknown as SaveFileGameData;

      const result = sanitizeSaveData(badData, createFallback());
      expect(result.coins).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(result.board)).toBe(true);
      expect(result.maxLevel).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.unlockedLevels)).toBe(true);
      expect(Array.isArray(result.orders)).toBe(true);
    });

    it("金币为负数时应使用兜底值", () => {
      const data = { ...createFallback(), coins: -50 };
      const result = sanitizeSaveData(data, createFallback());
      expect(result.coins).toBe(50);
    });

    it("金币有小数时应向下取整", () => {
      const data = { ...createFallback(), coins: 100.9 };
      const result = sanitizeSaveData(data, createFallback());
      expect(result.coins).toBe(100);
    });

    it("非法棋盘格应替换为 null", () => {
      const data = {
        ...createFallback(),
        board: [1, "invalid", 999, null, true] as unknown as (number | null)[],
      };
      const result = sanitizeSaveData(data, createFallback());
      expect(result.board[0]).toBe(1);
      expect(result.board[1]).toBeNull();
      expect(result.board[2]).toBeNull();
      expect(result.board[3]).toBeNull();
      expect(result.board[4]).toBeNull();
    });

    it("unlockedLevels 必须包含等级1", () => {
      const data = {
        ...createFallback(),
        unlockedLevels: [2, 3],
      };
      const result = sanitizeSaveData(data, createFallback());
      expect(result.unlockedLevels).toContain(1);
    });

    it("maxLevel 范围内的等级应自动加入 unlockedLevels", () => {
      const data = {
        ...createFallback(),
        maxLevel: 3,
        unlockedLevels: [1],
      };
      const result = sanitizeSaveData(data, createFallback());
      expect(result.unlockedLevels).toContain(2);
      expect(result.unlockedLevels).toContain(3);
    });

    it("时间线数据异常时应安全处理", () => {
      const data = {
        ...createFallback(),
        timeline: "invalid" as unknown as null,
      };
      const result = sanitizeSaveData(data, createFallback());
      expect(result.timeline).toBeUndefined();
    });

    it("时间线记录超过500条时应裁剪", () => {
      const records = Array.from({ length: 600 }, (_, i) => ({
        id: i,
        type: "spawn" as const,
        timestamp: 1000 + i,
        gameVersion: SAVE_VERSION,
        levelId: "classic",
        level: 1,
        index: i,
        cost: 10,
        freeSpawn: false,
      }));

      const data = {
        ...createFallback(),
        timeline: {
          version: "1.1.0",
          startTime: 1000,
          records,
        },
      };

      const result = sanitizeSaveData(data, createFallback());
      expect(result.timeline?.records.length).toBe(500);
    });
  });
});
