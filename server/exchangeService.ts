import type { Exchange, Market, Ticker, Kline, Position, Order, ApiCredentials } from "@shared/schema";
import { randomUUID } from "crypto";
import { getCoinstoreContracts, getCoinstoreTicker, getCoinstoreKlines, validateCoinstoreCredentials } from "./coinstoreApi";
import { getBydfiMarkets, getBydfiTicker, getBydfiKlines, validateBydfiCredentials } from "./bydfiApi";
import { 
  getBitunixMarkets, 
  getBitunixTicker, 
  getBitunixKlines, 
  validateBitunixCredentials,
  placeBitunixOrder,
  setBitunixLeverage,
  getBitunixPositions,
  cancelBitunixOrder,
  closeBitunixPosition,
  type PlaceOrderParams,
  type BitunixPosition,
} from "./bitunixApi";
import { getToobitMarkets, getToobitTicker, getToobitKlines, validateToobitCredentials } from "./toobitApi";

// Flag to enable/disable live API (can be controlled via environment)
const USE_LIVE_API = process.env.USE_LIVE_API !== "false";

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
  bitunix: {
    name: "Bitunix",
    maxLeverage: 125,
    makerFee: 0.0002,
    takerFee: 0.0006,
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
    priceVolatility: 0.0035,
  },
  toobit: {
    name: "Toobit",
    maxLeverage: 150,
    makerFee: 0.00015,
    takerFee: 0.00035,
    minOrderSize: {
      BTCUSDT: 0.00005,
      ETHUSDT: 0.0005,
      SOLUSDT: 0.005,
      BNBUSDT: 0.0005,
      XRPUSDT: 0.1,
      ADAUSDT: 0.1,
      DOGEUSDT: 1,
      LINKUSDT: 0.01,
      MATICUSDT: 0.1,
      ARBUSDT: 0.01,
      OPUSDT: 0.01,
      APTUSDT: 0.001,
    },
    priceVolatility: 0.005,
  },
};

// Fallback market listings (used when live API is unavailable)
const FALLBACK_MARKETS: Record<Exchange, Market[]> = {
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
  bitunix: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 6, maxLeverage: 125 },
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 5, maxLeverage: 100 },
    { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2, maxLeverage: 75 },
    { symbol: "BNBUSDT", baseAsset: "BNB", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, maxLeverage: 75 },
    { symbol: "XRPUSDT", baseAsset: "XRP", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1, maxLeverage: 75 },
    { symbol: "ADAUSDT", baseAsset: "ADA", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 1, maxLeverage: 50 },
    { symbol: "DOGEUSDT", baseAsset: "DOGE", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 0, maxLeverage: 50 },
    { symbol: "AVAXUSDT", baseAsset: "AVAX", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2, maxLeverage: 50 },
  ],
  toobit: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 1, quantityPrecision: 5, maxLeverage: 150 },
    { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, maxLeverage: 125 },
    { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 2, maxLeverage: 100 },
    { symbol: "BNBUSDT", baseAsset: "BNB", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, maxLeverage: 100 },
    { symbol: "XRPUSDT", baseAsset: "XRP", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1, maxLeverage: 100 },
    { symbol: "ADAUSDT", baseAsset: "ADA", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 1, maxLeverage: 75 },
    { symbol: "DOGEUSDT", baseAsset: "DOGE", quoteAsset: "USDT", pricePrecision: 5, quantityPrecision: 0, maxLeverage: 75 },
    { symbol: "LINKUSDT", baseAsset: "LINK", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2, maxLeverage: 75 },
    { symbol: "MATICUSDT", baseAsset: "MATIC", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1, maxLeverage: 75 },
    { symbol: "ARBUSDT", baseAsset: "ARB", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1, maxLeverage: 50 },
    { symbol: "OPUSDT", baseAsset: "OP", quoteAsset: "USDT", pricePrecision: 4, quantityPrecision: 1, maxLeverage: 50 },
    { symbol: "APTUSDT", baseAsset: "APT", quoteAsset: "USDT", pricePrecision: 3, quantityPrecision: 2, maxLeverage: 50 },
  ],
};

