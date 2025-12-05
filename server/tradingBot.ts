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
}

class TradingBot {
  private config: TradingBotConfig | null = null;
  private state: TradingBotState = {
    isRunning: false,
    isPaused: false,
    lastCheck: 0,
    decisions: [],
    executionMode: "paper",
    totalTrades: 0,
    successfulTrades: 0,
  };
  private checkInterval: NodeJS.Timeout | null = null;

  async start(config: TradingBotConfig): Promise<void> {
    if (this.state.isRunning) {
      throw new Error("Trading bot is already running");
    }

    this.config = config;
    this.state = {
      isRunning: true,
      isPaused: false,
      lastCheck: Date.now(),
      decisions: [],
      executionMode: config.executionMode,
      totalTrades: 0,
      successfulTrades: 0,
    };

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

  private async executeTradeCheck(): Promise<void> {
    if (!this.config || this.state.isPaused) return;

    try {
      const { exchange, symbol, algorithm, executionMode } = this.config;
      
      // Get exchange-specific configuration
      const exchangeInfo = exchangeService.getExchangeInfo(exchange);
      
      // Get current market data - getTicker/getKlines now return result types
      const tickerResult = await exchangeService.getTicker(exchange, symbol);
      const klinesResult = await exchangeService.getKlines(exchange, symbol, "15m", 50);
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

  private async evaluateRules(
    rules: TradingRule[],
    ticker: Ticker,
    klines: Kline[],
    positions: Position[],
    exchangeInfo: ReturnType<typeof exchangeService.getExchangeInfo>
  ): Promise<{ action: string; rule?: TradingRule; reason: string }> {
    // Sort rules by priority
    const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

    // Calculate some basic indicators
    const closes = klines.map((k) => k.close);
    const sma20 = this.calculateSMA(closes, 20);
    const sma50 = this.calculateSMA(closes, 50);
    const currentPrice = ticker.lastPrice;
    const priceChange = ticker.priceChangePercent;
    const hasPosition = positions.length > 0;

    // Simple rule evaluation based on conditions
    for (const rule of sortedRules) {
      const condition = rule.condition.toLowerCase();
      let shouldTrigger = false;

      // Example condition evaluations
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

        // Execute order (simulated in paper mode, would be real in real mode)
        const order = await exchangeService.placeOrder(exchange, credentials, {
          symbol,
          type: decision.rule?.priceType || "market",
          side: decision.action as "buy" | "sell",
          quantity,
          price: ticker.lastPrice,
        });

        await storage.addOrder(exchange, order);

        // If order filled, create position
        if (order.status === "filled") {
          this.state.successfulTrades++;
          
          const position: Position = {
            id: randomUUID(),
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
          await exchangeService.closePosition(exchange, credentials, position.id);
          await storage.deletePosition(exchange, position.id);
          // Clean up any associated stop orders
          await storage.deleteStopOrdersByPosition(exchange, position.id);

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
