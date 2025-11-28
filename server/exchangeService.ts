import type { Exchange, Market, Ticker, Kline, Position, Order, ApiCredentials } from "@shared/schema";
import { randomUUID } from "crypto";

// Exchange-specific configurations
const EXCHANGE_CONFIG: Record<Exchange, {
  name: string;
  maxLeverage: number;
  makerFee: number;
  takerFee: number;
  minOrderSize: Record<string, number>;
  priceVolatility: number;
}> = {
  coinstore: {
    name: "Coinstore",
    maxLeverage: 100,
    makerFee: 0.0002,
    takerFee: 0.0004,
    minOrderSize: {
      BTCUSDT: 0.001,
      ETHUSDT: 0.01,
      SOLUSDT: 0.1,
      BNBUSDT: 0.01,
      XRPUSDT: 10,
      ADAUSDT: 10,
      DOGEUSDT: 100,
      AVAXUSDT: 0.1,
    },
    priceVolatility: 0.003,
  },
  bydfi: {
    name: "BYDFI",
    maxLeverage: 125,
    makerFee: 0.0001,
    takerFee: 0.0003,
    minOrderSize: {
      BTCUSDT: 0.0001,
      ETHUSDT: 0.001,
      SOLUSDT: 0.01,
      BNBUSDT: 0.001,
      XRPUSDT: 1,
      ADAUSDT: 1,
      DOGEUSDT: 10,
      LINKUSDT: 0.1,
      MATICUSDT: 1,
      ARBUSDT: 0.1,
      OPUSDT: 0.1,
      APTUSDT: 0.01,
    },
    priceVolatility: 0.004,
  },
};

// Comprehensive market listings per exchange
const MOCK_MARKETS: Record<Exchange, Market[]> = {
  coinstore: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 6, maxLeverage: 100 },
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 5, maxLeverage: 75 },
    { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2, maxLeverage: 50 },
    { symbol: "BNBUSDT", baseAsset: "BNB", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, maxLeverage: 50 },
    { symbol: "XRPUSDT", baseAsset: "XRP", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1, maxLeverage: 50 },
    { symbol: "ADAUSDT", baseAsset: "ADA", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 1, maxLeverage: 25 },
    { symbol: "DOGEUSDT", baseAsset: "DOGE", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 0, maxLeverage: 25 },
    { symbol: "AVAXUSDT", baseAsset: "AVAX", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2, maxLeverage: 25 },
  ],
  bydfi: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 1, quantityPrecision: 4, maxLeverage: 125 },
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, maxLeverage: 100 },
    { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 2, maxLeverage: 75 },
    { symbol: "BNBUSDT", baseAsset: "BNB", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 3, maxLeverage: 75 },
    { symbol: "XRPUSDT", baseAsset: "XRP", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 0, maxLeverage: 75 },
    { symbol: "ADAUSDT", baseAsset: "ADA", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 0, maxLeverage: 50 },
    { symbol: "DOGEUSDT", baseAsset: "DOGE", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 0, maxLeverage: 50 },
    { symbol: "LINKUSDT", baseAsset: "LINK", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2, maxLeverage: 50 },
    { symbol: "MATICUSDT", baseAsset: "MATIC", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 0, maxLeverage: 50 },
    { symbol: "ARBUSDT", baseAsset: "ARB", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1, maxLeverage: 25 },
    { symbol: "OPUSDT", baseAsset: "OP", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1, maxLeverage: 25 },
    { symbol: "APTUSDT", baseAsset: "APT", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2, maxLeverage: 25 },
  ],
};

// Price cache to maintain consistency across calls
const priceCache: Map<string, { price: number; lastUpdate: number }> = new Map();

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
  getExchangeInfo(exchange: Exchange): typeof EXCHANGE_CONFIG[Exchange];
}