// Cache for markets from live API
const marketsCache: Map<Exchange, { markets: Market[]; timestamp: number }> = new Map();
const MARKETS_CACHE_TTL = 300000; // 5 minutes

// Price cache to maintain consistency across calls
const priceCache: Map<string, { price: number; lastUpdate: number }> = new Map();

// ============ RATE LIMITING & TICKER CACHING ============

// Ticker result cache - prevents duplicate API calls for same symbol within TTL
const tickerResultCache: Map<string, { result: TickerResult; timestamp: number }> = new Map();
const TICKER_CACHE_TTL = 2000; // 2 seconds - prevents rapid duplicate calls

// Klines result cache - prevents duplicate API calls for same symbol/timeframe within TTL  
const klinesResultCache: Map<string, { result: KlinesResult; timestamp: number }> = new Map();
const KLINES_CACHE_TTL = 2000; // 2 seconds - faster refresh for real-time updates

// Per-exchange rate limiter - tracks last request time and enforces minimum delay
const exchangeRateLimits: Map<Exchange, { lastRequest: number; requestQueue: Promise<void> }> = new Map();
const MIN_REQUEST_DELAY_MS = 200; // Minimum 200ms between requests per exchange

// Rate limit error tracking - if we hit rate limits, back off
const rateLimitBackoff: Map<Exchange, { until: number; delay: number }> = new Map();
const INITIAL_BACKOFF_MS = 5000; // 5 seconds initial backoff
const MAX_BACKOFF_MS = 60000; // Max 60 seconds backoff

