import type { Exchange, Market, Ticker, Kline, Position, Order, ApiCredentials } from "@shared/schema";
import { randomUUID } from "crypto";

// Mock data generators for development/testing
// In production, these would be replaced with actual API calls to Coinstore/BYDFI

const MOCK_MARKETS: Record<Exchange, Market[]> = {
  coinstore: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 6 },
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 5 },
    { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2 },
    { symbol: "BNBUSDT", baseAsset: "BNB", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4 },
    { symbol: "XRPUSDT", baseAsset: "XRP", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1 },
    { symbol: "ADAUSDT", baseAsset: "ADA", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 1 },
    { symbol: "DOGEUSDT", baseAsset: "DOGE", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 0 },
    { symbol: "AVAXUSDT", baseAsset: "AVAX", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2 },
  ],
  bydfi: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 6 },
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 5 },
    { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2 },
  ],
};

interface ExchangeService {
  validateCredentials(credentials: ApiCredentials): Promise<boolean>;
  getMarkets(exchange: Exchange): Promise<Market[]>;
  getTicker(exchange: Exchange, symbol: string): Promise<Ticker>;
  getKlines(exchange: Exchange, symbol: string, timeframe: string, limit?: number): Promise<Kline[]>;
  getPositions(exchange: Exchange, credentials: ApiCredentials): Promise<Position[]>;
  getOrders(exchange: Exchange, credentials: ApiCredentials): Promise<Order[]>;
  placeOrder(exchange: Exchange, credentials: ApiCredentials, order: Partial<Order>): Promise<Order>;
  cancelOrder(exchange: Exchange, credentials: ApiCredentials, orderId: string): Promise<boolean>;
  closePosition(exchange: Exchange, credentials: ApiCredentials, positionId: string): Promise<boolean>;
  closeAllPositions(exchange: Exchange, credentials: ApiCredentials): Promise<boolean>;
}

// Generate realistic mock price based on symbol
function getBasePrice(symbol: string): number {
  const basePrices: Record<string, number> = {
    BTCUSDT: 95000 + Math.random() * 2000,
    ETHUSDT: 3500 + Math.random() * 100,
    SOLUSDT: 180 + Math.random() * 10,
    BNBUSDT: 650 + Math.random() * 20,
    XRPUSDT: 2.1 + Math.random() * 0.1,
    ADAUSDT: 0.85 + Math.random() * 0.05,
    DOGEUSDT: 0.35 + Math.random() * 0.02,
    AVAXUSDT: 45 + Math.random() * 3,
  };
  return basePrices[symbol] || 100 + Math.random() * 10;
}

// Generate mock ticker data
function generateMockTicker(symbol: string): Ticker {
  const basePrice = getBasePrice(symbol);
  const change = (Math.random() - 0.5) * 0.06; // -3% to +3% change
  const priceChange = basePrice * change;
  
  return {
    symbol,
    lastPrice: basePrice,
    priceChange,
    priceChangePercent: change * 100,
    high24h: basePrice * (1 + Math.abs(change) + Math.random() * 0.02),
    low24h: basePrice * (1 - Math.abs(change) - Math.random() * 0.02),
    volume24h: Math.random() * 1000000000,
    timestamp: Date.now(),
  };
}

// Generate mock klines
function generateMockKlines(symbol: string, timeframe: string, limit: number = 100): Kline[] {
  const klines: Kline[] = [];
  let basePrice = getBasePrice(symbol);
  const timeframeMs = getTimeframeMs(timeframe);
  const now = Date.now();

  for (let i = limit; i > 0; i--) {
    const volatility = 0.002 + Math.random() * 0.008; // 0.2% to 1% volatility
    const trend = Math.random() - 0.48; // Slight upward bias
    
    const open = basePrice;
    const change = basePrice * volatility * trend;
    const close = open + change;
    const high = Math.max(open, close) * (1 + Math.random() * volatility);
    const low = Math.min(open, close) * (1 - Math.random() * volatility);
    
    klines.push({
      time: now - (i * timeframeMs),
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)),
      close: parseFloat(close.toFixed(4)),
      volume: Math.random() * 10000,
    });

    basePrice = close;
  }

  return klines;
}

