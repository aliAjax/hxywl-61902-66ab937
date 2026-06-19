import React, { useState, useEffect, useCallback, useRef } from "react";
import "./styles.css";

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

const DESSERTS = [
  { emoji: "🍬", name: "糖果", level: 1, color: "#f9a8d4" },
  { emoji: "🍪", name: "曲奇", level: 2, color: "#fbbf24" },
  { emoji: "🍩", name: "甜甜圈", level: 3, color: "#fb923c" },
  { emoji: "🧁", name: "纸杯蛋糕", level: 4, color: "#f472b6" },
  { emoji: "🍰", name: "蛋糕", level: 5, color: "#ec4899" },
  { emoji: "🍮", name: "布丁", level: 6, color: "#a855f7" },
  { emoji: "🎂", name: "生日蛋糕", level: 7, color: "#8b5cf6" },
  { emoji: "🍨", name: "冰淇淋", level: 8, color: "#06b6d4" },
  { emoji: "🥧", name: "派", level: 9, color: "#10b981" },
  { emoji: "🍫", name: "巧克力", level: 10, color: "#78350f" },
];

const BOARD_SIZE = 25;
const STORAGE_KEY = game.id + "-save";
const POINTER_MOVE_THRESHOLD = 5;
const MAX_ORDERS = 3;
const MIN_ORDER_ITEMS = 1;
const MAX_ORDER_ITEMS = 3;
let orderIdCounter = 0;

interface GameState {
  board: (number | null)[];
  coins: number;
  maxLevel: number;
  unlockedLevels: number[];
}

interface OrderItem {
  level: number;
  count: number;
  collected: number;
}

interface Order {
  id: number;
  items: OrderItem[];
  reward: number;
  completed: boolean;
}

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

function loadGameState(): GameState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        board: parsed.board || Array(BOARD_SIZE).fill(null),
        coins: parsed.coins || 0,
        maxLevel: parsed.maxLevel || 1,
        unlockedLevels: parsed.unlockedLevels || [1],
      };
    }
  } catch (e) {
    console.error("Failed to load game state:", e);
  }
  return {
    board: Array(BOARD_SIZE).fill(null),
    coins: 0,
    maxLevel: 1,
    unlockedLevels: [1],
  };
}