// Base prices for all supported assets
const BASE_PRICES: Record<string, number> = {
  BTCUSDT: 95000,
  ETHUSDT: 3500,
  SOLUSDT: 180,
  BNBUSDT: 650,
  XRPUSDT: 2.1,
  ADAUSDT: 0.85,
  DOGEUSDT: 0.35,
  AVAXUSDT: 45,
  LINKUSDT: 14.5,
  MATICUSDT: 0.52,
  ARBUSDT: 0.95,
  OPUSDT: 1.85,
  APTUSDT: 9.2,
};

// Get current price with realistic movement
function getCurrentPrice(exchange: Exchange, symbol: string): number {
  const cacheKey = `${exchange}:${symbol}`;
  const cached = priceCache.get(cacheKey);
  const config = EXCHANGE_CONFIG[exchange];
  const basePrice = BASE_PRICES[symbol] || 100;
  
  if (cached && Date.now() - cached.lastUpdate < 1000) {
    return cached.price;
  }
  
  // Apply small random movement from last price or base price
  const lastPrice = cached?.price || basePrice;
  const volatility = config.priceVolatility;
  const change = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = lastPrice * (1 + change);
  
  // Ensure price stays within reasonable bounds (80% to 120% of base)
  const clampedPrice = Math.max(basePrice * 0.8, Math.min(basePrice * 1.2, newPrice));
  
  priceCache.set(cacheKey, { price: clampedPrice, lastUpdate: Date.now() });
  return clampedPrice;
}

// Generate mock ticker data with exchange-specific characteristics
function generateMockTicker(exchange: Exchange, symbol: string): Ticker {
  const currentPrice = getCurrentPrice(exchange, symbol);
  const basePrice = BASE_PRICES[symbol] || 100;
  const change = (currentPrice - basePrice) / basePrice;
  
  // BYDFI tends to have higher volume
  const volumeMultiplier = exchange === "bydfi" ? 1.5 : 1.0;
  
  return {
    symbol,
    lastPrice: currentPrice,
    priceChange: currentPrice - basePrice,
    priceChangePercent: change * 100,
    high24h: currentPrice * (1 + Math.abs(change) + Math.random() * 0.015),
    low24h: currentPrice * (1 - Math.abs(change) - Math.random() * 0.015),
    volume24h: (Math.random() * 500000000 + 100000000) * volumeMultiplier,
    timestamp: Date.now(),
  };
}

// Generate mock klines with exchange-specific volatility
function generateMockKlines(exchange: Exchange, symbol: string, timeframe: string, limit: number = 100): Kline[] {
  const klines: Kline[] = [];
  const config = EXCHANGE_CONFIG[exchange];
  const timeframeMs = getTimeframeMs(timeframe);
  const now = Date.now();
  
  // Start from a base price and work forward
  let price = (BASE_PRICES[symbol] || 100) * (0.95 + Math.random() * 0.1);

  for (let i = limit; i > 0; i--) {
    const volatility = config.priceVolatility + Math.random() * 0.005;
    const trend = Math.random() - 0.48; // Slight upward bias
    
    const open = price;
    const changePercent = volatility * trend;
    const close = open * (1 + changePercent);
    const high = Math.max(open, close) * (1 + Math.random() * volatility);
    const low = Math.min(open, close) * (1 - Math.random() * volatility);
    
    // Get precision for this market
    const market = MOCK_MARKETS[exchange]?.find(m => m.symbol === symbol);
    const precision = market?.pricePrecision || 4;
    
    klines.push({
      time: now - (i * timeframeMs),
      open: parseFloat(open.toFixed(precision)),
      high: parseFloat(high.toFixed(precision)),
      low: parseFloat(low.toFixed(precision)),
      close: parseFloat(close.toFixed(precision)),
      volume: Math.random() * 10000 * (exchange === "bydfi" ? 1.5 : 1.0),
    });

    price = close;
  }

  return klines;
}

function getTimeframeMs(timeframe: string): number {
  const multipliers: Record<string, number> = {
    "1m": 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
  };
  return multipliers[timeframe] || 60 * 1000;
}

// In-memory order and position storage for simulation
const simulatedOrders: Map<string, Order[]> = new Map();
const simulatedPositions: Map<string, Position[]> = new Map();

