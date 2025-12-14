import type { TradingAlgorithm, TradingRule, Position, Order, Ticker, Kline, Exchange, ExecutionMode, OptimizationMode, StopOrder, RiskManagement, InsertTrade, OptimizationSuggestion, LiveStrategyMetrics } from "@shared/schema";
import { storage } from "./storage";
import { exchangeService } from "./exchangeService";
import { notificationService } from "./notificationService";
import { strategyOptimizer } from "./strategyOptimizer";
import { randomUUID } from "crypto";

// Map position IDs to trade IDs for updating when positions close
const positionToTradeId: Map<string, number> = new Map();

interface TradingBotConfig {
  exchange: Exchange;
  symbol: string;
  algorithm: TradingAlgorithm;
  executionMode: ExecutionMode;
  optimizationMode: OptimizationMode;
  timeframe: string; // User-selected timeframe for klines analysis (1m, 5m, 15m, etc.)
  checkIntervalMs?: number;
  onOptimizationSuggestion?: (suggestion: Omit<OptimizationSuggestion, "id" | "timestamp">) => void;
  onMetricsUpdate?: (metrics: LiveStrategyMetrics) => void;
  onAlgorithmUpdate?: (algorithm: TradingAlgorithm) => void;
}

interface TradingBotState {
  isRunning: boolean;
  isPaused: boolean;
  lastCheck: number;
  decisions: string[];
  executionMode: ExecutionMode;
  totalTrades: number;
  successfulTrades: number;
  // Frequency control tracking
  lastTradeTime: number;        // Timestamp of last trade for cooldown
  tradesThisHour: number[];     // Timestamps of trades in the last hour
  positionOpenTimes: Map<string, number>; // positionId -> openTime for min hold time
}

// Known rule patterns that the bot can understand
const RECOGNIZED_RULE_PATTERNS = [
  // SMA conditions
  "price above sma", "price below sma", "sma crossover", "bullish crossover", "bearish crossover",
  // MACD conditions
  "macd bullish crossover", "macd cross above", "macd bearish crossover", "macd cross below",
  "macd bullish", "macd positive", "macd bearish", "macd negative",
  "macd histogram positive", "histogram above zero", "macd histogram negative", "histogram below zero",
  "macd above signal", "macd below signal",
  // Volume conditions
  "volume spike", "high volume spike", "high volume", "above average volume",
  "low volume", "below average volume", "volume increasing", "rising volume",
  "volume decreasing", "falling volume",
  // Combined conditions
  "macd bullish with volume", "bullish with volume confirmation",
  "macd bearish with volume", "bearish with volume confirmation",
  "macd crossover with volume", "bullish breakout", "breakout with volume", "bearish breakdown",
  // Price/market conditions
  "oversold", "overbought", "no position", "has position",
  // Immediate entry
  "immediate", "enter now", "market entry", "on start", "always enter", "entry signal",
  // Take profit / stop loss (need % number)
  "take profit", "take-profit", "stop loss", "stop-loss", "price decreases", "price increases",
  // Price breakout
  "price breaks", "breaks below", "breaks above",
  // Numeric conditions (price > X, price < X, etc.)
  "price >", "price <", "price >=", "price <=", "price =",
];

export interface RuleWarning {
  ruleIndex: number;
  condition: string;
  action: string;
  warning: string;
  isUnrecognized: boolean;
}

// Type for compound condition AST nodes
type ConditionNodeType = 'LEAF' | 'AND' | 'OR' | 'NOT' | 'XOR' | 'IF_THEN';
interface ConditionNode {
  type: ConditionNodeType;
  children?: ConditionNode[];
  condition?: string;
}

class TradingBot {
  private config: TradingBotConfig | null = null;
  private reportedWarnings: Set<string> = new Set(); // Track already reported warnings
  private state: TradingBotState = {
    isRunning: false,
    isPaused: false,
    lastCheck: 0,
    decisions: [],
    executionMode: "paper",
    totalTrades: 0,
    successfulTrades: 0,
    // Frequency control tracking
    lastTradeTime: 0,
    tradesThisHour: [],
    positionOpenTimes: new Map(),
  };
  private checkInterval: NodeJS.Timeout | null = null;

  // Validate algorithm rules and return any warnings
  validateRules(rules: TradingRule[]): RuleWarning[] {
    const warnings: RuleWarning[] = [];
    
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const condition = rule.condition.toLowerCase();
      
      // Check if rule matches any recognized pattern
      const isRecognized = RECOGNIZED_RULE_PATTERNS.some(pattern => 
        condition.includes(pattern.toLowerCase())
      );
      
      // Also check for numeric price conditions (price > 100, etc.)
      const hasNumericCondition = /price\s*[><=]+\s*[\d.]+/.test(condition);
      
      if (!isRecognized && !hasNumericCondition) {
        warnings.push({
          ruleIndex: i,
          condition: rule.condition,
          action: rule.action,
          warning: `Unrecognized condition: "${rule.condition}". The bot may not be able to evaluate this rule.`,
          isUnrecognized: true,
        });
      }
      
      // Check for missing action
      if (!rule.action || !["buy", "sell", "close", "hold"].includes(rule.action.toLowerCase())) {
        warnings.push({
          ruleIndex: i,
          condition: rule.condition,
          action: rule.action,
          warning: `Invalid action "${rule.action}". Expected: buy, sell, close, or hold.`,
          isUnrecognized: false,
        });
      }
    }
    
