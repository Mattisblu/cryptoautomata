import type { 
  TradingAlgorithm, 
  Exchange, 
  ExecutionMode, 
  OptimizationMode, 
  OptimizationSuggestion, 
  LiveStrategyMetrics,
  RunningStrategy 
} from "@shared/schema";
import { storage } from "./storage";
import { exchangeService } from "./exchangeService";
import { notificationService } from "./notificationService";
import { strategyOptimizer } from "./strategyOptimizer";
import { randomUUID } from "crypto";

interface BotInstance {
  sessionId: string;
  exchange: Exchange;
  symbol: string;
  algorithm: TradingAlgorithm;
  executionMode: ExecutionMode;
  optimizationMode: OptimizationMode;
  timeframe: string;
  checkInterval: NodeJS.Timeout | null;
  isRunning: boolean;
  isPaused: boolean;
  totalTrades: number;
  successfulTrades: number;
  onOptimizationSuggestion?: (suggestion: Omit<OptimizationSuggestion, "id" | "timestamp">) => void;
  onMetricsUpdate?: (metrics: LiveStrategyMetrics) => void;
  onAlgorithmUpdate?: (algorithm: TradingAlgorithm) => void;
}

interface StartStrategyConfig {
  exchange: Exchange;
  symbol: string;
  algorithm: TradingAlgorithm;
  executionMode: ExecutionMode;
  optimizationMode: OptimizationMode;
  timeframe?: string; // User-selected timeframe for klines analysis
  onOptimizationSuggestion?: (suggestion: Omit<OptimizationSuggestion, "id" | "timestamp">) => void;
  onMetricsUpdate?: (metrics: LiveStrategyMetrics) => void;
  onAlgorithmUpdate?: (algorithm: TradingAlgorithm) => void;
}

