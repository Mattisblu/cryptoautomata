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
} from "@shared/schema";
import { trades, dailySummaries, algorithmPerformance } from "@shared/schema";
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
}

export class MemStorage implements IStorage {
  private credentials: Map<Exchange, ApiCredentials> = new Map();
  private markets: Map<Exchange, Market[]> = new Map();
  private tickers: Map<string, Ticker> = new Map();
  private klines: Map<string, Kline[]> = new Map();
  private positions: Map<Exchange, Position[]> = new Map();
  private orders: Map<Exchange, Order[]> = new Map();
  private stopOrders: Map<Exchange, StopOrder[]> = new Map();
  private algorithms: Map<string, TradingAlgorithm> = new Map();
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

  // Algorithms
  async getAlgorithms(): Promise<TradingAlgorithm[]> {
    return Array.from(this.algorithms.values());
  }

  async getAlgorithm(id: string): Promise<TradingAlgorithm | null> {
    return this.algorithms.get(id) || null;
  }

  async saveAlgorithm(algorithm: TradingAlgorithm): Promise<void> {
    this.algorithms.set(algorithm.id, algorithm);
  }

  async updateAlgorithm(algorithm: TradingAlgorithm): Promise<void> {
    if (this.algorithms.has(algorithm.id)) {
      this.algorithms.set(algorithm.id, algorithm);
    }
  }

  async deleteAlgorithm(id: string): Promise<void> {
    this.algorithms.delete(id);
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
}

export const storage = new MemStorage();
