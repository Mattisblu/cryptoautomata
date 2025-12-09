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
  queryString: string
): string {
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(queryString);
  return hmac.digest("hex");
}

function createToobitSignedParams(
  credentials: ApiCredentials,
  params: Record<string, string | number> = {}
): { queryString: string; headers: Record<string, string> } {
  const timestamp = Date.now();
  const allParams: Record<string, string | number> = {
    ...params,
    timestamp,
    recvWindow: 10000,
  };
  
  const sortedParams = Object.keys(allParams)
    .sort()
    .map(key => `${key}=${allParams[key]}`)
    .join("&");
  
  const signature = generateToobitSignature(credentials.secretKey, sortedParams);
  const queryString = `${sortedParams}&signature=${signature}`;
  
  const headers: Record<string, string> = {
    "X-BB-APIKEY": credentials.apiKey,
    "Content-Type": "application/json",
  };
  
  return { queryString, headers };
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
    const response = await fetchWithTimeout(`${TOOBIT_BASE_URL}/api/v1/exchangeInfo`);
    
    if (!response.ok) {
      console.error(`Toobit markets API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.symbols) {
      console.error("Toobit markets response error:", data.msg || "No symbols data");
      return [];
    }
    
    return data.symbols
      .filter((s: any) => s.status === "TRADING" && s.quoteAsset === "USDT")
      .map((symbol: any) => ({
        symbol: symbol.symbol,
        baseAsset: symbol.baseAsset,
        quoteAsset: symbol.quoteAsset,
        pricePrecision: symbol.quotePrecision || 8,
        quantityPrecision: symbol.baseAssetPrecision || 8,
        maxLeverage: 100,
      }));
  } catch (error) {
    console.error("Failed to fetch Toobit markets:", error);
    return [];
  }
}

export async function getToobitTicker(symbol: string): Promise<ApiResult<Ticker>> {
  try {
    const response = await fetchWithTimeout(`${TOOBIT_BASE_URL}/quote/v1/ticker/24hr?symbol=${symbol}`);
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
      };
    }
    
    const data = await response.json();
    
    // Response is an array with one ticker object using short property names
    const ticker = Array.isArray(data) ? data[0] : data;
    
    if (!ticker || !ticker.s) {
      return {
        success: false,
        data: null,
        error: "No ticker data",
        errorCode: "NO_DATA",
      };
    }
    
    // Short property names: t=time, s=symbol, c=close, h=high, l=low, o=open, v=volume, pc=priceChange, pcp=priceChangePercent
    return {
      success: true,
      data: {
        symbol,
        lastPrice: parseFloat(ticker.c || "0"),
        priceChange: parseFloat(ticker.pc || "0"),
        priceChangePercent: parseFloat(ticker.pcp || "0") * 100,
        high24h: parseFloat(ticker.h || "0"),
        low24h: parseFloat(ticker.l || "0"),
        volume24h: parseFloat(ticker.v || "0"),
        timestamp: ticker.t || Date.now(),
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
      `${TOOBIT_BASE_URL}/quote/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
      };
    }
    
    const rawData = await response.json();
    
    if (!Array.isArray(rawData) || rawData.length === 0) {
      return {
        success: false,
        data: null,
        error: "No klines data",
        errorCode: "NO_DATA",
      };
    }
    
    // Toobit klines format: [openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]
    const klines: Kline[] = rawData.map((k: any[]) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
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
  // Toobit uses Binance-style intervals: 1m, 5m, 15m, 30m, 1h, 4h, 1d
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

export async function validateToobitCredentials(credentials: ApiCredentials): Promise<boolean> {
  try {
    const { queryString, headers } = createToobitSignedParams(credentials);
    const url = `${TOOBIT_BASE_URL}/api/v1/spot/account?${queryString}`;
    
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers,
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`[TOOBIT] Validation response:`, data.code === 0 ? "Success" : data.message);
      return data.code === 0 || data.code === "0";
    }
    
    const errorText = await response.text();
    console.warn(`[TOOBIT] Validation failed: ${response.status} - ${errorText}`);
    return false;
  } catch (error) {
    console.warn("Toobit credential validation failed:", error);
    return false;
  }
}

// Balance info types
export interface ExchangeBalance {
  asset: string;
  available: number;
  frozen: number;
  total: number;
  unrealizedPnl: number;
  marginBalance: number;
}

export async function getToobitBalance(credentials: ApiCredentials): Promise<ApiResult<ExchangeBalance[]>> {
  try {
    const { queryString, headers } = createToobitSignedParams(credentials);
    const url = `${TOOBIT_BASE_URL}/api/v1/spot/account?${queryString}`;

    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `Toobit balance API returned status ${response.status}`,
        errorCode: "HTTP_ERROR"
      };
    }

    const data = await response.json();

    if (data.code !== 0 && data.code !== "0") {
      return {
        success: false,
        data: null,
        error: data.message || "Failed to fetch balance",
        errorCode: "API_ERROR"
      };
    }

    const balances: ExchangeBalance[] = [];
    const accountBalances = data.data?.balances || data.balances || [];

    if (Array.isArray(accountBalances)) {
      for (const item of accountBalances) {
        // Only include USDT balance for futures trading
        const asset = item.asset || item.coin || "";
        if (asset === "USDT" || !asset) {
          const available = parseFloat(item.free || item.available || item.availableBalance || "0");
          const frozen = parseFloat(item.locked || item.frozen || item.frozenBalance || "0");
          const unrealizedPnl = parseFloat(item.unrealizedPnl || item.unrealizedProfit || "0");
          const marginBalance = parseFloat(item.marginBalance || item.balance || "0");

          balances.push({
            asset: asset || "USDT",
            available,
            frozen,
            total: available + frozen,
            unrealizedPnl,
            marginBalance: marginBalance || (available + frozen + unrealizedPnl),
          });
        }
      }
    } else if (typeof data.data === "object" && data.data) {
      // Single balance object
      const available = parseFloat(data.data.free || data.data.available || "0");
      const frozen = parseFloat(data.data.locked || data.data.frozen || "0");
      const unrealizedPnl = parseFloat(data.data.unrealizedPnl || "0");
      const marginBalance = parseFloat(data.data.marginBalance || "0");

      balances.push({
        asset: data.data.asset || "USDT",
        available,
        frozen,
        total: available + frozen,
        unrealizedPnl,
        marginBalance: marginBalance || (available + frozen + unrealizedPnl),
      });
    }

    // If no USDT balance found, return empty with success
    if (balances.length === 0) {
      balances.push({
        asset: "USDT",
        available: 0,
        frozen: 0,
        total: 0,
        unrealizedPnl: 0,
        marginBalance: 0,
      });
    }

    return {
      success: true,
      data: balances
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[TOOBIT] Failed to fetch balance:", errorMessage);
    return {
      success: false,
      data: null,
      error: `Failed to fetch Toobit balance: ${errorMessage}`,
      errorCode: "NETWORK_ERROR"
    };
  }
}
