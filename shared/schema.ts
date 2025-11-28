import { z } from "zod";
import { pgTable, text, integer, real, timestamp, boolean, serial, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

// ============ DATABASE TABLES (Drizzle ORM) ============

// Trade history table - persists all executed trades for analytics
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "buy" or "sell"
  positionSide: text("position_side").notNull(), // "long" or "short"
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  quantity: real("quantity").notNull(),
  leverage: integer("leverage").notNull().default(1),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  fees: real("fees").default(0),
  executionMode: text("execution_mode").notNull().default("paper"), // "paper" or "real"
  algorithmId: text("algorithm_id"),
  algorithmName: text("algorithm_name"),
  status: text("status").notNull().default("open"), // "open", "closed", "liquidated"
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  stopLossPrice: real("stop_loss_price"),
  takeProfitPrice: real("take_profit_price"),
  closeReason: text("close_reason"), // "manual", "stop_loss", "take_profit", "trailing_stop", "liquidation", "algorithm"
  notes: text("notes"),
});

// Daily trading summaries for quick analytics
export const dailySummaries = pgTable("daily_summaries", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(), // YYYY-MM-DD format
  exchange: text("exchange").notNull(),
  totalTrades: integer("total_trades").notNull().default(0),
  winningTrades: integer("winning_trades").notNull().default(0),
  losingTrades: integer("losing_trades").notNull().default(0),
  totalPnl: real("total_pnl").notNull().default(0),
  totalFees: real("total_fees").notNull().default(0),
  largestWin: real("largest_win").default(0),
  largestLoss: real("largest_loss").default(0),
  executionMode: text("execution_mode").notNull().default("paper"),
});

// Algorithm performance tracking
export const algorithmPerformance = pgTable("algorithm_performance", {
  id: serial("id").primaryKey(),
  algorithmId: text("algorithm_id").notNull(),
  algorithmName: text("algorithm_name").notNull(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  totalTrades: integer("total_trades").notNull().default(0),
  winningTrades: integer("winning_trades").notNull().default(0),
  totalPnl: real("total_pnl").notNull().default(0),
  avgPnlPerTrade: real("avg_pnl_per_trade").default(0),
  maxDrawdown: real("max_drawdown").default(0),
  sharpeRatio: real("sharpe_ratio"),
  winRate: real("win_rate").default(0),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
});

// Relations
export const tradesRelations = relations(trades, ({ }) => ({}));
export const dailySummariesRelations = relations(dailySummaries, ({ }) => ({}));
export const algorithmPerformanceRelations = relations(algorithmPerformance, ({ }) => ({}));

// Insert schemas
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;

export const insertDailySummarySchema = createInsertSchema(dailySummaries).omit({ id: true });
export type InsertDailySummary = z.infer<typeof insertDailySummarySchema>;
export type DailySummary = typeof dailySummaries.$inferSelect;

export const insertAlgorithmPerformanceSchema = createInsertSchema(algorithmPerformance).omit({ id: true });
export type InsertAlgorithmPerformance = z.infer<typeof insertAlgorithmPerformanceSchema>;
export type AlgorithmPerformance = typeof algorithmPerformance.$inferSelect;

// ============ EXISTING TYPES (Non-database) ============

// Exchange types
export const exchanges = ["coinstore", "bydfi"] as const;
export type Exchange = typeof exchanges[number];

// Market/Trading pair types
export interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  maxLeverage: number;
}

// Trading modes
export const tradingModes = ["ai-trading", "ai-scalping", "manual"] as const;
export type TradingMode = typeof tradingModes[number];

// Order types
export const orderTypes = ["market", "limit"] as const;
export type OrderType = typeof orderTypes[number];

export const orderSides = ["buy", "sell"] as const;
export type OrderSide = typeof orderSides[number];

export const orderStatuses = ["pending", "filled", "cancelled", "partial"] as const;
export type OrderStatus = typeof orderStatuses[number];

export const positionSides = ["long", "short"] as const;
export type PositionSide = typeof positionSides[number];

