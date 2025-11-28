import type { TradingAlgorithm, TradingRule, Position, Order, Ticker, Kline, Exchange, ExecutionMode } from "@shared/schema";
import { storage } from "./storage";
import { exchangeService } from "./exchangeService";
import { randomUUID } from "crypto";

interface TradingBotConfig {
  exchange: Exchange;
  symbol: string;
  algorithm: TradingAlgorithm;
  executionMode: ExecutionMode;
  checkIntervalMs?: number;
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
    
    if (this.state.executionMode === "paper") {
      // Paper trading - simulate closing positions
      await exchangeService.closeAllPositions(this.config.exchange, credentials);
      await storage.setPositions(this.config.exchange, []);
      
      await storage.addTradeLog({
        type: "position",
        message: `[${modeLabel}] All positions closed (simulated)`,
      });
    } else {
      // Real trading - would execute real close orders
      // For now, still uses simulation until real API is connected
      await exchangeService.closeAllPositions(this.config.exchange, credentials);
      await storage.setPositions(this.config.exchange, []);
      
      await storage.addTradeLog({
        type: "position",
        message: `[${modeLabel}] All positions closed`,
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
      
      // Get current market data
      const ticker = await exchangeService.getTicker(exchange, symbol);
      const klines = await exchangeService.getKlines(exchange, symbol, "15m", 50);
      
      // Get current positions
      const credentials = await storage.getCredentials(exchange);
      if (!credentials) return;

      const positions = await storage.getPositions(exchange);
      
      // Update ticker in storage
      await storage.setTicker(exchange, symbol, ticker);

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
        // Use exchange-specific max leverage if algorithm allows
        const effectiveLeverage = Math.min(
          riskManagement.maxLeverage,
          exchangeInfo.maxLeverage
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
        }
      } else if (decision.action === "close") {
        const positions = await storage.getPositions(exchange);
        const symbolPositions = positions.filter((p) => p.symbol === symbol);

        for (const position of symbolPositions) {
          await exchangeService.closePosition(exchange, credentials, position.id);
          await storage.deletePosition(exchange, position.id);

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
        }
      }
    } catch (error) {
      await storage.addTradeLog({
        type: "error",
        message: `[${modeLabel}] Failed to execute ${decision.action}: ${(error as Error).message}`,
      });
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