    return warnings;
  }

  async start(config: TradingBotConfig): Promise<void> {
    if (this.state.isRunning) {
      throw new Error("Trading bot is already running");
    }

    this.config = config;
    this.reportedWarnings = new Set(); // Reset warnings on new start
    this.state = {
      isRunning: true,
      isPaused: false,
      lastCheck: Date.now(),
      decisions: [],
      executionMode: config.executionMode,
      totalTrades: 0,
      successfulTrades: 0,
      // Reset frequency control tracking
      lastTradeTime: 0,
      tradesThisHour: [],
      positionOpenTimes: new Map(),
    };

    // Validate algorithm rules before starting
    const ruleWarnings = this.validateRules(config.algorithm.rules);
    if (ruleWarnings.length > 0) {
      console.warn(`[TradingBot] Algorithm has ${ruleWarnings.length} rule warning(s):`);
      for (const warning of ruleWarnings) {
        console.warn(`  - Rule ${warning.ruleIndex + 1}: ${warning.warning}`);
        
        // Log to trade log and send notification
        await storage.addTradeLog({
          type: "warning",
          message: `Rule Warning: ${warning.warning}`,
          data: { 
            ruleIndex: warning.ruleIndex,
            condition: warning.condition,
            action: warning.action,
            algorithmId: config.algorithm.id,
          },
        });
        
        // Send notification for unrecognized rules
        if (warning.isUnrecognized) {
          await notificationService.notifyError(
            `Unrecognized rule in algorithm "${config.algorithm.name}": "${warning.condition}"`,
            { algorithmId: config.algorithm.id, ruleIndex: warning.ruleIndex }
          );
        }
      }
    }

    // Get exchange-specific configuration
    const exchangeInfo = exchangeService.getExchangeInfo(config.exchange);
    const modeLabel = config.executionMode === "paper" ? "PAPER TRADING" : "REAL TRADING";

    await storage.addTradeLog({
      type: "algorithm",
      message: `[${modeLabel}] Trading bot started on ${exchangeInfo.name} with algorithm: ${config.algorithm.name}`,
      data: { 
        algorithmId: config.algorithm.id, 
        symbol: config.symbol,
        exchange: config.exchange,
        executionMode: config.executionMode,
        maxLeverage: exchangeInfo.maxLeverage,
        makerFee: exchangeInfo.makerFee,
        takerFee: exchangeInfo.takerFee,
      },
    });

    // Start the trading loop with exchange-specific interval
    // BYDFI has faster API response times
    const defaultInterval = config.exchange === "bydfi" ? 3000 : 5000;
    const scalpingInterval = config.exchange === "bydfi" ? 1500 : 2000;
    const interval = config.checkIntervalMs || 
      (config.algorithm.mode === "ai-scalping" ? scalpingInterval : defaultInterval);

    this.checkInterval = setInterval(
      () => this.executeTradeCheck(),
      interval
    );

    // Start strategy optimizer for all AI trading modes
    // The optimizer monitors performance and generates suggestions regardless of optimization mode
    // In "manual" optimization mode: suggestions require user approval before applying
    // In "semi-auto" mode: parameter adjustments are auto-applied
    // In "full-auto" mode: full strategy rewrites are auto-applied
    if (config.algorithm.mode !== "manual") {
      await strategyOptimizer.start({
        exchange: config.exchange,
        symbol: config.symbol,
        algorithm: config.algorithm,
        optimizationMode: config.optimizationMode,
        timeframe: config.timeframe,
        onSuggestion: config.onOptimizationSuggestion || (() => {}),
        onMetricsUpdate: config.onMetricsUpdate || (() => {}),
        onAlgorithmUpdate: (algo) => {
          this.updateAlgorithm(algo);
          if (config.onAlgorithmUpdate) {
            config.onAlgorithmUpdate(algo);
          }
        },
      });
    }
  }

  // Update the running algorithm (for optimization)
  updateAlgorithm(algorithm: TradingAlgorithm): void {
    if (this.config) {
      this.config.algorithm = algorithm;
      const modeLabel = this.state.executionMode === "paper" ? "PAPER" : "REAL";
      storage.addTradeLog({
        type: "algorithm",
        message: `[${modeLabel}] Algorithm updated: ${algorithm.name} v${algorithm.version}`,
        data: { algorithmId: algorithm.id, version: algorithm.version },
      });
    }
  }

  async pause(): Promise<void> {
    if (!this.state.isRunning) {
      throw new Error("Trading bot is not running");
    }

    this.state.isPaused = true;
    const modeLabel = this.state.executionMode === "paper" ? "PAPER" : "REAL";
    
    await storage.addTradeLog({
      type: "algorithm",
      message: `[${modeLabel}] Trading bot paused`,
    });
  }

  async resume(): Promise<void> {
    if (!this.state.isRunning) {
      throw new Error("Trading bot is not running");
    }

    this.state.isPaused = false;
    const modeLabel = this.state.executionMode === "paper" ? "PAPER" : "REAL";
    
    await storage.addTradeLog({
      type: "algorithm",
      message: `[${modeLabel}] Trading bot resumed`,
    });
  }

  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Stop strategy optimizer
    if (strategyOptimizer.isActive()) {
      await strategyOptimizer.stop();
    }

    const modeLabel = this.state.executionMode === "paper" ? "PAPER" : "REAL";
    const stats = `Total trades: ${this.state.totalTrades}, Successful: ${this.state.successfulTrades}`;
    
    await storage.addTradeLog({
      type: "algorithm",
      message: `[${modeLabel}] Trading bot stopped. ${stats}`,
      data: {
        totalTrades: this.state.totalTrades,
        successfulTrades: this.state.successfulTrades,
      },
    });

    this.state.isRunning = false;
    this.state.isPaused = false;
  }

  async closeAllPositions(): Promise<void> {
    if (!this.config) return;

    const credentials = await storage.getCredentials(this.config.exchange);
    if (!credentials) {
      throw new Error("No credentials available");
    }

    const modeLabel = this.state.executionMode === "paper" ? "PAPER" : "REAL";
    const exchange = this.config.exchange;
    
    // Get current positions before closing
    const positions = await storage.getPositions(exchange);

    // Update trade records for each position using its most recent markPrice
    for (const position of positions) {
      // Try to get current price for this specific symbol
      let exitPrice = position.markPrice;
      try {
        const tickerResult = await exchangeService.getTicker(exchange, position.symbol);
        exitPrice = tickerResult.ticker.lastPrice || position.markPrice;
      } catch {
        // Use position's markPrice as fallback
      }
      
      await this.updateTradeOnClose(position, exitPrice, "manual");
      this.state.successfulTrades++;
    }
    
    if (this.state.executionMode === "paper") {
      // Paper trading - simulate closing positions
      await exchangeService.closeAllPositions(exchange, credentials);
      await storage.setPositions(exchange, []);
      
      await storage.addTradeLog({
        type: "position",
        message: `[${modeLabel}] All ${positions.length} positions closed (simulated)`,
        data: { positionsClosed: positions.length },
      });
    } else {
      // Real trading - would execute real close orders
      // For now, still uses simulation until real API is connected
      await exchangeService.closeAllPositions(exchange, credentials);
      await storage.setPositions(exchange, []);
      
      await storage.addTradeLog({
        type: "position",
        message: `[${modeLabel}] All ${positions.length} positions closed`,
        data: { positionsClosed: positions.length },
      });
    }

    await this.stop();
  }

  // Check if frequency controls allow a new trade
  private checkFrequencyControls(riskManagement: RiskManagement, positions: Position[], action: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    
    // 1. Trade Cooldown check (for new entries only)
    if ((action === "buy" || action === "sell") && riskManagement.tradeCooldownSeconds) {
      const cooldownMs = riskManagement.tradeCooldownSeconds * 1000;
      const timeSinceLastTrade = now - this.state.lastTradeTime;
      if (this.state.lastTradeTime > 0 && timeSinceLastTrade < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastTrade) / 1000);
        return { allowed: false, reason: `Trade cooldown: ${remainingSeconds}s remaining` };
      }
    }
    
    // 2. Max Trades Per Hour check
    if (riskManagement.maxTradesPerHour) {
      // Clean up old trades (older than 1 hour)
      const oneHourAgo = now - 60 * 60 * 1000;
      this.state.tradesThisHour = this.state.tradesThisHour.filter(t => t > oneHourAgo);
      
      if (this.state.tradesThisHour.length >= riskManagement.maxTradesPerHour) {
        return { allowed: false, reason: `Max trades/hour reached: ${this.state.tradesThisHour.length}/${riskManagement.maxTradesPerHour}` };
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
        const openTime = this.state.positionOpenTimes.get(pos.id);
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
  private recordTradeExecution(positionId?: string): void {
    const now = Date.now();
    this.state.lastTradeTime = now;
    this.state.tradesThisHour.push(now);
    
    // Track position open time if this is a new position
    if (positionId) {
      this.state.positionOpenTimes.set(positionId, now);
    }
  }

  // Remove position from tracking when closed
  private recordPositionClose(positionId: string): void {
    this.state.positionOpenTimes.delete(positionId);
  }

  private async executeTradeCheck(): Promise<void> {
    if (!this.config || this.state.isPaused) return;

    try {
      const { exchange, symbol, algorithm, executionMode, timeframe } = this.config;
      
      // Get exchange-specific configuration
      const exchangeInfo = exchangeService.getExchangeInfo(exchange);
      
      // Get current market data - getTicker/getKlines now return result types
      const tickerResult = await exchangeService.getTicker(exchange, symbol);
      const klinesResult = await exchangeService.getKlines(exchange, symbol, timeframe, 50);
      const ticker = tickerResult.ticker;
      const klines = klinesResult.klines;
      
      // Get current positions
      const credentials = await storage.getCredentials(exchange);
      if (!credentials) return;

      const positions = await storage.getPositions(exchange);
      
      // Update ticker in storage
      await storage.setTicker(exchange, symbol, ticker);

      // Check and execute stop orders (SL/TP/Trailing)
      await this.checkStopOrders(exchange, ticker, positions);

      // Evaluate trading rules with exchange-specific parameters
      const decision = await this.evaluateRules(
        algorithm.rules, 
        ticker, 
        klines, 
        positions,
        exchangeInfo
      );

      if (decision.action !== "hold") {
        // Check frequency controls before executing
        const frequencyCheck = this.checkFrequencyControls(algorithm.riskManagement, positions, decision.action);
        if (!frequencyCheck.allowed) {
          // Log but don't execute
          console.log(`[FrequencyControl] Blocked: ${frequencyCheck.reason}`);
          return;
        }
        
        await this.executeDecision(decision, ticker, exchangeInfo);
      }

      this.state.lastCheck = Date.now();
    } catch (error) {
      console.error("Trade check error:", error);
      await storage.addTradeLog({
        type: "error",
        message: `Trade check failed: ${(error as Error).message}`,
      });
    }
  }

  private async checkStopOrders(
    exchange: Exchange,
    ticker: Ticker,
    positions: Position[]
  ): Promise<void> {
    const stopOrders = await storage.getStopOrders(exchange);
    const activeStopOrders = stopOrders.filter(so => so.status === "active");
    const modeLabel = this.state.executionMode === "paper" ? "PAPER" : "REAL";

    for (const stopOrder of activeStopOrders) {
      const position = positions.find(p => p.id === stopOrder.positionId);
      if (!position) {
        // Position closed, cancel stop order
        await storage.deleteStopOrder(exchange, stopOrder.id);
        continue;
      }

      const currentPrice = ticker.lastPrice;
      let shouldTrigger = false;

      if (stopOrder.type === "stop_loss") {
        // Stop loss triggers when price moves against position
        if (position.side === "long" && currentPrice <= stopOrder.triggerPrice) {
          shouldTrigger = true;
        } else if (position.side === "short" && currentPrice >= stopOrder.triggerPrice) {
          shouldTrigger = true;
        }
      } else if (stopOrder.type === "take_profit") {
        // Take profit triggers when price moves in favor
        if (position.side === "long" && currentPrice >= stopOrder.triggerPrice) {
          shouldTrigger = true;
        } else if (position.side === "short" && currentPrice <= stopOrder.triggerPrice) {
          shouldTrigger = true;
        }
      } else if (stopOrder.type === "trailing_stop" && stopOrder.trailingDistance) {
        // Trailing stop - update highest/lowest price and check trigger
        const updatedStopOrder = { ...stopOrder };
        
        if (position.side === "long") {
          // Track highest price for long position
          const highestPrice = Math.max(stopOrder.highestPrice || position.entryPrice, currentPrice);
          updatedStopOrder.highestPrice = highestPrice;
          
          // Calculate trailing stop trigger price
          const trailTrigger = highestPrice * (1 - stopOrder.trailingDistance / 100);
          updatedStopOrder.triggerPrice = trailTrigger;
          
          if (currentPrice <= trailTrigger) {
            shouldTrigger = true;
          }
        } else {
          // Track lowest price for short position
          const lowestPrice = Math.min(stopOrder.lowestPrice || position.entryPrice, currentPrice);
          updatedStopOrder.lowestPrice = lowestPrice;
          
          // Calculate trailing stop trigger price
          const trailTrigger = lowestPrice * (1 + stopOrder.trailingDistance / 100);
          updatedStopOrder.triggerPrice = trailTrigger;
          
          if (currentPrice >= trailTrigger) {
            shouldTrigger = true;
          }
        }

        // Update trailing stop order with new tracking prices
        if (!shouldTrigger) {
          await storage.updateStopOrder(exchange, updatedStopOrder);
        }
      }

      if (shouldTrigger) {
        // Execute stop order - close position
        const credentials = await storage.getCredentials(exchange);
        if (credentials) {
          await exchangeService.closePosition(exchange, credentials, position.id);
          await storage.deletePosition(exchange, position.id);
          await storage.deleteStopOrdersByPosition(exchange, position.id);

          const orderType = stopOrder.type === "stop_loss" ? "STOP LOSS" : 
                           stopOrder.type === "take_profit" ? "TAKE PROFIT" : "TRAILING STOP";
          const pnlSign = position.unrealizedPnl >= 0 ? "+" : "";

          await storage.addTradeLog({
            type: "position",
            message: `[${modeLabel}] ${orderType} triggered: Closed ${position.side} ${position.quantity.toFixed(6)} ${position.symbol} @ ${currentPrice.toFixed(2)} (PnL: ${pnlSign}$${position.unrealizedPnl.toFixed(2)})`,
            data: {
              positionId: position.id,
              stopOrderId: stopOrder.id,
              orderType: stopOrder.type,
              triggerPrice: stopOrder.triggerPrice,
              pnl: position.unrealizedPnl,
              exchange,
            },
          });

          // Update trade record in database
          await this.updateTradeOnClose(position, currentPrice, stopOrder.type);

          // Send notification for stop order trigger
          if (stopOrder.type === "stop_loss") {
            await notificationService.notifyStopLoss(
              exchange,
              position.symbol,
              position.side,
              position.unrealizedPnl,
              this.state.executionMode
            );
          } else if (stopOrder.type === "take_profit") {
            await notificationService.notifyTakeProfit(
              exchange,
              position.symbol,
              position.side,
              position.unrealizedPnl,
              this.state.executionMode
            );
          } else if (stopOrder.type === "trailing_stop") {
            await notificationService.notifyTrailingStop(
              exchange,
              position.symbol,
              position.side,
              position.unrealizedPnl,
              this.state.executionMode
            );
          }

          this.state.successfulTrades++;
        }
      }
    }
  }

  private async createStopOrders(
    exchange: Exchange,
    position: Position,
    riskManagement: RiskManagement
  ): Promise<void> {
    const modeLabel = this.state.executionMode === "paper" ? "PAPER" : "REAL";

    // Create stop-loss order if enabled
    if (riskManagement.autoStopLoss || riskManagement.stopLossPercent > 0) {
      const slPrice = position.side === "long"
        ? position.entryPrice * (1 - riskManagement.stopLossPercent / 100)
        : position.entryPrice * (1 + riskManagement.stopLossPercent / 100);

      const stopLossOrder: StopOrder = {
        id: randomUUID(),
        positionId: position.id,
        type: "stop_loss",
        triggerPrice: slPrice,
        quantity: position.quantity,
        status: "active",
        createdAt: Date.now(),
      };

      await storage.addStopOrder(exchange, stopLossOrder);

      // Update position with stop loss reference
      position.stopLossPrice = slPrice;
      position.stopOrderId = stopLossOrder.id;
      await storage.updatePosition(exchange, position);

      await storage.addTradeLog({
        type: "order",
        message: `[${modeLabel}] Stop-loss set: ${position.symbol} @ ${slPrice.toFixed(2)} (${riskManagement.stopLossPercent}%)`,
        data: { stopOrderId: stopLossOrder.id, triggerPrice: slPrice },
      });
    }

    // Create take-profit order if enabled
    if (riskManagement.autoTakeProfit || riskManagement.takeProfitPercent > 0) {
      const tpPrice = position.side === "long"
        ? position.entryPrice * (1 + riskManagement.takeProfitPercent / 100)
        : position.entryPrice * (1 - riskManagement.takeProfitPercent / 100);

      const takeProfitOrder: StopOrder = {
        id: randomUUID(),
        positionId: position.id,
        type: "take_profit",
        triggerPrice: tpPrice,
        quantity: position.quantity,
        status: "active",
        createdAt: Date.now(),
      };

      await storage.addStopOrder(exchange, takeProfitOrder);

      // Update position with take profit reference
      position.takeProfitPrice = tpPrice;
      position.takeProfitOrderId = takeProfitOrder.id;
      await storage.updatePosition(exchange, position);

      await storage.addTradeLog({
        type: "order",
        message: `[${modeLabel}] Take-profit set: ${position.symbol} @ ${tpPrice.toFixed(2)} (${riskManagement.takeProfitPercent}%)`,
        data: { stopOrderId: takeProfitOrder.id, triggerPrice: tpPrice },
      });
    }

    // Create trailing stop if enabled
    if (riskManagement.trailingStop && riskManagement.trailingStopPercent) {
      const trailingOrder: StopOrder = {
        id: randomUUID(),
        positionId: position.id,
        type: "trailing_stop",
        triggerPrice: position.entryPrice, // Will be updated dynamically
        quantity: position.quantity,
        status: "active",
        trailingDistance: riskManagement.trailingStopPercent,
        highestPrice: position.side === "long" ? position.entryPrice : undefined,
        lowestPrice: position.side === "short" ? position.entryPrice : undefined,
        createdAt: Date.now(),
      };

      await storage.addStopOrder(exchange, trailingOrder);

      // Update position with trailing stop reference
      position.trailingStopDistance = riskManagement.trailingStopPercent;
      position.trailingStopOrderId = trailingOrder.id;
      await storage.updatePosition(exchange, position);

      await storage.addTradeLog({
        type: "order",
        message: `[${modeLabel}] Trailing stop set: ${position.symbol} with ${riskManagement.trailingStopPercent}% distance`,
        data: { stopOrderId: trailingOrder.id, trailingDistance: riskManagement.trailingStopPercent },
      });
    }
  }

  // ============================================================
  // COMPOUND CONDITION PARSER
  // Supports: AND, OR, NOT, XOR, IF-THEN, and parentheses for nesting
  // ============================================================

  // Token types for parsing
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

  // Check if a condition is compound (has operators)
  private isCompoundCondition(condition: string): boolean {
    const upper = condition.toUpperCase();
    return upper.includes(' AND ') || upper.includes(' OR ') || 
           upper.includes(' NOT ') || upper.includes(' XOR ') ||
           upper.includes('(') || (upper.includes(' IF ') && upper.includes(' THEN '));
  }

  // Parse a compound condition into an AST
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

  // Context object passed to primitive evaluator to avoid repeated calculations
  private evaluationContext: {
    currentPrice: number;
    priceChange: number;
    hasPosition: boolean;
    sma20: number;
    sma50: number;
    macd: ReturnType<TradingBot["calculateMACD"]>;
    volume: ReturnType<TradingBot["calculateVolumeAnalysis"]>;
    klines: Kline[];
    positions: Position[];
  } | null = null;

  // Evaluate a single primitive condition (non-compound)
  // Returns true if the condition is met
  private evaluatePrimitiveCondition(conditionText: string): boolean {
    if (!this.evaluationContext) return false;
    
    const { currentPrice, priceChange, hasPosition, sma20, sma50, macd, volume, klines, positions } = this.evaluationContext;
    const condition = conditionText.toLowerCase().trim();
    
    // Empty condition
    if (!condition) return false;

    // --- NUMERIC PRICE CONDITIONS (highest priority) ---
    const numericResult = this.evaluateNumericCondition(conditionText, currentPrice);
    if (numericResult.matched) {
      return numericResult.triggered;
    }

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
    if (condition.includes("macd above signal") && macd.macdLine > macd.signalLine) return true;
    if (condition.includes("macd below signal") && macd.macdLine < macd.signalLine) return true;

    // --- Volume Conditions ---
    if ((condition.includes("volume spike") || condition.includes("high volume spike")) && volume.isVolumeSpike) return true;
    if ((condition.includes("high volume") || condition.includes("above average volume")) && volume.isHighVolume) return true;
    if ((condition.includes("low volume") || condition.includes("below average volume")) && volume.isLowVolume) return true;
    if ((condition.includes("volume increasing") || condition.includes("rising volume")) && volume.volumeTrend === "increasing") return true;
    if ((condition.includes("volume decreasing") || condition.includes("falling volume")) && volume.volumeTrend === "decreasing") return true;

    // --- Combined Conditions (MACD + Volume confirmation) ---
    if ((condition.includes("macd bullish with volume") || condition.includes("bullish with volume confirmation")) && macd.trend === "bullish" && volume.isHighVolume) return true;
    if ((condition.includes("macd bearish with volume") || condition.includes("bearish with volume confirmation")) && macd.trend === "bearish" && volume.isHighVolume) return true;
    if (condition.includes("macd crossover with volume") && macd.crossover !== "none" && volume.isHighVolume) return true;
    if ((condition.includes("bullish breakout") || condition.includes("breakout with volume")) && macd.trend === "bullish" && volume.isVolumeSpike && currentPrice > sma20) return true;
    if (condition.includes("bearish breakdown") && macd.trend === "bearish" && volume.isVolumeSpike && currentPrice < sma20) return true;

    // --- Simple Trend Conditions ---
    if (condition.includes("uptrend") || condition.includes("upward trend") || 
        condition.includes("trending up") || condition.includes("bullish trend") ||
        condition.includes("price rising") || condition.includes("price going up")) {
      if (klines.length >= 2) {
        const lastCandle = klines[klines.length - 1];
        const prevCandle = klines[klines.length - 2];
        if (lastCandle.close > lastCandle.open && currentPrice > prevCandle.close) return true;
      }
    }
    if (condition.includes("downtrend") || condition.includes("downward trend") || 
        condition.includes("trending down") || condition.includes("bearish trend") ||
        condition.includes("price falling") || condition.includes("price going down")) {
      if (klines.length >= 2) {
        const lastCandle = klines[klines.length - 1];
        const prevCandle = klines[klines.length - 2];
        if (lastCandle.close < lastCandle.open && currentPrice < prevCandle.close) return true;
      }
    }

    // --- Green/Red Candle Conditions ---
    if (condition.includes("green candle") || condition.includes("bullish candle") || 
        condition.includes("candle closes above") || condition.includes("close above open") ||
        condition.includes("closes above its open")) {
      if (klines.length >= 1) {
        const lastCandle = klines[klines.length - 1];
        if (lastCandle.close > lastCandle.open) return true;
      }
    }
    if (condition.includes("red candle") || condition.includes("bearish candle") || 
        condition.includes("candle closes below") || condition.includes("close below open") ||
        condition.includes("closes below its open")) {
      if (klines.length >= 1) {
        const lastCandle = klines[klines.length - 1];
        if (lastCandle.close < lastCandle.open) return true;
      }
    }

    // --- Price vs Previous Close Conditions ---
    if (condition.includes("above previous close") || condition.includes("price above prev") ||
        condition.includes("ticker above previous") || condition.includes("above the previous close")) {
      if (klines.length >= 2 && currentPrice > klines[klines.length - 2].close) return true;
    }
    if (condition.includes("below previous close") || condition.includes("price below prev") ||
        condition.includes("ticker below previous") || condition.includes("below the previous close")) {
      if (klines.length >= 2 && currentPrice < klines[klines.length - 2].close) return true;
    }

    // --- Positive/Negative Price Change Conditions ---
    if ((condition.includes("positive change") || condition.includes("price change positive") ||
         condition.includes("price is up") || condition.includes("gaining")) && priceChange > 0) return true;
    if ((condition.includes("negative change") || condition.includes("price change negative") ||
         condition.includes("price is down") || condition.includes("losing")) && priceChange < 0) return true;

    // --- Price/Market Conditions ---
    if (condition.includes("oversold") && priceChange < -2) return true;
    if (condition.includes("overbought") && priceChange > 2) return true;
    if (condition.includes("no position") && !hasPosition) return true;
    if (condition.includes("has position") && hasPosition) return true;

    // --- Immediate Entry Conditions (always trigger if no position) ---
    if ((condition.includes("immediate") || 
         condition.includes("enter now") || 
         condition.includes("market entry") ||
         condition.includes("on start") ||
         condition.includes("always enter") ||
         condition.includes("entry signal")) && !hasPosition) {
      return true;
    }

    // --- Take Profit / Stop Loss based on percentage from entry ---
    if (hasPosition && (condition.includes("take profit") || condition.includes("take-profit") || 
         condition.includes("stop loss") || condition.includes("stop-loss") ||
         condition.includes("price decreases") || condition.includes("price increases"))) {
      const percentMatch = condition.match(/(\d+\.?\d*)\s*%/);
      if (percentMatch) {
        const targetPercent = parseFloat(percentMatch[1]);
        const position = positions[0];
        if (position && position.entryPrice) {
          const entryPrice = position.entryPrice;
          const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
          const isLong = position.side === "long";
          const effectivePnl = isLong ? pnlPercent : -pnlPercent;
          
          if (condition.includes("take profit") || condition.includes("take-profit") || 
              (condition.includes("decreases") && !isLong) || (condition.includes("increases") && isLong)) {
            if (effectivePnl >= targetPercent) return true;
          } else if (condition.includes("stop loss") || condition.includes("stop-loss") ||
                     (condition.includes("increases") && !isLong) || (condition.includes("decreases") && isLong)) {
            if (effectivePnl <= -targetPercent) return true;
          }
        }
      }
    }

    // --- Price level breakout/breakdown conditions ---
    if (condition.includes("price breaks") || condition.includes("breaks below") || condition.includes("breaks above")) {
      const priceMatch = condition.match(/(\d+\.?\d*)/);
      if (priceMatch) {
        const targetPrice = parseFloat(priceMatch[1]);
        if (condition.includes("below") && currentPrice < targetPrice) return true;
        if (condition.includes("above") && currentPrice > targetPrice) return true;
      }
    }

    return false;
  }

  private async evaluateRules(
    rules: TradingRule[],
    ticker: Ticker,
    klines: Kline[],
    positions: Position[],
    exchangeInfo: ReturnType<typeof exchangeService.getExchangeInfo>
  ): Promise<{ action: string; rule?: TradingRule; reason: string }> {
    // Sort rules by priority
    const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

    // Calculate basic indicators
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

    // Log current indicator values for debugging
    console.log(`[TradingBot] === Trade Check ===`);
    console.log(`[TradingBot] Price: $${currentPrice.toFixed(4)} | Change: ${priceChange.toFixed(2)}%`);
    console.log(`[TradingBot] MACD: ${macd.macdLine.toFixed(4)} | Signal: ${macd.signalLine.toFixed(4)} | Histogram: ${macd.histogram.toFixed(4)} | Trend: ${macd.trend} | Crossover: ${macd.crossover}`);
    console.log(`[TradingBot] Volume: ${volume.volumeRatio.toFixed(2)}x avg | Spike: ${volume.isVolumeSpike} | High: ${volume.isHighVolume} | Trend: ${volume.volumeTrend}`);
    console.log(`[TradingBot] SMA20: ${sma20.toFixed(4)} | SMA50: ${sma50.toFixed(4)} | Has Position: ${hasPosition}`);
    console.log(`[TradingBot] Evaluating ${sortedRules.length} rules...`);

    // Rule evaluation with support for compound conditions (AND, OR, NOT, XOR, IF-THEN)
    for (const rule of sortedRules) {
      let shouldTrigger = false;
      let triggerDebugInfo = "";

      // Check if this is a compound condition (has AND, OR, NOT, XOR, IF-THEN, or parentheses)
      if (this.isCompoundCondition(rule.condition)) {
        // Parse compound condition into AST and evaluate
        const ast = this.parseCompoundCondition(rule.condition);
        shouldTrigger = this.evaluateConditionNode(ast, (primitive) => this.evaluatePrimitiveCondition(primitive));
        triggerDebugInfo = `Compound condition evaluated: ${shouldTrigger ? "TRUE" : "FALSE"}`;
        console.log(`[TradingBot] Compound rule "${rule.condition}": ${triggerDebugInfo}`);
      } else {
        // Simple primitive condition - evaluate directly
        shouldTrigger = this.evaluatePrimitiveCondition(rule.condition);
      }

      // Debug: Log unmatched conditions
      if (!shouldTrigger) {
        console.log(`[TradingBot] Rule not matched: "${rule.condition}" (action: ${rule.action})`);
      }

      if (shouldTrigger) {
        const condition = rule.condition.toLowerCase();
        // Build detailed reason with indicator values
        let reason = `Rule triggered: ${rule.condition}`;
        
        // Add debug info if applicable
        if (triggerDebugInfo) {
          reason += ` | ${triggerDebugInfo}`;
        }
        if (condition.includes("macd")) {
          reason += ` | MACD: ${macd.macdLine.toFixed(2)}, Signal: ${macd.signalLine.toFixed(2)}, Trend: ${macd.trend}`;
        }
        if (condition.includes("volume")) {
          reason += ` | Volume: ${volume.volumeRatio.toFixed(2)}x avg, Trend: ${volume.volumeTrend}`;
        }
        
        // Log the trigger for debugging
        console.log(`[TradingBot] TRIGGER FIRED: action=${rule.action}, reason=${reason}`);
        
        // Clear evaluation context
        this.evaluationContext = null;
        
        return {
          action: rule.action,
          rule,
          reason,
        };
      }
    }

    // Clear evaluation context
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
  // Returns: { macdLine, signalLine, histogram, trend }
  private calculateMACD(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): {
    macdLine: number;
    signalLine: number;
    histogram: number;
    trend: "bullish" | "bearish" | "neutral";
    crossover: "bullish_crossover" | "bearish_crossover" | "none";
  } {
    if (closes.length < slowPeriod + signalPeriod) {
      return { macdLine: 0, signalLine: 0, histogram: 0, trend: "neutral", crossover: "none" };
    }

    // Calculate EMAs
    const ema12 = this.calculateEMA(closes, fastPeriod);
    const ema26 = this.calculateEMA(closes, slowPeriod);
    
    if (ema12.length === 0 || ema26.length === 0) {
      return { macdLine: 0, signalLine: 0, histogram: 0, trend: "neutral", crossover: "none" };
    }

    // Calculate MACD line (difference between fast and slow EMA)
    // Align the arrays - ema26 starts later than ema12
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
      return { macdLine: 0, signalLine: 0, histogram: 0, trend: "neutral", crossover: "none" };
    }

    // Calculate signal line (EMA of MACD line)
    const signalLineArray = this.calculateEMA(macdLineArray, signalPeriod);
    
    if (signalLineArray.length < 2) {
      return { macdLine: 0, signalLine: 0, histogram: 0, trend: "neutral", crossover: "none" };
    }

    // Get current and previous values
    const currentMacd = macdLineArray[macdLineArray.length - 1];
    const previousMacd = macdLineArray[macdLineArray.length - 2];
    const currentSignal = signalLineArray[signalLineArray.length - 1];
    const previousSignal = signalLineArray[signalLineArray.length - 2];
    const histogram = currentMacd - currentSignal;

    // Determine trend
    let trend: "bullish" | "bearish" | "neutral" = "neutral";
    if (currentMacd > currentSignal && histogram > 0) {
      trend = "bullish";
    } else if (currentMacd < currentSignal && histogram < 0) {
      trend = "bearish";
    }

    // Detect crossovers
    let crossover: "bullish_crossover" | "bearish_crossover" | "none" = "none";
    if (previousMacd <= previousSignal && currentMacd > currentSignal) {
      crossover = "bullish_crossover"; // MACD crossed above signal
    } else if (previousMacd >= previousSignal && currentMacd < currentSignal) {
      crossover = "bearish_crossover"; // MACD crossed below signal
    }

    return {
      macdLine: currentMacd,
      signalLine: currentSignal,
      histogram,
      trend,
      crossover,
    };
  }

  // Calculate volume analysis
  private calculateVolumeAnalysis(klines: Kline[]): {
    currentVolume: number;
    averageVolume: number;
    volumeRatio: number;
    isVolumeSpike: boolean;
    isHighVolume: boolean;
    isLowVolume: boolean;
    volumeTrend: "increasing" | "decreasing" | "stable";
  } {
    if (klines.length < 20) {
      const vol = klines.length > 0 ? klines[klines.length - 1].volume : 0;
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

    const volumes = klines.map(k => k.volume);
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
    decision: { action: string; rule?: TradingRule; reason: string },
    ticker: Ticker,
    exchangeInfo: ReturnType<typeof exchangeService.getExchangeInfo>
  ): Promise<void> {
    if (!this.config) return;

    const { exchange, symbol, algorithm, executionMode } = this.config;
    const credentials = await storage.getCredentials(exchange);
    if (!credentials) return;

    const { riskManagement } = algorithm;
    const modeLabel = executionMode === "paper" ? "PAPER" : "REAL";

    await storage.addTradeLog({
      type: "signal",
      message: `[${modeLabel}] ${decision.reason}`,
      data: { action: decision.action, exchange },
    });

    try {
      this.state.totalTrades++;

      if (decision.action === "buy" || decision.action === "sell") {
        // Calculate position size based on risk management
        // Get market-specific max leverage - getMarkets now returns MarketsResult
        const marketsResult = await exchangeService.getMarkets(exchange);
        const market = marketsResult.markets.find(m => m.symbol === symbol);
        const marketMaxLeverage = market?.maxLeverage || exchangeInfo.maxLeverage;
        
        // Use the minimum of algorithm, exchange-wide, and market-specific leverage limits
        const effectiveLeverage = Math.min(
          riskManagement.maxLeverage,
          exchangeInfo.maxLeverage,
          marketMaxLeverage
        );
        
        const positionSize = Math.min(
          riskManagement.maxPositionSize,
          1000 // Default max
        );
        const quantity = positionSize / ticker.lastPrice;

        let order: Order;
        let realOrderId: string | undefined;

        if (executionMode === "real") {
          // REAL TRADING: Place order on exchange
          console.log(`[REAL TRADING] Executing ${decision.action} order on ${exchange}`);
          const realResult = await exchangeService.placeRealOrder(exchange, credentials, {
            symbol,
            side: decision.action as "buy" | "sell",
            type: (decision.rule?.priceType || "market") as "market" | "limit",
            quantity,
            price: ticker.lastPrice,
            leverage: effectiveLeverage,
          });

          if (!realResult.success) {
            await storage.addTradeLog({
              type: "error",
              message: `[REAL] Order failed: ${realResult.error}`,
              data: { exchange, symbol, side: decision.action },
            });
            return;
          }

          order = realResult.order!;
          realOrderId = realResult.exchangeOrderId;
          console.log(`[REAL TRADING] Order executed: ${realOrderId}`);
        } else {
          // PAPER TRADING: Simulated order
          order = await exchangeService.placeOrder(exchange, credentials, {
            symbol,
            type: decision.rule?.priceType || "market",
            side: decision.action as "buy" | "sell",
            quantity,
            price: ticker.lastPrice,
          });
        }

        await storage.addOrder(exchange, order);

        // If order filled, create position
        if (order.status === "filled" || executionMode === "real") {
          this.state.successfulTrades++;
          
          const positionId = randomUUID();
          
          // Record trade execution for frequency control
          this.recordTradeExecution(positionId);
          
          const position: Position = {
            id: positionId,
            symbol,
            side: decision.action === "buy" ? "long" : "short",
            entryPrice: order.price,
            markPrice: ticker.lastPrice,
            quantity: order.filledQuantity,
            leverage: effectiveLeverage,
            marginType: "isolated",
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
            liquidationPrice: this.calculateLiquidationPrice(
              order.price,
              decision.action === "buy" ? "long" : "short",
              effectiveLeverage
            ),
            timestamp: Date.now(),
          };

          await storage.updatePosition(exchange, position);

          // Calculate estimated fee
          const fee = order.price * order.filledQuantity * exchangeInfo.takerFee;

          await storage.addTradeLog({
            type: "position",
            message: `[${modeLabel}] Opened ${position.side} position: ${position.quantity.toFixed(6)} ${symbol} @ ${position.entryPrice.toFixed(2)} (fee: ~$${fee.toFixed(4)})`,
            data: { 
              positionId: position.id,
              exchange,
              leverage: effectiveLeverage,
            },
          });

          // Create stop-loss, take-profit, and trailing stop orders
          await this.createStopOrders(exchange, position, riskManagement);

          // Record trade in database for analytics
          try {
            const tradeData: InsertTrade = {
              exchange,
              symbol,
              side: decision.action,
              positionSide: position.side,
              entryPrice: position.entryPrice,
              quantity: position.quantity,
              leverage: effectiveLeverage,
              fees: fee,
              executionMode,
              algorithmId: algorithm.id,
              algorithmName: algorithm.name,
              status: "open",
              stopLossPrice: position.stopLossPrice || null,
              takeProfitPrice: position.takeProfitPrice || null,
            };

            const savedTrade = await storage.createTrade(tradeData);
            positionToTradeId.set(position.id, savedTrade.id);
          } catch (err) {
            console.error("Failed to save trade to database:", err);
          }

          // Send notification for position open
          await notificationService.notifyTradeOpen(
            exchange,
            symbol,
            position.side,
            position.quantity,
            position.entryPrice,
            executionMode
          );
        }
      } else if (decision.action === "close") {
        const positions = await storage.getPositions(exchange);
        const symbolPositions = positions.filter((p) => p.symbol === symbol);

        for (const position of symbolPositions) {
          if (executionMode === "real") {
            // REAL TRADING: Close position on exchange
            console.log(`[REAL TRADING] Closing position on ${exchange}: ${position.symbol}`);
            const closed = await exchangeService.closeRealPosition(exchange, credentials, position);
            if (!closed) {
              await storage.addTradeLog({
                type: "error",
                message: `[REAL] Failed to close position on exchange: ${position.symbol}`,
                data: { exchange, symbol: position.symbol, positionId: position.id },
              });
            }
          } else {
            await exchangeService.closePosition(exchange, credentials, position.id);
          }
          
          await storage.deletePosition(exchange, position.id);
          // Clean up any associated stop orders
          await storage.deleteStopOrdersByPosition(exchange, position.id);

          // Record position close for frequency control
          this.recordPositionClose(position.id);
          this.recordTradeExecution();
          
          this.state.successfulTrades++;

          await storage.addTradeLog({
            type: "position",
            message: `[${modeLabel}] Closed position: ${position.side} ${position.quantity.toFixed(6)} ${symbol} (PnL: ${position.unrealizedPnl >= 0 ? '+' : ''}$${position.unrealizedPnl.toFixed(2)})`,
            data: { 
              positionId: position.id, 
              pnl: position.unrealizedPnl,
              exchange,
            },
          });

          // Update trade record in database
          await this.updateTradeOnClose(position, ticker.lastPrice, "algorithm");

          // Send notification for position close
          await notificationService.notifyTradeClose(
            exchange,
            symbol,
            position.side,
            position.unrealizedPnl,
            "algorithm",
            executionMode
          );
        }
      }
    } catch (error) {
      await storage.addTradeLog({
        type: "error",
        message: `[${modeLabel}] Failed to execute ${decision.action}: ${(error as Error).message}`,
      });

      // Send error notification
      await notificationService.notifyError(
        `Failed to execute ${decision.action}: ${(error as Error).message}`,
        { exchange, symbol }
      );
    }
  }

  private calculateLiquidationPrice(
    entryPrice: number,
    side: "long" | "short",
    leverage: number
  ): number {
    const marginRatio = 1 / leverage;
    if (side === "long") {
      return entryPrice * (1 - marginRatio + 0.005); // 0.5% maintenance margin
    } else {
      return entryPrice * (1 + marginRatio - 0.005);
    }
  }

  private async updateTradeOnClose(
    position: Position,
    exitPrice: number,
    closeReason: string
  ): Promise<void> {
    try {
      // First try the in-memory map
      let tradeId = positionToTradeId.get(position.id);
      
      // If not in map (e.g., after restart), try to find by position data
      if (!tradeId) {
        // Look up open trades matching this position's entry parameters
        const trades = await storage.getTrades({
          symbol: position.symbol,
          status: "open",
          limit: 10,
        });
        
        // Find a matching trade (same entry price, quantity, side)
        const matchingTrade = trades.find(t => 
          Math.abs(t.entryPrice - position.entryPrice) < 0.01 &&
          Math.abs(t.quantity - position.quantity) < 0.0001 &&
          t.positionSide === position.side
        );
        
        if (matchingTrade) {
          tradeId = matchingTrade.id;
        }
      }

      if (tradeId) {
        // Calculate PnL
        const pnl = position.side === "long"
          ? (exitPrice - position.entryPrice) * position.quantity
          : (position.entryPrice - exitPrice) * position.quantity;
        
        const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100 *
          (position.side === "long" ? 1 : -1);

        await storage.updateTrade(tradeId, {
          exitPrice,
          pnl,
          pnlPercent,
          status: "closed",
          closedAt: new Date(),
          closeReason,
        });

        // Notify strategy optimizer about the trade result
        if (strategyOptimizer.isActive()) {
          strategyOptimizer.recordTrade(pnl, pnl > 0);
        }

        positionToTradeId.delete(position.id);
      }
    } catch (err) {
      console.error("Failed to update trade in database:", err);
    }
  }

  getState(): TradingBotState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.state.isRunning;
  }

  isPaused(): boolean {
    return this.state.isPaused;
  }

  getExecutionMode(): ExecutionMode {
    return this.state.executionMode;
  }
}

// Singleton trading bot instance
export const tradingBot = new TradingBot();