async function waitForRateLimit(exchange: Exchange): Promise<void> {
  // Check if we're in backoff mode due to rate limit error
  const backoff = rateLimitBackoff.get(exchange);
  if (backoff && Date.now() < backoff.until) {
    const waitTime = backoff.until - Date.now();
    console.log(`[${exchange.toUpperCase()}] Rate limit backoff: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  // Get or create limiter for this exchange
  let limiter = exchangeRateLimits.get(exchange);
  if (!limiter) {
    limiter = { lastRequest: 0, requestQueue: Promise.resolve() };
    exchangeRateLimits.set(exchange, limiter);
  }
  
  // Chain this request onto the queue - this ensures serialization
  // Each caller waits for previous requests to complete before proceeding
  const previousQueue = limiter.requestQueue;
  
  // Create a new promise that this caller will resolve when done with the delay
  let resolveCurrentRequest: () => void;
  limiter.requestQueue = new Promise<void>((resolve) => {
    resolveCurrentRequest = resolve;
  });
  
  // Wait for previous requests to complete
  await previousQueue;
  
  // Calculate delay needed from last request
  const timeSinceLastRequest = Date.now() - limiter.lastRequest;
  if (timeSinceLastRequest < MIN_REQUEST_DELAY_MS) {
    const delay = MIN_REQUEST_DELAY_MS - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  limiter.lastRequest = Date.now();
  
  // Signal that this request's delay is complete, allowing next request to proceed
  resolveCurrentRequest!();
}

function handleRateLimitError(exchange: Exchange, errorMsg: string): void {
  // Detect rate limit errors from common patterns
  const isRateLimit = 
    errorMsg.toLowerCase().includes("rate limit") ||
    errorMsg.toLowerCase().includes("too many") ||
    errorMsg.includes("429") ||
    errorMsg.includes("HTTP_429");
  
  if (isRateLimit) {
    const current = rateLimitBackoff.get(exchange);
    const newDelay = current ? Math.min(current.delay * 2, MAX_BACKOFF_MS) : INITIAL_BACKOFF_MS;
    rateLimitBackoff.set(exchange, { 
      until: Date.now() + newDelay, 
      delay: newDelay 
    });
    console.warn(`[${exchange.toUpperCase()}] Rate limit detected, backing off for ${newDelay}ms`);
  }
}

function clearRateLimitBackoff(exchange: Exchange): void {
  // Clear backoff on successful request
  if (rateLimitBackoff.has(exchange)) {
    rateLimitBackoff.delete(exchange);
  }
}

// Data source type
export type DataSource = "live" | "simulated";

// Internal tracking for debugging (not used by callers - they use return values)
let lastDataSource: DataSource = "simulated";
let lastDataError: string | undefined;

// Result types that include data source info
export interface TickerResult {
  ticker: Ticker;
  dataSource: DataSource;
  dataError?: string;
}

export interface KlinesResult {
  klines: Kline[];
  dataSource: DataSource;
  dataError?: string;
}

export interface MarketsResult {
  markets: Market[];
  dataSource: DataSource;
  dataError?: string;
}

// Order params for real trading
export interface RealOrderParams {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  quantity: number;
  price?: number;
  leverage?: number;
}

// Result for real order placement
export interface RealOrderResult {
  success: boolean;
  order?: Order;
  position?: Position;
  error?: string;
  exchangeOrderId?: string;
}

interface ExchangeService {
  validateCredentials(credentials: ApiCredentials): Promise<boolean>;
  getMarkets(exchange: Exchange): Promise<MarketsResult>;
  getTicker(exchange: Exchange, symbol: string): Promise<TickerResult>;
  getKlines(exchange: Exchange, symbol: string, timeframe: string, limit?: number): Promise<KlinesResult>;
  getPositions(exchange: Exchange, credentials: ApiCredentials): Promise<Position[]>;
  getOrders(exchange: Exchange, credentials: ApiCredentials): Promise<Order[]>;
  placeOrder(exchange: Exchange, credentials: ApiCredentials, order: Partial<Order>): Promise<Order>;
  placeRealOrder(exchange: Exchange, credentials: ApiCredentials, params: RealOrderParams): Promise<RealOrderResult>;
  cancelOrder(exchange: Exchange, credentials: ApiCredentials, orderId: string): Promise<boolean>;
  closePosition(exchange: Exchange, credentials: ApiCredentials, positionId: string): Promise<boolean>;
  closeRealPosition(exchange: Exchange, credentials: ApiCredentials, position: Position): Promise<boolean>;
  closeAllPositions(exchange: Exchange, credentials: ApiCredentials): Promise<boolean>;
  fetchRealPositions(exchange: Exchange, credentials: ApiCredentials): Promise<Position[]>;
  getExchangeInfo(exchange: Exchange): typeof EXCHANGE_CONFIG[Exchange];
}

// Base prices for fallback simulation
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

// Get current price with realistic movement (fallback)
function getCurrentPrice(exchange: Exchange, symbol: string): number {
  const cacheKey = `${exchange}:${symbol}`;
  const cached = priceCache.get(cacheKey);
  const config = EXCHANGE_CONFIG[exchange];
  const basePrice = BASE_PRICES[symbol] || 100;
  
  if (cached && Date.now() - cached.lastUpdate < 1000) {
    return cached.price;
  }
  
  const lastPrice = cached?.price || basePrice;
  const volatility = config.priceVolatility;
  const change = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = lastPrice * (1 + change);
  
  const clampedPrice = Math.max(basePrice * 0.8, Math.min(basePrice * 1.2, newPrice));
  
  priceCache.set(cacheKey, { price: clampedPrice, lastUpdate: Date.now() });
  return clampedPrice;
}

// Generate simulated ticker data (fallback)
function generateSimulatedTicker(exchange: Exchange, symbol: string): Ticker {
  const currentPrice = getCurrentPrice(exchange, symbol);
  const basePrice = BASE_PRICES[symbol] || 100;
  const change = (currentPrice - basePrice) / basePrice;
  
  const volumeMultipliers: Record<Exchange, number> = {
    coinstore: 1.0,
    bydfi: 1.5,
    bitunix: 1.2,
    toobit: 1.3,
  };
  const volumeMultiplier = volumeMultipliers[exchange];
  
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

// Generate simulated klines (fallback)
function generateSimulatedKlines(exchange: Exchange, symbol: string, timeframe: string, limit: number = 100): Kline[] {
  const klines: Kline[] = [];
  const config = EXCHANGE_CONFIG[exchange];
  const timeframeMs = getTimeframeMs(timeframe);
  const now = Date.now();
  
  let price = (BASE_PRICES[symbol] || 100) * (0.95 + Math.random() * 0.1);

  for (let i = limit; i > 0; i--) {
    const volatility = config.priceVolatility + Math.random() * 0.005;
    const trend = Math.random() - 0.48;
    
    const open = price;
    const changePercent = volatility * trend;
    const close = open * (1 + changePercent);
    const high = Math.max(open, close) * (1 + Math.random() * volatility);
    const low = Math.min(open, close) * (1 - Math.random() * volatility);
    
    const market = FALLBACK_MARKETS[exchange]?.find(m => m.symbol === symbol);
    const precision = market?.pricePrecision || 4;
    
    const volumeMultipliers: Record<Exchange, number> = {
      coinstore: 1.0,
      bydfi: 1.5,
      bitunix: 1.2,
      toobit: 1.3,
    };
    
    klines.push({
      time: now - (i * timeframeMs),
      open: parseFloat(open.toFixed(precision)),
      high: parseFloat(high.toFixed(precision)),
      low: parseFloat(low.toFixed(precision)),
      close: parseFloat(close.toFixed(precision)),
      volume: Math.random() * 10000 * volumeMultipliers[exchange],
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

// Exchange service implementation with live API + fallback
export const exchangeService: ExchangeService = {
  async validateCredentials(credentials: ApiCredentials): Promise<boolean> {
    if (!credentials.apiKey || !credentials.secretKey) {
      return false;
    }
    
    // For development/testing with test keys, always accept
    if (credentials.apiKey.startsWith("test")) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return true;
    }
    
    if (credentials.apiKey.startsWith("invalid")) {
      return false;
    }
    
    // Try real API validation if credentials look real
    if (USE_LIVE_API && credentials.apiKey.length > 10) {
      try {
        if (credentials.exchange === "coinstore") {
          return await validateCoinstoreCredentials(credentials);
        } else if (credentials.exchange === "bydfi") {
          return await validateBydfiCredentials(credentials);
        } else if (credentials.exchange === "bitunix") {
          return await validateBitunixCredentials(credentials);
        } else if (credentials.exchange === "toobit") {
          return await validateToobitCredentials(credentials);
        }
      } catch (error) {
        console.warn(`Live credential validation failed for ${credentials.exchange}, accepting for paper trading`);
      }
    }
    
    // Accept credentials for paper trading mode
    return true;
  },

  async getMarkets(exchange: Exchange): Promise<MarketsResult> {
    // Check cache first
    const cached = marketsCache.get(exchange);
    if (cached && Date.now() - cached.timestamp < MARKETS_CACHE_TTL) {
      return { markets: cached.markets, dataSource: "live" };
    }
    
    if (USE_LIVE_API) {
      try {
        let liveMarkets: Market[] = [];
        
        if (exchange === "coinstore") {
          liveMarkets = await getCoinstoreContracts();
        } else if (exchange === "bydfi") {
          liveMarkets = await getBydfiMarkets();
        } else if (exchange === "bitunix") {
          liveMarkets = await getBitunixMarkets();
        } else if (exchange === "toobit") {
          liveMarkets = await getToobitMarkets();
        }
        
        if (liveMarkets.length > 0) {
          console.log(`[${exchange.toUpperCase()}] Fetched ${liveMarkets.length} markets from live API`);
          marketsCache.set(exchange, { markets: liveMarkets, timestamp: Date.now() });
          lastDataSource = "live";
          return { markets: liveMarkets, dataSource: "live" };
        }
      } catch (error) {
        console.warn(`[${exchange.toUpperCase()}] Live markets API failed, using fallback:`, error);
      }
    }
    
    // Fallback to static markets
    lastDataSource = "simulated";
    return { markets: FALLBACK_MARKETS[exchange] || [], dataSource: "simulated" };
  },

  async getTicker(exchange: Exchange, symbol: string): Promise<TickerResult> {
    const tickerCacheKey = `${exchange}:${symbol}`;
    
    // Check ticker result cache first - prevents duplicate API calls within TTL
    const cachedResult = tickerResultCache.get(tickerCacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < TICKER_CACHE_TTL) {
      return cachedResult.result;
    }
    
    let dataError: string | undefined;
    
    if (USE_LIVE_API) {
      try {
        // Wait for rate limit before making request
        await waitForRateLimit(exchange);
        
        let result: { success: boolean; data: any; error?: string; errorCode?: string } | null = null;
        
        if (exchange === "coinstore") {
          result = await getCoinstoreTicker(symbol);
        } else if (exchange === "bydfi") {
          result = await getBydfiTicker(symbol);
        } else if (exchange === "bitunix") {
          result = await getBitunixTicker(symbol);
        } else if (exchange === "toobit") {
          result = await getToobitTicker(symbol);
        }
        
        if (result?.success && result.data && result.data.lastPrice > 0) {
          priceCache.set(tickerCacheKey, { price: result.data.lastPrice, lastUpdate: Date.now() });
          lastDataSource = "live";
          lastDataError = undefined;
          clearRateLimitBackoff(exchange);
          console.log(`[${exchange.toUpperCase()}] Live ticker for ${symbol}: $${result.data.lastPrice.toFixed(2)}`);
          
          const tickerResult: TickerResult = { ticker: result.data, dataSource: "live" };
          tickerResultCache.set(tickerCacheKey, { result: tickerResult, timestamp: Date.now() });
          return tickerResult;
        } else if (result && !result.success) {
          console.warn(`[${exchange.toUpperCase()}] Ticker API failed for ${symbol}: ${result.error} (${result.errorCode})`);
          dataError = result.error;
          lastDataError = result.error;
          handleRateLimitError(exchange, result.error || "");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[${exchange.toUpperCase()}] Live ticker API exception for ${symbol}: ${errorMsg}`);
        dataError = errorMsg;
        lastDataError = errorMsg;
        handleRateLimitError(exchange, errorMsg);
      }
    }
    
    // Fallback to simulated ticker
    lastDataSource = "simulated";
    const ticker = generateSimulatedTicker(exchange, symbol);
    const fallbackResult: TickerResult = { ticker, dataSource: "simulated", dataError };
    tickerResultCache.set(tickerCacheKey, { result: fallbackResult, timestamp: Date.now() });
    return fallbackResult;
  },

  async getKlines(exchange: Exchange, symbol: string, timeframe: string, limit: number = 100): Promise<KlinesResult> {
    const klinesCacheKey = `${exchange}:${symbol}:${timeframe}:${limit}`;
    
    // Check klines result cache first - prevents duplicate API calls within TTL
    const cachedResult = klinesResultCache.get(klinesCacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < KLINES_CACHE_TTL) {
      return cachedResult.result;
    }
    
    let dataError: string | undefined;
    
    if (USE_LIVE_API) {
      try {
        // Wait for rate limit before making request
        await waitForRateLimit(exchange);
        
        let result: { success: boolean; data: any; error?: string; errorCode?: string } | null = null;
        
        if (exchange === "coinstore") {
          result = await getCoinstoreKlines(symbol, timeframe, limit);
        } else if (exchange === "bydfi") {
          result = await getBydfiKlines(symbol, timeframe, limit);
        } else if (exchange === "bitunix") {
          result = await getBitunixKlines(symbol, timeframe, limit);
        } else if (exchange === "toobit") {
          result = await getToobitKlines(symbol, timeframe, limit);
        }
        
        if (result?.success && result.data && result.data.length > 0) {
          lastDataSource = "live";
          lastDataError = undefined;
          clearRateLimitBackoff(exchange);
          console.log(`[${exchange.toUpperCase()}] Live klines for ${symbol}: ${result.data.length} candles`);
          
          const klinesResult: KlinesResult = { klines: result.data, dataSource: "live" };
          klinesResultCache.set(klinesCacheKey, { result: klinesResult, timestamp: Date.now() });
          return klinesResult;
        } else if (result && !result.success) {
          console.warn(`[${exchange.toUpperCase()}] Klines API failed for ${symbol}: ${result.error} (${result.errorCode})`);
          dataError = result.error;
          lastDataError = result.error;
          handleRateLimitError(exchange, result.error || "");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[${exchange.toUpperCase()}] Live klines API exception for ${symbol}: ${errorMsg}`);
        dataError = errorMsg;
        lastDataError = errorMsg;
        handleRateLimitError(exchange, errorMsg);
      }
    }
    
    // Fallback to simulated klines
    lastDataSource = "simulated";
    const klines = generateSimulatedKlines(exchange, symbol, timeframe, limit);
    const fallbackResult: KlinesResult = { klines, dataSource: "simulated", dataError };
    klinesResultCache.set(klinesCacheKey, { result: fallbackResult, timestamp: Date.now() });
    return fallbackResult;
  },

  async getPositions(exchange: Exchange, credentials: ApiCredentials): Promise<Position[]> {
    // Positions are managed locally for paper trading
    // Real trading would use exchange API
    const key = getStorageKey(exchange, credentials.apiKey);
    return simulatedPositions.get(key) || [];
  },

  async getOrders(exchange: Exchange, credentials: ApiCredentials): Promise<Order[]> {
    const key = getStorageKey(exchange, credentials.apiKey);
    return simulatedOrders.get(key) || [];
  },

  async placeOrder(exchange: Exchange, credentials: ApiCredentials, orderParams: Partial<Order>): Promise<Order> {
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 100));
    
    const config = EXCHANGE_CONFIG[exchange];
    const symbol = orderParams.symbol || "BTCUSDT";
    const currentPrice = getCurrentPrice(exchange, symbol);
    
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

    const key = getStorageKey(exchange, credentials.apiKey);
    const orders = simulatedOrders.get(key) || [];
    orders.push(order);
    simulatedOrders.set(key, orders);

    if (order.status === "filled") {
      const positions = simulatedPositions.get(key) || [];
      const existingPosition = positions.find(p => p.symbol === symbol);
      
      if (existingPosition) {
        if ((existingPosition.side === "long" && order.side === "buy") ||
            (existingPosition.side === "short" && order.side === "sell")) {
          const totalQuantity = existingPosition.quantity + order.quantity;
          const avgPrice = (existingPosition.entryPrice * existingPosition.quantity + 
                          order.price * order.quantity) / totalQuantity;
          existingPosition.quantity = totalQuantity;
          existingPosition.entryPrice = avgPrice;
        } else {
          existingPosition.quantity -= order.quantity;
          if (existingPosition.quantity <= 0) {
            const idx = positions.indexOf(existingPosition);
            positions.splice(idx, 1);
          }
        }
      } else {
        const leverage = 10;
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

  // ============ REAL TRADING METHODS ============
  
  // Place a real order on the exchange
  async placeRealOrder(exchange: Exchange, credentials: ApiCredentials, params: RealOrderParams): Promise<RealOrderResult> {
    console.log(`[REAL TRADING] Placing order on ${exchange}: ${params.side} ${params.quantity} ${params.symbol}`);
    
    if (exchange === "bitunix") {
      try {
        // First, set leverage if specified
        if (params.leverage) {
          const leverageResult = await setBitunixLeverage(
            credentials,
            params.symbol,
            params.leverage,
            "ISOLATION"
          );
          if (!leverageResult.success) {
            console.warn(`[REAL TRADING] Failed to set leverage: ${leverageResult.error}`);
            // Continue anyway - leverage may already be set
          }
        }

        // Place the order
        const orderParams: PlaceOrderParams = {
          symbol: params.symbol,
          side: params.side.toUpperCase() as "BUY" | "SELL",
          orderType: params.type.toUpperCase() as "MARKET" | "LIMIT",
          qty: params.quantity.toString(),
          tradeSide: "OPEN",
        };

        if (params.type === "limit" && params.price) {
          orderParams.price = params.price.toString();
        }

        const result = await placeBitunixOrder(credentials, orderParams);

        if (!result.success || !result.data) {
          console.error(`[REAL TRADING] Order failed: ${result.error}`);
          return {
            success: false,
            error: result.error || "Order placement failed",
          };
        }

        console.log(`[REAL TRADING] Order placed successfully: ${result.data.orderId}`);

        // Get current ticker for order price
        const tickerResult = await this.getTicker(exchange, params.symbol);
        const fillPrice = parseFloat(result.data.avgPrice || result.data.price) || tickerResult.ticker.lastPrice;

        // Create local order record
        const order: Order = {
          id: result.data.orderId,
          symbol: params.symbol,
          type: params.type,
          side: params.side,
          price: fillPrice,
          quantity: params.quantity,
          filledQuantity: parseFloat(result.data.filledQty || result.data.qty) || params.quantity,
          status: result.data.status?.toLowerCase() === "filled" ? "filled" : "pending",
          timestamp: Date.now(),
        };

        // Create position for filled market orders
        let position: Position | undefined;
        if (order.status === "filled" || params.type === "market") {
          const leverage = params.leverage || 10;
          position = {
            id: randomUUID(), // We'll update this when we fetch real positions
            symbol: params.symbol,
            side: params.side === "buy" ? "long" : "short",
            entryPrice: fillPrice,
            markPrice: fillPrice,
            quantity: params.quantity,
            leverage,
            marginType: "isolated",
            unrealizedPnl: 0,
            unrealizedPnlPercent: 0,
            liquidationPrice: params.side === "buy" 
              ? fillPrice * (1 - 1/leverage * 0.9)
              : fillPrice * (1 + 1/leverage * 0.9),
            timestamp: Date.now(),
          };
        }

        return {
          success: true,
          order,
          position,
          exchangeOrderId: result.data.orderId,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[REAL TRADING] Exception: ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
        };
      }
    }

    // For unsupported exchanges, return error
    return {
      success: false,
      error: `Real trading not implemented for ${exchange}`,
    };
  },

  // Close a real position on the exchange
  async closeRealPosition(exchange: Exchange, credentials: ApiCredentials, position: Position): Promise<boolean> {
    console.log(`[REAL TRADING] Closing position on ${exchange}: ${position.symbol} ${position.side}`);
    
    if (exchange === "bitunix") {
      try {
        // First try to fetch real positions to get the positionId
        const positionsResult = await getBitunixPositions(credentials);
        
        if (positionsResult.success && positionsResult.data) {
          // Find matching position
          const realPosition = positionsResult.data.find(
            (p: BitunixPosition) => p.symbol === position.symbol
          );
          
          if (realPosition) {
            const result = await closeBitunixPosition(
              credentials,
              realPosition.positionId,
              position.symbol,
              realPosition.side,
              realPosition.qty
            );
            
            if (result.success) {
              console.log(`[REAL TRADING] Position closed successfully`);
              return true;
            } else {
              console.error(`[REAL TRADING] Failed to close position: ${result.error}`);
              return false;
            }
          }
        }
        
        // If we can't find real position, try placing opposite order
        const closeSide = position.side === "long" ? "SELL" : "BUY";
        const result = await placeBitunixOrder(credentials, {
          symbol: position.symbol,
          side: closeSide as "BUY" | "SELL",
          orderType: "MARKET",
          qty: position.quantity.toString(),
          tradeSide: "CLOSE",
          reduceOnly: true,
        });
        
        if (result.success) {
          console.log(`[REAL TRADING] Position closed with reduce-only order`);
          return true;
        }
        
        console.error(`[REAL TRADING] Failed to close position: ${result.error}`);
        return false;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[REAL TRADING] Exception closing position: ${errorMsg}`);
        return false;
      }
    }
    
    return false;
  },

  // Fetch real positions from the exchange
  async fetchRealPositions(exchange: Exchange, credentials: ApiCredentials): Promise<Position[]> {
    console.log(`[REAL TRADING] Fetching positions from ${exchange}`);
    
    if (exchange === "bitunix") {
      try {
        const result = await getBitunixPositions(credentials);
        
        if (!result.success || !result.data) {
          console.error(`[REAL TRADING] Failed to fetch positions: ${result.error}`);
          return [];
        }
        
        const positions: Position[] = result.data.map((p: BitunixPosition) => ({
          id: p.positionId,
          symbol: p.symbol,
          side: p.side.toLowerCase() === "long" || p.side.toLowerCase() === "buy" ? "long" : "short",
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          quantity: parseFloat(p.qty),
          leverage: parseInt(p.leverage) || 10,
          marginType: p.marginMode?.toLowerCase() === "cross" ? "cross" : "isolated",
          unrealizedPnl: parseFloat(p.unrealizedPnl),
          unrealizedPnlPercent: 0, // Calculate based on entry/mark
          liquidationPrice: parseFloat(p.liquidationPrice),
          timestamp: Date.now(),
        }));
        
        // Calculate unrealized PnL percent
        for (const pos of positions) {
          if (pos.entryPrice > 0) {
            const priceDiff = pos.side === "long" 
              ? pos.markPrice - pos.entryPrice 
              : pos.entryPrice - pos.markPrice;
            pos.unrealizedPnlPercent = (priceDiff / pos.entryPrice) * 100 * pos.leverage;
          }
        }
        
        console.log(`[REAL TRADING] Fetched ${positions.length} positions`);
        return positions;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[REAL TRADING] Exception fetching positions: ${errorMsg}`);
        return [];
      }
    }
    
    return [];
  },
  
  getExchangeInfo(exchange: Exchange) {
    return EXCHANGE_CONFIG[exchange];
  },
};

// Ticker stream callback with data source info (same as TickerResult)
export interface TickerStreamData {
  ticker: Ticker;
  dataSource: DataSource;
  dataError?: string;
}

// Klines stream callback with data source info
export interface KlinesStreamData {
  klines: Kline[];
  dataSource: DataSource;
  dataError?: string;
}

// Function to continuously update ticker data (for WebSocket simulation)
// NOTE: Default interval increased from 1000ms to 2000ms to reduce API rate limiting issues
export function createTickerStream(
  exchange: Exchange,
  symbol: string,
  callback: (data: TickerStreamData) => void,
  intervalMs: number = 2000
): { stop: () => void } {
  const fetchTicker = async () => {
    try {
      // getTicker now returns TickerResult with data source embedded
      const result = await exchangeService.getTicker(exchange, symbol);
      callback({ 
        ticker: result.ticker, 
        dataSource: result.dataSource,
        ...(result.dataError ? { dataError: result.dataError } : {})
      });
    } catch (error) {
      console.error("Ticker stream error:", error);
    }
  };

  fetchTicker();
  const interval = setInterval(fetchTicker, intervalMs);

  return {
    stop: () => clearInterval(interval),
  };
}

// Function to continuously update klines data (for chart and indicator updates)
// Klines update less frequently than tickers since candle data changes slowly
export function createKlinesStream(
  exchange: Exchange,
  symbol: string,
  timeframe: string,
  callback: (data: KlinesStreamData) => void,
  intervalMs: number = 10000 // 10 seconds - klines change slower than tickers
): { stop: () => void } {
  const fetchKlines = async () => {
    try {
      const result = await exchangeService.getKlines(exchange, symbol, timeframe, 100);
      callback({ 
        klines: result.klines, 
        dataSource: result.dataSource,
        ...(result.dataError ? { dataError: result.dataError } : {})
      });
    } catch (error) {
      console.error("Klines stream error:", error);
    }
  };

  fetchKlines();
  const interval = setInterval(fetchKlines, intervalMs);

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
