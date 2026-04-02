// Dynamic workflow schema for agent-based trading system

export enum AgentRole {
  Manager = 'Manager',
  Market = 'Market',
  Risk = 'Risk',
  Execution = 'Execution',
}

export type AgentMessageType =
  | 'REQUEST_MARKET_DATA'
  | 'RESPONSE_MARKET_DATA'
  | 'REQUEST_TRADE_VALIDATION'
  | 'RESPONSE_TRADE_VALIDATION'
  | 'REQUEST_EXECUTE_TRADE'
  | 'RESPONSE_EXECUTE_TRADE'
  | 'NOTIFY'
  | 'ERROR';

export interface AgentMessage {
  id: string;
  from: AgentRole;
  to: AgentRole;
  type: AgentMessageType;
  payload: any;
  timestamp: number;
}

export interface TradeRequest {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  leverage?: number;
  userId: string;
  exchange: string; // Added for agent workflow
  // Optional agent/orchestrator fields
  executionMode?: 'paper' | 'real';
  timeframe?: string;
  objective?: string;
  algorithm?: any;
  autoApprove?: boolean;
  tradingMode?: string;
}

export interface TradeValidation {
  valid: boolean;
  reason?: string;
  riskReport?: any;
}

export interface ExecutionResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

export interface MarketData {
  symbol: string;
  price: number;
  orderbook?: any;
  indicators?: any;
}
