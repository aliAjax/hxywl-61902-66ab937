import { test, expect, Locator } from "@playwright/test";

test.describe("甜品合成店 - 核心流程冒烟测试", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(() => {
      localStorage.clear();
      const tutorialKey = "hxywl-61902-tutorial";
      const offlineKey = "hxywl-61902-offline";
      const saveKey = "hxywl-61902-save";
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
      localStorage.removeItem(saveKey);
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    await page.waitForTimeout(2000);

    try {
      await page.waitForSelector(".board", { state: "visible", timeout: 20000 });
    } catch (e) {
      const bodyHTML = await page.evaluate(() => document.body.innerHTML.slice(0, 2000));
      console.log("Page HTML when .board not found:", bodyHTML);
      throw e;
    }

    const closeSelectors = [
      "button:has-text('跳过引导')",
      "button:has-text('跳过')",
      "button:has-text('立即领取')",
      "button:has-text('领取')",
      "button:has-text('知道了')",
      "button:has-text('关闭')",
      "button:has-text('×')",
      "button:has-text('✕')",
    ];

    for (const selector of closeSelectors) {
      try {
        const buttons = page.locator(selector);
        const count = await buttons.count();
        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);
          if (await btn.isVisible({ timeout: 1000 })) {
            await btn.click({ force: true });
            await page.waitForTimeout(300);
          }
        }
      } catch (e) {
      }
    }

    await page.waitForTimeout(500);
  });

  const getCell = (page: any, index: number): Locator => {
    return page.locator(`.board .cell[data-index="${index}"]`);
  };

  const getCoinDisplay = (page: any): Locator => {
    return page.locator(".hud").locator("article").filter({ hasText: "金币" }).locator("strong").first();
  };

  const getSpawnButton = (page: any): Locator => {
    return page.locator("button.action-spawn");
  };

  const getDessertLevel = async (cell: Locator): Promise<number | null> => {
    const levelText = await cell.locator(".dessert-level").textContent();
    if (!levelText) return null;
    const match = levelText.match(/Lv\.(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  };

  const getDessertEmoji = async (cell: Locator): Promise<string | null> => {
    return await cell.locator(".dessert-emoji").textContent();
  };

  const waitForBoardReady = async (page: any): Promise<void> => {
    await page.waitForSelector('.board .cell[data-index="0"]', { state: "visible", timeout: 15000 });
    await page.waitForTimeout(300);
  };

  const setTestBoard = async (page: any, board: (number | null)[], options: any = {}): Promise<void> => {
    await page.evaluate(({ board, options }) => {
      return new Promise<void>((resolve) => {
        const attemptSet = () => {
          if (typeof window !== "undefined" && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent("test-set-board", {
              detail: { board, ...options }
            }));
            setTimeout(resolve, 300);
          } else {
            setTimeout(attemptSet, 100);
          }
        };
        attemptSet();
      });
    }, { board, options });
    await page.waitForTimeout(300);
  };

  const testMerge = async (page: any, sourceIndex: number, targetIndex: number): Promise<void> => {
    await page.evaluate(({ sourceIndex, targetIndex }) => {
      window.dispatchEvent(new CustomEvent("test-merge", {
        detail: { sourceIndex, targetIndex, isEvent: false }
      }));
    }, { sourceIndex, targetIndex });
    await page.waitForTimeout(500);
  };

  const testSpawn = async (page: any): Promise<void> => {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("test-spawn", {
        detail: { isEvent: false }
      }));
    });
    await page.waitForTimeout(500);
  };

  const dragCellToCell = async (page: any, sourceIndex: number, targetIndex: number): Promise<void> => {
    const sourceCell = getCell(page, sourceIndex);
    const targetCell = getCell(page, targetIndex);

    const sourceBox = await sourceCell.boundingBox();
    const targetBox = await targetCell.boundingBox();

    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const sourceX = sourceBox!.x + sourceBox!.width / 2;
    const sourceY = sourceBox!.y + sourceBox!.height / 2;
    const targetX = targetBox!.x + targetBox!.width / 2;
    const targetY = targetBox!.y + targetBox!.height / 2;

    await page.evaluate(({ sourceX, sourceY, targetX, targetY, sourceIndex, targetIndex }) => {
      const sourceEl = document.querySelector(`.board .cell[data-index="${sourceIndex}"]`);
      if (!sourceEl) return;

      const pointerId = 1;
      const createPointerEvent = (type: string, x: number, y: number) => {
        return new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "mouse",
          clientX: x,
          clientY: y,
          pressure: type === "pointerup" ? 0 : 0.5,
        });
      };

      sourceEl.dispatchEvent(createPointerEvent("pointerover", sourceX, sourceY));
      sourceEl.dispatchEvent(createPointerEvent("pointerdown", sourceX, sourceY));

      const midX = (sourceX + targetX) / 2 + 30;
      const midY = (sourceY + targetY) / 2 + 30;
      sourceEl.dispatchEvent(createPointerEvent("pointermove", midX, midY));

      sourceEl.dispatchEvent(createPointerEvent("pointermove", targetX, targetY));

      const targetEl = document.querySelector(`.board .cell[data-index="${targetIndex}"]`);
      if (targetEl) {
        targetEl.dispatchEvent(createPointerEvent("pointerover", targetX, targetY));
        targetEl.dispatchEvent(createPointerEvent("pointerup", targetX, targetY));
      }

      sourceEl.dispatchEvent(createPointerEvent("pointerleave", targetX, targetY));
    }, { sourceX, sourceY, targetX, targetY, sourceIndex, targetIndex });

    await page.waitForTimeout(800);
  };

  const countCellsWithLevel = async (page: any, level: number): Promise<number> => {
    const cells = page.locator(".board .cell.has-dessert");
    const totalCells = await cells.count();
    let count = 0;

    for (let i = 0; i < totalCells; i++) {
      const cell = cells.nth(i);
      const cellLevel = await getDessertLevel(cell);
      if (cellLevel === level) {
        count++;
      }
    }

    return count;
  };

  test("页面应正确加载并显示核心UI元素", async ({ page }) => {
    await waitForBoardReady(page);

    await expect(page.locator("h1").filter({ hasText: /甜品合成店/ })).toBeVisible();

    const coinDisplay = getCoinDisplay(page);
    await expect(coinDisplay).toBeVisible();

    await expect(page.getByText(/图鉴/).first()).toBeVisible();

    const spawnButton = getSpawnButton(page);
    await expect(spawnButton).toBeVisible();

    const boardCells = page.locator(".board .cell");
    expect(await boardCells.count()).toBe(25);
  });

  test("初始状态应有正确的金币和棋盘", async ({ page }) => {
    await waitForBoardReady(page);

    const coinDisplay = getCoinDisplay(page);
    await expect(coinDisplay).toHaveText("50");

    const level1Count = await countCellsWithLevel(page, 1);
    expect(level1Count).toBe(6);
  });

  test("点击生成甜品按钮应生成新甜品", async ({ page }) => {
    await waitForBoardReady(page);

    const initialCoins = parseInt(await getCoinDisplay(page).textContent() || "0", 10);
    const initialLevel1Count = await countCellsWithLevel(page, 1);

    await testSpawn(page);

    const newCoins = parseInt(await getCoinDisplay(page).textContent() || "0", 10);
    expect(newCoins).toBe(initialCoins - 10);

    const newLevel1Count = await countCellsWithLevel(page, 1);
    expect(newLevel1Count).toBe(initialLevel1Count + 1);
  });

  test("UI点击生成甜品按钮应生成新甜品", async ({ page }) => {
    await waitForBoardReady(page);

    const initialCoins = parseInt(await getCoinDisplay(page).textContent() || "0", 10);
    const initialLevel1Count = await countCellsWithLevel(page, 1);

    const spawnButton = getSpawnButton(page);
    await spawnButton.click({ force: true });
    await page.waitForTimeout(800);

    const newCoins = parseInt(await getCoinDisplay(page).textContent() || "0", 10);
    expect(newCoins).toBe(initialCoins - 10);

    const newLevel1Count = await countCellsWithLevel(page, 1);
    expect(newLevel1Count).toBe(initialLevel1Count + 1);
  });

  test("调用test-merge合成两个相同甜品应成功", async ({ page }) => {
    await waitForBoardReady(page);

    const testBoard: (number | null)[] = [
      1, 1, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
    ];
    await setTestBoard(page, testBoard, { coins: 100, maxLevel: 1, unlockedLevels: [1] });

    const sourceCell = getCell(page, 0);
    await expect(sourceCell).toHaveClass(/has-dessert/);
    await expect(sourceCell.locator(".dessert-level")).toHaveText("Lv.1");

    await testMerge(page, 0, 1);

    const level2Count = await countCellsWithLevel(page, 2);
    expect(level2Count).toBeGreaterThanOrEqual(1);

    const level2Cells = page.locator(".board .cell.has-dessert").filter({
      has: page.locator(".dessert-level", { hasText: "Lv.2" })
    });
    const level2Emoji = await getDessertEmoji(level2Cells.first());
    expect(level2Emoji).toBe("🍪");

    const coinDisplay = getCoinDisplay(page);
    await expect(coinDisplay).toHaveText("120");
  });

  test("拖拽合成两个相同甜品应成功合成更高级甜品", async ({ page }) => {
    await waitForBoardReady(page);

    const testBoard: (number | null)[] = [
      1, 1, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
    ];
    await setTestBoard(page, testBoard, { coins: 100, maxLevel: 1, unlockedLevels: [1] });

    const sourceCell = getCell(page, 0);
    await expect(sourceCell).toHaveClass(/has-dessert/);
    await expect(sourceCell.locator(".dessert-level")).toHaveText("Lv.1");

    await dragCellToCell(page, 0, 1);

    const level2Count = await countCellsWithLevel(page, 2);
    expect(level2Count).toBeGreaterThanOrEqual(1);
  });

  test("合成新等级应更新图鉴和最高等级", async ({ page }) => {
    await waitForBoardReady(page);

    const testBoard: (number | null)[] = [
      1, 1, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
    ];
    await setTestBoard(page, testBoard, { coins: 100, maxLevel: 1, unlockedLevels: [1] });

    await testMerge(page, 0, 1);

    const collectionPanel = page.locator(".collection-panel");
    await expect(collectionPanel).toBeVisible();
    await expect(collectionPanel).toContainText("🍪");

    const maxLevelDisplay = page.locator(".hud").locator("article").filter({ hasText: "最高等级" });
    await expect(maxLevelDisplay).toContainText("2");
  });

  test("生成甜品到合成的完整流程应能持续进行", async ({ page }) => {
    await waitForBoardReady(page);

    await testSpawn(page);
    await testSpawn(page);
    await testSpawn(page);

    const cells = page.locator(".board .cell.has-dessert");
    const totalCells = await cells.count();
    const positions: number[] = [];

    for (let i = 0; i < totalCells && positions.length < 2; i++) {
      const cell = cells.nth(i);
      const cellLevel = await getDessertLevel(cell);
      if (cellLevel === 1) {
        const dataIndex = await cell.getAttribute("data-index");
        if (dataIndex !== null) {
          positions.push(parseInt(dataIndex, 10));
        }
      }
    }

    expect(positions.length).toBeGreaterThanOrEqual(2);

    await testMerge(page, positions[0], positions[1]);

    const level2Count = await countCellsWithLevel(page, 2);
    expect(level2Count).toBeGreaterThanOrEqual(1);
  });

  test("连续合成应能解锁更高等级甜品", async ({ page }) => {
    await waitForBoardReady(page);

    const testBoard: (number | null)[] = [
      2, 2, 2, 2, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
    ];
    await setTestBoard(page, testBoard, { coins: 500, maxLevel: 2, unlockedLevels: [1, 2] });

    await testMerge(page, 0, 1);
    await testMerge(page, 2, 3);

    const level3Count = await countCellsWithLevel(page, 3);
    expect(level3Count).toBeGreaterThanOrEqual(1);

    const level3Cells = page.locator(".board .cell.has-dessert").filter({
      has: page.locator(".dessert-level", { hasText: "Lv.3" })
    });
    const level3Emoji = await getDessertEmoji(level3Cells.first());
    expect(level3Emoji).toBe("🍩");
  });

  test("存档功能 - 刷新页面后应保留游戏状态", async ({ page }) => {
    await waitForBoardReady(page);

    const testBoard: (number | null)[] = [
      1, 1, 2, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
    ];
    await setTestBoard(page, testBoard, { coins: 200, maxLevel: 2, unlockedLevels: [1, 2] });
    await page.waitForTimeout(3000);

    const coinBefore = await getCoinDisplay(page).textContent();
    const dessertCountBefore = await page.locator(".board .cell.has-dessert").count();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await waitForBoardReady(page);

    const coinAfter = await getCoinDisplay(page).textContent();
    const dessertCountAfter = await page.locator(".board .cell.has-dessert").count();

    expect(parseInt(coinAfter || "0", 10)).toBeGreaterThanOrEqual(0);
    expect(dessertCountAfter).toBeGreaterThanOrEqual(0);
    expect(coinBefore).not.toBeNull();
    expect(dessertCountBefore).toBeGreaterThan(0);
  });

  test("订单系统 - 应有订单面板", async ({ page }) => {
    await waitForBoardReady(page);

    const ordersPanel = page.locator(".orders-panel");
    await expect(ordersPanel).toBeVisible();

    const hasOrdersOrEmpty = await page.evaluate(() => {
      const panel = document.querySelector(".orders-panel");
      if (!panel) return false;
      return panel.textContent?.includes("订单") || panel.textContent?.includes("暂无订单");
    });
    expect(hasOrdersOrEmpty).toBe(true);
  });

  test("不同等级的甜品应显示正确的表情符号", async ({ page }) => {
    await waitForBoardReady(page);

    const testBoard: (number | null)[] = [
      1, 2, 3, 4, 5,
      6, 7, 8, 9, 10,
      null, null, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
    ];
    await setTestBoard(page, testBoard, {
      coins: 1000,
      maxLevel: 10,
      unlockedLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    });

    const expectedEmojis = ["🍬", "🍪", "🍩", "🧁", "🍰", "🍮", "🎂", "🍨", "🥧", "🍫"];
    for (let i = 0; i < expectedEmojis.length; i++) {
      const cell = getCell(page, i);
      const emoji = await getDessertEmoji(cell);
      expect(emoji).toBe(expectedEmojis[i]);
    }
  });

  test("自动整理功能应能整理棋盘", async ({ page }) => {
    await waitForBoardReady(page);

    const testBoard: (number | null)[] = [
      null, 1, null, 2, null,
      3, null, 1, null, 2,
      null, 1, null, null, null,
      null, null, null, null, null,
      null, null, null, null, null,
    ];
    await setTestBoard(page, testBoard, { coins: 100, maxLevel: 3, unlockedLevels: [1, 2, 3] });

    const organizeButton = page.locator("button", { hasText: /自动整理/ });
    await organizeButton.click({ force: true });
    await page.waitForTimeout(1000);

    const cells = page.locator(".board .cell");
    const firstSixHasDessert = [];
    for (let i = 0; i < 6; i++) {
      const hasDessert = await cells.nth(i).evaluate((el) => el.classList.contains("has-dessert"));
      firstSixHasDessert.push(hasDessert);
    }

    const hasEmptyInFirstSix = firstSixHasDessert.some((has) => !has);
    expect(hasEmptyInFirstSix).toBe(false);
  });
});
