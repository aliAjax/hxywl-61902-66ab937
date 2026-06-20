import { test, expect } from "@playwright/test";

test.describe("甜品合成店 - 核心流程冒烟测试", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(() => {
      localStorage.clear();
      const tutorialKey = "hxywl-61902-tutorial";
      const offlineKey = "hxywl-61902-offline";
      localStorage.setItem(tutorialKey, JSON.stringify({
        currentStep: "completed",
        completedSteps: ["welcome", "spawn", "merge", "order", "collection", "offline", "completed"],
        hasSpawned: true,
        hasMerged: true,
        hasCompletedOrder: true,
        hasViewedCollection: true,
        hasClaimedOffline: true,
      }));
      localStorage.setItem(offlineKey, JSON.stringify({
        lastLeaveTime: Date.now(),
        lastClaimTime: Date.now(),
      }));
    });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const closeSelectors = [
      "button:has-text('跳过引导')",
      "button:has-text('跳过')",
      "button:has-text('立即领取')",
      "button:has-text('领取')",
      "button:has-text('知道了')",
      "button:has-text('关闭')",
      "button:has-text('×')",
    ];

    for (const selector of closeSelectors) {
      try {
        const buttons = page.locator(selector);
        const count = await buttons.count();
        for (let i = 0; i < count; i++) {
          if (await buttons.nth(i).isVisible()) {
            await buttons.nth(i).click();
            await page.waitForTimeout(500);
          }
        }
      } catch (e) {
      }
    }

    await page.waitForTimeout(1000);
  });

  test("页面应正确加载并显示核心UI元素", async ({ page }) => {
    await expect(page.locator("h1").filter({ hasText: /甜品合成店/ })).toBeVisible();
    await expect(page.getByText(/金币/)).toBeVisible();
    await expect(page.getByText(/图鉴/)).toBeVisible();
    await expect(page.getByRole("button", { name: /生成甜品/ })).toBeVisible();
    const boardCells = page.locator(".board .cell");
    expect(await boardCells.count()).toBe(25);
  });

  test("初始状态应有正确的金币和棋盘", async ({ page }) => {
    const coinDisplay = page.getByText(/金币/).first();
    await expect(coinDisplay).toContainText("50");

    const level1Cells = page.locator(".board .cell").filter({
      hasText: "🍬",
    });
    expect(await level1Cells.count()).toBe(6);
  });

  test("点击生成甜品按钮应生成新甜品", async ({ page }) => {
    const spawnButton = page.getByRole("button", { name: /生成甜品/ });

    const initialCoinText = await page.getByText(/金币/).first().textContent();
    const initialCoins = parseInt(initialCoinText?.match(/\d+/)?.[0] || "0", 10);

    await spawnButton.click();

    await page.waitForTimeout(500);

    const newCoinText = await page.getByText(/金币/).first().textContent();
    const newCoins = parseInt(newCoinText?.match(/\d+/)?.[0] || "0", 10);
    expect(newCoins).toBe(initialCoins - 10);

    const level1Cells = page.locator(".board .cell").filter({
      hasText: "🍬",
    });
    expect(await level1Cells.count()).toBe(7);
  });

  test("拖拽合成两个相同甜品应成功合成更高级甜品", async ({ page }) => {
    await page.evaluate(() => {
      const board = [1, 1, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null];
      window.dispatchEvent(new CustomEvent("test-set-board", { detail: { board, coins: 100 } }));
    });

    await page.waitForTimeout(300);

    const cells = page.locator(".board .cell");
    const sourceCell = cells.nth(0);
    const targetCell = cells.nth(1);

    const sourceBox = await sourceCell.boundingBox();
    const targetBox = await targetCell.boundingBox();

    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 }
    );
    await page.mouse.up();

    await page.waitForTimeout(800);

    const level2Cells = page.locator(".board .cell").filter({
      hasText: "🍪",
    });
    expect(await level2Cells.count()).toBeGreaterThanOrEqual(1);

    const coinDisplay = page.getByText(/金币/).first();
    await expect(coinDisplay).toContainText(/120/);
  });

  test("合成新等级应更新图鉴和最高等级", async ({ page }) => {
    await page.evaluate(() => {
      const board = [1, 1, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null];
      window.dispatchEvent(new CustomEvent("test-set-board", { detail: { board, coins: 100, maxLevel: 1, unlockedLevels: [1] } }));
    });

    await page.waitForTimeout(300);

    const cells = page.locator(".board .cell");
    const sourceCell = cells.nth(0);
    const targetCell = cells.nth(1);

    const sourceBox = await sourceCell.boundingBox();
    const targetBox = await targetCell.boundingBox();

    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 }
    );
    await page.mouse.up();

    await page.waitForTimeout(1000);

    const collectionPanel = page.locator(".collection-panel");
    await expect(collectionPanel).toContainText("🍪");

    const maxLevelDisplay = page.getByText(/最高等级/);
    await expect(maxLevelDisplay).toContainText("2");
  });

  test("生成甜品到合成的完整流程应能持续进行", async ({ page }) => {
    const spawnButton = page.getByRole("button", { name: /生成甜品/ });

    await spawnButton.click();
    await page.waitForTimeout(600);

    await spawnButton.click();
    await page.waitForTimeout(600);

    await spawnButton.click();
    await page.waitForTimeout(600);

    const level1CellsBefore = await page
      .locator(".board .cell")
      .filter({ hasText: "🍬" })
      .count();
    expect(level1CellsBefore).toBeGreaterThanOrEqual(2);

    const cells = page.locator(".board .cell");
    const level1Positions: number[] = [];

    for (let i = 0; i < 25; i++) {
      const text = await cells.nth(i).textContent();
      if (text?.includes("🍬") && level1Positions.length < 2) {
        level1Positions.push(i);
      }
    }

    expect(level1Positions.length).toBeGreaterThanOrEqual(2);

    const sourceBox = await cells.nth(level1Positions[0]).boundingBox();
    const targetBox = await cells.nth(level1Positions[1]).boundingBox();

    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 15 }
    );
    await page.mouse.up();

    await page.waitForTimeout(1000);

    const level2Cells = await page
      .locator(".board .cell")
      .filter({ hasText: "🍪" })
      .count();
    expect(level2Cells).toBeGreaterThanOrEqual(1);
  });

  test("连续合成应能解锁更高等级甜品", async ({ page }) => {
    await page.evaluate(() => {
      const board = [
        2, 2, 2, 2, null,
        null, null, null, null, null,
        null, null, null, null, null,
        null, null, null, null, null,
        null, null, null, null, null,
      ];
      window.dispatchEvent(new CustomEvent("test-set-board", {
        detail: { board, coins: 500, maxLevel: 2, unlockedLevels: [1, 2] }
      }));
    });

    await page.waitForTimeout(300);

    const cells = page.locator(".board .cell");

    for (let round = 0; round < 2; round++) {
      const positions: number[] = [];
      for (let i = 0; i < 25; i++) {
        const text = await cells.nth(i).textContent();
        if (text?.includes("🍪") && positions.length < 2) {
          positions.push(i);
        }
      }

      if (positions.length >= 2) {
        const sourceBox = await cells.nth(positions[0]).boundingBox();
        const targetBox = await cells.nth(positions[1]).boundingBox();

        await page.mouse.move(
          sourceBox!.x + sourceBox!.width / 2,
          sourceBox!.y + sourceBox!.height / 2
        );
        await page.mouse.down();
        await page.mouse.move(
          targetBox!.x + targetBox!.width / 2,
          targetBox!.y + targetBox!.height / 2,
          { steps: 10 }
        );
        await page.mouse.up();
        await page.waitForTimeout(800);
      }
    }

    const level3Cells = await page
      .locator(".board .cell")
      .filter({ hasText: "🍩" })
      .count();
    expect(level3Cells).toBeGreaterThanOrEqual(1);
  });

  test("存档功能 - 刷新页面后进度应保留", async ({ page, context }) => {
    await page.evaluate(() => {
      const board = [
        1, 1, 2, null, null,
        null, null, null, null, null,
        null, null, null, null, null,
        null, null, null, null, null,
        null, null, null, null, null,
      ];
      window.dispatchEvent(new CustomEvent("test-set-board", {
        detail: { board, coins: 200, maxLevel: 2, unlockedLevels: [1, 2] }
      }));
    });

    await page.waitForTimeout(1000);

    await page.reload();
    await page.waitForLoadState("networkidle");

    const coinDisplay = page.getByText(/金币/).first();
    await expect(coinDisplay).toContainText("200");

    const level2Cells = await page
      .locator(".board .cell")
      .filter({ hasText: "🍪" })
      .count();
    expect(level2Cells).toBe(1);
  });

  test("订单系统 - 应有订单显示", async ({ page }) => {
    const ordersPanel = page.locator(".orders-panel");
    await expect(ordersPanel).toBeVisible();

    const orderItems = ordersPanel.locator(".order-item");
    expect(await orderItems.count()).toBeGreaterThanOrEqual(1);
  });

  test("不同等级的甜品应显示正确的表情符号", async ({ page }) => {
    await page.evaluate(() => {
      const board = [
        1, 2, 3, 4, 5,
        6, 7, 8, 9, 10,
        null, null, null, null, null,
        null, null, null, null, null,
        null, null, null, null, null,
      ];
      window.dispatchEvent(new CustomEvent("test-set-board", {
        detail: { board, coins: 1000, maxLevel: 10, unlockedLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }
      }));
    });

    await page.waitForTimeout(300);

    const cells = page.locator(".board .cell");

    const expectedEmojis = ["🍬", "🍪", "🍩", "🧁", "🍰", "🍮", "🎂", "🍨", "🥧", "🍫"];
    for (let i = 0; i < expectedEmojis.length; i++) {
      await expect(cells.nth(i)).toContainText(expectedEmojis[i]);
    }
  });

  test("自动整理功能应能整理棋盘", async ({ page }) => {
    await page.evaluate(() => {
      const board = [
        null, 1, null, 2, null,
        3, null, 1, null, 2,
        null, 1, null, null, null,
        null, null, null, null, null,
        null, null, null, null, null,
      ];
      window.dispatchEvent(new CustomEvent("test-set-board", {
        detail: { board, coins: 100, maxLevel: 3, unlockedLevels: [1, 2, 3] }
      }));
    });

    await page.waitForTimeout(300);

    const organizeButton = page.getByRole("button", { name: /自动整理/ });
    await organizeButton.click();

    await page.waitForTimeout(500);

    const cells = page.locator(".board .cell");
    const firstThreeCells = [];
    for (let i = 0; i < 6; i++) {
      firstThreeCells.push(await cells.nth(i).textContent());
    }

    const hasNullInFirstSix = firstThreeCells.some(
      (text) => !text || text.trim() === ""
    );
    expect(hasNullInFirstSix).toBe(false);
  });
});
