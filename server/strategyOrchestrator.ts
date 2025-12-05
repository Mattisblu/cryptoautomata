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
    const { exchange, symbol, algorithm, executionMode, optimizationMode } = config;
    
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
      const { exchange, symbol, algorithm, executionMode } = instance;
      
      const exchangeInfo = exchangeService.getExchangeInfo(exchange);
      // getTicker/getKlines now return result types with data source embedded
      const tickerResult = await exchangeService.getTicker(exchange, symbol);
      const klinesResult = await exchangeService.getKlines(exchange, symbol, "15m", 50);
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

  private async evaluateRules(
    rules: TradingAlgorithm["rules"],
    ticker: { lastPrice: number; priceChangePercent: number },
    klines: { close: number }[],
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

    for (const rule of sortedRules) {
      const condition = rule.condition.toLowerCase();
      let shouldTrigger = false;

      if (condition.includes("price above sma") && currentPrice > sma20) {
        shouldTrigger = true;
      } else if (condition.includes("price below sma") && currentPrice < sma20) {
        shouldTrigger = true;
      } else if (condition.includes("bullish crossover") && sma20 > sma50) {
        shouldTrigger = true;
      } else if (condition.includes("bearish crossover") && sma20 < sma50) {
        shouldTrigger = true;
      } else if (condition.includes("oversold") && priceChange < -2) {
        shouldTrigger = true;
      } else if (condition.includes("overbought") && priceChange > 2) {
        shouldTrigger = true;
      } else if (condition.includes("no position") && !hasPosition) {
        shouldTrigger = true;
      } else if (condition.includes("has position") && hasPosition) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        return {
          action: rule.action,
          rule,
          reason: `Rule triggered: ${rule.condition}`,
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
