import { randomUUID } from "crypto";
import type {
  Exchange,
  Market,
  TradingMode,
  Ticker,
  Kline,
  Position,
  Order,
  TradingAlgorithm,
  ChatMessage,
  TradeCycleState,
  TradeLogEntry,
  ApiCredentials,
  InsertChatMessage,
} from "@shared/schema";

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
}

export class MemStorage implements IStorage {
  private credentials: Map<Exchange, ApiCredentials> = new Map();
  private markets: Map<Exchange, Market[]> = new Map();
  private tickers: Map<string, Ticker> = new Map();
  private klines: Map<string, Kline[]> = new Map();
  private positions: Map<Exchange, Position[]> = new Map();
  private orders: Map<Exchange, Order[]> = new Map();
  private algorithms: Map<string, TradingAlgorithm> = new Map();
  private chatMessages: ChatMessage[] = [];
  private tradeCycleState: TradeCycleState | null = null;
  private tradeLogs: TradeLogEntry[] = [];

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
}

export const storage = new MemStorage();