// Kline/Candlestick data
export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Ticker data
export interface Ticker {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

// API credentials schema
export const apiCredentialsSchema = z.object({
  exchange: z.enum(exchanges),
  apiKey: z.string().min(1, "API Key is required"),
  secretKey: z.string().min(1, "Secret Key is required"),
  passphrase: z.string().optional(),
  saveCredentials: z.boolean().default(false),
});

export type ApiCredentials = z.infer<typeof apiCredentialsSchema>;

// Stop-loss and take-profit order types
export interface StopOrder {
  id: string;
  positionId: string;
  type: "stop_loss" | "take_profit" | "trailing_stop";
  triggerPrice: number;
  quantity: number;
  status: "active" | "triggered" | "cancelled";
  trailingDistance?: number;  // For trailing stops (in %)
  highestPrice?: number;      // Track highest price for trailing stop (long)
  lowestPrice?: number;       // Track lowest price for trailing stop (short)
  createdAt: number;
  triggeredAt?: number;
}

// Position schema with stop-loss and take-profit tracking
export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  markPrice: number;
  quantity: number;
  leverage: number;
  marginType: "isolated" | "cross";
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  liquidationPrice: number;
  timestamp: number;
  // Risk management fields
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopDistance?: number;  // Trailing stop distance in %
  stopOrderId?: string;
  takeProfitOrderId?: string;
  trailingStopOrderId?: string;
}

// Order schema
export interface Order {
  id: string;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  price: number;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  timestamp: number;
}

// Manual order input schema
export const manualOrderSchema = z.object({
  symbol: z.string().min(1),
  type: z.enum(orderTypes),
  side: z.enum(orderSides),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  leverage: z.number().min(1).max(125).default(1),
});

export type ManualOrderInput = z.infer<typeof manualOrderSchema>;

// Chat message types
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  algorithmJson?: TradingAlgorithm;
}

// Trading algorithm schema (AI-generated)
export interface TradingAlgorithm {
  id: string;
  name: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  mode: TradingMode;
  symbol: string;
  rules: TradingRule[];
  riskManagement: RiskManagement;
  status: "active" | "paused" | "stopped";
}

export interface TradingRule {
  id: string;
  condition: string;
  action: "buy" | "sell" | "close" | "hold";
  quantity?: number;
  quantityPercent?: number;
  priceType: "market" | "limit";
  limitOffset?: number;
  priority: number;
}

export interface RiskManagement {
  maxPositionSize: number;
  maxLeverage: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxDailyLoss: number;
  trailingStop: boolean;
  trailingStopPercent?: number;
  autoStopLoss: boolean;       // Auto-create SL orders on position open
  autoTakeProfit: boolean;     // Auto-create TP orders on position open
  breakEvenTrigger?: number;   // Move SL to break-even after X% profit
}

// Risk parameters configuration schema for UI
export const riskParametersSchema = z.object({
  maxPositionSize: z.number().min(10).max(100000).default(1000),
  maxLeverage: z.number().min(1).max(125).default(10),
  stopLossPercent: z.number().min(0.1).max(50).default(2),
  takeProfitPercent: z.number().min(0.1).max(100).default(4),
  maxDailyLoss: z.number().min(10).max(100000).default(1000),
  trailingStop: z.boolean().default(false),
  trailingStopPercent: z.number().min(0.1).max(20).optional(),
  autoStopLoss: z.boolean().default(true),
  autoTakeProfit: z.boolean().default(true),
  breakEvenTrigger: z.number().min(0.5).max(50).optional(),
});

export type RiskParameters = z.infer<typeof riskParametersSchema>;

// Trade cycle status
export const tradeCycleStatuses = ["idle", "running", "paused", "stopping"] as const;
export type TradeCycleStatus = typeof tradeCycleStatuses[number];

// Execution modes: Paper (simulated) vs Real (live trading)
export const executionModes = ["paper", "real"] as const;
export type ExecutionMode = typeof executionModes[number];

export interface TradeCycleState {
  status: TradeCycleStatus;
  mode: TradingMode;
  executionMode: ExecutionMode;
  exchange: Exchange;
  symbol: string;
  startedAt?: number;
  algorithmId?: string;
  lastUpdate?: number;
}

// Connection status
export const connectionStatuses = ["connected", "connecting", "disconnected", "error"] as const;
export type ConnectionStatus = typeof connectionStatuses[number];

export interface ConnectionState {
  status: ConnectionStatus;
  exchange: Exchange;
  lastHeartbeat?: number;
  error?: string;
}

// Trade log entry
export interface TradeLogEntry {
  id: string;
  timestamp: number;
  type: "order" | "position" | "algorithm" | "signal" | "error";
  message: string;
  data?: Record<string, unknown>;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Markets list response
export interface MarketsResponse {
  exchange: Exchange;
  markets: Market[];
}

// Insert schemas for storage
export const insertChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  algorithmJson: z.any().optional(),
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

// Trade data for analysis
export interface TradeData {
  ticker: Ticker;
  klines: Kline[];
  positions: Position[];
  orders: Order[];
  signals?: TradingSignal[];
}

export interface TradingSignal {
  type: "bullish" | "bearish" | "neutral";
  indicator: string;
  strength: number;
  message: string;
  timestamp: number;
}

// User schema (keep existing)
export interface User {
  id: string;
  username: string;
  password: string;
}

export const insertUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
