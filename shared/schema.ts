import { z } from "zod";

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

// Position schema
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
}

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
