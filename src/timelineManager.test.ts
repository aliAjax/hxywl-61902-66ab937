import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createInitialTimeline,
  pruneOldRecords,
  isValidTimelineData,
  loadTimeline,
  saveTimeline,
  clearTimeline,
  resetTimeline,
  getTimelineRecords,
  getTimelineSummary,
  recordSpawn,
  recordMerge,
  recordMove,
  loadTimelineFromSaveData,
  MAX_TIMELINE_RECORDS,
  MAX_REPLAY_HISTORY_DAYS,
  TIMELINE_STORAGE_KEY,
  TIMELINE_VERSION,
  type TimelineData,
  type TimelineSpawnRecord,
  type TimelineRecord,
} from "./timelineManager";

describe("时间线管理", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
    localStorage.clear();
    clearTimeline();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createInitialTimeline", () => {
    it("应创建初始时间线", () => {
      const timeline = createInitialTimeline();
      expect(timeline.version).toBe(TIMELINE_VERSION);
      expect(timeline.records).toEqual([]);
      expect(timeline.lastRecordId).toBe(0);
      expect(typeof timeline.startTime).toBe("number");
    });
  });

  describe("isValidTimelineData", () => {
    it("应验证合法的时间线数据", () => {
      const validData = {
        version: "1.1.0",
        records: [],
        lastRecordId: 0,
        startTime: Date.now(),
      };
      expect(isValidTimelineData(validData)).toBe(true);
    });

    it("应拒绝 null 和 undefined", () => {
      expect(isValidTimelineData(null)).toBe(false);
      expect(isValidTimelineData(undefined)).toBe(false);
    });

    it("应拒绝非对象数据", () => {
      expect(isValidTimelineData("string")).toBe(false);
      expect(isValidTimelineData(123)).toBe(false);
      expect(isValidTimelineData([])).toBe(false);
    });

    it("应拒绝缺少 version 的数据", () => {
      const data = {
        records: [],
        lastRecordId: 0,
        startTime: Date.now(),
      };
      expect(isValidTimelineData(data)).toBe(false);
    });

    it("应拒绝 records 不是数组的数据", () => {
      const data = {
        version: "1.1.0",
        records: "not array",
        lastRecordId: 0,
        startTime: Date.now(),
      };
      expect(isValidTimelineData(data)).toBe(false);
    });

    it("应拒绝 lastRecordId 不是数字的数据", () => {
      const data = {
        version: "1.1.0",
        records: [],
        lastRecordId: "zero",
        startTime: Date.now(),
      };
      expect(isValidTimelineData(data)).toBe(false);
    });

    it("应拒绝 startTime 不是数字的数据", () => {
      const data = {
        version: "1.1.0",
        records: [],
        lastRecordId: 0,
        startTime: "now",
      };
      expect(isValidTimelineData(data)).toBe(false);
    });
  });

  describe("pruneOldRecords - 7天外记录清理", () => {
    const createTimelineWithOldRecords = (): TimelineData => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const records: TimelineRecord[] = [];

      for (let i = 0; i < 10; i++) {
        records.push({
          id: i + 1,
          type: "spawn",
          timestamp: now - (8 - i) * dayMs,
          gameVersion: TIMELINE_VERSION,
          levelId: "classic",
          level: 1,
          index: i,
          cost: 10,
          freeSpawn: false,
        });
      }

      return {
        version: TIMELINE_VERSION,
        records,
        lastRecordId: 10,
        startTime: now - 10 * dayMs,
      };
    };

    it("应保留7天内的记录，删除7天前的记录", () => {
      const timeline = createTimelineWithOldRecords();
      const beforeCount = timeline.records.length;

      pruneOldRecords(timeline);

      expect(timeline.records.length).toBeLessThan(beforeCount);
      const cutoff = Date.now() - MAX_REPLAY_HISTORY_DAYS * 24 * 60 * 60 * 1000;
      for (const record of timeline.records) {
        expect(record.timestamp).toBeGreaterThanOrEqual(cutoff);
      }
    });

    it("所有记录都在7天内时不应删除任何记录", () => {
      const now = Date.now();
      const records: TimelineRecord[] = [];
      for (let i = 0; i < 5; i++) {
        records.push({
          id: i + 1,
          type: "spawn",
          timestamp: now - i * 24 * 60 * 60 * 1000,
          gameVersion: TIMELINE_VERSION,
          levelId: "classic",
          level: 1,
          index: i,
          cost: 10,
          freeSpawn: false,
        });
      }

      const timeline: TimelineData = {
        version: TIMELINE_VERSION,
        records,
        lastRecordId: 5,
        startTime: now - 5 * 24 * 60 * 60 * 1000,
      };

      pruneOldRecords(timeline);
      expect(timeline.records.length).toBe(5);
    });

    it("所有记录都超过7天时应清空记录", () => {
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const records: TimelineRecord[] = [];
      for (let i = 0; i < 5; i++) {
        records.push({
          id: i + 1,
          type: "spawn",
          timestamp: oldTime - i * 1000,
          gameVersion: TIMELINE_VERSION,
          levelId: "classic",
          level: 1,
          index: i,
          cost: 10,
          freeSpawn: false,
        });
      }

      const timeline: TimelineData = {
        version: TIMELINE_VERSION,
        records,
        lastRecordId: 5,
        startTime: oldTime,
      };

      pruneOldRecords(timeline);
      expect(timeline.records.length).toBe(0);
    });

    it("空记录不应报错", () => {
      const timeline: TimelineData = {
        version: TIMELINE_VERSION,
        records: [],
        lastRecordId: 0,
        startTime: Date.now(),
      };

      expect(() => pruneOldRecords(timeline)).not.toThrow();
      expect(timeline.records.length).toBe(0);
    });
  });

  describe("pruneOldRecords - 记录数量上限", () => {
    const createManyRecords = (count: number): TimelineData => {
      const now = Date.now();
      const records: TimelineRecord[] = [];
      for (let i = 0; i < count; i++) {
        records.push({
          id: i + 1,
          type: "spawn",
          timestamp: now - (count - i) * 1000,
          gameVersion: TIMELINE_VERSION,
          levelId: "classic",
          level: 1,
          index: i,
          cost: 10,
          freeSpawn: false,
        });
      }
      return {
        version: TIMELINE_VERSION,
        records,
        lastRecordId: count,
        startTime: now - count * 1000,
      };
    };

    it(`记录数超过 ${MAX_TIMELINE_RECORDS} 时应裁剪到上限`, () => {
      const overLimit = MAX_TIMELINE_RECORDS + 100;
      const timeline = createManyRecords(overLimit);

      pruneOldRecords(timeline);

      expect(timeline.records.length).toBe(MAX_TIMELINE_RECORDS);
    });

    it(`记录数等于 ${MAX_TIMELINE_RECORDS} 时不应裁剪`, () => {
      const timeline = createManyRecords(MAX_TIMELINE_RECORDS);

      pruneOldRecords(timeline);

      expect(timeline.records.length).toBe(MAX_TIMELINE_RECORDS);
    });

    it(`记录数少于 ${MAX_TIMELINE_RECORDS} 时不应裁剪`, () => {
      const timeline = createManyRecords(100);

      pruneOldRecords(timeline);

      expect(timeline.records.length).toBe(100);
    });

    it("裁剪时应保留最新的记录", () => {
      const overLimit = MAX_TIMELINE_RECORDS + 50;
      const timeline = createManyRecords(overLimit);

      const lastIdBefore = Math.max(...timeline.records.map(r => r.id));
      pruneOldRecords(timeline);
      const lastIdAfter = Math.max(...timeline.records.map(r => r.id));

      expect(lastIdAfter).toBe(lastIdBefore);
      expect(timeline.records[0].id).toBe(overLimit - MAX_TIMELINE_RECORDS + 1);
    });

    it("同时满足时间和数量限制时应两者都生效", () => {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const records: TimelineRecord[] = [];

      for (let i = 0; i < MAX_TIMELINE_RECORDS + 200; i++) {
        records.push({
          id: i + 1,
          type: "spawn",
          timestamp: now - (MAX_TIMELINE_RECORDS + 200 - i) * dayMs,
          gameVersion: TIMELINE_VERSION,
          levelId: "classic",
          level: 1,
          index: i,
          cost: 10,
          freeSpawn: false,
        });
      }

      const timeline: TimelineData = {
        version: TIMELINE_VERSION,
        records,
        lastRecordId: MAX_TIMELINE_RECORDS + 200,
        startTime: now - (MAX_TIMELINE_RECORDS + 200) * dayMs,
      };

      pruneOldRecords(timeline);

      expect(timeline.records.length).toBeLessThanOrEqual(MAX_TIMELINE_RECORDS);
      const cutoff = now - MAX_REPLAY_HISTORY_DAYS * dayMs;
      for (const record of timeline.records) {
        expect(record.timestamp).toBeGreaterThanOrEqual(cutoff);
      }
    });
  });

  describe("localStorage 存储", () => {
    it("loadTimeline 在 localStorage 为空时应创建新时间线并保存", () => {
      const timeline = loadTimeline();

      expect(timeline).toBeDefined();
      expect(timeline.records.length).toBe(0);

      const saved = localStorage.getItem(TIMELINE_STORAGE_KEY);
      expect(saved).not.toBeNull();
    });

    it("loadTimeline 应从 localStorage 加载有效数据", () => {
      const testData: TimelineData = {
        version: TIMELINE_VERSION,
        records: [
          {
            id: 1,
            type: "spawn",
            timestamp: Date.now() - 1000,
            gameVersion: TIMELINE_VERSION,
            levelId: "classic",
            level: 1,
            index: 0,
            cost: 10,
            freeSpawn: false,
          },
        ],
        lastRecordId: 1,
        startTime: Date.now() - 5000,
      };

      clearTimeline();
      localStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(testData));

      const timeline = loadTimeline();
      expect(timeline.records.length).toBe(1);
      expect(timeline.lastRecordId).toBe(1);
    });

    it("saveTimeline 应将时间线保存到 localStorage", () => {
      const timeline = createInitialTimeline();
      saveTimeline(timeline);

      const saved = localStorage.getItem(TIMELINE_STORAGE_KEY);
      expect(saved).not.toBeNull();

      const parsed = JSON.parse(saved!);
      expect(parsed.version).toBe(timeline.version);
    });

    it("clearTimeline 应清除 localStorage 中的时间线", () => {
      localStorage.setItem(TIMELINE_STORAGE_KEY, "test");
      clearTimeline();

      expect(localStorage.getItem(TIMELINE_STORAGE_KEY)).toBeNull();
    });

    it("localStorage 中是损坏 JSON 时应创建新时间线", () => {
      localStorage.setItem(TIMELINE_STORAGE_KEY, "{invalid json}");
      clearTimeline();

      const timeline = loadTimeline();
      expect(timeline).toBeDefined();
      expect(timeline.records).toEqual([]);
    });

    it("localStorage 中数据格式错误时应创建新时间线", () => {
      const badData = {
        wrongField: "value",
        records: "not array",
      };
      localStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(badData));
      clearTimeline();

      const timeline = loadTimeline();
      expect(timeline).toBeDefined();
      expect(timeline.records.length).toBe(0);
    });

    it("resetTimeline 应重置时间线", () => {
      const timeline = loadTimeline();
      recordSpawn(1, 0, 10, false);

      const recordsAfterRecord = getTimelineRecords().length;
      expect(recordsAfterRecord).toBeGreaterThan(0);

      resetTimeline();
      const recordsAfterReset = getTimelineRecords().length;
      expect(recordsAfterReset).toBe(0);
    });
  });

  describe("loadTimelineFromSaveData - 从存档数据加载", () => {
    it("应从有效存档数据加载时间线", () => {
      const now = Date.now();
      const saveData = {
        version: "1.1.0",
        startTime: now - 5000,
        records: [
          {
            id: 5,
            type: "spawn" as const,
            timestamp: now - 1000,
            gameVersion: "1.1.0",
            levelId: "classic",
            level: 1,
            index: 0,
            cost: 10,
            freeSpawn: false,
          },
        ],
      };

      const timeline = loadTimelineFromSaveData(saveData);
      expect(timeline.records.length).toBe(1);
      expect(timeline.lastRecordId).toBe(5);
      expect(timeline.startTime).toBe(now - 5000);
    });

    it("数据为 null 时应创建新时间线", () => {
      const timeline = loadTimelineFromSaveData(null);
      expect(timeline).toBeDefined();
      expect(timeline.records.length).toBe(0);
    });

    it("数据为 undefined 时应创建新时间线", () => {
      const timeline = loadTimelineFromSaveData(undefined);
      expect(timeline).toBeDefined();
      expect(timeline.records.length).toBe(0);
    });

    it("数据格式非法时应创建新时间线", () => {
      const badData = {
        version: "bad",
      };
      const timeline = loadTimelineFromSaveData(badData as unknown as Parameters<typeof loadTimelineFromSaveData>[0]);
      expect(timeline).toBeDefined();
      expect(timeline.records.length).toBe(0);
    });

    it("应根据 lastRecordId 恢复 id 计数器", () => {
      const saveData = {
        version: "1.1.0",
        startTime: 1000,
        records: [
          {
            id: 42,
            type: "spawn" as const,
            timestamp: 2000,
            gameVersion: "1.1.0",
            levelId: "classic",
            level: 1,
            index: 0,
            cost: 10,
            freeSpawn: false,
          },
        ],
      };

      loadTimelineFromSaveData(saveData);
      const record = recordSpawn(1, 1, 10, false);

      expect(record.id).toBe(43);
    });

    it("应自动裁剪超过上限的记录", () => {
      const records: TimelineRecord[] = [];
      for (let i = 0; i < MAX_TIMELINE_RECORDS + 100; i++) {
        records.push({
          id: i + 1,
          type: "spawn",
          timestamp: Date.now() - (MAX_TIMELINE_RECORDS + 100 - i) * 1000,
          gameVersion: "1.1.0",
          levelId: "classic",
          level: 1,
          index: i,
          cost: 10,
          freeSpawn: false,
        });
      }

      const saveData = {
        version: "1.1.0",
        startTime: 1000,
        records,
      };

      const timeline = loadTimelineFromSaveData(saveData);
      expect(timeline.records.length).toBe(MAX_TIMELINE_RECORDS);
    });
  });

  describe("记录操作", () => {
    beforeEach(() => {
      loadTimeline();
    });

    it("recordSpawn 应正确记录生成操作", () => {
      const record = recordSpawn(1, 0, 10, false);

      expect(record.type).toBe("spawn");
      expect(record.level).toBe(1);
      expect(record.index).toBe(0);
      expect(record.cost).toBe(10);
      expect(record.freeSpawn).toBe(false);
      expect(record.id).toBeGreaterThan(0);
      expect(typeof record.timestamp).toBe("number");

      const records = getTimelineRecords();
      expect(records.length).toBe(1);
    });

    it("getTimelineSummary 应正确汇总统计", () => {
      recordSpawn(1, 0, 10, false);
      recordMerge(0, 1, 1, 2, 20, false);
      recordMove(2, 3, 1);

      const summary = getTimelineSummary();
      expect(summary.totalActions).toBe(3);
      expect(summary.totalSpawns).toBe(1);
      expect(summary.totalMerges).toBe(1);
      expect(summary.totalMoves).toBe(1);
      expect(summary.totalCoinsFromMerges).toBe(20);
    });

    it("记录添加后自动保存到 localStorage", () => {
      recordSpawn(1, 0, 10, false);

      const saved = localStorage.getItem(TIMELINE_STORAGE_KEY);
      expect(saved).not.toBeNull();

      const parsed = JSON.parse(saved!);
      expect(parsed.records.length).toBe(1);
    });
  });
});
