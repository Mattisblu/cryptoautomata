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

// Live Positions - persists active trading positions across restarts
export const livePositions = pgTable("live_positions", {
  id: text("id").primaryKey(), // Position ID from exchange or generated
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "long" or "short"
  entryPrice: real("entry_price").notNull(),
  markPrice: real("mark_price").notNull(),
  quantity: real("quantity").notNull(),
  leverage: integer("leverage").notNull().default(1),
  marginType: text("margin_type").notNull().default("isolated"), // "isolated" or "cross"
  unrealizedPnl: real("unrealized_pnl").notNull().default(0),
  unrealizedPnlPercent: real("unrealized_pnl_percent").notNull().default(0),
  liquidationPrice: real("liquidation_price").notNull().default(0),
  stopLossPrice: real("stop_loss_price"),
  takeProfitPrice: real("take_profit_price"),
  trailingStopDistance: real("trailing_stop_distance"),
  stopOrderId: text("stop_order_id"),
  takeProfitOrderId: text("take_profit_order_id"),
  trailingStopOrderId: text("trailing_stop_order_id"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Live Orders - persists active orders across restarts
export const liveOrders = pgTable("live_orders", {
  id: text("id").primaryKey(), // Order ID from exchange or generated
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull(), // "market", "limit", "stop_market", "stop_limit"
  side: text("side").notNull(), // "buy" or "sell"
  price: real("price").notNull(),
  quantity: real("quantity").notNull(),
  filledQuantity: real("filled_quantity").notNull().default(0),
  status: text("status").notNull().default("pending"), // "pending", "partial", "filled", "cancelled"
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Live Stop Orders - persists stop loss/take profit/trailing stop orders across restarts
export const liveStopOrders = pgTable("live_stop_orders", {
  id: text("id").primaryKey(), // Stop order ID
  exchange: text("exchange").notNull(),
  positionId: text("position_id").notNull(),
  type: text("type").notNull(), // "stop_loss", "take_profit", "trailing_stop"
  triggerPrice: real("trigger_price").notNull(),
  quantity: real("quantity").notNull(),
  status: text("status").notNull().default("active"), // "active", "triggered", "cancelled"
  highestPrice: real("highest_price"), // For trailing stop on long positions
  lowestPrice: real("lowest_price"), // For trailing stop on short positions
  trailingDistance: real("trailing_distance"), // Percentage for trailing stop
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============ POSITION BROKER TABLES ============
// These tables enable shadow position tracking when exchanges (like Bitunix) 
// aggregate multiple trades into a single combined position

// Logical Positions - tracks individual trade intents separate from exchange's aggregated view
export const logicalPositions = pgTable("logical_positions", {
  id: text("id").primaryKey(), // Unique logical position ID (UUID)
  sessionId: text("session_id").notNull(), // Strategy session that owns this position
  algorithmId: text("algorithm_id").notNull(), // Algorithm that created this position
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "long" or "short"
  entryPrice: real("entry_price").notNull(), // Average entry price for this logical position
  quantity: real("quantity").notNull(), // Size of this logical position
  remainingQuantity: real("remaining_quantity").notNull(), // How much is still open
  leverage: integer("leverage").notNull().default(1),
  allocatedMargin: real("allocated_margin").notNull(), // Margin assigned to this position
  stopLossPercent: real("stop_loss_percent"), // ROI-based SL target
  takeProfitPercent: real("take_profit_percent"), // ROI-based TP target
  trailingStopPercent: real("trailing_stop_percent"), // ROI-based trailing stop
  status: text("status").notNull().default("open"), // "open", "partial", "closed", "liquidated"
  realizedPnl: real("realized_pnl").notNull().default(0),
  fees: real("fees").notNull().default(0),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  closeReason: text("close_reason"), // "manual", "stop_loss", "take_profit", "trailing_stop", "liquidation"
  exchangePositionId: text("exchange_position_id"), // Reference to exchange's aggregated position
});

// Fills - tracks individual order fills that contribute to logical positions
export const fills = pgTable("fills", {
  id: serial("id").primaryKey(),
  logicalPositionId: text("logical_position_id").notNull(), // Parent logical position
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  orderId: text("order_id"), // Exchange order ID if available
  side: text("side").notNull(), // "buy" or "sell"
  fillType: text("fill_type").notNull(), // "entry" or "exit"
  price: real("price").notNull(),
  quantity: real("quantity").notNull(),
  fee: real("fee").notNull().default(0),
  feeAsset: text("fee_asset"), // Asset the fee was paid in
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Position Reconciliation - snapshots for comparing local vs exchange state
export const positionReconciliation = pgTable("position_reconciliation", {
  id: serial("id").primaryKey(),
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  // Local aggregate (sum of logical positions)
  localQuantity: real("local_quantity").notNull(),
  localAvgEntryPrice: real("local_avg_entry_price").notNull(),
  localSide: text("local_side"), // "long", "short", or null if flat
  // Exchange reported position
  exchangeQuantity: real("exchange_quantity").notNull(),
  exchangeAvgEntryPrice: real("exchange_avg_entry_price").notNull(),
  exchangeSide: text("exchange_side"), // "long", "short", or null if flat
  // Drift detection
  quantityDrift: real("quantity_drift").notNull().default(0), // exchange - local
  priceDrift: real("price_drift").notNull().default(0), // exchange - local
  hasDrift: boolean("has_drift").notNull().default(false),
  driftResolved: boolean("drift_resolved").notNull().default(false),
  resolutionNote: text("resolution_note"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Relations
export const tradesRelations = relations(trades, ({ }) => ({}));
export const dailySummariesRelations = relations(dailySummaries, ({ }) => ({}));
export const algorithmPerformanceRelations = relations(algorithmPerformance, ({ }) => ({}));
export const algorithmVersionsRelations = relations(algorithmVersions, ({ }) => ({}));
export const livePositionsRelations = relations(livePositions, ({ }) => ({}));
export const liveOrdersRelations = relations(liveOrders, ({ }) => ({}));
export const liveStopOrdersRelations = relations(liveStopOrders, ({ }) => ({}));
export const algorithmsRelations = relations(algorithms, ({ }) => ({}));
export const abTestsRelations = relations(abTests, ({ }) => ({}));
export const notificationsRelations = relations(notifications, ({ }) => ({}));
export const notificationSettingsRelations = relations(notificationSettings, ({ }) => ({}));
export const runningStrategiesRelations = relations(runningStrategies, ({ }) => ({}));
export const logicalPositionsRelations = relations(logicalPositions, ({ }) => ({}));
export const fillsRelations = relations(fills, ({ }) => ({}));
export const positionReconciliationRelations = relations(positionReconciliation, ({ }) => ({}));

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

// Position Broker insert schemas
export const insertLogicalPositionSchema = createInsertSchema(logicalPositions);
export type InsertLogicalPosition = z.infer<typeof insertLogicalPositionSchema>;
export type LogicalPosition = typeof logicalPositions.$inferSelect;

export const insertFillSchema = createInsertSchema(fills).omit({ id: true });
export type InsertFill = z.infer<typeof insertFillSchema>;
export type Fill = typeof fills.$inferSelect;

export const insertPositionReconciliationSchema = createInsertSchema(positionReconciliation).omit({ id: true });
export type InsertPositionReconciliation = z.infer<typeof insertPositionReconciliationSchema>;
export type PositionReconciliation = typeof positionReconciliation.$inferSelect;

// Logical position statuses
export const logicalPositionStatuses = ["open", "partial", "closed", "liquidated"] as const;
export type LogicalPositionStatus = typeof logicalPositionStatuses[number];

// Running strategy status type
export const runningStrategyStatuses = ["running", "paused", "stopped", "error"] as const;
export type RunningStrategyStatus = typeof runningStrategyStatuses[number];

// Notification types for frontend
export const notificationTypes = ["trade_open", "trade_close", "stop_loss", "take_profit", "trailing_stop", "error", "info"] as const;
export type NotificationType = typeof notificationTypes[number];

// ============ EXISTING TYPES (Non-database) ============

// Exchange types
export const exchanges = ["coinstore", "bydfi", "toobit", "bitunix"] as const;
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

export interface VolatilityGuardConfig {
  enabled: boolean;
  shortWindow: number;         // Short ATR/sigma window (default: 5 bars)
  longWindow: number;          // Long baseline window (default: 30 bars)
  atrMultiplier: number;       // ATR ratio threshold to trigger (default: 3.0)
  sigmaMultiplier: number;     // Sigma ratio threshold (default: 2.5)
  wickRatioThreshold: number;  // Max wick ratio before trigger (default: 0.6)
  barPersistence: number;      // Bars to sustain before action (default: 2)
  cooldownMs: number;          // Cooldown after trigger (default: 60000)
}

export const defaultVolatilityGuardConfig: VolatilityGuardConfig = {
  enabled: false,
  shortWindow: 5,
  longWindow: 30,
  atrMultiplier: 3.0,
  sigmaMultiplier: 2.5,
  wickRatioThreshold: 0.6,
  barPersistence: 2,
  cooldownMs: 60000,
};

// Asset Guard Rule - Portfolio-level rule for margin reallocation
export interface AssetGuardRule {
  enabled: boolean;
  assetThreshold: number;       // Trigger when available assets fall below this (e.g., $5)
  sellFraction: number;         // Fraction of margin to sell (e.g., 0.33 for 33%)
  cooldownMs: number;           // Cooldown between triggers (default: 60000ms)
  lastTriggered?: number;       // Timestamp of last trigger (runtime state)
}

export const defaultAssetGuardRule: AssetGuardRule = {
  enabled: false,
  assetThreshold: 5,            // Default: $5
  sellFraction: 0.33,           // Default: 33%
  cooldownMs: 60000,            // Default: 1 minute cooldown
};

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
  // Frequency controls (null = disabled)
  tradeCooldownSeconds?: number | null;    // Wait time after closing before next entry
  maxTradesPerHour?: number | null;        // Hard cap on trades per hour
  minHoldTimeSeconds?: number | null;      // Minimum time to hold a position
  maxConcurrentPositions?: number | null;  // Limit open positions at once
  // Volatility protection
  volatilityGuard?: VolatilityGuardConfig;
  // Asset guard for margin reallocation
  assetGuard?: AssetGuardRule;
}

// Volatility guard schema for UI
export const volatilityGuardSchema = z.object({
  enabled: z.boolean().default(false),
  shortWindow: z.number().min(2).max(20).default(5),
  longWindow: z.number().min(10).max(100).default(30),
  atrMultiplier: z.number().min(1.5).max(10).default(3.0),
  sigmaMultiplier: z.number().min(1.5).max(10).default(2.5),
  wickRatioThreshold: z.number().min(0.3).max(0.9).default(0.6),
  barPersistence: z.number().min(1).max(10).default(2),
  cooldownMs: z.number().min(10000).max(600000).default(60000),
});

// Asset guard schema for AI-parsed portfolio rules
export const assetGuardSchema = z.object({
  enabled: z.boolean().default(false),
  assetThreshold: z.number().min(0.1).max(10000).default(5),
  sellFraction: z.number().min(0.1).max(0.9).default(0.33),
  cooldownMs: z.number().min(10000).max(600000).default(60000),
});

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
  // Frequency controls - null means disabled
  tradeCooldownSeconds: z.number().min(5).max(3600).nullable().optional(),
  maxTradesPerHour: z.number().min(1).max(100).nullable().optional(),
  minHoldTimeSeconds: z.number().min(5).max(3600).nullable().optional(),
  maxConcurrentPositions: z.number().min(1).max(10).nullable().optional(),
  // Volatility protection
  volatilityGuard: volatilityGuardSchema.optional(),
  // Asset guard for margin reallocation
  assetGuard: assetGuardSchema.optional(),
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
  type: "order" | "position" | "algorithm" | "signal" | "error" | "warning";
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