function getTimeframeMs(timeframe: string): number {
  const multipliers: Record<string, number> = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
  };
  return multipliers[timeframe] || 60 * 1000;
}

// Mock exchange service implementation
export const exchangeService: ExchangeService = {
  async validateCredentials(credentials: ApiCredentials): Promise<boolean> {
    // Simulate API validation - in production, make actual API call
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
    
    // Basic validation - require non-empty keys
    if (!credentials.apiKey || !credentials.secretKey) {
      return false;
    }
    
    // Simulate occasional auth failure for testing
    if (credentials.apiKey.startsWith("invalid")) {
      return false;
    }
    
    return true;
  },

  async getMarkets(exchange: Exchange): Promise<Market[]> {
    await new Promise(resolve => setTimeout(resolve, 200));
    return MOCK_MARKETS[exchange] || [];
  },

  async getTicker(exchange: Exchange, symbol: string): Promise<Ticker> {
    await new Promise(resolve => setTimeout(resolve, 50));
    return generateMockTicker(symbol);
  },

  async getKlines(exchange: Exchange, symbol: string, timeframe: string, limit: number = 100): Promise<Kline[]> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return generateMockKlines(symbol, timeframe, limit);
  },

  async getPositions(exchange: Exchange, credentials: ApiCredentials): Promise<Position[]> {
    await new Promise(resolve => setTimeout(resolve, 100));
    // Return empty array - positions would come from actual exchange
    return [];
  },

  async getOrders(exchange: Exchange, credentials: ApiCredentials): Promise<Order[]> {
    await new Promise(resolve => setTimeout(resolve, 100));
    // Return empty array - orders would come from actual exchange
    return [];
  },

  async placeOrder(exchange: Exchange, credentials: ApiCredentials, orderParams: Partial<Order>): Promise<Order> {
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Simulate order creation
    const order: Order = {
      id: randomUUID(),
      symbol: orderParams.symbol || "BTCUSDT",
      type: orderParams.type || "market",
      side: orderParams.side || "buy",
      price: orderParams.price || getBasePrice(orderParams.symbol || "BTCUSDT"),
      quantity: orderParams.quantity || 0.001,
      filledQuantity: orderParams.type === "market" ? (orderParams.quantity || 0.001) : 0,
      status: orderParams.type === "market" ? "filled" : "pending",
      timestamp: Date.now(),
    };

    return order;
  },

  async cancelOrder(exchange: Exchange, credentials: ApiCredentials, orderId: string): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 100));
    return true;
  },

  async closePosition(exchange: Exchange, credentials: ApiCredentials, positionId: string): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 200));
    return true;
  },

  async closeAllPositions(exchange: Exchange, credentials: ApiCredentials): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 500));
    return true;
  },
};

// Function to continuously update ticker data (for WebSocket simulation)
export function createTickerStream(
  symbol: string,
  callback: (ticker: Ticker) => void,
  intervalMs: number = 1000
): { stop: () => void } {
  let lastPrice = getBasePrice(symbol);
  
  const interval = setInterval(() => {
    const change = (Math.random() - 0.5) * 0.002; // Small random change
    lastPrice = lastPrice * (1 + change);
    
    const ticker: Ticker = {
      symbol,
      lastPrice,
      priceChange: lastPrice * change,
      priceChangePercent: change * 100,
      high24h: lastPrice * 1.02,
      low24h: lastPrice * 0.98,
      volume24h: Math.random() * 1000000000,
      timestamp: Date.now(),
    };
    
    callback(ticker);
  }, intervalMs);

  return {
    stop: () => clearInterval(interval),
  };
}
