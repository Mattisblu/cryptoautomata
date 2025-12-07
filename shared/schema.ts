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

// Algorithm version history - stores all versions of an algorithm for tracking changes
export const algorithmVersions = pgTable("algorithm_versions", {
  id: serial("id").primaryKey(),
  algorithmId: text("algorithm_id").notNull(), // Parent algorithm ID
  version: integer("version").notNull(),
  name: text("name").notNull(),
  mode: text("mode").notNull(), // ai-trading, ai-scalping, manual
  symbol: text("symbol").notNull(),
  rules: text("rules").notNull(), // JSON string of TradingRule[]
  riskManagement: text("risk_management").notNull(), // JSON string of RiskManagement
  createdAt: timestamp("created_at").notNull().defaultNow(),
  changeNotes: text("change_notes"), // Description of what changed
  parentVersionId: integer("parent_version_id"), // Reference to the version this was based on
});

// Notifications - store user notifications for trade events
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // "trade_open", "trade_close", "stop_loss", "take_profit", "error", "info"
  title: text("title").notNull(),
  message: text("message").notNull(),
  exchange: text("exchange"),
  symbol: text("symbol"),
  pnl: real("pnl"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  data: text("data"), // JSON string with additional data
});

// Notification settings - user preferences for notifications
export const notificationSettings = pgTable("notification_settings", {
  id: serial("id").primaryKey(),
  emailEnabled: boolean("email_enabled").notNull().default(false),
  emailAddress: text("email_address"),
  browserEnabled: boolean("browser_enabled").notNull().default(true),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  tradeOpenEnabled: boolean("trade_open_enabled").notNull().default(true),
  tradeCloseEnabled: boolean("trade_close_enabled").notNull().default(true),
  stopLossEnabled: boolean("stop_loss_enabled").notNull().default(true),
  takeProfitEnabled: boolean("take_profit_enabled").notNull().default(true),
  dailySummaryEnabled: boolean("daily_summary_enabled").notNull().default(false),
  minPnlAlert: real("min_pnl_alert"), // Only notify if PnL exceeds this amount
});

