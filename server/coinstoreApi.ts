import crypto from "crypto";
import type { Exchange, Market, Ticker, Kline, ApiCredentials } from "@shared/schema";

const COINSTORE_FUTURES_BASE_URL = "https://futures.coinstore.com/api";

// Structured result type for better error propagation
export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  error?: string;
  errorCode?: string;
}

interface CoinstoreResponse<T> {
  code: string;
  message: string;
  data: T;
}

interface CoinstoreContract {
  contractId: number;
  currencyId: number;
  name: string;
  displayName: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  tickSize: number;
  priceScale: number;
  maxOrderSize: number;
  minOrderSize: number;
  takerFeeRate: number;
  makerFeeRate: number;
  contractSize: number;
  minMaintRate: number;
  fundingInterval: number;
  tags: string;
  weight: number;
  riskLimits: Array<{
    maxSize: number;
    maintRate: number;
    leverage: number;
  }>;
}

interface CoinstoreTicker {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  high24h: string;
  low24h: string;
  volume24h: string;
  openPrice: string;
  timestamp: number;
}

interface CoinstoreKline {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

function generateCoinstoreSignature(secretKey: string, payload: string, expires: number): string {
  const expiresKey = String(Math.floor(expires / 30000));
  
  const hmac1 = crypto.createHmac("sha256", secretKey);
  hmac1.update(expiresKey);
  const key = hmac1.digest("hex");
  
  const hmac2 = crypto.createHmac("sha256", key);
  hmac2.update(payload);
  return hmac2.digest("hex");
}

function createAuthHeaders(credentials: ApiCredentials, payload: string = ""): Record<string, string> {
  const expires = Date.now();
  const signature = generateCoinstoreSignature(credentials.secretKey, payload, expires);
  
  return {
    "X-CS-APIKEY": credentials.apiKey,
    "X-CS-EXPIRES": String(expires),
    "X-CS-SIGN": signature,
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

export async function getCoinstoreContracts(): Promise<Market[]> {
  try {
    const response = await fetchWithTimeout(`${COINSTORE_FUTURES_BASE_URL}/configs/public`);
    
    if (!response.ok) {
      console.error(`Coinstore contracts API error: ${response.status}`);
      return [];
    }
    
    const data: CoinstoreResponse<{ contracts: CoinstoreContract[] }> = await response.json();
    
    if (data.code !== "0" || !data.data?.contracts) {
      console.error("Coinstore contracts response error:", data.message);
      return [];
    }
    
    return data.data.contracts
      .filter(c => c.quoteAsset === "USDT")
      .map(contract => {
        const maxLeverage = contract.riskLimits?.[0]?.leverage || 100;
        return {
          symbol: contract.name,
          baseAsset: contract.baseAsset,
          quoteAsset: contract.quoteAsset,
          pricePrecision: contract.priceScale,
          quantityPrecision: Math.max(0, Math.ceil(-Math.log10(contract.contractSize))),
          maxLeverage,
        };
      });
  } catch (error) {
    console.error("Failed to fetch Coinstore contracts:", error);
    return [];
  }
}

export async function getCoinstoreTicker(symbol: string): Promise<ApiResult<Ticker>> {
  try {
    const contractId = await getContractIdBySymbol(symbol);
    if (!contractId) {
      return {
        success: false,
        data: null,
        error: `Contract ID not found for symbol: ${symbol}`,
        errorCode: "CONTRACT_NOT_FOUND"
      };
    }
    
    const response = await fetchWithTimeout(
      `${COINSTORE_FUTURES_BASE_URL}/ticker/price?contractId=${contractId}`
    );
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `Coinstore ticker API returned status ${response.status}`,
        errorCode: "HTTP_ERROR"
      };
    }
    
    const data = await response.json();
    
    if (data.code !== "0" || !data.data) {
      return {
        success: false,
        data: null,
        error: data.message || "Invalid ticker response",
        errorCode: "API_ERROR"
      };
    }
    
    const tickerData = data.data;
    const lastPrice = parseFloat(tickerData.lastPrice || tickerData.price || "0");
    const openPrice = parseFloat(tickerData.openPrice || tickerData.open24h || lastPrice.toString());
    const priceChange = lastPrice - openPrice;
    const priceChangePercent = openPrice > 0 ? (priceChange / openPrice) * 100 : 0;
    
    return {
      success: true,
      data: {
        symbol,
        lastPrice,
        priceChange,
        priceChangePercent,
        high24h: parseFloat(tickerData.high24h || tickerData.highPrice || lastPrice.toString()),
        low24h: parseFloat(tickerData.low24h || tickerData.lowPrice || lastPrice.toString()),
        volume24h: parseFloat(tickerData.volume24h || tickerData.volume || "0"),
        timestamp: tickerData.timestamp || Date.now(),
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[COINSTORE] Failed to fetch ticker:", errorMessage);
    return {
      success: false,
      data: null,
      error: `Failed to fetch Coinstore ticker: ${errorMessage}`,
      errorCode: "NETWORK_ERROR"
    };
  }
}

export async function getCoinstoreKlines(
  symbol: string, 
  timeframe: string, 
  limit: number = 100
): Promise<ApiResult<Kline[]>> {
  try {
    const contractId = await getContractIdBySymbol(symbol);
    if (!contractId) {
      return {
        success: false,
        data: null,
        error: `Contract ID not found for symbol: ${symbol}`,
        errorCode: "CONTRACT_NOT_FOUND"
      };
    }
    
    const interval = mapTimeframeToInterval(timeframe);
    const endTime = Date.now();
    const startTime = endTime - (limit * getTimeframeMs(timeframe));
    
    const response = await fetchWithTimeout(
      `${COINSTORE_FUTURES_BASE_URL}/kline?contractId=${contractId}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`
    );
    
    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `Coinstore klines API returned status ${response.status}`,
        errorCode: "HTTP_ERROR"
      };
    }
    
    const data = await response.json();
    
    if (data.code !== "0" || !data.data) {
      return {
        success: false,
        data: null,
        error: data.message || "Invalid klines response",
        errorCode: "API_ERROR"
      };
    }
    
    const klines: Kline[] = (data.data.klines || data.data || []).map((k: any) => ({
      time: k.time || k[0],
      open: parseFloat(k.open || k[1] || "0"),
      high: parseFloat(k.high || k[2] || "0"),
      low: parseFloat(k.low || k[3] || "0"),
      close: parseFloat(k.close || k[4] || "0"),
      volume: parseFloat(k.volume || k[5] || "0"),
    }));
    
    return {
      success: true,
      data: klines.sort((a, b) => a.time - b.time)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[COINSTORE] Failed to fetch klines:", errorMessage);
    return {
      success: false,
      data: null,
      error: `Failed to fetch Coinstore klines: ${errorMessage}`,
      errorCode: "NETWORK_ERROR"
    };
  }
}

const contractIdCache: Map<string, number> = new Map();
let contractsCacheTime = 0;
let contractCacheInitialized = false;

function normalizeSymbol(symbol: string): string[] {
  const base = symbol.toUpperCase();
  const variants: string[] = [base];
  
  if (base.includes("USDT")) {
    const baseAsset = base.replace("USDT", "");
    variants.push(`${baseAsset}-USDT`);
    variants.push(`${baseAsset}USDT`);
    variants.push(`${baseAsset}-USDT-PERPETUAL`);
    variants.push(`${baseAsset}USDT-PERPETUAL`);
    variants.push(`${baseAsset}_USDT`);
    variants.push(`${baseAsset}/USDT`);
  }
  
  return [...new Set(variants)];
}

async function getContractIdBySymbol(symbol: string): Promise<number | null> {
  if (Date.now() - contractsCacheTime > 3600000) {
    contractIdCache.clear();
    contractCacheInitialized = false;
  }
  
  const symbolVariants = normalizeSymbol(symbol);
  
  for (const variant of symbolVariants) {
    if (contractIdCache.has(variant)) {
      return contractIdCache.get(variant) || null;
    }
  }
  
  if (contractCacheInitialized) {
    return null;
  }
  
  try {
    const response = await fetchWithTimeout(`${COINSTORE_FUTURES_BASE_URL}/configs/public`);
    if (!response.ok) {
      console.warn(`Coinstore configs API returned status: ${response.status}`);
      return null;
    }
    
    const data: CoinstoreResponse<{ contracts: CoinstoreContract[] }> = await response.json();
    if (data.code !== "0" || !data.data?.contracts) {
      console.warn("Coinstore configs response invalid:", data.message || "No contracts data");
      return null;
    }
    
    contractsCacheTime = Date.now();
    contractCacheInitialized = true;
    
    for (const contract of data.data.contracts) {
      contractIdCache.set(contract.name.toUpperCase(), contract.contractId);
      if (contract.displayName) {
        contractIdCache.set(contract.displayName.toUpperCase(), contract.contractId);
      }
    }
    
    if (contractIdCache.size > 0) {
      console.log(`[COINSTORE] Loaded ${contractIdCache.size} contracts. Available: ${Array.from(contractIdCache.keys()).slice(0, 5).join(", ")}...`);
    }
    
    for (const variant of symbolVariants) {
      if (contractIdCache.has(variant)) {
        return contractIdCache.get(variant) || null;
      }
    }
    
    return null;
  } catch (error) {
    console.warn("Failed to fetch Coinstore contract configs:", error);
    return null;
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

export async function validateCoinstoreCredentials(credentials: ApiCredentials): Promise<boolean> {
  try {
    const payload = "";
    const headers = createAuthHeaders(credentials, payload);
    
    const response = await fetchWithTimeout(
      `${COINSTORE_FUTURES_BASE_URL}/user/balance`,
      { headers }
    );
    
    return response.status === 200;
  } catch {
    return false;
  }
}
