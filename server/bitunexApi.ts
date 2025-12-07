import crypto from "crypto";
import type { Market, Ticker, Kline, ApiCredentials } from "@shared/schema";

const BITUNEX_BASE_URL = "https://api.bitunex.com";

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  errorCode?: string;
}

interface BitunexResponse<T> {
  code: string;
  msg: string;
  data: T;
}

interface BitunexSymbol {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  baseScale: number;
  quoteScale: number;
  tradeStatus: string;
  maxLeverage: number;
}

interface BitunexTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  high24h: string;
  low24h: string;
  vol24h: string;
  timestamp: number;
}

interface BitunexKline {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

function generateBitunexSignature(secretKey: string, timestamp: string, method: string, path: string): string {
  const message = timestamp + method.toUpperCase() + path;
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(message);
  return hmac.digest("hex");
}

function createBitunexHeaders(credentials: ApiCredentials, method: string, path: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = generateBitunexSignature(credentials.secretKey, timestamp, method, path);
  
  return {
    "X-BX-APIKEY": credentials.apiKey,
    "X-BX-TIMESTAMP": timestamp,
    "X-BX-SIGN": signature,
    "Content-Type": "application/json",
  };
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

export async function getBitunexMarkets(): Promise<Market[]> {
  try {
    const response = await fetchWithTimeout(`${BITUNEX_BASE_URL}/v1/public/symbols`);
    
    if (!response.ok) {
      console.error(`Bitunex markets API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.data?.symbols) {
      console.error("Bitunex markets response error:", data.msg || "No symbols data");
      return [];
    }
    
    return data.data.symbols
      .filter((s: BitunexSymbol) => s.tradeStatus === "active" && s.quoteCoin === "USDT")
      .map((symbol: BitunexSymbol) => ({
        symbol: symbol.symbol,
        baseAsset: symbol.baseCoin,
        quoteAsset: symbol.quoteCoin,
        pricePrecision: symbol.quoteScale,
        quantityPrecision: symbol.baseScale,
        maxLeverage: symbol.maxLeverage || 100,
      }));
  } catch (error) {
    console.error("Failed to fetch Bitunex markets:", error);
    return [];
  }
}

export async function getBitunexTicker(symbol: string): Promise<ApiResult<Ticker>> {
  try {
    const response = await fetchWithTimeout(`${BITUNEX_BASE_URL}/v1/public/ticker?symbol=${symbol}`);
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
      };
    }
    
    const responseData: BitunexResponse<BitunexTicker> = await response.json();
    
    if (responseData.code !== "0" || !responseData.data) {
      return {
        success: false,
        data: null,
        error: responseData.msg || "No ticker data",
        errorCode: responseData.code,
      };
    }
    
    const ticker = responseData.data;
    return {
      success: true,
      data: {
        symbol,
        lastPrice: parseFloat(ticker.lastPrice),
        priceChange: 0,
        priceChangePercent: parseFloat(ticker.priceChangePercent),
        high24h: parseFloat(ticker.high24h),
        low24h: parseFloat(ticker.low24h),
        volume24h: parseFloat(ticker.vol24h),
        timestamp: ticker.timestamp,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      data: null,
      error: errorMsg,
      errorCode: "FETCH_ERROR",
    };
  }
}

export async function getBitunexKlines(
  symbol: string,
  timeframe: string,
  limit: number = 100
): Promise<ApiResult<Kline[]>> {
  try {
    const interval = mapTimeframeToInterval(timeframe);
    const response = await fetchWithTimeout(
      `${BITUNEX_BASE_URL}/v1/public/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
      };
    }
    
    const responseData: BitunexResponse<BitunexKline[]> = await response.json();
    
    if (responseData.code !== "0" || !responseData.data || responseData.data.length === 0) {
      return {
        success: false,
        data: null,
        error: responseData.msg || "No klines data",
        errorCode: responseData.code,
      };
    }
    
    const klines: Kline[] = responseData.data.map((k: BitunexKline) => ({
      time: k.time,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
    }));
    
    return {
      success: true,
      data: klines,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      data: null,
      error: errorMsg,
      errorCode: "FETCH_ERROR",
    };
  }
}

function mapTimeframeToInterval(timeframe: string): string {
  const mapping: Record<string, string> = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1hour",
    "4h": "4hour",
    "1d": "1day",
    "1D": "1day",
  };
  return mapping[timeframe] || "15min";
}

export async function validateBitunexCredentials(credentials: ApiCredentials): Promise<boolean> {
  try {
    const headers = createBitunexHeaders(credentials, "GET", "/v1/account/info");
    const response = await fetchWithTimeout(`${BITUNEX_BASE_URL}/v1/account/info`, {
      method: "GET",
      headers,
    });
    
    return response.ok;
  } catch (error) {
    console.warn("Bitunex credential validation failed:", error);
    return false;
  }
}