function saveGameState(state: GameState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function generateOrder(unlockedLevels: number[]): Order {
  const numItems = Math.floor(Math.random() * (MAX_ORDER_ITEMS - MIN_ORDER_ITEMS + 1)) + MIN_ORDER_ITEMS;
  const items: OrderItem[] = [];
  let totalReward = 0;
  const usedLevels = new Set<number>();

  for (let i = 0; i < numItems; i++) {
    let level: number;
    do {
      level = unlockedLevels[Math.floor(Math.random() * unlockedLevels.length)];
    } while (usedLevels.has(level) && usedLevels.size < unlockedLevels.length);
    
    usedLevels.add(level);
    const count = Math.floor(Math.random() * 2) + 1;
    items.push({ level, count, collected: 0 });
    totalReward += level * count * 15;
  }

  return {
    id: ++orderIdCounter,
    items,
    reward: totalReward,
    completed: false,
  };
}

function generateOrders(unlockedLevels: number[], count: number = MAX_ORDERS): Order[] {
  if (unlockedLevels.length === 0) return [];
  const orders: Order[] = [];
  for (let i = 0; i < count; i++) {
    orders.push(generateOrder(unlockedLevels));
  }
  return orders;
}

function countDessertsOnBoard(board: (number | null)[], level: number): number {
  return board.filter(cell => cell === level).length;
}

function removeDessertsFromBoard(board: (number | null)[], level: number, count: number): (number | null)[] {
  const newBoard = [...board];
  let removed = 0;
  for (let i = 0; i < newBoard.length && removed < count; i++) {
    if (newBoard[i] === level) {
      newBoard[i] = null;
      removed++;
    }
  }
  return newBoard;
}

function canSubmitOrder(board: (number | null)[], order: Order): boolean {
  return order.items.every(item => countDessertsOnBoard(board, item.level) >= item.count);
}

function submitOrder(board: (number | null)[], order: Order): { newBoard: (number | null)[]; success: boolean } {
  if (!canSubmitOrder(board, order)) {
    return { newBoard: board, success: false };
  }

  let newBoard = [...board];
  for (const item of order.items) {
    newBoard = removeDessertsFromBoard(newBoard, item.level, item.count);
  }
  return { newBoard, success: true };
}

function App(): React.ReactElement {
  const initialState = loadGameState();
  const [board, setBoard] = useState<(number | null)[]>(initialState.board);
  const [coins, setCoins] = useState<number>(initialState.coins);
  const [maxLevel, setMaxLevel] = useState<number>(initialState.maxLevel);
  const [unlockedLevels, setUnlockedLevels] = useState<number[]>(initialState.unlockedLevels);
  const [orders, setOrders] = useState<Order[]>(generateOrders(initialState.unlockedLevels));
  const [toast, setToast] = useState<string | null>(null);

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

  const boardRef = useRef<(number | null)[]>(board);
  const coinsRef = useRef<number>(coins);
  const maxLevelRef = useRef<number>(maxLevel);
  const unlockedLevelsRef = useRef<number[]>(unlockedLevels);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<DragState>(drag);
  const hoverRef = useRef<number | null>(null);

  boardRef.current = board;
  coinsRef.current = coins;
  maxLevelRef.current = maxLevel;
  unlockedLevelsRef.current = unlockedLevels;
  dragRef.current = drag;
  hoverRef.current = hoverIndex;

  useEffect(() => {
    saveGameState({
      board,
      coins,
      maxLevel,
      unlockedLevels,
    });
  }, [board, coins, maxLevel, unlockedLevels]);

  const showToast = useCallback((message: string): void => {
    setToast(message);
    setTimeout(() => setToast(null), 1500);
  }, []);

  const getRandomEmptyCell = useCallback((currentBoard: (number | null)[]): number | null => {
    const emptyIndices: number[] = [];
    currentBoard.forEach((cell, index) => {
      if (cell === null) emptyIndices.push(index);
    });
    if (emptyIndices.length === 0) return null;
    return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
  }, []);

  const spawnDessert = useCallback((targetLevel?: number): boolean => {
    const level = targetLevel || Math.min(
      Math.floor(Math.random() * Math.min(maxLevelRef.current, 3)) + 1,
      DESSERTS.length
    );
    const emptyIndex = getRandomEmptyCell(boardRef.current);
    if (emptyIndex === null) {
      showToast("棋盘已满！请先合并一些甜品");
      return false;
    }
    const newBoard = [...boardRef.current];
    newBoard[emptyIndex] = level;
    setBoard(newBoard);
    return true;
  }, [getRandomEmptyCell, showToast]);

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
    if (sourceIndex === targetIndex || sourceIndex < 0 || sourceIndex >= BOARD_SIZE
        || targetIndex < 0 || targetIndex >= BOARD_SIZE) {
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
      return true;
    }

    if (sourceLevel === targetLevel) {
      const newLevel = sourceLevel + 1;
      if (newLevel > DESSERTS.length) {
        showToast("⭐ 已达到最高等级！");
        triggerFailFeedback([sourceIndex, targetIndex]);
        return false;
      } else {
        const coinReward = newLevel * 10;
        const newBoard = [...boardRef.current];
        newBoard[targetIndex] = newLevel;
        newBoard[sourceIndex] = null;
        setBoard(newBoard);
        setCoins((prev: number) => prev + coinReward);
        triggerSuccessFeedback(targetIndex);
        showToast(`✨ 合成${DESSERTS[newLevel - 1].name}！+${coinReward}金币`);

        if (newLevel > maxLevelRef.current) {
          setMaxLevel(newLevel);
          setTimeout(() => showToast(`🎉 解锁新等级：${DESSERTS[newLevel - 1].name}！`), 800);
        }
        if (!unlockedLevelsRef.current.includes(newLevel)) {
          setUnlockedLevels((prev: number[]) => [...prev, newLevel].sort((a: number, b: number) => a - b));
        }
        return true;
      }
    } else {
      triggerFailFeedback([sourceIndex, targetIndex]);
      showToast("❌ 等级不同，无法合成！");
      return false;
    }
  }, [showToast, triggerSuccessFeedback, triggerFailFeedback]);

  const getCellIndexFromPoint = useCallback((clientX: number, clientY: number): number | null => {
    const cells = cellRefs.current;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const rect = cell.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right
          && clientY >= rect.top && clientY <= rect.bottom) {
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
      if (!boardEl || boardEl !== boardRefEl.current) return;

      const idxStr = cellEl.getAttribute("data-index");
      if (idxStr === null) return;
      const index = Number(idxStr);
      if (isNaN(index) || index < 0 || index >= BOARD_SIZE) return;
      if (boardRef.current[index] === null) return;

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

      const hovered = getCellIndexFromPoint(e.clientX, e.clientY);
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

      const targetIndex = getCellIndexFromPoint(e.clientX, e.clientY);

      if (d.hasMoved && targetIndex !== null && d.sourceIndex !== null) {
        performMerge(d.sourceIndex, targetIndex);
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
      if (!boardEl || boardEl !== boardRefEl.current) return;
      const idxStr = cellEl.getAttribute("data-index");
      if (idxStr === null) return;
      const index = Number(idxStr);
      if (isNaN(index) || index < 0 || index >= BOARD_SIZE) return;
      if (boardRef.current[index] !== null) return;

      const level = Math.floor(Math.random() * Math.min(maxLevelRef.current, 3)) + 1;
      const newBoard = [...boardRef.current];
      newBoard[index] = level;
      setBoard(newBoard);
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
  }, [getCellIndexFromPoint, performMerge, showToast]);

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

    showToast(`🎉 订单完成！+${order.reward}金币`);

    setTimeout(() => {
      setOrders((prev: Order[]) => {
        const remaining = prev.filter((o: Order) => !o.completed);
        const newOrders = generateOrders(unlockedLevelsRef.current, MAX_ORDERS - remaining.length);
        return [...remaining, ...newOrders];
      });
    }, 1500);
  }, [showToast]);

  const handleRefreshOrders = useCallback((): void => {
    if (unlockedLevelsRef.current.length === 0) {
      showToast("❌ 没有解锁的甜品，无法生成订单！");
      return;
    }
    setOrders(generateOrders(unlockedLevelsRef.current));
    showToast("📋 订单已刷新！");
  }, [showToast]);

  const handleAction = (action: string): void => {
    if (action === "生成甜品") {
      spawnDessert();
    } else if (action === "自动整理") {
      const newBoard = Array(BOARD_SIZE).fill(null);
      const nonNullCells = board.filter((cell: number | null) => cell !== null) as number[];
      nonNullCells.sort((a: number, b: number) => a - b);
      nonNullCells.forEach((cell: number, index: number) => {
        newBoard[index] = cell;
      });
      setBoard(newBoard);
      showToast("🧹 整理完成！");
    } else if (action === "领取收益") {
      const offlineReward = maxLevel * 5;
      setCoins((prev: number) => prev + offlineReward);
      showToast(`💰 领取离线收益 +${offlineReward}金币！`);
    }
  };

  const completedOrders = orders.filter((o: Order) => o.completed).length;

  useEffect(() => {
    const hasAnyDessert = board.some((cell: number | null) => cell !== null);
    if (!hasAnyDessert) {
      for (let i = 0; i < 5; i++) {
        spawnDessert(1);
      }
    }
  }, []);

  const getCellClass = (index: number): string => {
    const classes: string[] = ["cell"];
    classes.push(board[index] ? "has-dessert" : "empty");

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

  return (
    <main className="game-shell">
      {toast && <div className="toast">{toast}</div>}

      {drag.isDragging && drag.sourceIndex !== null && drag.hasMoved && board[drag.sourceIndex] && (
        <div
          className="drag-floating-element"
          style={{
            left: drag.currentX - 32,
            top: drag.currentY - 32,
            background: `linear-gradient(145deg, ${DESSERTS[board[drag.sourceIndex]! - 1].color}dd, ${DESSERTS[board[drag.sourceIndex]! - 1].color}99)`,
          }}
        >
          <span className="dessert-emoji">{DESSERTS[board[drag.sourceIndex]! - 1].emoji}</span>
          <span className="dessert-level">Lv.{board[drag.sourceIndex]}</span>
        </div>
      )}

      <section className="hero">
        <p>{game.id} · H5Game · Port {game.port}</p>
        <h1>{game.title}</h1>
        <span>{game.tagline}</span>
      </section>

      <section className="hud">
        {game.stats.map((stat: string, index: number) => (
          <article key={stat}>
            <small>{stat}</small>
            <strong>
              {index === 0 ? coins :
               index === 1 ? `${completedOrders}/${orders.length}` :
               index === 2 ? `${unlockedLevels.length}/${DESSERTS.length}` :
               `${maxLevel}级 ${DESSERTS[Math.min(maxLevel - 1, DESSERTS.length - 1)]?.emoji}`}
            </strong>
          </article>
        ))}
      </section>

      <section className={"playground " + game.mode}>
        <div
          className="board merge-board"
          ref={boardRefEl}
        >
          {board.map((cell: number | null, index: number) => {
            const dessert = cell ? DESSERTS[cell - 1] : null;
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
        </div>

        <aside className="side-panel">
          <h2>核心玩法</h2>
          <p>拖动相同等级的甜品叠在一起即可合成更高级的甜品，获得金币奖励。不同等级的甜品无法合成。点击空格可快速生成1-3级甜品。</p>

          <div className="orders-panel">
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
              orders.map((order: Order) => (
                <div key={order.id} className={`order-card ${order.completed ? "completed" : ""}`}>
                  <div className="order-items">
                    {order.items.map((item: OrderItem, idx: number) => {
                      const dessert = DESSERTS[item.level - 1];
                      const available = countDessertsOnBoard(board, item.level);
                      const hasEnough = available >= item.count;
                      return (
                        <div key={idx} className={`order-item-row ${hasEnough ? "available" : "unavailable"}`}>
                          <span className="order-dessert">
                            <span className="order-emoji">{dessert?.emoji}</span>
                            <span className="order-name">{dessert?.name}</span>
                          </span>
                          <span className="order-count">
                            <span className={hasEnough ? "count-ok" : "count-missing"}>
                              {available}/{item.count}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
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
              ))
            )}
          </div>

          <div className="collection-panel">
            <h3>📖 甜品图鉴</h3>
            <div className="collection-grid">
              {DESSERTS.map((dessert) => (
                <div
                  key={dessert.level}
                  className={`collection-item ${unlockedLevels.includes(dessert.level) ? "unlocked" : "locked"}`}
                  title={dessert.name}
                >
                  {unlockedLevels.includes(dessert.level) ? dessert.emoji : "❓"}
                </div>
              ))}
            </div>
          </div>

          <div className="actions">
            {game.actions.map((action: string) => (
              <button key={action} onClick={() => handleAction(action)}>{action}</button>
            ))}
          </div>
        </aside>
      </section>

      <section className="result-panel">
        <h2>游戏说明</h2>
        <p>
          🎮 <strong>玩法：</strong>拖拽相同等级的甜品到一起合成更高级甜品。每合成一次获得金币，等级越高金币越多。<br />
          � <strong>订单：</strong>完成订单栏中的订单可获得额外金币奖励。提交棋盘中对应数量的甜品即可完成订单，完成后会自动刷新新订单。<br />
          �💾 <strong>存档：</strong>所有游戏数据自动保存到浏览器本地，刷新页面后进度不会丢失。<br />
          🎯 <strong>目标：</strong>尽可能合成更高级的甜品，完成订单获得额外奖励，收集全部甜品图鉴！
        </p>
      </section>
    </main>
  );
}

export default App;
