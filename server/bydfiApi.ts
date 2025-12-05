import crypto from "crypto";
import type { Market, Ticker, Kline, ApiCredentials } from "@shared/schema";

const BYDFI_BASE_URL = "https://api.bydfi.com";
const BYDFI_FUTURES_URL = "https://api.bydfi.com/api/v1/futures";

// Structured result type for better error propagation
export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  errorCode?: string;
}

interface BydfiResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface BydfiSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  status: string;
  maxLeverage: number;
  minOrderQty: string;
  maxOrderQty: string;
  tickSize: string;
  stepSize: string;
}

interface BydfiTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openPrice: string;
  closeTime: number;
}

function generateBydfiSignature(
  secretKey: string,
  timestamp: string,
  method: string,
  path: string,
  body: string = ""
): string {
  const message = timestamp + method.toUpperCase() + path + body;
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(message);
  return hmac.digest("hex");
}

function createBydfiHeaders(
  credentials: ApiCredentials,
  method: string,
  path: string,
  body: string = ""
): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = generateBydfiSignature(credentials.secretKey, timestamp, method, path, body);
  
  const headers: Record<string, string> = {
    "X-BYD-APIKEY": credentials.apiKey,
    "X-BYD-TIMESTAMP": timestamp,
    "X-BYD-SIGN": signature,
    "Content-Type": "application/json",
  };
  
  if (credentials.passphrase) {
    headers["X-BYD-PASSPHRASE"] = credentials.passphrase;
  }
  
  return headers;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getBydfiMarkets(): Promise<Market[]> {
  try {
    const response = await fetchWithTimeout(`${BYDFI_BASE_URL}/api/v1/public/futures/symbols`);
    
    if (!response.ok) {
      console.error(`BYDFI markets API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.data?.symbols) {
      console.error("BYDFI markets response error:", data.message || "No symbols data");
      return [];
    }
    
    return data.data.symbols
      .filter((s: BydfiSymbol) => s.status === "TRADING" && s.quoteAsset === "USDT")
      .map((symbol: BydfiSymbol) => ({
        symbol: symbol.symbol,
        baseAsset: symbol.baseAsset,
        quoteAsset: symbol.quoteAsset,
        pricePrecision: symbol.pricePrecision,
        quantityPrecision: symbol.quantityPrecision,
        maxLeverage: symbol.maxLeverage || 125,
      }));
  } catch (error) {
    console.error("Failed to fetch BYDFI markets:", error);
    return [];
  }
}

export async function getBydfiTicker(symbol: string): Promise<ApiResult<Ticker>> {
  try {
    const response = await fetchWithTimeout(
      `${BYDFI_BASE_URL}/api/v1/public/futures/ticker?symbol=${symbol}`
    );
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `BYDFI ticker API returned status ${response.status}`,
        errorCode: "HTTP_ERROR"
      };
    }
    
    const data = await response.json();
    
    if (!data.data) {
      return {
        success: false,
        data: null,
        error: data.message || "No ticker data in response",
        errorCode: "API_ERROR"
      };
    }
    
    const ticker = data.data;
    const lastPrice = parseFloat(ticker.lastPrice || "0");
    const openPrice = parseFloat(ticker.openPrice || lastPrice.toString());
    const priceChange = lastPrice - openPrice;
    const priceChangePercent = openPrice > 0 ? (priceChange / openPrice) * 100 : 0;
    
    return {
      success: true,
      data: {
        symbol,
        lastPrice,
        priceChange,
        priceChangePercent: parseFloat(ticker.priceChangePercent) || priceChangePercent,
        high24h: parseFloat(ticker.highPrice || lastPrice.toString()),
        low24h: parseFloat(ticker.lowPrice || lastPrice.toString()),
        volume24h: parseFloat(ticker.quoteVolume || ticker.volume || "0"),
        timestamp: ticker.closeTime || Date.now(),
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[BYDFI] Failed to fetch ticker:", errorMessage);
    return {
      success: false,
      data: null,
      error: `Failed to fetch BYDFI ticker: ${errorMessage}`,
      errorCode: "NETWORK_ERROR"
    };
  }
}

export async function getBydfiKlines(
  symbol: string,
  timeframe: string,
  limit: number = 100
): Promise<ApiResult<Kline[]>> {
  try {
    const interval = mapBydfiTimeframe(timeframe);
    const endTime = Date.now();
    const startTime = endTime - (limit * getTimeframeMs(timeframe));
    
    const response = await fetchWithTimeout(
      `${BYDFI_BASE_URL}/api/v1/public/futures/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`
    );
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `BYDFI klines API returned status ${response.status}`,
        errorCode: "HTTP_ERROR"
      };
    }
    
    const data = await response.json();
    
    if (!data.data) {
      return {
        success: false,
        data: null,
        error: data.message || "No kline data in response",
        errorCode: "API_ERROR"
      };
    }
    
    const klines: Kline[] = (data.data || []).map((k: any) => {
      if (Array.isArray(k)) {
        return {
          time: k[0],
          open: parseFloat(k[1] || "0"),
          high: parseFloat(k[2] || "0"),
          low: parseFloat(k[3] || "0"),
          close: parseFloat(k[4] || "0"),
          volume: parseFloat(k[5] || "0"),
        };
      }
      return {
        time: k.time || k.openTime,
        open: parseFloat(k.open || "0"),
        high: parseFloat(k.high || "0"),
        low: parseFloat(k.low || "0"),
        close: parseFloat(k.close || "0"),
        volume: parseFloat(k.volume || "0"),
      };
    });
    
    return {
      success: true,
      data: klines.sort((a, b) => a.time - b.time)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[BYDFI] Failed to fetch klines:", errorMessage);
    return {
      success: false,
      data: null,
      error: `Failed to fetch BYDFI klines: ${errorMessage}`,
      errorCode: "NETWORK_ERROR"
    };
  }
}

function mapBydfiTimeframe(timeframe: string): string {
  const mapping: Record<string, string> = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "4h",
    "1d": "1d",
    "1D": "1d",
  };
  return mapping[timeframe] || "15m";
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
    "1D": 24 * 60 * 60 * 1000,
  };
  return multipliers[timeframe] || 15 * 60 * 1000;
}

export async function validateBydfiCredentials(credentials: ApiCredentials): Promise<boolean> {
  try {
    const path = "/api/v1/futures/account";
    const headers = createBydfiHeaders(credentials, "GET", path);
    
    const response = await fetchWithTimeout(
      `${BYDFI_BASE_URL}${path}`,
      { headers }
    );
    
    return response.status === 200;
  } catch {
    return false;
  }
}

let allTickersCache: Map<string, Ticker> = new Map();
let allTickersCacheTime = 0;

export async function getBydfiAllTickers(): Promise<Map<string, Ticker>> {
  if (Date.now() - allTickersCacheTime < 5000 && allTickersCache.size > 0) {
    return allTickersCache;
  }
  
  try {
    const response = await fetchWithTimeout(
      `${BYDFI_BASE_URL}/api/v1/public/futures/tickers`
    );
    
    if (!response.ok) {
      return allTickersCache;
    }
    
    const data = await response.json();
    
    if (data.data && Array.isArray(data.data)) {
      allTickersCache.clear();
      allTickersCacheTime = Date.now();
      
      for (const ticker of data.data) {
        const lastPrice = parseFloat(ticker.lastPrice || "0");
        const openPrice = parseFloat(ticker.openPrice || lastPrice.toString());
        const priceChange = lastPrice - openPrice;
        const priceChangePercent = openPrice > 0 ? (priceChange / openPrice) * 100 : 0;
        
        allTickersCache.set(ticker.symbol, {
          symbol: ticker.symbol,
          lastPrice,
          priceChange,
          priceChangePercent: parseFloat(ticker.priceChangePercent) || priceChangePercent,
          high24h: parseFloat(ticker.highPrice || lastPrice.toString()),
          low24h: parseFloat(ticker.lowPrice || lastPrice.toString()),
          volume24h: parseFloat(ticker.quoteVolume || ticker.volume || "0"),
          timestamp: ticker.closeTime || Date.now(),
        });
      }
    }
    
    return allTickersCache;
  } catch (error) {
    console.error("Failed to fetch BYDFI all tickers:", error);
    return allTickersCache;
  }
}
