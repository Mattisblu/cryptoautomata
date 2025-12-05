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
} from "@shared/schema";
import { trades, dailySummaries, algorithmPerformance, algorithmVersions, abTests, notifications, notificationSettings, runningStrategies, algorithms } from "@shared/schema";
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
}

export class MemStorage implements IStorage {
  private credentials: Map<Exchange, ApiCredentials> = new Map();
  private markets: Map<Exchange, Market[]> = new Map();
  private tickers: Map<string, Ticker> = new Map();
  private klines: Map<string, Kline[]> = new Map();
  private positions: Map<Exchange, Position[]> = new Map();
  private orders: Map<Exchange, Order[]> = new Map();
  private stopOrders: Map<Exchange, StopOrder[]> = new Map();
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

  // Positions
  async getPositions(exchange: Exchange): Promise<Position[]> {
    return this.positions.get(exchange) || [];
  }

  async getPosition(exchange: Exchange, id: string): Promise<Position | null> {
    const positions = this.positions.get(exchange) || [];
    return positions.find(p => p.id === id) || null;
  }

  async setPositions(exchange: Exchange, positions: Position[]): Promise<void> {
    this.positions.set(exchange, positions);
  }

  async updatePosition(exchange: Exchange, position: Position): Promise<void> {
    const positions = this.positions.get(exchange) || [];
    const index = positions.findIndex(p => p.id === position.id);
    if (index >= 0) {
      positions[index] = position;
    } else {
      positions.push(position);
    }
    this.positions.set(exchange, positions);
  }

  async deletePosition(exchange: Exchange, id: string): Promise<void> {
    const positions = this.positions.get(exchange) || [];
    this.positions.set(exchange, positions.filter(p => p.id !== id));
  }

  // Orders
  async getOrders(exchange: Exchange): Promise<Order[]> {
    return this.orders.get(exchange) || [];
  }

  async getOrder(exchange: Exchange, id: string): Promise<Order | null> {
    const orders = this.orders.get(exchange) || [];
    return orders.find(o => o.id === id) || null;
  }

  async addOrder(exchange: Exchange, order: Order): Promise<void> {
    const orders = this.orders.get(exchange) || [];
    orders.push(order);
    this.orders.set(exchange, orders);
  }

  async updateOrder(exchange: Exchange, order: Order): Promise<void> {
    const orders = this.orders.get(exchange) || [];
    const index = orders.findIndex(o => o.id === order.id);
    if (index >= 0) {
      orders[index] = order;
      this.orders.set(exchange, orders);
    }
  }

  // Stop Orders (SL/TP/Trailing)
  async getStopOrders(exchange: Exchange): Promise<StopOrder[]> {
    return this.stopOrders.get(exchange) || [];
  }

  async getStopOrdersByPosition(exchange: Exchange, positionId: string): Promise<StopOrder[]> {
    const stopOrders = this.stopOrders.get(exchange) || [];
    return stopOrders.filter(so => so.positionId === positionId);
  }

  async addStopOrder(exchange: Exchange, stopOrder: StopOrder): Promise<void> {
    const stopOrders = this.stopOrders.get(exchange) || [];
    stopOrders.push(stopOrder);
    this.stopOrders.set(exchange, stopOrders);
  }

  async updateStopOrder(exchange: Exchange, stopOrder: StopOrder): Promise<void> {
    const stopOrders = this.stopOrders.get(exchange) || [];
    const index = stopOrders.findIndex(so => so.id === stopOrder.id);
    if (index >= 0) {
      stopOrders[index] = stopOrder;
      this.stopOrders.set(exchange, stopOrders);
    }
  }

  async deleteStopOrder(exchange: Exchange, id: string): Promise<void> {
    const stopOrders = this.stopOrders.get(exchange) || [];
    this.stopOrders.set(exchange, stopOrders.filter(so => so.id !== id));
  }

  async deleteStopOrdersByPosition(exchange: Exchange, positionId: string): Promise<void> {
    const stopOrders = this.stopOrders.get(exchange) || [];
    this.stopOrders.set(exchange, stopOrders.filter(so => so.positionId !== positionId));
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
}

export const storage = new MemStorage();
