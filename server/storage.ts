import { randomUUID } from "crypto";
import type {
  Exchange,
  Market,
  TradingMode,
  Ticker,
  Kline,
  Position,
  Order,
  StopOrder,
  TradingAlgorithm,
  ChatMessage,
  TradeCycleState,
  TradeLogEntry,
  ApiCredentials,
  InsertChatMessage,
  RiskParameters,
  Trade,
  InsertTrade,
  DailySummary,
  AlgorithmPerformance,
  AlgorithmVersion,
  InsertAlgorithmVersion,
  AbTest,
  InsertAbTest,
  Notification,
  InsertNotification,
  NotificationSettings,
  RunningStrategy,
  InsertRunningStrategy,
  RunningStrategyStatus,
  LogicalPosition,
  InsertLogicalPosition,
  Fill,
  InsertFill,
  PositionReconciliation,
  InsertPositionReconciliation,
} from "@shared/schema";
import { trades, dailySummaries, algorithmPerformance, algorithmVersions, abTests, notifications, notificationSettings, runningStrategies, algorithms, livePositions, liveOrders, liveStopOrders, logicalPositions, fills, positionReconciliation } from "@shared/schema";
import type { PositionSide, OrderType, OrderSide, OrderStatus } from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";

export interface IStorage {
  // Credentials
  saveCredentials(credentials: ApiCredentials): Promise<void>;
  getCredentials(exchange: Exchange): Promise<ApiCredentials | null>;
  clearCredentials(exchange: Exchange): Promise<void>;

  // Markets
  getMarkets(exchange: Exchange): Promise<Market[]>;
  setMarkets(exchange: Exchange, markets: Market[]): Promise<void>;

  // Market Data
  getTicker(exchange: Exchange, symbol: string): Promise<Ticker | null>;
  setTicker(exchange: Exchange, symbol: string, ticker: Ticker): Promise<void>;
  getKlines(exchange: Exchange, symbol: string, timeframe: string): Promise<Kline[]>;
  setKlines(exchange: Exchange, symbol: string, timeframe: string, klines: Kline[]): Promise<void>;
  addKline(exchange: Exchange, symbol: string, timeframe: string, kline: Kline): Promise<void>;

  // Positions
  getPositions(exchange: Exchange): Promise<Position[]>;
  getPosition(exchange: Exchange, id: string): Promise<Position | null>;
  setPositions(exchange: Exchange, positions: Position[]): Promise<void>;
  updatePosition(exchange: Exchange, position: Position): Promise<void>;
  deletePosition(exchange: Exchange, id: string): Promise<void>;

  // Orders
  getOrders(exchange: Exchange): Promise<Order[]>;
  getOrder(exchange: Exchange, id: string): Promise<Order | null>;
  addOrder(exchange: Exchange, order: Order): Promise<void>;
  updateOrder(exchange: Exchange, order: Order): Promise<void>;

  // Stop Orders (SL/TP/Trailing)
  getStopOrders(exchange: Exchange): Promise<StopOrder[]>;
  getStopOrdersByPosition(exchange: Exchange, positionId: string): Promise<StopOrder[]>;
  addStopOrder(exchange: Exchange, stopOrder: StopOrder): Promise<void>;
  updateStopOrder(exchange: Exchange, stopOrder: StopOrder): Promise<void>;
  deleteStopOrder(exchange: Exchange, id: string): Promise<void>;
  deleteStopOrdersByPosition(exchange: Exchange, positionId: string): Promise<void>;

  // Risk Parameters
  getRiskParameters(): Promise<RiskParameters | null>;
  setRiskParameters(params: RiskParameters): Promise<void>;

  // Algorithms
  getAlgorithms(): Promise<TradingAlgorithm[]>;
  getAlgorithm(id: string): Promise<TradingAlgorithm | null>;
  saveAlgorithm(algorithm: TradingAlgorithm): Promise<void>;
  updateAlgorithm(algorithm: TradingAlgorithm): Promise<void>;
  deleteAlgorithm(id: string): Promise<void>;

  // Chat Messages
  getChatMessages(): Promise<ChatMessage[]>;
  addChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearChatMessages(): Promise<void>;

  // Trade Cycle State
  getTradeCycleState(): Promise<TradeCycleState | null>;
  setTradeCycleState(state: TradeCycleState): Promise<void>;

  // Trade Logs
  getTradeLog(): Promise<TradeLogEntry[]>;
  addTradeLog(entry: Omit<TradeLogEntry, "id" | "timestamp">): Promise<TradeLogEntry>;
  clearTradeLog(): Promise<void>;

