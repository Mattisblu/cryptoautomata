import crypto from "crypto";
import type { Market, Ticker, Kline, ApiCredentials } from "@shared/schema";

const TOOBIT_BASE_URL = "https://api.toobit.com";

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  errorCode?: string;
}

interface ToobitResponse<T> {
  code: string;
  message: string;
  data: T;
}

interface ToobitSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  status: string;
  maxLeverage: number;
}

interface ToobitTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openPrice: string;
  time: number;
}

interface ToobitKline {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

function generateToobitSignature(
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

function createToobitHeaders(
  credentials: ApiCredentials,
  method: string,
  path: string,
  body: string = ""
): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = generateToobitSignature(credentials.secretKey, timestamp, method, path, body);
  
  const headers: Record<string, string> = {
    "X-TB-APIKEY": credentials.apiKey,
    "X-TB-TIMESTAMP": timestamp,
    "X-TB-SIGN": signature,
    "Content-Type": "application/json",
  };
  
  if (credentials.passphrase) {
    headers["X-TB-PASSPHRASE"] = credentials.passphrase;
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

export async function getToobitMarkets(): Promise<Market[]> {
  try {
    const response = await fetchWithTimeout(`${TOOBIT_BASE_URL}/v1/public/instruments`);
    
    if (!response.ok) {
      console.error(`Toobit markets API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.data?.instruments) {
      console.error("Toobit markets response error:", data.message || "No instruments data");
      return [];
    }
    
    return data.data.instruments
      .filter((s: ToobitSymbol) => s.status === "TRADING" && s.quoteAsset === "USDT")
      .map((symbol: ToobitSymbol) => ({
        symbol: symbol.symbol,
        baseAsset: symbol.baseAsset,
        quoteAsset: symbol.quoteAsset,
        pricePrecision: symbol.pricePrecision,
        quantityPrecision: symbol.quantityPrecision,
        maxLeverage: symbol.maxLeverage || 100,
      }));
  } catch (error) {
    console.error("Failed to fetch Toobit markets:", error);
    return [];
  }
}

export async function getToobitTicker(symbol: string): Promise<ApiResult<Ticker>> {
  try {
    const response = await fetchWithTimeout(`${TOOBIT_BASE_URL}/v1/public/ticker?symbol=${symbol}`);
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
      };
    }
    
    const responseData: ToobitResponse<ToobitTicker> = await response.json();
    
    if (responseData.code !== "0" || !responseData.data) {
      return {
        success: false,
        data: null,
        error: responseData.message || "No ticker data",
        errorCode: responseData.code,
      };
    }
    
    const ticker = responseData.data;
    return {
      success: true,
      data: {
        symbol,
        lastPrice: parseFloat(ticker.lastPrice),
        priceChange: parseFloat(ticker.priceChange),
        priceChangePercent: parseFloat(ticker.priceChangePercent),
        high24h: parseFloat(ticker.highPrice),
        low24h: parseFloat(ticker.lowPrice),
        volume24h: parseFloat(ticker.volume),
        timestamp: ticker.time,
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

export async function getToobitKlines(
  symbol: string,
  timeframe: string,
  limit: number = 100
): Promise<ApiResult<Kline[]>> {
  try {
    const interval = mapTimeframeToInterval(timeframe);
    const response = await fetchWithTimeout(
      `${TOOBIT_BASE_URL}/v1/public/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
      };
    }
    
    const responseData: ToobitResponse<ToobitKline[]> = await response.json();
    
    if (responseData.code !== "0" || !responseData.data || responseData.data.length === 0) {
      return {
        success: false,
        data: null,
        error: responseData.message || "No klines data",
        errorCode: responseData.code,
      };
    }
    
    const klines: Kline[] = responseData.data.map((k: ToobitKline) => ({
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

export async function validateToobitCredentials(credentials: ApiCredentials): Promise<boolean> {
  try {
    const headers = createToobitHeaders(credentials, "GET", "/v1/account/info");
    const response = await fetchWithTimeout(`${TOOBIT_BASE_URL}/v1/account/info`, {
      method: "GET",
      headers,
    });
    
    return response.ok;
  } catch (error) {
    console.warn("Toobit credential validation failed:", error);
    return false;
  }
}
