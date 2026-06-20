import React, { useState, useMemo, useCallback } from "react";
import {
  getLevelConfig,
  LevelConfig,
  LEVEL_ORDER,
} from "./gameConfig";
import {
  SimulationParams,
  SimulationResult,
  DEFAULT_PARAMS,
  createDefaultParams,
  runSimulation,
  getEconomicSnapshot,
  LevelProgress,
} from "./economicSimulator";

interface SimulationPanelProps {
  currentMaxLevel: number;
  currentCoins: number;
  currentLevelId: string;
}

interface ParamSliderProps {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

function ParamSlider({ label, description, value, min, max, step, unit, onChange }: ParamSliderProps): React.ReactElement {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="sim-param-row">
      <div className="sim-param-header">
        <span className="sim-param-label">{label}</span>
        <span className="sim-param-value">{value}{unit || ""}</span>
      </div>
      <p className="sim-param-desc">{description}</p>
      <div className="sim-slider-container">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="sim-slider"
          style={{
            background: `linear-gradient(90deg, #f59e0b 0%, #f59e0b ${pct}%, rgba(148,163,184,0.3) ${pct}%, rgba(148,163,184,0.3) 100%)`
          }}
        />
      </div>
    </div>
  );
}

export default function SimulationPanel({ currentMaxLevel, currentCoins, currentLevelId }: SimulationPanelProps): React.ReactElement {
  const config = getLevelConfig(currentLevelId);
  const desserts = config.desserts;
  const maxDessertLevel = desserts.length;
  const [isOpen, setIsOpen] = useState(false);
  const [params, setParams] = useState<SimulationParams>(() => ({
    ...createDefaultParams(),
    levelId: currentLevelId,
    startLevel: currentMaxLevel,
    startCoins: currentCoins,
  }));
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [simulationCount, setSimulationCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"params" | "progress" | "economy">("params");

  const handleUseCurrentProgress = useCallback(() => {
    setParams(prev => ({
      ...prev,
      startLevel: currentMaxLevel,
      startCoins: currentCoins,
    }));
  }, [currentMaxLevel, currentCoins]);

  const handleResetParams = useCallback(() => {
    setParams({
      ...createDefaultParams(),
      startLevel: currentMaxLevel,
      startCoins: currentCoins,
    });
  }, [currentMaxLevel, currentCoins]);

  const handleRunSimulation = useCallback(() => {
    const simResult = runSimulation(params);
    setResult(simResult);
    setSimulationCount(prev => prev + 1);
  }, [params]);

  const updateParam = useCallback(<K extends keyof SimulationParams>(
    key: K,
    value: SimulationParams[K]
  ) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const snapshot = useMemo(() => getEconomicSnapshot(params.startLevel, config), [params.startLevel, config]);
  const targetSnapshot = useMemo(() => {
    if (params.targetLevel > params.startLevel) {
      return getEconomicSnapshot(params.targetLevel, config);
    }
    return null;
  }, [params.startLevel, params.targetLevel]);

  const progressBars = useMemo(() => {
    if (!result || result.levelProgress.length === 0) return [];
    const maxTime = Math.max(...result.levelProgress.map(p => p.timeToReachMinutes));
    return result.levelProgress.map(p => ({
      ...p,
      widthPct: Math.max(3, (p.timeToReachMinutes / maxTime) * 100),
    }));
  }, [result]);

  const coinSources = useMemo(() => {
    if (!result) return null;
    const s = result.summary;
    const totalPositive = s.totalMergeCoins + s.totalOrderCoins + s.totalOfflineCoins + s.totalEventCoins;
    if (totalPositive === 0) return null;
    return {
      merge: (s.totalMergeCoins / totalPositive) * 100,
      order: (s.totalOrderCoins / totalPositive) * 100,
      offline: (s.totalOfflineCoins / totalPositive) * 100,
      event: (s.totalEventCoins / totalPositive) * 100,
    };
  }, [result]);

  const formatTimeCompact = (minutes: number): string => {
    if (minutes < 60) return `${Math.round(minutes)}分`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}时${Math.round(minutes % 60)}分`;
    const days = Math.floor(hours / 24);
    return `${days}天${hours % 24}时`;
  };

  return (
    <>
      <article
        className="sim-entry-article"
        onClick={() => setIsOpen(true)}
      >
        <small>📊 经济模拟</small>
        <strong className="sim-entry-text">
          {result ? `预测：${formatTimeCompact(result.totalTimeMinutes)}` : "点击分析 →"}
        </strong>
      </article>

      {isOpen && (
        <div className="modal-overlay" onClick={() => setIsOpen(false)}>
          <div
            className="modal-content sim-panel-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setIsOpen(false)}>×</button>

            <div className="sim-panel-header">
              <div className="sim-panel-icon">📊</div>
              <h2 className="sim-panel-title">经济平衡模拟器</h2>
              <p className="sim-panel-subtitle">
                基于真实游戏配置，预测从当前进度推进到目标等级的大致时长
              </p>
            </div>

            <div className="sim-current-status">
              <div className="sim-status-badge">
                <span className="sim-status-label">当前进度</span>
                <span className="sim-status-value">
                  Lv.{currentMaxLevel} {desserts[currentMaxLevel - 1]?.emoji} · 💰{currentCoins}
                </span>
              </div>
              <button
                className="sim-use-current-btn"
                onClick={handleUseCurrentProgress}
              >
                使用当前进度
              </button>
            </div>

            <div className="sim-tabs">
              <button
                className={`sim-tab-btn ${activeTab === "params" ? "active" : ""}`}
                onClick={() => setActiveTab("params")}
              >
                ⚙️ 参数设置
              </button>
              <button
                className={`sim-tab-btn ${activeTab === "progress" ? "active" : ""}`}
                onClick={() => setActiveTab("progress")}
              >
                📈 进度预测
              </button>
              <button
                className={`sim-tab-btn ${activeTab === "economy" ? "active" : ""}`}
                onClick={() => setActiveTab("economy")}
              >
                💰 经济快照
              </button>
            </div>

            <div className="sim-tab-content">
              {activeTab === "params" && (
                <div className="sim-params-scroll">
                  <div className="sim-param-section">
                    <h4 className="sim-section-title">🎯 目标设置</h4>
                    <ParamSlider
                      label="起始等级"
                      description="模拟开始时的最高甜品等级"
                      value={params.startLevel}
                      min={1}
                      max={maxDessertLevel - 1}
                      step={1}
                      onChange={(v) => updateParam("startLevel", Math.min(v, params.targetLevel - 1))}
                    />
                    <ParamSlider
                      label="目标等级"
                      description="想要解锁的最高甜品等级"
                      value={params.targetLevel}
                      min={Math.max(2, params.startLevel + 1)}
                      max={maxDessertLevel}
                      step={1}
                      onChange={(v) => updateParam("targetLevel", Math.max(v, params.startLevel + 1))}
                    />
                    <ParamSlider
                      label="起始金币"
                      description="模拟开始时拥有的金币数量"
                      value={params.startCoins}
                      min={0}
                      max={10000}
                      step={50}
                      onChange={(v) => updateParam("startCoins", v)}
                    />
                  </div>

                  <div className="sim-param-section">
                    <h4 className="sim-section-title">⚡ 游戏效率</h4>
                    <ParamSlider
                      label="每分钟生成次数"
                      description="活跃游戏时每分钟生成甜品的平均次数"
                      value={params.spawnsPerMinute}
                      min={1}
                      max={20}
                      step={1}
                      unit=" 次/分"
                      onChange={(v) => updateParam("spawnsPerMinute", v)}
                    />
                    <ParamSlider
                      label="合成效率"
                      description="有效合成占理论最优的比例（1.0为完美策略）"
                      value={params.mergeEfficiency}
                      min={0.3}
                      max={1.0}
                      step={0.05}
                      onChange={(v) => updateParam("mergeEfficiency", v)}
                    />
                    <ParamSlider
                      label="每小时完成订单"
                      description="活跃游戏时每小时平均完成的订单数量"
                      value={params.ordersCompletedPerHour}
                      min={1}
                      max={30}
                      step={1}
                      unit=" 单/时"
                      onChange={(v) => updateParam("ordersCompletedPerHour", v)}
                    />
                  </div>

                  <div className="sim-param-section">
                    <h4 className="sim-section-title">⏰ 游戏习惯</h4>
                    <ParamSlider
                      label="每日游戏时长"
                      description="平均每天的活跃游戏时长"
                      value={params.dailyPlayHours}
                      min={0.25}
                      max={8}
                      step={0.25}
                      unit=" 小时/天"
                      onChange={(v) => updateParam("dailyPlayHours", v)}
                    />
                    <ParamSlider
                      label="每日离线时长"
                      description="用于计算离线收益的每日平均离线时间"
                      value={params.offlineHoursPerDay}
                      min={0}
                      max={16}
                      step={0.5}
                      unit=" 小时/天"
                      onChange={(v) => updateParam("offlineHoursPerDay", v)}
                    />
                    <ParamSlider
                      label="离线收益倍率"
                      description="离线收益的实际领取效率（考虑是否及时领取）"
                      value={params.offlineEarningRateMultiplier}
                      min={0.3}
                      max={1.0}
                      step={0.05}
                      onChange={(v) => updateParam("offlineEarningRateMultiplier", v)}
                    />
                  </div>

                  <div className="sim-param-section">
                    <h4 className="sim-section-title">🎮 活动参与</h4>
                    <ParamSlider
                      label="每周活动频率"
                      description="平均每周举办的限时挑战活动次数"
                      value={params.eventFrequencyPerWeek}
                      min={0}
                      max={7}
                      step={1}
                      unit=" 次/周"
                      onChange={(v) => updateParam("eventFrequencyPerWeek", v)}
                    />
                    <ParamSlider
                      label="活动参与率"
                      description="实际参与的活动占举办活动的比例"
                      value={params.eventParticipationRate}
                      min={0}
                      max={1.0}
                      step={0.05}
                      onChange={(v) => updateParam("eventParticipationRate", v)}
                    />
                    <ParamSlider
                      label="活动技巧等级"
                      description="参与活动时的表现（影响活动收益）"
                      value={params.eventSkillLevel}
                      min={0.2}
                      max={1.0}
                      step={0.05}
                      onChange={(v) => updateParam("eventSkillLevel", v)}
                    />
                    <ParamSlider
                      label="碎片金币价值"
                      description="一个图鉴碎片折算为多少金币（用于收益评估）"
                      value={params.eventShardCoinValue}
                      min={10}
                      max={200}
                      step={10}
                      onChange={(v) => updateParam("eventShardCoinValue", v)}
                    />
                  </div>
                </div>
              )}

              {activeTab === "progress" && (
                <div className="sim-result-scroll">
                  {!result ? (
                    <div className="sim-empty-state">
                      <div className="sim-empty-icon">🔬</div>
                      <p className="sim-empty-title">尚未运行模拟</p>
                      <p className="sim-empty-desc">调整参数后点击「运行模拟」按钮，查看进度预测结果</p>
                    </div>
                  ) : (
                    <>
                      <div className={`sim-overview-card ${result.success ? "success" : "warning"}`}>
                        <div className="sim-overview-main">
                          <span className="sim-overview-label">预计总时长</span>
                          <span className="sim-overview-value">{result.totalTimeFormatted}</span>
                        </div>
                        {!result.success && (
                          <p className="sim-overview-warning">⚠️ 模拟超时，结果仅供参考</p>
                        )}
                      </div>

                      <div className="sim-level-progress-section">
                        <h4 className="sim-section-title">各等级解锁进度</h4>
                        <div className="sim-level-progress-list">
                          {progressBars.map((p: LevelProgress & { widthPct: number }) => {
                            const dessert = desserts[p.level - 1];
                            return (
                              <div key={p.level} className="sim-level-item">
                                <div className="sim-level-header">
                                  <span className="sim-level-name">
                                    {dessert?.emoji} Lv.{p.level} {dessert?.name}
                                  </span>
                                  <span className="sim-level-time">
                                    {formatTimeCompact(p.timeToReachMinutes)}
                                  </span>
                                </div>
                                <div className="sim-level-bar-bg">
                                  <div
                                    className="sim-level-bar-fill"
                                    style={{
                                      width: `${p.widthPct}%`,
                                      background: p.level >= 8
                                        ? "linear-gradient(90deg, #f59e0b, #ef4444)"
                                        : p.level >= 5
                                        ? "linear-gradient(90deg, #8b5cf6, #f59e0b)"
                                        : "linear-gradient(90deg, #22c55e, #8b5cf6)",
                                    }}
                                  />
                                </div>
                                <div className="sim-level-stats">
                                  <span>累计: {formatTimeCompact(p.cumulativeTimeMinutes)}</span>
                                  <span>💰 {p.totalCoinsAtUnlock.toLocaleString()}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="sim-summary-section">
                        <h4 className="sim-section-title">数据统计</h4>
                        <div className="sim-summary-grid">
                          <div className="sim-summary-item">
                            <span className="sim-summary-label">合成次数</span>
                            <span className="sim-summary-value">{result.summary.totalMerges.toLocaleString()}</span>
                          </div>
                          <div className="sim-summary-item">
                            <span className="sim-summary-label">生成次数</span>
                            <span className="sim-summary-value">{result.summary.totalSpawns.toLocaleString()}</span>
                          </div>
                          <div className="sim-summary-item">
                            <span className="sim-summary-label">完成订单</span>
                            <span className="sim-summary-value">{result.summary.totalOrdersCompleted.toLocaleString()}</span>
                          </div>
                          <div className="sim-summary-item">
                            <span className="sim-summary-label">参与活动</span>
                            <span className="sim-summary-value">{result.summary.eventsParticipated}/{result.summary.eventsAttempted}</span>
                          </div>
                        </div>
                      </div>

                      {coinSources && (
                        <div className="sim-coins-source-section">
                          <h4 className="sim-section-title">金币来源分布</h4>
                          <div className="sim-coins-bar">
                            {coinSources.merge > 0 && (
                              <div
                                className="sim-coins-segment sim-coins-merge"
                                style={{ width: `${coinSources.merge}%` }}
                                title={`合成奖励: ${result.summary.totalMergeCoins.toLocaleString()} (${coinSources.merge.toFixed(1)}%)`}
                              >
                                {coinSources.merge >= 10 && `合成 ${coinSources.merge.toFixed(0)}%`}
                              </div>
                            )}
                            {coinSources.order > 0 && (
                              <div
                                className="sim-coins-segment sim-coins-order"
                                style={{ width: `${coinSources.order}%` }}
                                title={`订单奖励: ${result.summary.totalOrderCoins.toLocaleString()} (${coinSources.order.toFixed(1)}%)`}
                              >
                                {coinSources.order >= 10 && `订单 ${coinSources.order.toFixed(0)}%`}
                              </div>
                            )}
                            {coinSources.offline > 0 && (
                              <div
                                className="sim-coins-segment sim-coins-offline"
                                style={{ width: `${coinSources.offline}%` }}
                                title={`离线收益: ${result.summary.totalOfflineCoins.toLocaleString()} (${coinSources.offline.toFixed(1)}%)`}
                              >
                                {coinSources.offline >= 10 && `离线 ${coinSources.offline.toFixed(0)}%`}
                              </div>
                            )}
                            {coinSources.event > 0 && (
                              <div
                                className="sim-coins-segment sim-coins-event"
                                style={{ width: `${coinSources.event}%` }}
                                title={`活动奖励: ${result.summary.totalEventCoins.toLocaleString()} (${coinSources.event.toFixed(1)}%)`}
                              >
                                {coinSources.event >= 10 && `活动 ${coinSources.event.toFixed(0)}%`}
                              </div>
                            )}
                          </div>
                          <div className="sim-coins-legend">
                            <span><i className="sim-legend-dot sim-coins-merge"></i> 合成 💰{result.summary.totalMergeCoins.toLocaleString()}</span>
                            <span><i className="sim-legend-dot sim-coins-order"></i> 订单 💰{result.summary.totalOrderCoins.toLocaleString()}</span>
                            <span><i className="sim-legend-dot sim-coins-offline"></i> 离线 💰{result.summary.totalOfflineCoins.toLocaleString()}</span>
                            <span><i className="sim-legend-dot sim-coins-event"></i> 活动 💰{result.summary.totalEventCoins.toLocaleString()}</span>
                          </div>
                        </div>
                      )}

                      <div className="sim-bottleneck-section">
                        <h4 className="sim-section-title">⚠️ 瓶颈分析</h4>
                        <ul className="sim-analysis-list">
                          {result.bottleneckAnalysis.map((msg, idx) => (
                            <li key={idx}>{msg}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="sim-recommendations-section">
                        <h4 className="sim-section-title">💡 优化建议</h4>
                        <ul className="sim-analysis-list sim-recommendations-list">
                          {result.recommendations.map((msg, idx) => (
                            <li key={idx}>{msg}</li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === "economy" && (
                <div className="sim-economy-scroll">
                  <div className="sim-economy-card">
                    <h4 className="sim-section-title">
                      {desserts[params.startLevel - 1]?.emoji} 起始等级 Lv.{params.startLevel} 经济数据
                    </h4>
                    <div className="sim-economy-grid">
                      <div className="sim-economy-item">
                        <span className="sim-economy-label">生成成本</span>
                        <span className="sim-economy-value danger">💰 {snapshot.spawnCost}</span>
                      </div>
                      <div className="sim-economy-item">
                        <span className="sim-economy-label">平均合成奖励</span>
                        <span className="sim-economy-value success">+💰 {snapshot.averageMergeReward}</span>
                      </div>
                      <div className="sim-economy-item">
                        <span className="sim-economy-label">平均订单奖励</span>
                        <span className="sim-economy-value success">+💰 {snapshot.averageOrderReward}</span>
                      </div>
                      <div className="sim-economy-item">
                        <span className="sim-economy-label">离线时薪</span>
                        <span className="sim-economy-value info">💰 {snapshot.offlineHourlyRate.toLocaleString()}/时</span>
                      </div>
                    </div>
                    {snapshot.costToNextLevel ? (
                      <div className="sim-next-level-cost">
                        <p className="sim-next-title">
                          升到 Lv.{params.startLevel + 1} {desserts[params.startLevel]?.name} 理论最低消耗：
                        </p>
                        <div className="sim-next-cost-grid">
                          <span>生成次数: <strong>{snapshot.costToNextLevel.spawns}</strong></span>
                          <span>合成次数: <strong>{snapshot.costToNextLevel.merges}</strong></span>
                          <span>最低金币: <strong className="danger">💰 {snapshot.costToNextLevel.minCost}</strong></span>
                        </div>
                      </div>
                    ) : (
                      <div className="sim-next-level-cost">
                        <p className="sim-next-title">已达最高等级！</p>
                      </div>
                    )}
                    <div className="sim-efficiency-hint">
                      ⚖️ 收支平衡系数: <strong className={snapshot.efficiencyBreakEven < 1 ? "success" : "danger"}>
                        {snapshot.efficiencyBreakEven.toFixed(2)}
                      </strong>
                      <span className="sim-efficiency-note">
                        （小于1表示理想情况下经济为正循环）
                      </span>
                    </div>
                  </div>

                  {targetSnapshot && (
                    <div className="sim-economy-card">
                      <h4 className="sim-section-title">
                        {desserts[params.targetLevel - 1]?.emoji} 目标等级 Lv.{params.targetLevel} 经济数据
                      </h4>
                      <div className="sim-economy-grid">
                        <div className="sim-economy-item">
                          <span className="sim-economy-label">平均合成奖励</span>
                          <span className="sim-economy-value success">+💰 {targetSnapshot.averageMergeReward}</span>
                        </div>
                        <div className="sim-economy-item">
                          <span className="sim-economy-label">平均订单奖励</span>
                          <span className="sim-economy-value success">+💰 {targetSnapshot.averageOrderReward}</span>
                        </div>
                        <div className="sim-economy-item">
                          <span className="sim-economy-label">离线时薪</span>
                          <span className="sim-economy-value info">💰 {targetSnapshot.offlineHourlyRate.toLocaleString()}/时</span>
                        </div>
                        <div className="sim-economy-item">
                          <span className="sim-economy-label">收益提升</span>
                          <span className="sim-economy-value highlight">
                            +{Math.round(((targetSnapshot.averageOrderReward + targetSnapshot.offlineHourlyRate) -
                              (snapshot.averageOrderReward + snapshot.offlineHourlyRate / 60 * 60)) /
                              Math.max(1, snapshot.averageOrderReward + snapshot.offlineHourlyRate) * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="sim-verification-note">
                    <div className="sim-verification-header">
                      <span>🔍</span>
                      <strong>规则一致性验证</strong>
                    </div>
                    <p className="sim-verification-text">
                      所有模拟计算均复用游戏真实配置（<code>gameConfig.ts</code>），
                      包括生成成本、合成奖励系数 <code>{snapshot.spawnCost}</code> / <code>×{10}</code>、
                      订单奖励系数 <code>×{15}</code>、离线收益基础值 <code>{2}/分/Lv</code> 等，
                      确保模拟面板与游戏实际规则保持一致。
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="sim-actions">
              <button
                className="sim-action-btn sim-reset-btn"
                onClick={handleResetParams}
              >
                🔄 重置参数
              </button>
              <button
                className="sim-action-btn sim-run-btn"
                onClick={handleRunSimulation}
              >
                🚀 运行模拟
                {simulationCount > 0 && <span className="sim-run-count"> ({simulationCount})</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