// A/B Tests - run two algorithms simultaneously to compare performance
export const abTests = pgTable("ab_tests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  algorithmAId: text("algorithm_a_id").notNull(),
  algorithmAName: text("algorithm_a_name").notNull(),
  algorithmAVersion: integer("algorithm_a_version").notNull(),
  algorithmBId: text("algorithm_b_id").notNull(),
  algorithmBName: text("algorithm_b_name").notNull(),
  algorithmBVersion: integer("algorithm_b_version").notNull(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  status: text("status").notNull().default("pending"), // pending, running, completed, cancelled
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  winnerId: text("winner_id"), // Which algorithm won
  tradesA: integer("trades_a").notNull().default(0),
  tradesB: integer("trades_b").notNull().default(0),
  pnlA: real("pnl_a").notNull().default(0),
  pnlB: real("pnl_b").notNull().default(0),
  winRateA: real("win_rate_a").default(0),
  winRateB: real("win_rate_b").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Running Strategies - tracks active trading bot sessions
export const runningStrategies = pgTable("running_strategies", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(), // Unique session identifier
  algorithmId: text("algorithm_id").notNull(),
  algorithmName: text("algorithm_name").notNull(),
  algorithmVersion: integer("algorithm_version").notNull().default(1),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  executionMode: text("execution_mode").notNull().default("paper"), // "paper" or "real"
  optimizationMode: text("optimization_mode").notNull().default("manual"), // "manual", "semi-auto", "full-auto"
  status: text("status").notNull().default("running"), // "running", "paused", "stopped", "error"
  totalTrades: integer("total_trades").notNull().default(0),
  successfulTrades: integer("successful_trades").notNull().default(0),
  totalPnl: real("total_pnl").notNull().default(0),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  lastHeartbeat: timestamp("last_heartbeat").notNull().defaultNow(),
  stoppedAt: timestamp("stopped_at"),
  errorMessage: text("error_message"),
});

// Algorithms - persists trading algorithms
export const algorithms = pgTable("algorithms", {
  id: text("id").primaryKey(), // UUID string
  name: text("name").notNull(),
  mode: text("mode").notNull(), // ai-trading, ai-scalping, manual
  symbol: text("symbol").notNull(),
  version: integer("version").notNull().default(1),
  rules: text("rules").notNull(), // JSON string of TradingRule[]
  riskManagement: text("risk_management").notNull(), // JSON string of RiskManagement
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Relations
export const tradesRelations = relations(trades, ({ }) => ({}));
export const dailySummariesRelations = relations(dailySummaries, ({ }) => ({}));
export const algorithmPerformanceRelations = relations(algorithmPerformance, ({ }) => ({}));
export const algorithmVersionsRelations = relations(algorithmVersions, ({ }) => ({}));
export const algorithmsRelations = relations(algorithms, ({ }) => ({}));
export const abTestsRelations = relations(abTests, ({ }) => ({}));
export const notificationsRelations = relations(notifications, ({ }) => ({}));
export const notificationSettingsRelations = relations(notificationSettings, ({ }) => ({}));
export const runningStrategiesRelations = relations(runningStrategies, ({ }) => ({}));

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

export const insertAlgorithmVersionSchema = createInsertSchema(algorithmVersions).omit({ id: true });
export type InsertAlgorithmVersion = z.infer<typeof insertAlgorithmVersionSchema>;
export type AlgorithmVersion = typeof algorithmVersions.$inferSelect;

export const insertAbTestSchema = createInsertSchema(abTests).omit({ id: true });
export type InsertAbTest = z.infer<typeof insertAbTestSchema>;
export type AbTest = typeof abTests.$inferSelect;

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

export const insertNotificationSettingsSchema = createInsertSchema(notificationSettings).omit({ id: true });
export type InsertNotificationSettings = z.infer<typeof insertNotificationSettingsSchema>;
export type NotificationSettings = typeof notificationSettings.$inferSelect;

export const insertRunningStrategySchema = createInsertSchema(runningStrategies).omit({ id: true });
export type InsertRunningStrategy = z.infer<typeof insertRunningStrategySchema>;
export type RunningStrategy = typeof runningStrategies.$inferSelect;

export const insertAlgorithmDbSchema = createInsertSchema(algorithms);
export type InsertAlgorithmDb = z.infer<typeof insertAlgorithmDbSchema>;
export type AlgorithmDb = typeof algorithms.$inferSelect;

// Running strategy status type
export const runningStrategyStatuses = ["running", "paused", "stopped", "error"] as const;
export type RunningStrategyStatus = typeof runningStrategyStatuses[number];

// Notification types for frontend
export const notificationTypes = ["trade_open", "trade_close", "stop_loss", "take_profit", "trailing_stop", "error", "info"] as const;
export type NotificationType = typeof notificationTypes[number];

// ============ EXISTING TYPES (Non-database) ============

// Exchange types
export const exchanges = ["coinstore", "bydfi", "bitunex", "toobit", "bitunix"] as const;
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
export const tradingModes = ["ai-trading", "manual"] as const;
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

// Strategy optimization modes for live trading
export const optimizationModes = ["manual", "semi-auto", "full-auto"] as const;
export type OptimizationMode = typeof optimizationModes[number];

// Optimization suggestion from AI
export interface OptimizationSuggestion {
  id: string;
  timestamp: number;
  type: "parameter" | "rule" | "full";  // What kind of change
  reason: string;                        // Why the AI suggests this
  currentValue?: string;                 // Current parameter/rule
  suggestedValue?: string;               // Suggested change
  suggestedAlgorithm?: TradingAlgorithm; // For full strategy updates
  performanceContext: {
    winRate: number;
    totalPnl: number;
    recentTrades: number;
    drawdown: number;
  };
  status: "pending" | "approved" | "rejected" | "auto-applied";
}

// Live strategy performance metrics
export interface LiveStrategyMetrics {
  algorithmId: string;
  sessionStarted: number;
  tradesExecuted: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  maxDrawdown: number;
  currentDrawdown: number;
  peakPnl: number;
  lastAnalysis: number;
  marketCondition?: "trending" | "ranging" | "volatile" | "quiet";
}

export interface TradeCycleState {
  status: TradeCycleStatus;
  mode: TradingMode;
  executionMode: ExecutionMode;
  optimizationMode: OptimizationMode;
  exchange: Exchange;
  symbol: string;
  startedAt?: number;
  algorithmId?: string;
  sessionId?: string; // Links to running strategies table for tracking
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
