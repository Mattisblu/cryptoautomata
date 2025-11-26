import type { TradingAlgorithm, TradingRule, Position, Order, Ticker, Kline, Exchange } from "@shared/schema";
import { storage } from "./storage";
import { exchangeService } from "./exchangeService";
import { randomUUID } from "crypto";

interface TradingBotConfig {
  exchange: Exchange;
  symbol: string;
  algorithm: TradingAlgorithm;
  checkIntervalMs?: number;
}

interface TradingBotState {
  isRunning: boolean;
  isPaused: boolean;
  lastCheck: number;
  decisions: string[];
}

class TradingBot {
  private config: TradingBotConfig | null = null;
  private state: TradingBotState = {
    isRunning: false,
    isPaused: false,
    lastCheck: 0,
    decisions: [],
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
    };

    await storage.addTradeLog({
      type: "algorithm",
      message: `Trading bot started with algorithm: ${config.algorithm.name}`,
      data: { algorithmId: config.algorithm.id, symbol: config.symbol },
    });

    // Start the trading loop
    this.checkInterval = setInterval(
      () => this.executeTradeCheck(),
      config.checkIntervalMs || 5000
    );
  }

  async pause(): Promise<void> {
    if (!this.state.isRunning) {
      throw new Error("Trading bot is not running");
    }

    this.state.isPaused = true;
    await storage.addTradeLog({
      type: "algorithm",
      message: "Trading bot paused",
    });
  }

  async resume(): Promise<void> {
    if (!this.state.isRunning) {
      throw new Error("Trading bot is not running");
    }

    this.state.isPaused = false;
    await storage.addTradeLog({
      type: "algorithm",
      message: "Trading bot resumed",
    });
  }

  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.state.isRunning = false;
    this.state.isPaused = false;

    await storage.addTradeLog({
      type: "algorithm",
      message: "Trading bot stopped",
    });
  }

  async closeAllPositions(): Promise<void> {
    if (!this.config) return;

    const credentials = await storage.getCredentials(this.config.exchange);
    if (!credentials) {
      throw new Error("No credentials available");
    }

    await exchangeService.closeAllPositions(this.config.exchange, credentials);
    await storage.setPositions(this.config.exchange, []);

    await storage.addTradeLog({
      type: "position",
      message: "All positions closed",
    });

    await this.stop();
  }

  private async executeTradeCheck(): Promise<void> {
    if (!this.config || this.state.isPaused) return;

    try {
      const { exchange, symbol, algorithm } = this.config;
      
      // Get current market data
      const ticker = await exchangeService.getTicker(exchange, symbol);
      const klines = await exchangeService.getKlines(exchange, symbol, "15m", 50);
      
      // Get current positions
      const credentials = await storage.getCredentials(exchange);
      if (!credentials) return;

      const positions = await storage.getPositions(exchange);
      
      // Update ticker in storage
      await storage.setTicker(exchange, symbol, ticker);

      // Evaluate trading rules
      const decision = await this.evaluateRules(algorithm.rules, ticker, klines, positions);

      if (decision.action !== "hold") {
        await this.executeDecision(decision, ticker);
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
    positions: Position[]
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
    ticker: Ticker
  ): Promise<void> {
    if (!this.config) return;

    const { exchange, symbol, algorithm } = this.config;
    const credentials = await storage.getCredentials(exchange);
    if (!credentials) return;

    const { riskManagement } = algorithm;

    await storage.addTradeLog({
      type: "signal",
      message: decision.reason,
      data: { action: decision.action },
    });

    try {
      if (decision.action === "buy" || decision.action === "sell") {
        // Calculate position size based on risk management
        const positionSize = Math.min(
          riskManagement.maxPositionSize,
          1000 // Default max
        );
        const quantity = positionSize / ticker.lastPrice;

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
          const position: Position = {
            id: randomUUID(),
            symbol,
            side: decision.action === "buy" ? "long" : "short",
            entryPrice: order.price,
            markPrice: ticker.lastPrice,
            quantity: order.filledQuantity,
            leverage: riskManagement.maxLeverage,
            marginType: "isolated",
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
            liquidationPrice: this.calculateLiquidationPrice(
              order.price,
              decision.action === "buy" ? "long" : "short",
              riskManagement.maxLeverage
            ),
            timestamp: Date.now(),
          };

          await storage.updatePosition(exchange, position);

          await storage.addTradeLog({
            type: "position",
            message: `Opened ${position.side} position: ${position.quantity} ${symbol} @ ${position.entryPrice}`,
            data: { positionId: position.id },
          });
        }
      } else if (decision.action === "close") {
        const positions = await storage.getPositions(exchange);
        const symbolPositions = positions.filter((p) => p.symbol === symbol);

        for (const position of symbolPositions) {
          await exchangeService.closePosition(exchange, credentials, position.id);
          await storage.deletePosition(exchange, position.id);

          await storage.addTradeLog({
            type: "position",
            message: `Closed position: ${position.side} ${position.quantity} ${symbol}`,
            data: { positionId: position.id, pnl: position.unrealizedPnl },
          });
        }
      }
    } catch (error) {
      await storage.addTradeLog({
        type: "error",
        message: `Failed to execute ${decision.action}: ${(error as Error).message}`,
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
}

// Singleton trading bot instance
export const tradingBot = new TradingBot();
