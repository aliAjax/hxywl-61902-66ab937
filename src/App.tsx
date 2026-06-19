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

interface GameState {
  board: (number | null)[];
  coins: number;
  maxLevel: number;
  unlockedLevels: number[];
}

interface Order {
  level: number;
  reward: number;
  filled: boolean;
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

function App(): React.ReactElement {
  const initialState = loadGameState();
  const [board, setBoard] = useState<(number | null)[]>(initialState.board);
  const [coins, setCoins] = useState<number>(initialState.coins);
  const [maxLevel, setMaxLevel] = useState<number>(initialState.maxLevel);
  const [unlockedLevels, setUnlockedLevels] = useState<number[]>(initialState.unlockedLevels);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState<number | null>(null);
  const [mergeFail, setMergeFail] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([
    { level: 3, reward: 50, filled: false },
    { level: 4, reward: 100, filled: false },
    { level: 5, reward: 200, filled: false },
  ]);
  const boardRef = useRef<(number | null)[]>(board);
  const coinsRef = useRef<number>(coins);
  const maxLevelRef = useRef<number>(maxLevel);
  const unlockedLevelsRef = useRef<number[]>(unlockedLevels);

  boardRef.current = board;
  coinsRef.current = coins;
  maxLevelRef.current = maxLevel;
  unlockedLevelsRef.current = unlockedLevels;

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

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number): void => {
    if (board[index] === null) {
      e.preventDefault();
      return;
    }
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (index !== dragIndex) {
      setDropTargetIndex(index);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>, index: number): void => {
    e.preventDefault();
    if (dropTargetIndex === index) {
      setDropTargetIndex(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number): void => {
    e.preventDefault();
    const sourceIndex = Number(e.dataTransfer.getData("text/plain"));
    
    if (sourceIndex === targetIndex || sourceIndex < 0 || sourceIndex >= BOARD_SIZE) {
      setDragIndex(null);
      setDropTargetIndex(null);
      return;
    }

    const sourceLevel = board[sourceIndex];
    const targetLevel = board[targetIndex];

    if (sourceLevel === null) {
      setDragIndex(null);
      setDropTargetIndex(null);
      return;
    }

    if (targetLevel === null) {
      const newBoard = [...board];
      newBoard[targetIndex] = sourceLevel;
      newBoard[sourceIndex] = null;
      setBoard(newBoard);
    } else if (sourceLevel === targetLevel) {
      const newLevel = sourceLevel + 1;
      if (newLevel > DESSERTS.length) {
        showToast("已达到最高等级！");
        setMergeFail([sourceIndex, targetIndex]);
        setTimeout(() => setMergeFail(null), 500);
      } else {
        const coinReward = newLevel * 10;
        const newBoard = [...board];
        newBoard[targetIndex] = newLevel;
        newBoard[sourceIndex] = null;
        setBoard(newBoard);
        setCoins((prev: number) => prev + coinReward);
        setMergeSuccess(targetIndex);
        setTimeout(() => setMergeSuccess(null), 600);
        showToast(`✨ 合成成功！+${coinReward}金币`);

        if (newLevel > maxLevelRef.current) {
          setMaxLevel(newLevel);
          showToast(`🎉 解锁新等级：${DESSERTS[newLevel - 1].name}！`);
        }
        if (!unlockedLevelsRef.current.includes(newLevel)) {
          setUnlockedLevels((prev: number[]) => [...prev, newLevel].sort((a: number, b: number) => a - b));
        }

        setOrders((prev: Order[]) => prev.map((order: Order) => {
          if (!order.filled && newLevel >= order.level) {
            setCoins((c: number) => c + order.reward);
            showToast(`📦 订单完成！+${order.reward}金币`);
            return { ...order, filled: true };
          }
          return order;
        }));
      }
    } else {
      setMergeFail([sourceIndex, targetIndex]);
      setTimeout(() => setMergeFail(null), 500);
      showToast("❌ 等级不同，无法合成！");
    }

    setDragIndex(null);
    setDropTargetIndex(null);
  };

  const handleDragEnd = (): void => {
    setDragIndex(null);
    setDropTargetIndex(null);
  };

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

  const handleCellClick = (index: number): void => {
    if (board[index] === null) {
      const level = Math.floor(Math.random() * Math.min(maxLevel, 3)) + 1;
      const newBoard = [...board];
      newBoard[index] = level;
      setBoard(newBoard);
    }
  };

  const filledOrders = orders.filter((o: Order) => o.filled).length;
  const isFailCell = (index: number): boolean => {
    return mergeFail ? (mergeFail[0] === index || mergeFail[1] === index) : false;
  };

  useEffect(() => {
    const hasAnyDessert = board.some((cell: number | null) => cell !== null);
    if (!hasAnyDessert) {
      for (let i = 0; i < 5; i++) {
        spawnDessert(1);
      }
    }
  }, []);

  return (
    <main className="game-shell">
      {toast && <div className="toast">{toast}</div>}

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
               index === 1 ? `${filledOrders}/${orders.length}` :
               index === 2 ? `${unlockedLevels.length}/${DESSERTS.length}` :
               `${maxLevel}级 ${DESSERTS[Math.min(maxLevel - 1, DESSERTS.length - 1)]?.emoji}`}
            </strong>
          </article>
        ))}
      </section>

      <section className={"playground " + game.mode}>
        <div className="board merge-board">
          {board.map((cell: number | null, index: number) => {
            const dessert = cell ? DESSERTS[cell - 1] : null;
            return (
              <div
                key={index}
                className={[
                  "cell",
                  cell ? "has-dessert" : "empty",
                  dragIndex === index ? "dragging" : "",
                  dropTargetIndex === index && dragIndex !== index ? "drop-target" : "",
                  mergeSuccess === index ? "merge-success" : "",
                  isFailCell(index) ? "merge-fail" : "",
                ].filter(Boolean).join(" ")}
                draggable={cell !== null}
                onDragStart={(e: React.DragEvent<HTMLDivElement>) => handleDragStart(e, index)}
                onDragOver={(e: React.DragEvent<HTMLDivElement>) => handleDragOver(e, index)}
                onDragLeave={(e: React.DragEvent<HTMLDivElement>) => handleDragLeave(e, index)}
                onDrop={(e: React.DragEvent<HTMLDivElement>) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                onClick={() => handleCellClick(index)}
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
            <h3>📋 当前订单</h3>
            {orders.map((order: Order, idx: number) => (
              <div key={idx} className={`order-item ${order.filled ? "filled" : ""}`}>
                <span>{order.filled ? "✅" : DESSERTS[order.level - 1]?.emoji} 合成 {order.level} 级甜品</span>
                <span className="reward">+{order.reward}💰</span>
              </div>
            ))}
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
          💾 <strong>存档：</strong>所有游戏数据自动保存到浏览器本地，刷新页面后进度不会丢失。<br />
          🎯 <strong>目标：</strong>尽可能合成更高级的甜品，完成订单获得额外奖励，收集全部甜品图鉴！
        </p>
      </section>
    </main>
  );
}

export default App;
