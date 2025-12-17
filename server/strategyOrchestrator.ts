import type { 
  TradingAlgorithm, 
  Exchange, 
  ExecutionMode, 
  OptimizationMode, 
  OptimizationSuggestion, 
  LiveStrategyMetrics,
  RunningStrategy,
  RiskManagement,
  Position,
  VolatilityGuardConfig 
} from "@shared/schema";
import { defaultVolatilityGuardConfig } from "@shared/schema";
import { storage } from "./storage";
import { exchangeService } from "./exchangeService";
import { notificationService } from "./notificationService";
import { strategyOptimizer } from "./strategyOptimizer";
import { getPositionBroker } from "./positionBroker";
import { getVolatilityGuard } from "./volatilityGuard";
import { randomUUID } from "crypto";

// Type for compound condition AST nodes
type ConditionNodeType = 'LEAF' | 'AND' | 'OR' | 'NOT' | 'XOR' | 'IF_THEN';
interface ConditionNode {
  type: ConditionNodeType;
  children?: ConditionNode[];
  condition?: string;
}

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
  // Frequency control tracking
  lastTradeTime: number;
  tradesThisHour: number[];
  positionOpenTimes: Map<string, number>;
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
      // Frequency control tracking
      lastTradeTime: 0,
      tradesThisHour: [],
      positionOpenTimes: new Map(),
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
        timeframe,
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

    // Get current price for PnL calculation
    const tickerResult = await exchangeService.getTicker(instance.exchange, instance.symbol);
    const currentPrice = tickerResult.ticker?.lastPrice ?? 0;

    // Close logical positions through PositionBroker
    const broker = getPositionBroker(instance.exchange, instance.symbol);
    const logicalPnl = await broker.closeAllPositions(sessionId, currentPrice, "manual_close_all");

    for (const position of symbolPositions) {
      await exchangeService.closePosition(instance.exchange, credentials, position.id);
      await storage.deletePosition(instance.exchange, position.id);
      // Record position close for frequency control
      this.recordPositionClose(instance, position.id);
      this.recordTradeExecution(instance);
    }

    await storage.addTradeLog({
      type: "position",
      message: `[${modeLabel}] Closed ${symbolPositions.length} positions for ${instance.symbol}, logical PnL: ${logicalPnl.toFixed(4)} USDT`,
      data: { sessionId, positionsClosed: symbolPositions.length, logicalPnl },
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

  // Check if frequency controls allow a new trade
  private checkFrequencyControls(instance: BotInstance, positions: Position[], action: string): { allowed: boolean; reason?: string } {
    const riskManagement = instance.algorithm.riskManagement;
    const now = Date.now();
    
    // 1. Trade Cooldown check (for new entries only)
    if ((action === "buy" || action === "sell") && riskManagement.tradeCooldownSeconds) {
      const cooldownMs = riskManagement.tradeCooldownSeconds * 1000;
      const timeSinceLastTrade = now - instance.lastTradeTime;
      if (instance.lastTradeTime > 0 && timeSinceLastTrade < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastTrade) / 1000);
        return { allowed: false, reason: `Trade cooldown: ${remainingSeconds}s remaining` };
      }
    }
    
    // 2. Max Trades Per Hour check
    if (riskManagement.maxTradesPerHour) {
      // Clean up old trades (older than 1 hour)
      const oneHourAgo = now - 60 * 60 * 1000;
      instance.tradesThisHour = instance.tradesThisHour.filter(t => t > oneHourAgo);
      
      if (instance.tradesThisHour.length >= riskManagement.maxTradesPerHour) {
        return { allowed: false, reason: `Max trades/hour reached: ${instance.tradesThisHour.length}/${riskManagement.maxTradesPerHour}` };
      }
    }
    
    // 3. Max Concurrent Positions check (for new entries only)
    if ((action === "buy" || action === "sell") && riskManagement.maxConcurrentPositions) {
      if (positions.length >= riskManagement.maxConcurrentPositions) {
        return { allowed: false, reason: `Max concurrent positions: ${positions.length}/${riskManagement.maxConcurrentPositions}` };
      }
    }
    
    // 4. Min Hold Time check (for close actions only)
    if (action === "close" && riskManagement.minHoldTimeSeconds && positions.length > 0) {
      const minHoldMs = riskManagement.minHoldTimeSeconds * 1000;
      // Check if any position was opened too recently
      for (const pos of positions) {
        const openTime = instance.positionOpenTimes.get(pos.id);
        if (openTime) {
          const holdTime = now - openTime;
          if (holdTime < minHoldMs) {
            const remainingSeconds = Math.ceil((minHoldMs - holdTime) / 1000);
            return { allowed: false, reason: `Min hold time: ${remainingSeconds}s remaining for ${pos.symbol}` };
          }
        }
      }
    }
    
    return { allowed: true };
  }

  // Track that a trade was executed
  private recordTradeExecution(instance: BotInstance, positionId?: string): void {
    const now = Date.now();
    instance.lastTradeTime = now;
    instance.tradesThisHour.push(now);
    
    // Track position open time if this is a new position
    if (positionId) {
      instance.positionOpenTimes.set(positionId, now);
    }
  }

  // Remove position from tracking when closed
  private recordPositionClose(instance: BotInstance, positionId: string): void {
    instance.positionOpenTimes.delete(positionId);
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

      // Get Position Broker
      const broker = getPositionBroker(exchange, symbol);
      const riskManagement = algorithm.riskManagement;
      
      // === VOLATILITY GUARD CHECK ===
      // Update volatility buffer with latest klines and check for dangerous market conditions
      const volatilityGuardConfig = riskManagement.volatilityGuard ?? defaultVolatilityGuardConfig;
      const volatilityGuard = getVolatilityGuard(exchange, symbol, volatilityGuardConfig);
      volatilityGuard.update(klines);
      
      const volatilityCheck = volatilityGuard.check();
      
      if (volatilityCheck.triggered) {
        // Critical volatility detected - close all positions immediately
        const modeLabel = executionMode === "paper" ? "PAPER" : "REAL";
        console.log(`[VolatilityGuard] CRITICAL volatility detected for ${symbol}: ${volatilityCheck.reason}`);
        
        const closeResult = await broker.closePositionsByReason(
          ticker.lastPrice,
          "volatility_guard",
          { sessionId }
        );
        
        if (closeResult.closedCount > 0) {
          // Close corresponding exchange positions
          for (const closedPos of closeResult.closedPositions) {
            if (closedPos.exchangePositionId) {
              const matchingExchangePos = symbolPositions.find(p => p.id === closedPos.exchangePositionId);
              if (matchingExchangePos) {
                await exchangeService.closePosition(exchange, credentials, matchingExchangePos.id);
                await storage.deletePosition(exchange, matchingExchangePos.id);
              }
            }
          }
          
          await notificationService.notify({
            type: "error",
            title: "Volatility Guard Triggered",
            message: `[${modeLabel}] VOLATILITY GUARD closed ${closeResult.closedCount} positions on ${symbol}. PnL: ${closeResult.totalPnl.toFixed(4)} USDT. Reason: ${volatilityCheck.reason}`,
            exchange,
            symbol,
            pnl: closeResult.totalPnl,
            data: {
              atrRatio: volatilityCheck.atrRatio,
              sigmaRatio: volatilityCheck.sigmaRatio,
              wickRatio: volatilityCheck.wickRatio,
            },
          });
          
          await storage.addTradeLog({
            type: "warning",
            message: `[${modeLabel}] VOLATILITY GUARD closed ${closeResult.closedCount} positions on ${symbol}: ${volatilityCheck.reason}`,
            data: {
              sessionId,
              closedCount: closeResult.closedCount,
              totalPnl: closeResult.totalPnl,
              atrRatio: volatilityCheck.atrRatio,
              sigmaRatio: volatilityCheck.sigmaRatio,
              wickRatio: volatilityCheck.wickRatio,
            },
          });
          
          instance.totalTrades += closeResult.closedCount;
        }
        
        // Don't process any new trades during critical volatility
        return;
      }

      // Check stop conditions on logical positions via PositionBroker
      const triggeredStops = await broker.checkStopConditions(ticker.lastPrice);
      
      for (const stop of triggeredStops) {
        const modeLabel = executionMode === "paper" ? "PAPER" : "REAL";
        
        // Close the logical position
        const result = await broker.closePosition({
          logicalPositionId: stop.position.id,
          exitPrice: ticker.lastPrice,
          reason: stop.trigger,
        });
        
        // Close the linked exchange position using stored exchangePositionId
        if (stop.position.exchangePositionId) {
          const matchingExchangePos = symbolPositions.find(p => 
            p.id === stop.position.exchangePositionId
          );
          if (matchingExchangePos) {
            await exchangeService.closePosition(exchange, credentials, matchingExchangePos.id);
            await storage.deletePosition(exchange, matchingExchangePos.id);
          }
        }
        
        const triggerLabel = stop.trigger === "take_profit" ? "TAKE PROFIT" : 
                            stop.trigger === "stop_loss" ? "STOP LOSS" : "TRAILING STOP";
        
        await notificationService.notify({
          type: stop.trigger === "stop_loss" ? "stop_loss" : "take_profit",
          title: `${triggerLabel} Triggered`,
          message: `[${modeLabel}] ${triggerLabel} triggered for ${symbol}: ROI ${stop.roi.toFixed(2)}%, PnL ${result.pnl.toFixed(4)} USDT`,
          exchange,
          symbol,
          pnl: result.pnl,
          data: {
            trigger: stop.trigger,
            roi: stop.roi,
          },
        });
        
        await storage.addTradeLog({
          type: "signal",
          message: `[${modeLabel}] ${triggerLabel} closed ${stop.position.side} ${symbol}: ROI=${stop.roi.toFixed(2)}%, PnL=${result.pnl.toFixed(4)} USDT`,
          data: { 
            sessionId, 
            logicalPositionId: stop.position.id,
            trigger: stop.trigger,
            roi: stop.roi,
            pnl: result.pnl,
          },
        });
        
        instance.totalTrades++;
        this.recordTradeExecution(instance);
      }

      const decision = await this.evaluateRules(
        algorithm.rules, 
        ticker, 
        klines, 
        symbolPositions,
        exchangeInfo
      );

      if (decision.action !== "hold") {
        // Check frequency controls before executing
        const frequencyCheck = this.checkFrequencyControls(instance, symbolPositions, decision.action);
        if (!frequencyCheck.allowed) {
          // Log but don't execute
          console.log(`[FrequencyControl] Session ${sessionId} blocked: ${frequencyCheck.reason}`);
          return;
        }
        
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

  // ============================================================
  // COMPOUND CONDITION PARSER
  // Supports: AND, OR, NOT, XOR, IF-THEN, and parentheses for nesting
  // ============================================================

  private tokenizeCondition(condition: string): string[] {
    let normalized = condition
      .replace(/\(/g, ' ( ')
      .replace(/\)/g, ' ) ')
      .replace(/\bAND\b/gi, ' AND ')
      .replace(/\bOR\b/gi, ' OR ')
      .replace(/\bNOT\b/gi, ' NOT ')
      .replace(/\bXOR\b/gi, ' XOR ')
      .replace(/\bIF\b/gi, ' IF ')
      .replace(/\bTHEN\b/gi, ' THEN ');
    return normalized.split(/\s+/).filter(t => t.length > 0);
  }

  private isCompoundCondition(condition: string): boolean {
    const upper = condition.toUpperCase();
    return upper.includes(' AND ') || upper.includes(' OR ') || 
           upper.includes(' NOT ') || upper.includes(' XOR ') ||
           upper.includes('(') || (upper.includes(' IF ') && upper.includes(' THEN '));
  }

  private parseCompoundCondition(condition: string): ConditionNode {
    const tokens = this.tokenizeCondition(condition);
    const { node } = this.parseExpression(tokens, 0);
    return node;
  }

  private parseExpression(tokens: string[], pos: number): { node: ConditionNode; nextPos: number } {
    // Check for IF-THEN at the START of the expression
    if (pos < tokens.length && tokens[pos]?.toUpperCase() === 'IF') {
      const ifResult = this.parseOr(tokens, pos + 1);
      if (ifResult.nextPos < tokens.length && tokens[ifResult.nextPos]?.toUpperCase() === 'THEN') {
        const thenResult = this.parseOr(tokens, ifResult.nextPos + 1);
        return { node: { type: 'IF_THEN', children: [ifResult.node, thenResult.node] }, nextPos: thenResult.nextPos };
      }
      // Fallback if THEN not found - treat as regular expression
      return ifResult;
    }
    return this.parseOr(tokens, pos);
  }

  private parseOr(tokens: string[], pos: number): { node: ConditionNode; nextPos: number } {
    let { node: left, nextPos } = this.parseXor(tokens, pos);
    while (nextPos < tokens.length && tokens[nextPos]?.toUpperCase() === 'OR') {
      const { node: right, nextPos: newPos } = this.parseXor(tokens, nextPos + 1);
      left = { type: 'OR', children: [left, right] };
      nextPos = newPos;
    }
    return { node: left, nextPos };
  }

  private parseXor(tokens: string[], pos: number): { node: ConditionNode; nextPos: number } {
    let { node: left, nextPos } = this.parseAnd(tokens, pos);
    while (nextPos < tokens.length && tokens[nextPos]?.toUpperCase() === 'XOR') {
      const { node: right, nextPos: newPos } = this.parseAnd(tokens, nextPos + 1);
      left = { type: 'XOR', children: [left, right] };
      nextPos = newPos;
    }
    return { node: left, nextPos };
  }

  private parseAnd(tokens: string[], pos: number): { node: ConditionNode; nextPos: number } {
    let { node: left, nextPos } = this.parseNot(tokens, pos);
    while (nextPos < tokens.length && tokens[nextPos]?.toUpperCase() === 'AND') {
      const { node: right, nextPos: newPos } = this.parseNot(tokens, nextPos + 1);
      left = { type: 'AND', children: [left, right] };
      nextPos = newPos;
    }
    return { node: left, nextPos };
  }

  private parseNot(tokens: string[], pos: number): { node: ConditionNode; nextPos: number } {
    if (pos < tokens.length && tokens[pos]?.toUpperCase() === 'NOT') {
      const { node: child, nextPos } = this.parseNot(tokens, pos + 1);
      return { node: { type: 'NOT', children: [child] }, nextPos };
    }
    return this.parsePrimary(tokens, pos);
  }

  private parsePrimary(tokens: string[], pos: number): { node: ConditionNode; nextPos: number } {
    if (pos >= tokens.length) {
      return { node: { type: 'LEAF', condition: '' }, nextPos: pos };
    }
    if (tokens[pos] === '(') {
      const { node, nextPos } = this.parseExpression(tokens, pos + 1);
      const finalPos = tokens[nextPos] === ')' ? nextPos + 1 : nextPos;
      return { node, nextPos: finalPos };
    }
    const operators = ['AND', 'OR', 'NOT', 'XOR', 'IF', 'THEN', '(', ')'];
    const conditionTokens: string[] = [];
    let currentPos = pos;
    while (currentPos < tokens.length) {
      const token = tokens[currentPos];
      if (operators.includes(token.toUpperCase()) || token === '(' || token === ')') break;
      conditionTokens.push(token);
      currentPos++;
    }
    return { node: { type: 'LEAF', condition: conditionTokens.join(' ') }, nextPos: currentPos };
  }

  private evaluateConditionNode(node: ConditionNode, evaluatePrimitive: (condition: string) => boolean): boolean {
    switch (node.type) {
      case 'LEAF':
        return evaluatePrimitive(node.condition || '');
      case 'AND':
        return node.children?.every(child => this.evaluateConditionNode(child, evaluatePrimitive)) ?? false;
      case 'OR':
        return node.children?.some(child => this.evaluateConditionNode(child, evaluatePrimitive)) ?? false;
      case 'NOT':
        return !this.evaluateConditionNode(node.children![0], evaluatePrimitive);
      case 'XOR': {
        const results = node.children?.map(child => this.evaluateConditionNode(child, evaluatePrimitive)) ?? [];
        return results.filter(r => r).length === 1;
      }
      case 'IF_THEN': {
        const [ifNode, thenNode] = node.children!;
        const ifResult = this.evaluateConditionNode(ifNode, evaluatePrimitive);
        if (!ifResult) return true;
        return this.evaluateConditionNode(thenNode, evaluatePrimitive);
      }
      default:
        return false;
    }
  }

  // Context object for primitive evaluator
  private evaluationContext: {
    currentPrice: number;
    priceChange: number;
    hasPosition: boolean;
    sma20: number;
    sma50: number;
    macd: ReturnType<StrategyOrchestrator["calculateMACD"]>;
    volume: ReturnType<StrategyOrchestrator["calculateVolumeAnalysis"]>;
    klines: { close: number; volume?: number }[];
    positions: any[];
  } | null = null;

  // Evaluate a single primitive condition
  private evaluatePrimitiveCondition(conditionText: string): boolean {
    if (!this.evaluationContext) return false;
    
    const { currentPrice, priceChange, hasPosition, sma20, sma50, macd, volume, klines, positions } = this.evaluationContext;
    const condition = conditionText.toLowerCase().trim();
    
    if (!condition) return false;

    // --- NUMERIC PRICE CONDITIONS ---
    const numericResult = this.evaluateNumericCondition(conditionText, currentPrice);
    if (numericResult.matched) return numericResult.triggered;

    // --- SMA Conditions ---
    if (condition.includes("price above sma") && currentPrice > sma20) return true;
    if (condition.includes("price below sma") && currentPrice < sma20) return true;
    if ((condition.includes("sma crossover") || condition.includes("bullish crossover")) && sma20 > sma50) return true;
    if (condition.includes("bearish crossover") && sma20 < sma50) return true;

    // --- MACD Conditions ---
    if ((condition.includes("macd bullish crossover") || condition.includes("macd cross above")) && macd.crossover === "bullish_crossover") return true;
    if ((condition.includes("macd bearish crossover") || condition.includes("macd cross below")) && macd.crossover === "bearish_crossover") return true;
    if ((condition.includes("macd bullish") || condition.includes("macd positive")) && macd.trend === "bullish") return true;
    if ((condition.includes("macd bearish") || condition.includes("macd negative")) && macd.trend === "bearish") return true;
    if ((condition.includes("macd histogram positive") || condition.includes("histogram above zero")) && macd.histogram > 0) return true;
    if ((condition.includes("macd histogram negative") || condition.includes("histogram below zero")) && macd.histogram < 0) return true;
    if (condition.includes("macd above zero") && macd.macdAboveZero) return true;
    if (condition.includes("macd below zero") && macd.macdBelowZero) return true;
    if (condition.includes("macd above signal") && macd.macdLine > macd.signalLine) return true;
    if (condition.includes("macd below signal") && macd.macdLine < macd.signalLine) return true;
    if ((condition.includes("histogram swelling") || condition.includes("momentum increasing") || condition.includes("bars increasing")) && macd.histogramMomentum === "swelling") return true;
    if ((condition.includes("histogram shrinking") || condition.includes("momentum decreasing") || condition.includes("bars decreasing")) && macd.histogramMomentum === "shrinking") return true;
    if ((condition.includes("bullish divergence") || condition.includes("positive divergence")) && macd.divergence === "bullish_divergence") return true;
    if ((condition.includes("bearish divergence") || condition.includes("negative divergence")) && macd.divergence === "bearish_divergence") return true;
    if ((condition.includes("divergence detected") || condition.includes("any divergence")) && macd.divergence !== "none") return true;

    // --- Volume Conditions ---
    if ((condition.includes("volume spike") || condition.includes("high volume spike")) && volume.isVolumeSpike) return true;
    if ((condition.includes("high volume") || condition.includes("above average volume")) && volume.isHighVolume) return true;
    if ((condition.includes("low volume") || condition.includes("below average volume")) && volume.isLowVolume) return true;
    if ((condition.includes("volume increasing") || condition.includes("rising volume")) && volume.volumeTrend === "increasing") return true;
    if ((condition.includes("volume decreasing") || condition.includes("falling volume")) && volume.volumeTrend === "decreasing") return true;

    // --- Combined Conditions ---
    if ((condition.includes("macd bullish with volume") || condition.includes("bullish with volume confirmation")) && macd.trend === "bullish" && volume.isHighVolume) return true;
    if ((condition.includes("macd bearish with volume") || condition.includes("bearish with volume confirmation")) && macd.trend === "bearish" && volume.isHighVolume) return true;
    if (condition.includes("macd crossover with volume") && macd.crossover !== "none" && volume.isHighVolume) return true;
    if ((condition.includes("bullish breakout") || condition.includes("breakout with volume")) && macd.trend === "bullish" && volume.isVolumeSpike && currentPrice > sma20) return true;
    if (condition.includes("bearish breakdown") && macd.trend === "bearish" && volume.isVolumeSpike && currentPrice < sma20) return true;

    // --- Price/Market Conditions ---
    if (condition.includes("oversold") && priceChange < -2) return true;
    if (condition.includes("overbought") && priceChange > 2) return true;
    if (condition.includes("no position") && !hasPosition) return true;
    if (condition.includes("has position") && hasPosition) return true;

    // --- Immediate Entry Conditions ---
    if ((condition.includes("immediate") || condition.includes("enter now") || condition.includes("market entry") ||
         condition.includes("on start") || condition.includes("always enter") || condition.includes("entry signal")) && !hasPosition) {
      return true;
    }

    return false;
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

    // Set up evaluation context for primitive evaluator
    this.evaluationContext = {
      currentPrice,
      priceChange,
      hasPosition,
      sma20,
      sma50,
      macd,
      volume,
      klines,
      positions,
    };

    // Rule evaluation with support for compound conditions (AND, OR, NOT, XOR, IF-THEN)
    for (const rule of sortedRules) {
      let shouldTrigger = false;
      let triggerDebugInfo = "";

      // Check if this is a compound condition
      if (this.isCompoundCondition(rule.condition)) {
        const ast = this.parseCompoundCondition(rule.condition);
        shouldTrigger = this.evaluateConditionNode(ast, (primitive) => this.evaluatePrimitiveCondition(primitive));
        triggerDebugInfo = `Compound condition evaluated: ${shouldTrigger ? "TRUE" : "FALSE"}`;
        console.log(`[StrategyOrchestrator] Compound rule "${rule.condition}": ${triggerDebugInfo}`);
      } else {
        // Simple primitive condition
        shouldTrigger = this.evaluatePrimitiveCondition(rule.condition);
      }

      if (shouldTrigger) {
        const condition = rule.condition.toLowerCase();
        let reason = `Rule triggered: ${rule.condition}`;
        
        if (triggerDebugInfo) {
          reason += ` | ${triggerDebugInfo}`;
        }
        if (condition.includes("macd") || condition.includes("histogram") || condition.includes("divergence") || condition.includes("momentum")) {
          reason += ` | MACD: ${macd.macdLine.toFixed(4)}, Signal: ${macd.signalLine.toFixed(4)}, Histogram: ${macd.histogram.toFixed(4)}, Trend: ${macd.trend}`;
        }
        if (condition.includes("volume")) {
          reason += ` | Volume: ${volume.volumeRatio.toFixed(2)}x avg, Trend: ${volume.volumeTrend}`;
        }
        
        console.log(`[StrategyOrchestrator] TRIGGER FIRED: action=${rule.action}, reason=${reason}`);
        this.evaluationContext = null;
        return { action: rule.action, rule, reason };
      }
    }

    this.evaluationContext = null;
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

        const positionId = randomUUID();
        const position = {
          id: positionId,
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
        
        // Create logical position via PositionBroker for shadow tracking
        // Pass exchangePositionId at creation time to ensure proper linking
        const broker = getPositionBroker(exchange, symbol);
        const logicalPosition = await broker.openPosition({
          sessionId: instance.sessionId,
          algorithmId: algorithm.id,
          exchange,
          symbol,
          side: position.side as "long" | "short",
          quantity,
          entryPrice: ticker.lastPrice,
          leverage: effectiveLeverage,
          allocatedMargin: positionSize / effectiveLeverage,
          takeProfitPercent: riskManagement.takeProfitPercent || undefined,
          stopLossPercent: riskManagement.stopLossPercent || undefined,
          trailingStopPercent: riskManagement.trailingStop ? riskManagement.trailingStopPercent : undefined,
          exchangePositionId: positionId,
        });
        
        // Record trade execution for frequency control
        this.recordTradeExecution(instance, positionId);
        
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
            logicalPositionId: logicalPosition.id,
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