function getStorageKey(exchange: Exchange, apiKey: string): string {
  return `${exchange}:${apiKey.slice(0, 8)}`;
}

// Exchange service implementation
export const exchangeService: ExchangeService = {
  async validateCredentials(credentials: ApiCredentials): Promise<boolean> {
    // Simulate exchange-specific validation time
    const delay = credentials.exchange === "bydfi" ? 300 : 500;
    await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 200));
    
    if (!credentials.apiKey || !credentials.secretKey) {
      return false;
    }
    
    // BYDFI requires passphrase
    if (credentials.exchange === "bydfi" && !credentials.passphrase) {
      console.log("BYDFI requires passphrase for authentication");
      // Still allow for development, but log warning
    }
    
    if (credentials.apiKey.startsWith("invalid")) {
      return false;
    }
    
    return true;
  },

  async getMarkets(exchange: Exchange): Promise<Market[]> {
    // BYDFI has faster API response
    const delay = exchange === "bydfi" ? 100 : 200;
    await new Promise(resolve => setTimeout(resolve, delay));
    return MOCK_MARKETS[exchange] || [];
  },

  async getTicker(exchange: Exchange, symbol: string): Promise<Ticker> {
    await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 30));
    return generateMockTicker(exchange, symbol);
  },

  async getKlines(exchange: Exchange, symbol: string, timeframe: string, limit: number = 100): Promise<Kline[]> {
    await new Promise(resolve => setTimeout(resolve, 80 + Math.random() * 50));
    return generateMockKlines(exchange, symbol, timeframe, limit);
  },

  async getPositions(exchange: Exchange, credentials: ApiCredentials): Promise<Position[]> {
    await new Promise(resolve => setTimeout(resolve, 50));
    const key = getStorageKey(exchange, credentials.apiKey);
    return simulatedPositions.get(key) || [];
  },

  async getOrders(exchange: Exchange, credentials: ApiCredentials): Promise<Order[]> {
    await new Promise(resolve => setTimeout(resolve, 50));
    const key = getStorageKey(exchange, credentials.apiKey);
    return simulatedOrders.get(key) || [];
  },

  async placeOrder(exchange: Exchange, credentials: ApiCredentials, orderParams: Partial<Order>): Promise<Order> {
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
    
    const config = EXCHANGE_CONFIG[exchange];
    const symbol = orderParams.symbol || "BTCUSDT";
    const currentPrice = getCurrentPrice(exchange, symbol);
    const market = MOCK_MARKETS[exchange]?.find(m => m.symbol === symbol);
    
    // Apply exchange-specific fees
    const fee = orderParams.type === "market" ? config.takerFee : config.makerFee;
    
    const order: Order = {
      id: randomUUID(),
      symbol,
      type: orderParams.type || "market",
      side: orderParams.side || "buy",
      price: orderParams.type === "limit" 
        ? (orderParams.price || currentPrice) 
        : currentPrice,
      quantity: orderParams.quantity || config.minOrderSize[symbol] || 0.001,
      filledQuantity: orderParams.type === "market" ? (orderParams.quantity || 0.001) : 0,
      status: orderParams.type === "market" ? "filled" : "pending",
      timestamp: Date.now(),
    };

    // Store the order
    const key = getStorageKey(exchange, credentials.apiKey);
    const orders = simulatedOrders.get(key) || [];
    orders.push(order);
    simulatedOrders.set(key, orders);

    // If market order filled, create/update position
    if (order.status === "filled") {
      const positions = simulatedPositions.get(key) || [];
      const existingPosition = positions.find(p => p.symbol === symbol);
      
      if (existingPosition) {
        // Update existing position
        if ((existingPosition.side === "long" && order.side === "buy") ||
            (existingPosition.side === "short" && order.side === "sell")) {
          // Adding to position
          const totalQuantity = existingPosition.quantity + order.quantity;
          const avgPrice = (existingPosition.entryPrice * existingPosition.quantity + 
                          order.price * order.quantity) / totalQuantity;
          existingPosition.quantity = totalQuantity;
          existingPosition.entryPrice = avgPrice;
        } else {
          // Reducing/closing position
          existingPosition.quantity -= order.quantity;
          if (existingPosition.quantity <= 0) {
            const idx = positions.indexOf(existingPosition);
            positions.splice(idx, 1);
          }
        }
      } else {
        // Create new position
        const leverage = 10; // Default leverage
        const position: Position = {
          id: randomUUID(),
          symbol,
          side: order.side === "buy" ? "long" : "short",
          entryPrice: order.price,
          markPrice: order.price,
          quantity: order.quantity,
          leverage,
          marginType: "isolated",
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          liquidationPrice: order.side === "buy" 
            ? order.price * (1 - 1/leverage * 0.9)
            : order.price * (1 + 1/leverage * 0.9),
          timestamp: Date.now(),
        };
        positions.push(position);
      }
      
      simulatedPositions.set(key, positions);
    }

    return order;
  },

  async cancelOrder(exchange: Exchange, credentials: ApiCredentials, orderId: string): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 80));
    
    const key = getStorageKey(exchange, credentials.apiKey);
    const orders = simulatedOrders.get(key) || [];
    const order = orders.find(o => o.id === orderId);
    
    if (order && order.status === "pending") {
      order.status = "cancelled";
      return true;
    }
    
    return false;
  },

  async closePosition(exchange: Exchange, credentials: ApiCredentials, positionId: string): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const key = getStorageKey(exchange, credentials.apiKey);
    const positions = simulatedPositions.get(key) || [];
    const idx = positions.findIndex(p => p.id === positionId);
    
    if (idx >= 0) {
      const position = positions[idx];
      
      // Create closing order
      const closingOrder: Order = {
        id: randomUUID(),
        symbol: position.symbol,
        type: "market",
        side: position.side === "long" ? "sell" : "buy",
        price: getCurrentPrice(exchange, position.symbol),
        quantity: position.quantity,
        filledQuantity: position.quantity,
        status: "filled",
        timestamp: Date.now(),
      };
      
      const orders = simulatedOrders.get(key) || [];
      orders.push(closingOrder);
      simulatedOrders.set(key, orders);
      
      positions.splice(idx, 1);
      simulatedPositions.set(key, positions);
      
      return true;
    }
    
    return false;
  },

  async closeAllPositions(exchange: Exchange, credentials: ApiCredentials): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const key = getStorageKey(exchange, credentials.apiKey);
    const positions = simulatedPositions.get(key) || [];
    
    for (const position of positions) {
      await this.closePosition(exchange, credentials, position.id);
    }
    
    return true;
  },
  
  getExchangeInfo(exchange: Exchange) {
    return EXCHANGE_CONFIG[exchange];
  },
};

// Function to continuously update ticker data (for WebSocket simulation)
export function createTickerStream(
  exchange: Exchange,
  symbol: string,
  callback: (ticker: Ticker) => void,
  intervalMs: number = 1000
): { stop: () => void } {
  const interval = setInterval(() => {
    const ticker = generateMockTicker(exchange, symbol);
    callback(ticker);
  }, intervalMs);

  return {
    stop: () => clearInterval(interval),
  };
}

// Function to update positions with current prices
export function updatePositionPrices(exchange: Exchange, credentials: ApiCredentials): void {
  const key = getStorageKey(exchange, credentials.apiKey);
  const positions = simulatedPositions.get(key) || [];
  
  for (const position of positions) {
    const currentPrice = getCurrentPrice(exchange, position.symbol);
    position.markPrice = currentPrice;
    
    if (position.side === "long") {
      position.unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity * position.leverage;
      position.unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100 * position.leverage;
    } else {
      position.unrealizedPnl = (position.entryPrice - currentPrice) * position.quantity * position.leverage;
      position.unrealizedPnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100 * position.leverage;
    }
  }
  
  simulatedPositions.set(key, positions);
}