class StrategyOrchestrator {
  private bots: Map<string, BotInstance> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  /**
   * Initialize the orchestrator on server startup.
   * This cleans up any strategies that were marked as "running" or "paused"
   * but are no longer active because the server was restarted.
   */
  async init(): Promise<void> {
    try {
      const staleStrategies = await storage.getRunningStrategies({ 
        status: "running" 
      });
      const pausedStrategies = await storage.getRunningStrategies({ 
        status: "paused" 
      });
      
      const allStale = [...staleStrategies, ...pausedStrategies];
      
      if (allStale.length > 0) {
        console.log(`[StrategyOrchestrator] Found ${allStale.length} stale strategies from previous session, cleaning up...`);
        
        for (const strategy of allStale) {
          await storage.stopRunningStrategy(strategy.sessionId);
          await storage.addTradeLog({
            type: "algorithm",
            message: `Strategy auto-stopped on server restart: ${strategy.algorithmName} on ${strategy.symbol}`,
            data: { 
              sessionId: strategy.sessionId,
              reason: "server_restart_cleanup"
            },
          });
          console.log(`[StrategyOrchestrator] Cleaned up stale strategy: ${strategy.algorithmName} (${strategy.sessionId})`);
        }
        
        console.log(`[StrategyOrchestrator] Cleanup complete - ${allStale.length} strategies stopped`);
      } else {
        console.log("[StrategyOrchestrator] No stale strategies found, ready to start");
      }
    } catch (error) {
      console.error("[StrategyOrchestrator] Error during initialization cleanup:", error);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      const sessionIds = Array.from(this.bots.keys());
      for (const sessionId of sessionIds) {
        await storage.updateRunningStrategyHeartbeat(sessionId);
      }
    }, 30000);
  }

  private getSessionKey(exchange: string, symbol: string): string {
    return `${exchange}:${symbol}`;
  }

  async startStrategy(config: StartStrategyConfig): Promise<string> {
    const { exchange, symbol, algorithm, executionMode, optimizationMode, timeframe = "15m" } = config;
    
    const existingOnMarket = await storage.getRunningStrategyByMarket(exchange, symbol);
    if (existingOnMarket) {
      throw new Error(`A strategy is already running on ${exchange} ${symbol}. Stop it first before starting a new one.`);
    }

    const sessionId = randomUUID();
    const exchangeInfo = exchangeService.getExchangeInfo(exchange);
    const modeLabel = executionMode === "paper" ? "PAPER TRADING" : "REAL TRADING";

    await storage.createRunningStrategy({
      sessionId,
      algorithmId: algorithm.id,
      algorithmName: algorithm.name,
      algorithmVersion: algorithm.version,
      exchange,
      symbol,
      executionMode,
      optimizationMode,
      status: "running",
      totalTrades: 0,
      successfulTrades: 0,
      totalPnl: 0,
    });

    const instance: BotInstance = {
      sessionId,
      exchange,
      symbol,
      algorithm,
      executionMode,
      optimizationMode,
      timeframe,
      checkInterval: null,
      isRunning: true,
      isPaused: false,
      totalTrades: 0,
      successfulTrades: 0,
      onOptimizationSuggestion: config.onOptimizationSuggestion,
      onMetricsUpdate: config.onMetricsUpdate,
      onAlgorithmUpdate: config.onAlgorithmUpdate,
    };

    this.bots.set(sessionId, instance);

    await storage.addTradeLog({
      type: "algorithm",
      message: `[${modeLabel}] Strategy started on ${exchangeInfo.name}: ${algorithm.name} on ${symbol}`,
      data: { 
        sessionId,
        algorithmId: algorithm.id, 
        symbol,
        exchange,
        executionMode,
      },
    });

    const defaultInterval = exchange === "bydfi" ? 3000 : 5000;
    const scalpingInterval = exchange === "bydfi" ? 1500 : 2000;
    const interval = algorithm.mode === "ai-scalping" ? scalpingInterval : defaultInterval;

    instance.checkInterval = setInterval(
      () => this.executeTradeCheck(sessionId),
      interval
    );

    if (algorithm.mode !== "manual") {
      await strategyOptimizer.start({
        exchange,
        symbol,
        algorithm,
        optimizationMode,
        onSuggestion: config.onOptimizationSuggestion || (() => {}),
        onMetricsUpdate: config.onMetricsUpdate || (() => {}),
        onAlgorithmUpdate: (algo) => {
          instance.algorithm = algo;
          if (config.onAlgorithmUpdate) {
            config.onAlgorithmUpdate(algo);
          }
        },
      });
    }

    return sessionId;
  }

  async pauseStrategy(sessionId: string): Promise<void> {
    const instance = this.bots.get(sessionId);
    if (!instance) {
      throw new Error("Strategy not found");
    }
    if (!instance.isRunning) {
      throw new Error("Strategy is not running");
    }

    instance.isPaused = true;
    await storage.updateRunningStrategy(sessionId, { status: "paused" });

    const modeLabel = instance.executionMode === "paper" ? "PAPER" : "REAL";
    await storage.addTradeLog({
      type: "algorithm",
      message: `[${modeLabel}] Strategy paused: ${instance.algorithm.name} on ${instance.symbol}`,
      data: { sessionId },
    });
  }

  async resumeStrategy(sessionId: string): Promise<void> {
    const instance = this.bots.get(sessionId);
    if (!instance) {
      throw new Error("Strategy not found");
    }
    if (!instance.isRunning) {
      throw new Error("Strategy is not running");
    }

    instance.isPaused = false;
    await storage.updateRunningStrategy(sessionId, { status: "running" });

    const modeLabel = instance.executionMode === "paper" ? "PAPER" : "REAL";
    await storage.addTradeLog({
      type: "algorithm",
      message: `[${modeLabel}] Strategy resumed: ${instance.algorithm.name} on ${instance.symbol}`,
      data: { sessionId },
    });
  }

  async stopStrategy(sessionId: string): Promise<void> {
    const instance = this.bots.get(sessionId);
    if (!instance) {
      const dbStrategy = await storage.getRunningStrategy(sessionId);
      if (dbStrategy) {
        await storage.stopRunningStrategy(sessionId);
      }
      return;
    }

    if (instance.checkInterval) {
      clearInterval(instance.checkInterval);
      instance.checkInterval = null;
    }

    instance.isRunning = false;
    instance.isPaused = false;

    await storage.stopRunningStrategy(sessionId);

    const modeLabel = instance.executionMode === "paper" ? "PAPER" : "REAL";
    const stats = `Total trades: ${instance.totalTrades}, Successful: ${instance.successfulTrades}`;
    
    await storage.addTradeLog({
      type: "algorithm",
      message: `[${modeLabel}] Strategy stopped: ${instance.algorithm.name} on ${instance.symbol}. ${stats}`,
      data: {
        sessionId,
        totalTrades: instance.totalTrades,
        successfulTrades: instance.successfulTrades,
      },
    });

    this.bots.delete(sessionId);
  }

  async stopAllStrategies(): Promise<void> {
    const sessionIds = Array.from(this.bots.keys());
    for (const sessionId of sessionIds) {
      await this.stopStrategy(sessionId);
    }
  }

  async closeAllPositionsAndStop(sessionId: string): Promise<void> {
    const instance = this.bots.get(sessionId);
    if (!instance) {
      throw new Error("Strategy not found");
    }

    const credentials = await storage.getCredentials(instance.exchange);
    if (!credentials) {
      throw new Error("No credentials available");
    }

    const modeLabel = instance.executionMode === "paper" ? "PAPER" : "REAL";
    const positions = await storage.getPositions(instance.exchange);
    const symbolPositions = positions.filter(p => p.symbol === instance.symbol);

    for (const position of symbolPositions) {
      await exchangeService.closePosition(instance.exchange, credentials, position.id);
      await storage.deletePosition(instance.exchange, position.id);
    }

    await storage.addTradeLog({
      type: "position",
      message: `[${modeLabel}] Closed ${symbolPositions.length} positions for ${instance.symbol}`,
      data: { sessionId, positionsClosed: symbolPositions.length },
    });

    await this.stopStrategy(sessionId);
  }

  getRunningBots(): { sessionId: string; exchange: Exchange; symbol: string; algorithmName: string; isPaused: boolean }[] {
    return Array.from(this.bots.values()).map(bot => ({
      sessionId: bot.sessionId,
      exchange: bot.exchange,
      symbol: bot.symbol,
      algorithmName: bot.algorithm.name,
      isPaused: bot.isPaused,
    }));
  }

  isStrategyRunning(sessionId: string): boolean {
    return this.bots.has(sessionId);
  }

  isAnyStrategyRunning(): boolean {
    return this.bots.size > 0;
  }

  private async executeTradeCheck(sessionId: string): Promise<void> {
    const instance = this.bots.get(sessionId);
    if (!instance || instance.isPaused) return;

    try {
      const { exchange, symbol, algorithm, executionMode, timeframe } = instance;
      
      const exchangeInfo = exchangeService.getExchangeInfo(exchange);
      // getTicker/getKlines now return result types with data source embedded
      const tickerResult = await exchangeService.getTicker(exchange, symbol);
      const klinesResult = await exchangeService.getKlines(exchange, symbol, timeframe, 50);
      const ticker = tickerResult.ticker;
      const klines = klinesResult.klines;
      
      const credentials = await storage.getCredentials(exchange);
      if (!credentials) return;

      const positions = await storage.getPositions(exchange);
      const symbolPositions = positions.filter(p => p.symbol === symbol);
      
      await storage.setTicker(exchange, symbol, ticker);

      const decision = await this.evaluateRules(
        algorithm.rules, 
        ticker, 
        klines, 
        symbolPositions,
        exchangeInfo
      );

      if (decision.action !== "hold") {
        await this.executeDecision(instance, decision, ticker, exchangeInfo);
      }

      await storage.updateRunningStrategy(sessionId, {
        totalTrades: instance.totalTrades,
        successfulTrades: instance.successfulTrades,
      });

    } catch (error) {
      console.error(`Trade check error for session ${sessionId}:`, error);
      await storage.addTradeLog({
        type: "error",
        message: `Trade check failed for ${instance.symbol}: ${(error as Error).message}`,
        data: { sessionId },
      });
    }
  }

  // Parse and evaluate numeric price conditions like "price > 0.14", "price >= 0.145", etc.
  // Returns { matched: boolean, triggered: boolean, debugInfo: string }
  private evaluateNumericCondition(
    condition: string,
    currentPrice: number
  ): { matched: boolean; triggered: boolean; debugInfo: string } {
    // Epsilon for floating-point comparison tolerance (0.0001% of price)
    const EPSILON = currentPrice * 0.000001;
    
    // Pattern to match: price (>|>=|<|<=|==|=) number
    // Supports: "price > 0.14", "price >= 0.145", "price < 100", "price == 50000"
    const numericPattern = /price\s*(>=|<=|>|<|==|=)\s*([\d.]+)/i;
    const match = condition.match(numericPattern);
    
    if (!match) {
      return { matched: false, triggered: false, debugInfo: "" };
    }
    
    const operator = match[1];
    const targetPrice = parseFloat(match[2]);
    
    if (isNaN(targetPrice)) {
      return { matched: true, triggered: false, debugInfo: `Invalid price value: ${match[2]}` };
    }
    
    let triggered = false;
    const diff = currentPrice - targetPrice;
    
    switch (operator) {
      case ">":
        triggered = currentPrice > targetPrice - EPSILON;
        break;
      case ">=":
        triggered = currentPrice >= targetPrice - EPSILON;
        break;
      case "<":
        triggered = currentPrice < targetPrice + EPSILON;
        break;
      case "<=":
        triggered = currentPrice <= targetPrice + EPSILON;
        break;
      case "==":
      case "=":
        // Use same epsilon as other operators - very tight tolerance for equality
        triggered = Math.abs(diff) <= Math.max(EPSILON, targetPrice * 0.000001);
        break;
    }
    
    const debugInfo = `[NumericTrigger] price=${currentPrice.toFixed(6)} ${operator} ${targetPrice} => ${triggered ? "TRIGGERED" : "not met"} (diff=${diff.toFixed(6)})`;
    
    return { matched: true, triggered, debugInfo };
  }

  private async evaluateRules(
    rules: TradingAlgorithm["rules"],
    ticker: { lastPrice: number; priceChangePercent: number },
    klines: { close: number; volume?: number }[],
    positions: any[],
    exchangeInfo: any
  ): Promise<{ action: string; rule?: any; reason: string }> {
    const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
    const closes = klines.map((k) => k.close);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const currentPrice = ticker.lastPrice;
    const priceChange = ticker.priceChangePercent;
    const hasPosition = positions.length > 0;

    // Calculate MACD indicators
    const macd = this.calculateMACD(closes);
    
    // Calculate volume analysis
    const volume = this.calculateVolumeAnalysis(klines);

    for (const rule of sortedRules) {
      const condition = rule.condition.toLowerCase();
      let shouldTrigger = false;
      let triggerDebugInfo = "";
      
      // Debug: Log each rule being evaluated
      console.log(`[StrategyOrchestrator] Evaluating rule: "${rule.condition}" (action: ${rule.action}, priority: ${rule.priority})`);

      // --- NUMERIC PRICE CONDITIONS (highest priority) ---
      const numericResult = this.evaluateNumericCondition(rule.condition, currentPrice);
      if (numericResult.matched) {
        shouldTrigger = numericResult.triggered;
        triggerDebugInfo = numericResult.debugInfo;
        console.log(`[StrategyOrchestrator] Rule "${rule.condition}": ${triggerDebugInfo}`);
      }
      // --- SMA Conditions ---
      else if (condition.includes("price above sma") && currentPrice > sma20) {
        shouldTrigger = true;
      } else if (condition.includes("price below sma") && currentPrice < sma20) {
        shouldTrigger = true;
      } else if (condition.includes("sma crossover") || condition.includes("bullish crossover")) {
        if (sma20 > sma50) shouldTrigger = true;
      } else if (condition.includes("bearish crossover")) {
        if (sma20 < sma50) shouldTrigger = true;
      }

      // --- MACD Conditions ---
      // Buy Signal: MACD line crosses above Signal Line (bullish momentum)
      else if (condition.includes("macd bullish crossover") || condition.includes("macd cross above")) {
        if (macd.crossover === "bullish_crossover") shouldTrigger = true;
      }
      // Sell Signal: MACD line crosses below Signal Line (bearish momentum)
      else if (condition.includes("macd bearish crossover") || condition.includes("macd cross below")) {
        if (macd.crossover === "bearish_crossover") shouldTrigger = true;
      }
      // MACD trend conditions
      else if (condition.includes("macd bullish") || condition.includes("macd positive")) {
        if (macd.trend === "bullish") shouldTrigger = true;
      } else if (condition.includes("macd bearish") || condition.includes("macd negative")) {
        if (macd.trend === "bearish") shouldTrigger = true;
      }
      // Histogram conditions (momentum strength)
      else if (condition.includes("macd histogram positive") || condition.includes("histogram above zero")) {
        if (macd.histogram > 0) shouldTrigger = true;
      } else if (condition.includes("macd histogram negative") || condition.includes("histogram below zero")) {
        if (macd.histogram < 0) shouldTrigger = true;
      }
      // Zero line conditions
      else if (condition.includes("macd above zero")) {
        if (macd.macdLine > 0) shouldTrigger = true;
      } else if (condition.includes("macd below zero")) {
        if (macd.macdLine < 0) shouldTrigger = true;
      }
      // MACD vs Signal line
      else if (condition.includes("macd above signal")) {
        if (macd.macdLine > macd.signalLine) shouldTrigger = true;
      } else if (condition.includes("macd below signal")) {
        if (macd.macdLine < macd.signalLine) shouldTrigger = true;
      }
      // Histogram momentum conditions (point 3: swelling/shrinking bars)
      else if (condition.includes("histogram swelling") || condition.includes("momentum increasing") || condition.includes("bars increasing")) {
        if (macd.histogramMomentum === "swelling") shouldTrigger = true;
      } else if (condition.includes("histogram shrinking") || condition.includes("momentum decreasing") || condition.includes("bars decreasing")) {
        if (macd.histogramMomentum === "shrinking") shouldTrigger = true;
      }
      // Divergence conditions (point 8: price vs MACD disagreement)
      else if (condition.includes("bullish divergence") || condition.includes("positive divergence")) {
        if (macd.divergence === "bullish_divergence") shouldTrigger = true;
      } else if (condition.includes("bearish divergence") || condition.includes("negative divergence")) {
        if (macd.divergence === "bearish_divergence") shouldTrigger = true;
      } else if (condition.includes("divergence detected") || condition.includes("any divergence")) {
        if (macd.divergence !== "none") shouldTrigger = true;
      }

      // --- Volume Conditions ---
      else if (condition.includes("volume spike") || condition.includes("high volume spike")) {
        if (volume.isVolumeSpike) shouldTrigger = true;
      } else if (condition.includes("high volume") || condition.includes("above average volume")) {
        if (volume.isHighVolume) shouldTrigger = true;
      } else if (condition.includes("low volume") || condition.includes("below average volume")) {
        if (volume.isLowVolume) shouldTrigger = true;
      } else if (condition.includes("volume increasing") || condition.includes("rising volume")) {
        if (volume.volumeTrend === "increasing") shouldTrigger = true;
      } else if (condition.includes("volume decreasing") || condition.includes("falling volume")) {
        if (volume.volumeTrend === "decreasing") shouldTrigger = true;
      }

      // --- Combined Conditions (MACD + Volume confirmation) ---
      else if (condition.includes("macd bullish with volume") || condition.includes("bullish with volume confirmation")) {
        if (macd.trend === "bullish" && volume.isHighVolume) shouldTrigger = true;
      } else if (condition.includes("macd bearish with volume") || condition.includes("bearish with volume confirmation")) {
        if (macd.trend === "bearish" && volume.isHighVolume) shouldTrigger = true;
      } else if (condition.includes("macd crossover with volume")) {
        if (macd.crossover !== "none" && volume.isHighVolume) shouldTrigger = true;
      } else if (condition.includes("bullish breakout") || condition.includes("breakout with volume")) {
        if (macd.trend === "bullish" && volume.isVolumeSpike && currentPrice > sma20) {
          shouldTrigger = true;
        }
      } else if (condition.includes("bearish breakdown")) {
        if (macd.trend === "bearish" && volume.isVolumeSpike && currentPrice < sma20) {
          shouldTrigger = true;
        }
      }

      // --- Price/Market Conditions ---
      else if (condition.includes("oversold") && priceChange < -2) {
        shouldTrigger = true;
      } else if (condition.includes("overbought") && priceChange > 2) {
        shouldTrigger = true;
      } else if (condition.includes("no position") && !hasPosition) {
        shouldTrigger = true;
      } else if (condition.includes("has position") && hasPosition) {
        shouldTrigger = true;
      }
      // --- Immediate Entry Conditions (always trigger if no position) ---
      else if (
        (condition.includes("immediate") || 
         condition.includes("enter now") || 
         condition.includes("market entry") ||
         condition.includes("on start") ||
         condition.includes("always enter") ||
         condition.includes("entry signal")) && 
        !hasPosition
      ) {
        shouldTrigger = true;
        console.log(`[StrategyOrchestrator] Immediate entry condition matched: "${rule.condition}"`);
      }

      if (shouldTrigger) {
        // Build detailed reason with indicator values
        let reason = `Rule triggered: ${rule.condition}`;
        
        if (triggerDebugInfo) {
          reason += ` | ${triggerDebugInfo}`;
        }
        if (condition.includes("macd") || condition.includes("histogram") || condition.includes("divergence") || condition.includes("momentum")) {
          reason += ` | MACD: ${macd.macdLine.toFixed(4)}, Signal: ${macd.signalLine.toFixed(4)}, Histogram: ${macd.histogram.toFixed(4)}, Trend: ${macd.trend}`;
          reason += `, HistMomentum: ${macd.histogramMomentum}, Divergence: ${macd.divergence}`;
          reason += `, AboveZero: ${macd.macdAboveZero}, BelowZero: ${macd.macdBelowZero}`;
        }
        if (condition.includes("volume")) {
          reason += ` | Volume: ${volume.volumeRatio.toFixed(2)}x avg, Trend: ${volume.volumeTrend}`;
        }
        
        console.log(`[StrategyOrchestrator] TRIGGER FIRED: action=${rule.action}, reason=${reason}`);
        return {
          action: rule.action,
          rule,
          reason,
        };
      }
    }

    return { action: "hold", reason: "No rules triggered" };
  }

  private calculateSMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  // Calculate Exponential Moving Average (needed for MACD)
  private calculateEMA(data: number[], period: number): number[] {
    if (data.length < period) return [];
    
    const multiplier = 2 / (period + 1);
    const ema: number[] = [];
    
    // Start with SMA for the first EMA value
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i];
    }
    ema.push(sum / period);
    
    // Calculate EMA for remaining values
    for (let i = period; i < data.length; i++) {
      const currentEma = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
      ema.push(currentEma);
    }
    
    return ema;
  }

  // Calculate MACD (Moving Average Convergence Divergence)
  // MACD Line: 12-period EMA minus 26-period EMA (shows momentum)
  // Signal Line: 9-period EMA of the MACD Line (trigger for trades)
  // Histogram: MACD Line minus Signal Line (shows momentum strength)
  // Histogram Momentum: Swelling (increasing) vs Shrinking (decreasing) bars
  // Divergence: When price and MACD move in opposite directions (trend reversal signal)
  private calculateMACD(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): {
    macdLine: number;
    signalLine: number;
    histogram: number;
    previousHistogram: number;
    trend: "bullish" | "bearish" | "neutral";
    crossover: "bullish_crossover" | "bearish_crossover" | "none";
    histogramMomentum: "swelling" | "shrinking" | "stable";
    divergence: "bullish_divergence" | "bearish_divergence" | "none";
    macdAboveZero: boolean;
    macdBelowZero: boolean;
  } {
    const defaultResult = { 
      macdLine: 0, signalLine: 0, histogram: 0, previousHistogram: 0,
      trend: "neutral" as const, crossover: "none" as const,
      histogramMomentum: "stable" as const, divergence: "none" as const,
      macdAboveZero: false, macdBelowZero: false
    };
    
    if (closes.length < slowPeriod + signalPeriod) {
      return defaultResult;
    }

    // Calculate EMAs: 12-period (fast) and 26-period (slow)
    const ema12 = this.calculateEMA(closes, fastPeriod);
    const ema26 = this.calculateEMA(closes, slowPeriod);
    
    if (ema12.length === 0 || ema26.length === 0) {
      return defaultResult;
    }

    // Calculate MACD line (difference between fast and slow EMA)
    const offset = slowPeriod - fastPeriod;
    const macdLineArray: number[] = [];
    
    for (let i = 0; i < ema26.length; i++) {
      const ema12Value = ema12[i + offset];
      const ema26Value = ema26[i];
      if (ema12Value !== undefined && ema26Value !== undefined) {
        macdLineArray.push(ema12Value - ema26Value);
      }
    }

    if (macdLineArray.length < signalPeriod) {
      return defaultResult;
    }

    // Calculate signal line (9-period EMA of MACD line)
    const signalLineArray = this.calculateEMA(macdLineArray, signalPeriod);
    
    if (signalLineArray.length < 2) {
      return defaultResult;
    }

    // Get current and previous values for crossover detection
    const currentMacd = macdLineArray[macdLineArray.length - 1];
    const previousMacd = macdLineArray[macdLineArray.length - 2];
    const currentSignal = signalLineArray[signalLineArray.length - 1];
    const previousSignal = signalLineArray[signalLineArray.length - 2];
    const histogram = currentMacd - currentSignal;
    const previousHistogram = previousMacd - previousSignal;

    // MACD vs Zero Line (points 6 & 7)
    const macdAboveZero = currentMacd > 0;
    const macdBelowZero = currentMacd < 0;

    // Determine trend based on MACD vs Signal and histogram
    let trend: "bullish" | "bearish" | "neutral" = "neutral";
    if (currentMacd > currentSignal && histogram > 0) {
      trend = "bullish";
    } else if (currentMacd < currentSignal && histogram < 0) {
      trend = "bearish";
    }

    // Detect crossovers (buy/sell signals) - points 4 & 5
    let crossover: "bullish_crossover" | "bearish_crossover" | "none" = "none";
    if (previousMacd <= previousSignal && currentMacd > currentSignal) {
      crossover = "bullish_crossover"; // MACD crossed above signal - BUY signal
    } else if (previousMacd >= previousSignal && currentMacd < currentSignal) {
      crossover = "bearish_crossover"; // MACD crossed below signal - SELL signal
    }

    // Histogram momentum detection (point 3) - Swelling vs Shrinking bars
    // Uses 3-bar comparison for more robust detection
    // Swelling: Histogram bars are getting larger (momentum increasing)
    // Shrinking: Histogram bars are getting smaller (momentum decreasing, possible reversal)
    let histogramMomentum: "swelling" | "shrinking" | "stable" = "stable";
    
    // Calculate histogram array for multi-bar comparison
    const histogramArray: number[] = [];
    const minLen = Math.min(macdLineArray.length, signalLineArray.length);
    for (let i = 0; i < minLen; i++) {
      histogramArray.push(macdLineArray[macdLineArray.length - minLen + i] - signalLineArray[signalLineArray.length - minLen + i]);
    }
    
    if (histogramArray.length >= 3) {
      const h0 = Math.abs(histogramArray[histogramArray.length - 1]); // current
      const h1 = Math.abs(histogramArray[histogramArray.length - 2]); // 1 bar ago
      const h2 = Math.abs(histogramArray[histogramArray.length - 3]); // 2 bars ago
      
      // Swelling: bars increasing in size over 2+ periods
      if (h0 > h1 && h1 > h2) {
        histogramMomentum = "swelling";
      }
      // Shrinking: bars decreasing in size over 2+ periods
      else if (h0 < h1 && h1 < h2) {
        histogramMomentum = "shrinking";
      }
      // Also detect single-period changes with threshold
      else {
        const avgChange = ((h0 - h1) + (h1 - h2)) / 2;
        const epsilon = 0.0001;
        if (avgChange > epsilon) {
          histogramMomentum = "swelling";
        } else if (avgChange < -epsilon) {
          histogramMomentum = "shrinking";
        }
      }
    }

    // Divergence detection (point 8) - Price vs MACD disagreement
    // Bullish divergence: Price making lower lows but MACD making higher lows (reversal up)
    // Bearish divergence: Price making higher highs but MACD making lower highs (reversal down)
    let divergence: "bullish_divergence" | "bearish_divergence" | "none" = "none";
    
    // Need at least 10 periods to detect proper swing divergence patterns
    if (closes.length >= 10 && macdLineArray.length >= 10) {
      const lookback = 10;
      const recentCloses = closes.slice(-lookback);
      const recentMacd = macdLineArray.slice(-lookback);
      
      // Find local price highs and lows (swing points)
      const priceHigh1 = Math.max(...recentCloses.slice(0, 5));
      const priceHigh2 = Math.max(...recentCloses.slice(5));
      const priceLow1 = Math.min(...recentCloses.slice(0, 5));
      const priceLow2 = Math.min(...recentCloses.slice(5));
      
      const macdHigh1 = Math.max(...recentMacd.slice(0, 5));
      const macdHigh2 = Math.max(...recentMacd.slice(5));
      const macdLow1 = Math.min(...recentMacd.slice(0, 5));
      const macdLow2 = Math.min(...recentMacd.slice(5));
      
      // Bullish divergence: Price making lower lows, MACD making higher lows
      // This suggests underlying momentum is strengthening despite falling price
      if (priceLow2 < priceLow1 && macdLow2 > macdLow1) {
        divergence = "bullish_divergence";
      }
      // Bearish divergence: Price making higher highs, MACD making lower highs
      // This suggests underlying momentum is weakening despite rising price
      else if (priceHigh2 > priceHigh1 && macdHigh2 < macdHigh1) {
        divergence = "bearish_divergence";
      }
    }

    return {
      macdLine: currentMacd,
      signalLine: currentSignal,
      histogram,
      previousHistogram,
      trend,
      crossover,
      histogramMomentum,
      divergence,
      macdAboveZero,
      macdBelowZero,
    };
  }

  // Calculate volume analysis
  private calculateVolumeAnalysis(klines: { close: number; volume?: number }[]): {
    currentVolume: number;
    averageVolume: number;
    volumeRatio: number;
    isVolumeSpike: boolean;
    isHighVolume: boolean;
    isLowVolume: boolean;
    volumeTrend: "increasing" | "decreasing" | "stable";
  } {
    const volumes = klines.map(k => k.volume || 0);
    
    if (klines.length < 20 || volumes.every(v => v === 0)) {
      const vol = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
      return {
        currentVolume: vol,
        averageVolume: vol,
        volumeRatio: 1,
        isVolumeSpike: false,
        isHighVolume: false,
        isLowVolume: false,
        volumeTrend: "stable",
      };
    }

    const currentVolume = volumes[volumes.length - 1];
    
    // Calculate 20-period average volume
    const avgVolume20 = this.calculateSMA(volumes.slice(-20), 20);
    
    // Volume ratio (current vs average)
    const volumeRatio = avgVolume20 > 0 ? currentVolume / avgVolume20 : 1;
    
    // Volume spike detection (volume > 2x average)
    const isVolumeSpike = volumeRatio > 2.0;
    
    // High volume (> 1.5x average)
    const isHighVolume = volumeRatio > 1.5;
    
    // Low volume (< 0.5x average)
    const isLowVolume = volumeRatio < 0.5;
    
    // Calculate volume trend (compare recent 5 bars vs previous 5 bars)
    let volumeTrend: "increasing" | "decreasing" | "stable" = "stable";
    if (volumes.length >= 10) {
      const recent5Avg = this.calculateSMA(volumes.slice(-5), 5);
      const previous5Avg = this.calculateSMA(volumes.slice(-10, -5), 5);
      
      if (recent5Avg > previous5Avg * 1.2) {
        volumeTrend = "increasing";
      } else if (recent5Avg < previous5Avg * 0.8) {
        volumeTrend = "decreasing";
      }
    }

    return {
      currentVolume,
      averageVolume: avgVolume20,
      volumeRatio,
      isVolumeSpike,
      isHighVolume,
      isLowVolume,
      volumeTrend,
    };
  }

  private async executeDecision(
    instance: BotInstance,
    decision: { action: string; rule?: any; reason: string },
    ticker: { lastPrice: number },
    exchangeInfo: any
  ): Promise<void> {
    const { exchange, symbol, algorithm, executionMode } = instance;
    const credentials = await storage.getCredentials(exchange);
    if (!credentials) return;

    const { riskManagement } = algorithm;
    const modeLabel = executionMode === "paper" ? "PAPER" : "REAL";

    await storage.addTradeLog({
      type: "signal",
      message: `[${modeLabel}] ${decision.reason} on ${symbol}`,
      data: { action: decision.action, exchange, sessionId: instance.sessionId },
    });

    try {
      instance.totalTrades++;

      if (decision.action === "buy" || decision.action === "sell") {
        // getMarkets now returns MarketsResult with data source embedded
        const marketsResult = await exchangeService.getMarkets(exchange);
        const market = marketsResult.markets.find(m => m.symbol === symbol);
        const marketMaxLeverage = market?.maxLeverage || exchangeInfo.maxLeverage;
        
        const effectiveLeverage = Math.min(
          riskManagement.maxLeverage,
          exchangeInfo.maxLeverage,
          marketMaxLeverage
        );
        
        const positionSize = Math.min(riskManagement.maxPositionSize, 1000);
        const quantity = positionSize / ticker.lastPrice;

        const order = await exchangeService.placeOrder(exchange, credentials, {
          symbol,
          type: decision.rule?.priceType || "market",
          side: decision.action as "buy" | "sell",
          quantity,
          price: ticker.lastPrice,
        });

        await storage.addOrder(exchange, order);

        const position = {
          id: randomUUID(),
          symbol,
          side: decision.action === "buy" ? "long" : "short",
          quantity,
          entryPrice: ticker.lastPrice,
          markPrice: ticker.lastPrice,
          leverage: effectiveLeverage,
          unrealizedPnl: 0,
          marginType: "isolated" as const,
          margin: positionSize / effectiveLeverage,
          liquidationPrice: 0,
        };

        await storage.updatePosition(exchange, position as any);
        instance.successfulTrades++;

        await notificationService.notifyTradeOpen(
          exchange,
          symbol,
          position.side as any,
          quantity,
          ticker.lastPrice,
          executionMode
        );

        await storage.addTradeLog({
          type: "position",
          message: `[${modeLabel}] Opened ${position.side} position: ${quantity.toFixed(6)} ${symbol} @ ${ticker.lastPrice.toFixed(2)}`,
          data: {
            sessionId: instance.sessionId,
            positionId: position.id,
            side: position.side,
            quantity,
            entryPrice: ticker.lastPrice,
          },
        });
      }
    } catch (error) {
      console.error("Decision execution error:", error);
      await storage.addTradeLog({
        type: "error",
        message: `[${modeLabel}] Failed to execute ${decision.action} on ${symbol}: ${(error as Error).message}`,
        data: { sessionId: instance.sessionId },
      });
    }
  }
}

export const strategyOrchestrator = new StrategyOrchestrator();
