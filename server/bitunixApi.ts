import crypto from "crypto";
import type { Market, Ticker, Kline, ApiCredentials } from "@shared/schema";

const BITUNIX_FUTURES_URL = "https://fapi.bitunix.com";
const BITUNIX_SPOT_URL = "https://api.bitunix.com";

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  errorCode?: string;
}

interface BitunixTradingPair {
  symbol: string;
  base: string;
  quote: string;
  minTradeVolume: string;
  maxLeverage: number;
  basePrecision: number;
  quotePrecision: number;
  symbolStatus: string;
}

interface BitunixTicker {
  symbol: string;
  lastPrice: string;
  markPrice: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  priceChange24h: string;
  priceChangePercent24h: string;
  ts: number;
}

function generateBitunixSignature(
  secretKey: string,
  timestamp: string,
  nonce: string,
  queryString: string,
  body: string
): string {
  const message = `${timestamp}${nonce}${queryString}${body}`;
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(message);
  return hmac.digest("hex");
}

function createBitunixHeaders(
  credentials: ApiCredentials,
  queryString: string = "",
  body: string = ""
): Record<string, string> {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const signature = generateBitunixSignature(
    credentials.secretKey,
    timestamp,
    nonce,
    queryString,
    body
  );

  return {
    "api-key": credentials.apiKey,
    "sign": signature,
    "timestamp": timestamp,
    "nonce": nonce,
    "Content-Type": "application/json",
  };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
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

export async function getBitunixMarkets(): Promise<Market[]> {
  try {
    const response = await fetchWithTimeout(
      `${BITUNIX_FUTURES_URL}/api/v1/futures/market/trading_pairs`
    );

    if (!response.ok) {
      console.error(`Bitunix markets API error: ${response.status}`);
      return [];
    }

    const result = await response.json();

    if (result.code !== 0 || !result.data) {
      console.error("Bitunix markets response error:", result.msg || "No data");
      return [];
    }

    return result.data
      .filter((pair: BitunixTradingPair) => 
        pair.symbolStatus === "OPEN" && pair.quote === "USDT"
      )
      .map((pair: BitunixTradingPair) => ({
        symbol: pair.symbol,
        baseAsset: pair.base,
        quoteAsset: pair.quote,
        pricePrecision: pair.quotePrecision || 2,
        quantityPrecision: pair.basePrecision || 4,
        maxLeverage: pair.maxLeverage || 125,
      }));
  } catch (error) {
    console.error("Failed to fetch Bitunix markets:", error);
    return [];
  }
}

export async function getBitunixTicker(symbol: string): Promise<ApiResult<Ticker>> {
  try {
    const response = await fetchWithTimeout(
      `${BITUNIX_FUTURES_URL}/api/v1/futures/market/tickers?symbols=${symbol}`
    );

    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
      };
    }

    const result = await response.json();

    if (result.code !== 0 || !result.data || result.data.length === 0) {
      return {
        success: false,
        data: null,
        error: result.msg || "No ticker data",
        errorCode: "NO_DATA",
      };
    }

    const ticker = result.data[0];
    const lastPrice = parseFloat(ticker.lastPrice || ticker.last || "0");
    const openPrice = parseFloat(ticker.open || "0");
    const priceChange = lastPrice - openPrice;
    const priceChangePercent = openPrice > 0 ? ((priceChange / openPrice) * 100) : 0;

    return {
      success: true,
      data: {
        symbol,
        lastPrice,
        priceChange,
        priceChangePercent,
        high24h: parseFloat(ticker.high || "0"),
        low24h: parseFloat(ticker.low || "0"),
        volume24h: parseFloat(ticker.quoteVol || ticker.baseVol || "0"),
        timestamp: Date.now(),
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

export async function getBitunixKlines(
  symbol: string,
  timeframe: string,
  limit: number = 100
): Promise<ApiResult<Kline[]>> {
  try {
    const interval = mapTimeframeToInterval(timeframe);
    const response = await fetchWithTimeout(
      `${BITUNIX_FUTURES_URL}/api/v1/futures/market/kline?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );

    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}`,
        errorCode: `HTTP_${response.status}`,
      };
    }

    const result = await response.json();

    if (result.code !== 0 || !result.data || result.data.length === 0) {
      return {
        success: false,
        data: null,
        error: result.msg || "No klines data",
        errorCode: "NO_DATA",
      };
    }

    const klines: Kline[] = result.data.map((k: any) => ({
      time: k.time || k.ts || k.t,
      open: parseFloat(k.open || "0"),
      high: parseFloat(k.high || "0"),
      low: parseFloat(k.low || "0"),
      close: parseFloat(k.close || "0"),
      volume: parseFloat(k.quoteVol || k.baseVol || "0"),
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
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "6h": "6h",
    "8h": "8h",
    "12h": "12h",
    "1d": "1d",
    "1D": "1d",
    "3d": "3d",
    "1w": "1w",
    "1M": "1M",
  };
  return mapping[timeframe] || "15m";
}

export async function validateBitunixCredentials(
  credentials: ApiCredentials
): Promise<boolean> {
  try {
    const headers = createBitunixHeaders(credentials);
    const url = `${BITUNIX_FUTURES_URL}/api/v1/futures/account`;

    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers,
    });

    if (response.ok) {
      const data = await response.json();
      return data.code === 0;
    }

    return false;
  } catch (error) {
    console.warn("Bitunix credential validation failed:", error);
    return false;
  }
}