  // Trade History (Database)
  createTrade(trade: InsertTrade): Promise<Trade>;
  updateTrade(id: number, updates: Partial<Trade>): Promise<Trade | null>;
  getTrades(options?: { 
    exchange?: string; 
    symbol?: string; 
    limit?: number; 
    status?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Trade[]>;
  getTrade(id: number): Promise<Trade | null>;
  clearTrades(): Promise<void>;
  getTradeAnalytics(exchange?: string): Promise<{
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnl: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    largestWin: number;
    largestLoss: number;
  }>;
  getDailySummaries(days?: number): Promise<DailySummary[]>;
  getAlgorithmPerformance(algorithmId?: string): Promise<AlgorithmPerformance[]>;

  // Algorithm Versions
  createAlgorithmVersion(version: InsertAlgorithmVersion): Promise<AlgorithmVersion>;
  getAlgorithmVersions(algorithmId: string): Promise<AlgorithmVersion[]>;
  getAlgorithmVersion(id: number): Promise<AlgorithmVersion | null>;
  getLatestAlgorithmVersion(algorithmId: string): Promise<AlgorithmVersion | null>;

  // A/B Tests
  createAbTest(test: InsertAbTest): Promise<AbTest>;
  updateAbTest(id: number, updates: Partial<AbTest>): Promise<AbTest | null>;
  getAbTests(): Promise<AbTest[]>;
  getAbTest(id: number): Promise<AbTest | null>;
  getActiveAbTests(): Promise<AbTest[]>;
  deleteAbTest(id: number): Promise<void>;

  // Notifications
  createNotification(notification: InsertNotification): Promise<Notification>;
  getNotifications(limit?: number): Promise<Notification[]>;
  getUnreadNotifications(): Promise<Notification[]>;
  markNotificationRead(id: number): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  deleteNotification(id: number): Promise<void>;
  clearNotifications(): Promise<void>;

  // Notification Settings
  getNotificationSettings(): Promise<NotificationSettings | null>;
  saveNotificationSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings>;

  // Running Strategies
  createRunningStrategy(strategy: InsertRunningStrategy): Promise<RunningStrategy>;
  getRunningStrategies(options?: { exchange?: string; status?: RunningStrategyStatus }): Promise<RunningStrategy[]>;
  getRunningStrategy(sessionId: string): Promise<RunningStrategy | null>;
  getRunningStrategyByMarket(exchange: string, symbol: string): Promise<RunningStrategy | null>;
  updateRunningStrategy(sessionId: string, updates: Partial<RunningStrategy>): Promise<RunningStrategy | null>;
  stopRunningStrategy(sessionId: string, errorMessage?: string): Promise<void>;
  updateRunningStrategyHeartbeat(sessionId: string): Promise<void>;
  cleanupStaleStrategies(maxAgeMs?: number): Promise<void>;

  // Logical Positions (Position Broker)
  createLogicalPosition(position: InsertLogicalPosition): Promise<LogicalPosition>;
  getLogicalPositions(options?: { sessionId?: string; exchange?: string; symbol?: string; status?: string }): Promise<LogicalPosition[]>;
  getLogicalPosition(id: string): Promise<LogicalPosition | null>;
  getOpenLogicalPositions(exchange: string, symbol: string): Promise<LogicalPosition[]>;
  updateLogicalPosition(id: string, updates: Partial<LogicalPosition>): Promise<LogicalPosition | null>;
  closeLogicalPosition(id: string, pnl: number, reason: string): Promise<void>;

  // Fills (Position Broker)
  createFill(fill: InsertFill): Promise<Fill>;
  getFillsByLogicalPosition(logicalPositionId: string): Promise<Fill[]>;
  getFills(options?: { exchange?: string; symbol?: string; limit?: number }): Promise<Fill[]>;

  // Position Reconciliation
  createReconciliationSnapshot(snapshot: InsertPositionReconciliation): Promise<PositionReconciliation>;
  getReconciliationSnapshots(exchange: string, symbol: string, limit?: number): Promise<PositionReconciliation[]>;
  getUnresolvedDrifts(): Promise<PositionReconciliation[]>;
  resolveDrift(id: number, resolutionNote: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private credentials: Map<Exchange, ApiCredentials> = new Map();
  private markets: Map<Exchange, Market[]> = new Map();
  private tickers: Map<string, Ticker> = new Map();
  private klines: Map<string, Kline[]> = new Map();
  // Note: positions and orders are now stored in the database for persistence
  // Stop orders are now in database (liveStopOrders table) - no longer using in-memory map
  // Note: algorithms are now stored in the database, not in-memory
  private chatMessages: ChatMessage[] = [];
  private tradeCycleState: TradeCycleState | null = null;
  private tradeLogs: TradeLogEntry[] = [];
  private riskParameters: RiskParameters | null = null;

  private getTickerKey(exchange: Exchange, symbol: string): string {
    return `${exchange}:${symbol}`;
  }

  private getKlineKey(exchange: Exchange, symbol: string, timeframe: string): string {
    return `${exchange}:${symbol}:${timeframe}`;
  }

  // Credentials
  async saveCredentials(credentials: ApiCredentials): Promise<void> {
    this.credentials.set(credentials.exchange, credentials);
  }

  async getCredentials(exchange: Exchange): Promise<ApiCredentials | null> {
    return this.credentials.get(exchange) || null;
  }

  async clearCredentials(exchange: Exchange): Promise<void> {
    this.credentials.delete(exchange);
  }

  // Markets
  async getMarkets(exchange: Exchange): Promise<Market[]> {
    return this.markets.get(exchange) || [];
  }

  async setMarkets(exchange: Exchange, markets: Market[]): Promise<void> {
    this.markets.set(exchange, markets);
  }

  // Market Data
  async getTicker(exchange: Exchange, symbol: string): Promise<Ticker | null> {
    return this.tickers.get(this.getTickerKey(exchange, symbol)) || null;
  }

  async setTicker(exchange: Exchange, symbol: string, ticker: Ticker): Promise<void> {
    this.tickers.set(this.getTickerKey(exchange, symbol), ticker);
  }

  async getKlines(exchange: Exchange, symbol: string, timeframe: string): Promise<Kline[]> {
    return this.klines.get(this.getKlineKey(exchange, symbol, timeframe)) || [];
  }

  async setKlines(exchange: Exchange, symbol: string, timeframe: string, klines: Kline[]): Promise<void> {
    this.klines.set(this.getKlineKey(exchange, symbol, timeframe), klines);
  }

  async addKline(exchange: Exchange, symbol: string, timeframe: string, kline: Kline): Promise<void> {
    const key = this.getKlineKey(exchange, symbol, timeframe);
    const existing = this.klines.get(key) || [];
    existing.push(kline);
    // Keep only last 500 klines
    if (existing.length > 500) {
      existing.shift();
    }
    this.klines.set(key, existing);
  }

  // Positions (Database-backed for persistence)
  async getPositions(exchange: Exchange): Promise<Position[]> {
    const rows = await db.select().from(livePositions).where(eq(livePositions.exchange, exchange));
    return rows.map(r => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side as PositionSide,
      entryPrice: r.entryPrice,
      markPrice: r.markPrice,
      quantity: r.quantity,
      leverage: r.leverage,
      marginType: r.marginType as "isolated" | "cross",
      unrealizedPnl: r.unrealizedPnl,
      unrealizedPnlPercent: r.unrealizedPnlPercent,
      liquidationPrice: r.liquidationPrice,
      timestamp: r.timestamp.getTime(),
      stopLossPrice: r.stopLossPrice ?? undefined,
      takeProfitPrice: r.takeProfitPrice ?? undefined,
      trailingStopDistance: r.trailingStopDistance ?? undefined,
      stopOrderId: r.stopOrderId ?? undefined,
      takeProfitOrderId: r.takeProfitOrderId ?? undefined,
      trailingStopOrderId: r.trailingStopOrderId ?? undefined,
    }));
  }

  async getPosition(exchange: Exchange, id: string): Promise<Position | null> {
    const [row] = await db.select().from(livePositions)
      .where(and(eq(livePositions.exchange, exchange), eq(livePositions.id, id)));
    if (!row) return null;
    return {
      id: row.id,
      symbol: row.symbol,
      side: row.side as PositionSide,
      entryPrice: row.entryPrice,
      markPrice: row.markPrice,
      quantity: row.quantity,
      leverage: row.leverage,
      marginType: row.marginType as "isolated" | "cross",
      unrealizedPnl: row.unrealizedPnl,
      unrealizedPnlPercent: row.unrealizedPnlPercent,
      liquidationPrice: row.liquidationPrice,
      timestamp: row.timestamp.getTime(),
      stopLossPrice: row.stopLossPrice ?? undefined,
      takeProfitPrice: row.takeProfitPrice ?? undefined,
      trailingStopDistance: row.trailingStopDistance ?? undefined,
      stopOrderId: row.stopOrderId ?? undefined,
      takeProfitOrderId: row.takeProfitOrderId ?? undefined,
      trailingStopOrderId: row.trailingStopOrderId ?? undefined,
    };
  }

  async setPositions(exchange: Exchange, positions: Position[]): Promise<void> {
    await db.delete(livePositions).where(eq(livePositions.exchange, exchange));
    if (positions.length > 0) {
      await db.insert(livePositions).values(positions.map(p => ({
        id: p.id,
        exchange: exchange,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        markPrice: p.markPrice,
        quantity: p.quantity,
        leverage: p.leverage,
        marginType: p.marginType,
        unrealizedPnl: p.unrealizedPnl,
        unrealizedPnlPercent: p.unrealizedPnlPercent,
        liquidationPrice: p.liquidationPrice,
        stopLossPrice: p.stopLossPrice ?? null,
        takeProfitPrice: p.takeProfitPrice ?? null,
        trailingStopDistance: p.trailingStopDistance ?? null,
        stopOrderId: p.stopOrderId ?? null,
        takeProfitOrderId: p.takeProfitOrderId ?? null,
        trailingStopOrderId: p.trailingStopOrderId ?? null,
        timestamp: new Date(p.timestamp),
      })));
    }
  }

  async updatePosition(exchange: Exchange, position: Position): Promise<void> {
    const existing = await this.getPosition(exchange, position.id);
    if (existing) {
      await db.update(livePositions)
        .set({
          symbol: position.symbol,
          side: position.side,
          entryPrice: position.entryPrice,
          markPrice: position.markPrice,
          quantity: position.quantity,
          leverage: position.leverage,
          marginType: position.marginType,
          unrealizedPnl: position.unrealizedPnl,
          unrealizedPnlPercent: position.unrealizedPnlPercent,
          liquidationPrice: position.liquidationPrice,
          stopLossPrice: position.stopLossPrice ?? null,
          takeProfitPrice: position.takeProfitPrice ?? null,
          trailingStopDistance: position.trailingStopDistance ?? null,
          stopOrderId: position.stopOrderId ?? null,
          takeProfitOrderId: position.takeProfitOrderId ?? null,
          trailingStopOrderId: position.trailingStopOrderId ?? null,
          timestamp: new Date(position.timestamp),
        })
        .where(eq(livePositions.id, position.id));
    } else {
      await db.insert(livePositions).values({
        id: position.id,
        exchange: exchange,
        symbol: position.symbol,
        side: position.side,
        entryPrice: position.entryPrice,
        markPrice: position.markPrice,
        quantity: position.quantity,
        leverage: position.leverage,
        marginType: position.marginType,
        unrealizedPnl: position.unrealizedPnl,
        unrealizedPnlPercent: position.unrealizedPnlPercent,
        liquidationPrice: position.liquidationPrice,
        stopLossPrice: position.stopLossPrice ?? null,
        takeProfitPrice: position.takeProfitPrice ?? null,
        trailingStopDistance: position.trailingStopDistance ?? null,
        stopOrderId: position.stopOrderId ?? null,
        takeProfitOrderId: position.takeProfitOrderId ?? null,
        trailingStopOrderId: position.trailingStopOrderId ?? null,
        timestamp: new Date(position.timestamp),
      });
    }
  }

  async deletePosition(exchange: Exchange, id: string): Promise<void> {
    await db.delete(livePositions).where(and(eq(livePositions.exchange, exchange), eq(livePositions.id, id)));
  }

  // Orders (Database-backed for persistence)
  async getOrders(exchange: Exchange): Promise<Order[]> {
    const rows = await db.select().from(liveOrders).where(eq(liveOrders.exchange, exchange));
    return rows.map(r => ({
      id: r.id,
      symbol: r.symbol,
      type: r.type as OrderType,
      side: r.side as OrderSide,
      price: r.price,
      quantity: r.quantity,
      filledQuantity: r.filledQuantity,
      status: r.status as OrderStatus,
      timestamp: r.timestamp.getTime(),
    }));
  }

  async getOrder(exchange: Exchange, id: string): Promise<Order | null> {
    const [row] = await db.select().from(liveOrders)
      .where(and(eq(liveOrders.exchange, exchange), eq(liveOrders.id, id)));
    if (!row) return null;
    return {
      id: row.id,
      symbol: row.symbol,
      type: row.type as OrderType,
      side: row.side as OrderSide,
      price: row.price,
      quantity: row.quantity,
      filledQuantity: row.filledQuantity,
      status: row.status as OrderStatus,
      timestamp: row.timestamp.getTime(),
    };
  }

  async addOrder(exchange: Exchange, order: Order): Promise<void> {
    await db.insert(liveOrders).values({
      id: order.id,
      exchange: exchange,
      symbol: order.symbol,
      type: order.type,
      side: order.side,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      status: order.status,
      timestamp: new Date(order.timestamp),
    });
  }

  async updateOrder(exchange: Exchange, order: Order): Promise<void> {
    await db.update(liveOrders)
      .set({
        symbol: order.symbol,
        type: order.type,
        side: order.side,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
        status: order.status,
        timestamp: new Date(order.timestamp),
      })
      .where(eq(liveOrders.id, order.id));
  }

  // Stop Orders (SL/TP/Trailing) - Database-backed for persistence
  async getStopOrders(exchange: Exchange): Promise<StopOrder[]> {
    const rows = await db.select().from(liveStopOrders).where(eq(liveStopOrders.exchange, exchange));
    return rows.map(r => ({
      id: r.id,
      positionId: r.positionId,
      type: r.type as "stop_loss" | "take_profit" | "trailing_stop",
      triggerPrice: r.triggerPrice,
      quantity: r.quantity,
      status: r.status as "active" | "triggered" | "cancelled",
      highestPrice: r.highestPrice ?? undefined,
      lowestPrice: r.lowestPrice ?? undefined,
      trailingDistance: r.trailingDistance ?? undefined,
      createdAt: r.createdAt.getTime(),
    }));
  }

  async getStopOrdersByPosition(exchange: Exchange, positionId: string): Promise<StopOrder[]> {
    const rows = await db.select().from(liveStopOrders)
      .where(and(eq(liveStopOrders.exchange, exchange), eq(liveStopOrders.positionId, positionId)));
    return rows.map(r => ({
      id: r.id,
      positionId: r.positionId,
      type: r.type as "stop_loss" | "take_profit" | "trailing_stop",
      triggerPrice: r.triggerPrice,
      quantity: r.quantity,
      status: r.status as "active" | "triggered" | "cancelled",
      highestPrice: r.highestPrice ?? undefined,
      lowestPrice: r.lowestPrice ?? undefined,
      trailingDistance: r.trailingDistance ?? undefined,
      createdAt: r.createdAt.getTime(),
    }));
  }

  async addStopOrder(exchange: Exchange, stopOrder: StopOrder): Promise<void> {
    await db.insert(liveStopOrders).values({
      id: stopOrder.id,
      exchange: exchange,
      positionId: stopOrder.positionId,
      type: stopOrder.type,
      triggerPrice: stopOrder.triggerPrice,
      quantity: stopOrder.quantity,
      status: stopOrder.status,
      highestPrice: stopOrder.highestPrice ?? null,
      lowestPrice: stopOrder.lowestPrice ?? null,
      trailingDistance: stopOrder.trailingDistance ?? null,
    });
  }

  async updateStopOrder(exchange: Exchange, stopOrder: StopOrder): Promise<void> {
    await db.update(liveStopOrders)
      .set({
        triggerPrice: stopOrder.triggerPrice,
        quantity: stopOrder.quantity,
        status: stopOrder.status,
        highestPrice: stopOrder.highestPrice ?? null,
        lowestPrice: stopOrder.lowestPrice ?? null,
        trailingDistance: stopOrder.trailingDistance ?? null,
      })
      .where(eq(liveStopOrders.id, stopOrder.id));
  }

  async deleteStopOrder(exchange: Exchange, id: string): Promise<void> {
    await db.delete(liveStopOrders).where(eq(liveStopOrders.id, id));
  }

  async deleteStopOrdersByPosition(exchange: Exchange, positionId: string): Promise<void> {
    await db.delete(liveStopOrders).where(eq(liveStopOrders.positionId, positionId));
  }

  // Risk Parameters
  async getRiskParameters(): Promise<RiskParameters | null> {
    return this.riskParameters;
  }

  async setRiskParameters(params: RiskParameters): Promise<void> {
    this.riskParameters = params;
  }

  // Algorithms (Database-backed for persistence)
  async getAlgorithms(): Promise<TradingAlgorithm[]> {
    const dbAlgorithms = await db.select().from(algorithms).orderBy(desc(algorithms.createdAt));
    return dbAlgorithms.map(alg => ({
      id: alg.id,
      name: alg.name,
      mode: alg.mode as TradingMode,
      symbol: alg.symbol,
      version: alg.version,
      rules: JSON.parse(alg.rules),
      riskManagement: JSON.parse(alg.riskManagement),
      createdAt: alg.createdAt.getTime(),
    }));
  }

  async getAlgorithm(id: string): Promise<TradingAlgorithm | null> {
    const [alg] = await db.select().from(algorithms).where(eq(algorithms.id, id));
    if (!alg) return null;
    return {
      id: alg.id,
      name: alg.name,
      mode: alg.mode as TradingMode,
      symbol: alg.symbol,
      version: alg.version,
      rules: JSON.parse(alg.rules),
      riskManagement: JSON.parse(alg.riskManagement),
      createdAt: alg.createdAt.getTime(),
    };
  }

  async saveAlgorithm(algorithm: TradingAlgorithm): Promise<void> {
    await db.insert(algorithms).values({
      id: algorithm.id,
      name: algorithm.name,
      mode: algorithm.mode,
      symbol: algorithm.symbol,
      version: algorithm.version,
      rules: JSON.stringify(algorithm.rules),
      riskManagement: JSON.stringify(algorithm.riskManagement),
      createdAt: new Date(algorithm.createdAt || Date.now()),
      updatedAt: new Date(),
    });
  }

  async updateAlgorithm(algorithm: TradingAlgorithm): Promise<void> {
    await db.update(algorithms)
      .set({
        name: algorithm.name,
        mode: algorithm.mode,
        symbol: algorithm.symbol,
        version: algorithm.version,
        rules: JSON.stringify(algorithm.rules),
        riskManagement: JSON.stringify(algorithm.riskManagement),
        updatedAt: new Date(),
      })
      .where(eq(algorithms.id, algorithm.id));
  }

  async deleteAlgorithm(id: string): Promise<void> {
    await db.delete(algorithms).where(eq(algorithms.id, id));
  }

  // Chat Messages
  async getChatMessages(): Promise<ChatMessage[]> {
    return this.chatMessages;
  }

  async addChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const chatMessage: ChatMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...message,
    };
    this.chatMessages.push(chatMessage);
    return chatMessage;
  }

  async clearChatMessages(): Promise<void> {
    this.chatMessages = [];
  }

  // Trade Cycle State
  async getTradeCycleState(): Promise<TradeCycleState | null> {
    return this.tradeCycleState;
  }

  async setTradeCycleState(state: TradeCycleState): Promise<void> {
    this.tradeCycleState = state;
  }

  // Trade Logs
  async getTradeLog(): Promise<TradeLogEntry[]> {
    return this.tradeLogs;
  }

  async addTradeLog(entry: Omit<TradeLogEntry, "id" | "timestamp">): Promise<TradeLogEntry> {
    const logEntry: TradeLogEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      ...entry,
    };
    this.tradeLogs.push(logEntry);
    // Keep only last 1000 logs
    if (this.tradeLogs.length > 1000) {
      this.tradeLogs.shift();
    }
    return logEntry;
  }

  async clearTradeLog(): Promise<void> {
    this.tradeLogs = [];
  }

  // Trade History (Database) - Uses PostgreSQL for persistence
  async createTrade(trade: InsertTrade): Promise<Trade> {
    const [newTrade] = await db.insert(trades).values(trade).returning();
    return newTrade;
  }

  async updateTrade(id: number, updates: Partial<Trade>): Promise<Trade | null> {
    const [updated] = await db
      .update(trades)
      .set(updates)
      .where(eq(trades.id, id))
      .returning();
    return updated || null;
  }

  async getTrades(options?: { 
    exchange?: string; 
    symbol?: string; 
    limit?: number; 
    status?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Trade[]> {
    const conditions = [];
    
    if (options?.exchange) {
      conditions.push(eq(trades.exchange, options.exchange));
    }
    if (options?.symbol) {
      conditions.push(eq(trades.symbol, options.symbol));
    }
    if (options?.status) {
      conditions.push(eq(trades.status, options.status));
    }
    if (options?.startDate) {
      conditions.push(gte(trades.openedAt, options.startDate));
    }
    if (options?.endDate) {
      conditions.push(lte(trades.openedAt, options.endDate));
    }

    const query = db.select().from(trades);
    
    if (conditions.length > 0) {
      const result = await query
        .where(and(...conditions))
        .orderBy(desc(trades.openedAt))
        .limit(options?.limit || 100);
      return result;
    }
    
    return query.orderBy(desc(trades.openedAt)).limit(options?.limit || 100);
  }

  async getTrade(id: number): Promise<Trade | null> {
    const [trade] = await db.select().from(trades).where(eq(trades.id, id));
    return trade || null;
  }

  async clearTrades(): Promise<void> {
    await db.delete(trades);
  }

  async getTradeAnalytics(exchange?: string): Promise<{
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnl: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    largestWin: number;
    largestLoss: number;
  }> {
    const conditions = [eq(trades.status, "closed")];
    if (exchange) {
      conditions.push(eq(trades.exchange, exchange));
    }

    const allTrades = await db
      .select()
      .from(trades)
      .where(and(...conditions));

    const closedTrades = allTrades.filter(t => t.pnl !== null);
    const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losingTrades = closedTrades.filter(t => (t.pnl || 0) < 0);

    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

    const largestWin = winningTrades.length > 0 
      ? Math.max(...winningTrades.map(t => t.pnl || 0)) 
      : 0;
    const largestLoss = losingTrades.length > 0 
      ? Math.min(...losingTrades.map(t => t.pnl || 0)) 
      : 0;

    return {
      totalTrades: closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      totalPnl,
      winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
      avgWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
      avgLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      largestWin,
      largestLoss,
    };
  }

  async getDailySummaries(days?: number): Promise<DailySummary[]> {
    const limit = days || 30;
    return db
      .select()
      .from(dailySummaries)
      .orderBy(desc(dailySummaries.date))
      .limit(limit);
  }

  async getAlgorithmPerformance(algorithmId?: string): Promise<AlgorithmPerformance[]> {
    if (algorithmId) {
      return db
        .select()
        .from(algorithmPerformance)
        .where(eq(algorithmPerformance.algorithmId, algorithmId));
    }
    return db.select().from(algorithmPerformance);
  }

  // ============ ALGORITHM VERSIONS ============

  async createAlgorithmVersion(version: InsertAlgorithmVersion): Promise<AlgorithmVersion> {
    const [newVersion] = await db.insert(algorithmVersions).values(version).returning();
    return newVersion;
  }

  async getAlgorithmVersions(algorithmId: string): Promise<AlgorithmVersion[]> {
    return db
      .select()
      .from(algorithmVersions)
      .where(eq(algorithmVersions.algorithmId, algorithmId))
      .orderBy(desc(algorithmVersions.version));
  }

  async getAlgorithmVersion(id: number): Promise<AlgorithmVersion | null> {
    const [version] = await db
      .select()
      .from(algorithmVersions)
      .where(eq(algorithmVersions.id, id));
    return version || null;
  }

  async getLatestAlgorithmVersion(algorithmId: string): Promise<AlgorithmVersion | null> {
    const [version] = await db
      .select()
      .from(algorithmVersions)
      .where(eq(algorithmVersions.algorithmId, algorithmId))
      .orderBy(desc(algorithmVersions.version))
      .limit(1);
    return version || null;
  }

  // ============ A/B TESTS ============

  async createAbTest(test: InsertAbTest): Promise<AbTest> {
    const [newTest] = await db.insert(abTests).values(test).returning();
    return newTest;
  }

  async updateAbTest(id: number, updates: Partial<AbTest>): Promise<AbTest | null> {
    const [updated] = await db
      .update(abTests)
      .set(updates)
      .where(eq(abTests.id, id))
      .returning();
    return updated || null;
  }

  async getAbTests(): Promise<AbTest[]> {
    return db
      .select()
      .from(abTests)
      .orderBy(desc(abTests.createdAt));
  }

  async getAbTest(id: number): Promise<AbTest | null> {
    const [test] = await db
      .select()
      .from(abTests)
      .where(eq(abTests.id, id));
    return test || null;
  }

  async getActiveAbTests(): Promise<AbTest[]> {
    return db
      .select()
      .from(abTests)
      .where(eq(abTests.status, "running"));
  }

  async deleteAbTest(id: number): Promise<void> {
    await db.delete(abTests).where(eq(abTests.id, id));
  }

  // ============ NOTIFICATIONS ============

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notifications).values(notification).returning();
    return newNotification;
  }

  async getNotifications(limit = 50): Promise<Notification[]> {
    return db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotifications(): Promise<Notification[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.isRead, false))
      .orderBy(desc(notifications.createdAt));
  }

  async markNotificationRead(id: number): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id));
  }

  async markAllNotificationsRead(): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.isRead, false));
  }

  async deleteNotification(id: number): Promise<void> {
    await db.delete(notifications).where(eq(notifications.id, id));
  }

  async clearNotifications(): Promise<void> {
    await db.delete(notifications);
  }

  // ============ NOTIFICATION SETTINGS ============

  private defaultSettings: NotificationSettings = {
    id: 1,
    emailEnabled: false,
    emailAddress: null,
    browserEnabled: true,
    soundEnabled: true,
    tradeOpenEnabled: true,
    tradeCloseEnabled: true,
    stopLossEnabled: true,
    takeProfitEnabled: true,
    dailySummaryEnabled: false,
    minPnlAlert: null,
  };

  async getNotificationSettings(): Promise<NotificationSettings | null> {
    const [settings] = await db.select().from(notificationSettings).limit(1);
    return settings || this.defaultSettings;
  }

  async saveNotificationSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const existing = await this.getNotificationSettings();
    
    if (existing && existing.id !== 1) {
      // Update existing
      const [updated] = await db
        .update(notificationSettings)
        .set(settings)
        .where(eq(notificationSettings.id, existing.id))
        .returning();
      return updated;
    } else {
      // Create new
      const [newSettings] = await db
        .insert(notificationSettings)
        .values({ ...this.defaultSettings, ...settings })
        .returning();
      return newSettings;
    }
  }

  // ============ RUNNING STRATEGIES ============

  async createRunningStrategy(strategy: InsertRunningStrategy): Promise<RunningStrategy> {
    const [newStrategy] = await db.insert(runningStrategies).values(strategy).returning();
    return newStrategy;
  }

  async getRunningStrategies(options?: { exchange?: string; status?: RunningStrategyStatus }): Promise<RunningStrategy[]> {
    let query = db.select().from(runningStrategies);
    
    const conditions = [];
    if (options?.exchange) {
      conditions.push(eq(runningStrategies.exchange, options.exchange));
    }
    if (options?.status) {
      conditions.push(eq(runningStrategies.status, options.status));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    
    return query.orderBy(desc(runningStrategies.startedAt));
  }

  async getRunningStrategy(sessionId: string): Promise<RunningStrategy | null> {
    const [strategy] = await db
      .select()
      .from(runningStrategies)
      .where(eq(runningStrategies.sessionId, sessionId))
      .limit(1);
    return strategy || null;
  }

  async getRunningStrategyByMarket(exchange: string, symbol: string): Promise<RunningStrategy | null> {
    const [strategy] = await db
      .select()
      .from(runningStrategies)
      .where(
        and(
          eq(runningStrategies.exchange, exchange),
          eq(runningStrategies.symbol, symbol),
          eq(runningStrategies.status, "running")
        )
      )
      .limit(1);
    return strategy || null;
  }

  async updateRunningStrategy(sessionId: string, updates: Partial<RunningStrategy>): Promise<RunningStrategy | null> {
    const [updated] = await db
      .update(runningStrategies)
      .set(updates)
      .where(eq(runningStrategies.sessionId, sessionId))
      .returning();
    return updated || null;
  }

  async stopRunningStrategy(sessionId: string, errorMessage?: string): Promise<void> {
    await db
      .update(runningStrategies)
      .set({
        status: errorMessage ? "error" : "stopped",
        stoppedAt: new Date(),
        errorMessage: errorMessage || null,
      })
      .where(eq(runningStrategies.sessionId, sessionId));
  }

  async updateRunningStrategyHeartbeat(sessionId: string): Promise<void> {
    await db
      .update(runningStrategies)
      .set({ lastHeartbeat: new Date() })
      .where(eq(runningStrategies.sessionId, sessionId));
  }

  async cleanupStaleStrategies(maxAgeMs: number = 5 * 60 * 1000): Promise<void> {
    const cutoffTime = new Date(Date.now() - maxAgeMs);
    await db
      .update(runningStrategies)
      .set({ status: "stopped", stoppedAt: new Date(), errorMessage: "Stale heartbeat - auto-stopped" })
      .where(
        and(
          eq(runningStrategies.status, "running"),
          lte(runningStrategies.lastHeartbeat, cutoffTime)
        )
      );
  }

  // ============ LOGICAL POSITIONS (Position Broker) ============

  async createLogicalPosition(position: InsertLogicalPosition): Promise<LogicalPosition> {
    const [created] = await db
      .insert(logicalPositions)
      .values(position)
      .returning();
    return created;
  }

  async getLogicalPositions(options?: { sessionId?: string; exchange?: string; symbol?: string; status?: string }): Promise<LogicalPosition[]> {
    const conditions = [];
    if (options?.sessionId) {
      conditions.push(eq(logicalPositions.sessionId, options.sessionId));
    }
    if (options?.exchange) {
      conditions.push(eq(logicalPositions.exchange, options.exchange));
    }
    if (options?.symbol) {
      conditions.push(eq(logicalPositions.symbol, options.symbol));
    }
    if (options?.status) {
      conditions.push(eq(logicalPositions.status, options.status));
    }

    let query = db.select().from(logicalPositions);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    return query.orderBy(desc(logicalPositions.openedAt));
  }

  async getLogicalPosition(id: string): Promise<LogicalPosition | null> {
    const [position] = await db
      .select()
      .from(logicalPositions)
      .where(eq(logicalPositions.id, id))
      .limit(1);
    return position || null;
  }

  async getOpenLogicalPositions(exchange: string, symbol: string): Promise<LogicalPosition[]> {
    return db
      .select()
      .from(logicalPositions)
      .where(
        and(
          eq(logicalPositions.exchange, exchange),
          eq(logicalPositions.symbol, symbol),
          eq(logicalPositions.status, "open")
        )
      )
      .orderBy(desc(logicalPositions.openedAt));
  }

  async updateLogicalPosition(id: string, updates: Partial<LogicalPosition>): Promise<LogicalPosition | null> {
    const [updated] = await db
      .update(logicalPositions)
      .set(updates)
      .where(eq(logicalPositions.id, id))
      .returning();
    return updated || null;
  }

  async closeLogicalPosition(id: string, pnl: number, reason: string): Promise<void> {
    await db
      .update(logicalPositions)
      .set({
        status: "closed",
        realizedPnl: pnl,
        closeReason: reason,
        closedAt: new Date(),
        remainingQuantity: 0,
      })
      .where(eq(logicalPositions.id, id));
  }

  // ============ FILLS (Position Broker) ============

  async createFill(fill: InsertFill): Promise<Fill> {
    const [created] = await db
      .insert(fills)
      .values(fill)
      .returning();
    return created;
  }

  async getFillsByLogicalPosition(logicalPositionId: string): Promise<Fill[]> {
    return db
      .select()
      .from(fills)
      .where(eq(fills.logicalPositionId, logicalPositionId))
      .orderBy(desc(fills.timestamp));
  }

  async getFills(options?: { exchange?: string; symbol?: string; limit?: number }): Promise<Fill[]> {
    const conditions = [];
    if (options?.exchange) {
      conditions.push(eq(fills.exchange, options.exchange));
    }
    if (options?.symbol) {
      conditions.push(eq(fills.symbol, options.symbol));
    }

    let query = db.select().from(fills);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    
    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    
    return query.orderBy(desc(fills.timestamp));
  }

  // ============ POSITION RECONCILIATION ============

  async createReconciliationSnapshot(snapshot: InsertPositionReconciliation): Promise<PositionReconciliation> {
    const [created] = await db
      .insert(positionReconciliation)
      .values(snapshot)
      .returning();
    return created;
  }

  async getReconciliationSnapshots(exchange: string, symbol: string, limit: number = 10): Promise<PositionReconciliation[]> {
    return db
      .select()
      .from(positionReconciliation)
      .where(
        and(
          eq(positionReconciliation.exchange, exchange),
          eq(positionReconciliation.symbol, symbol)
        )
      )
      .orderBy(desc(positionReconciliation.timestamp))
      .limit(limit);
  }

  async getUnresolvedDrifts(): Promise<PositionReconciliation[]> {
    return db
      .select()
      .from(positionReconciliation)
      .where(
        and(
          eq(positionReconciliation.hasDrift, true),
          eq(positionReconciliation.driftResolved, false)
        )
      )
      .orderBy(desc(positionReconciliation.timestamp));
  }

  async resolveDrift(id: number, resolutionNote: string): Promise<void> {
    await db
      .update(positionReconciliation)
      .set({
        driftResolved: true,
        resolutionNote,
      })
      .where(eq(positionReconciliation.id, id));
  }
}

export const storage = new MemStorage();
