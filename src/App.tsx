import { useMemo, useState } from "react";
import "./styles.css";

const game = {
  "id": "hxywl-61902",
  "port": 61902,
  "title": "甜品合成店",
  "tagline": "拖拽合成甜品，完成订单并解锁图鉴",
  "prompt": "做一个H5合成经营小游戏，玩家通过拖拽相同等级的甜品进行合成，解锁更高级甜品并获得金币。页面需要有合成棋盘、订单栏、金币数量、甜品图鉴和离线收益提示。游戏数据保存在浏览器本地，刷新后进度不能丢，适合后续扩展更多甜品和活动关卡。",
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

const boards: Record<string, string[]> = {
  rhythm: ["♪", "◇", "♪", "◆", "♪", "◇", "◆", "♪", "◇"],
  merge: ["🍩", "🍩", "🧁", "🍪", "🧁", "🍰", "🍪", "🍩", "🍮"],
  dungeon: ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"],
  slingshot: ["★", "·", "●", "·", "▣", "·", "★", "·", "◎"],
  escape: ["书架", "花瓶", "抽屉", "挂画", "地毯", "台灯", "门锁", "箱子", "窗帘"],
};

function App() {
  const [score, setScore] = useState(1280);
  const [combo, setCombo] = useState(7);
  const [selected, setSelected] = useState(0);
  const cells = useMemo(() => boards[game.mode], []);
  const best = Number(localStorage.getItem(game.id + "-best") || 0);

  function playCell(index: number) {
    setSelected(index);
    const gain = game.mode === "dungeon" && index % 5 === 0 ? -80 : 120 + index * 8;
    const nextScore = Math.max(0, score + gain);
    setScore(nextScore);
    setCombo((value) => (gain > 0 ? value + 1 : 0));
    if (nextScore > best) {
      localStorage.setItem(game.id + "-best", String(nextScore));
    }
  }

  return (
    <main className="game-shell">
      <section className="hero">
        <p>{game.id} · H5Game · Port {game.port}</p>
        <h1>{game.title}</h1>
        <span>{game.tagline}</span>
      </section>

      <section className="hud">
        {game.stats.map((stat, index) => (
          <article key={stat}>
            <small>{stat}</small>
            <strong>{index === 0 ? score : index === 1 ? best : index === 2 ? selected + 1 : combo}</strong>
          </article>
        ))}
      </section>

      <section className={"playground " + game.mode}>
        <div className="board">
          {cells.map((cell, index) => (
            <button
              className={selected === index ? "active" : ""}
              key={index}
              onClick={() => playCell(index)}
            >
              {cell}
            </button>
          ))}
        </div>
        <aside className="side-panel">
          <h2>核心玩法</h2>
          <p>{game.prompt}</p>
          <div className="actions">
            {game.actions.map((action) => (
              <button key={action}>{action}</button>
            ))}
          </div>
        </aside>
      </section>

      <section className="result-panel">
        <h2>结算预览</h2>
        <p>当前分数{score}，最高分{Math.max(best, score)}，连击{combo}。基础流程已包含开始、交互、反馈、记录和结算区域，后续可以继续扩展关卡、音效、动画与资源管理。</p>
      </section>
    </main>
  );
}

export default App;
