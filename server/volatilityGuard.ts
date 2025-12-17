import { Kline } from "@shared/schema";

export interface VolatilityGuardConfig {
  enabled: boolean;
  shortWindow: number;
  longWindow: number;
  atrMultiplier: number;
  sigmaMultiplier: number;
  wickRatioThreshold: number;
  barPersistence: number;
  cooldownMs: number;
}

export const defaultVolatilityGuardConfig: VolatilityGuardConfig = {
  enabled: false,
  shortWindow: 5,
  longWindow: 30,
  atrMultiplier: 3.0,
  sigmaMultiplier: 2.5,
  wickRatioThreshold: 0.6,
  barPersistence: 2,
  cooldownMs: 60000,
};

export type VolatilitySeverity = "normal" | "elevated" | "critical";

export interface VolatilityCheckResult {
  severity: VolatilitySeverity;
  triggered: boolean;
  atrRatio: number;
  sigmaRatio: number;
  wickRatio: number;
  persistentBars: number;
  reason?: string;
}

interface KlineBuffer {
  klines: Kline[];
  lastUpdate: number;
}

const volatilityBuffers: Map<string, KlineBuffer> = new Map();
const triggerHistory: Map<string, { lastTriggered: number; persistentCount: number }> = new Map();

function getBufferKey(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

function calculateATR(klines: Kline[]): number {
  if (klines.length < 2) return 0;
  
  let sumTR = 0;
  for (let i = 1; i < klines.length; i++) {
    const current = klines[i];
    const previous = klines[i - 1];
    
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    sumTR += tr;
  }
  
  return sumTR / (klines.length - 1);
}

function calculateLogReturnSigma(klines: Kline[]): number {
  if (klines.length < 2) return 0;
  
  const logReturns: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    if (klines[i - 1].close > 0 && klines[i].close > 0) {
      logReturns.push(Math.log(klines[i].close / klines[i - 1].close));
    }
  }
  
  if (logReturns.length === 0) return 0;
  
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / logReturns.length;
  
  return Math.sqrt(variance);
}

function calculateWickRatio(kline: Kline): number {
  const body = Math.abs(kline.close - kline.open);
  const totalRange = kline.high - kline.low;
  
  if (totalRange === 0) return 0;
  
  const upperWick = kline.high - Math.max(kline.open, kline.close);
  const lowerWick = Math.min(kline.open, kline.close) - kline.low;
  const maxWick = Math.max(upperWick, lowerWick);
  
  return maxWick / totalRange;
}

function calculateAverageWickRatio(klines: Kline[]): number {
  if (klines.length === 0) return 0;
  
  const ratios = klines.map(k => calculateWickRatio(k));
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

export function updateVolatilityBuffer(
  exchange: string,
  symbol: string,
  klines: Kline[]
): void {
  const key = getBufferKey(exchange, symbol);
  volatilityBuffers.set(key, {
    klines: klines.slice(-60),
    lastUpdate: Date.now(),
  });
}

export function checkVolatility(
  exchange: string,
  symbol: string,
  config: VolatilityGuardConfig = defaultVolatilityGuardConfig
): VolatilityCheckResult {
  const defaultResult: VolatilityCheckResult = {
    severity: "normal",
    triggered: false,
    atrRatio: 0,
    sigmaRatio: 0,
    wickRatio: 0,
    persistentBars: 0,
  };
  
  if (!config.enabled) {
    return defaultResult;
  }
  
  const key = getBufferKey(exchange, symbol);
  const buffer = volatilityBuffers.get(key);
  
  if (!buffer || buffer.klines.length < config.longWindow) {
    return defaultResult;
  }
  
  const klines = buffer.klines;
  const shortKlines = klines.slice(-config.shortWindow);
  const longKlines = klines.slice(-config.longWindow);
  
  const shortATR = calculateATR(shortKlines);
  const longATR = calculateATR(longKlines);
  const atrRatio = longATR > 0 ? shortATR / longATR : 0;
  
  const shortSigma = calculateLogReturnSigma(shortKlines);
  const longSigma = calculateLogReturnSigma(longKlines);
  const sigmaRatio = longSigma > 0 ? shortSigma / longSigma : 0;
  
  const recentWickRatio = calculateAverageWickRatio(shortKlines);
  
  const triggerKey = key;
  let history = triggerHistory.get(triggerKey) || { lastTriggered: 0, persistentCount: 0 };
  
  const atrTriggered = atrRatio >= config.atrMultiplier;
  const sigmaTriggered = sigmaRatio >= config.sigmaMultiplier;
  const wickTriggered = recentWickRatio >= config.wickRatioThreshold;
  
  const isVolatileNow = atrTriggered || sigmaTriggered || wickTriggered;
  
  if (isVolatileNow) {
    history.persistentCount++;
    history.lastTriggered = Date.now();
  } else {
    history.persistentCount = Math.max(0, history.persistentCount - 1);
  }
  
  triggerHistory.set(triggerKey, history);
  
  const persistentTrigger = history.persistentCount >= config.barPersistence;
  
  // Check if we're in cooldown period (recently triggered, waiting to allow trades again)
  const inCooldown = Date.now() - history.lastTriggered < config.cooldownMs;
  
  let severity: VolatilitySeverity = "normal";
  let reason: string | undefined;
  let shouldTrigger = false;
  
  if (persistentTrigger) {
    if (atrTriggered && sigmaTriggered) {
      // Both ATR and sigma exceeded thresholds - critical volatility
      severity = "critical";
      reason = `Critical volatility spike: ATR ratio ${atrRatio.toFixed(2)}x, Sigma ratio ${sigmaRatio.toFixed(2)}x`;
      shouldTrigger = true; // Always trigger on critical
    } else if (atrTriggered || sigmaTriggered || wickTriggered) {
      // One metric exceeded threshold - elevated volatility
      severity = "elevated";
      reason = `Elevated volatility: ATR ${atrRatio.toFixed(2)}x, Sigma ${sigmaRatio.toFixed(2)}x, Wick ${(recentWickRatio * 100).toFixed(1)}%`;
      // Only trigger elevated if we're not in cooldown (prevents repeated triggers)
      shouldTrigger = !inCooldown;
    }
  }
  
  return {
    severity,
    triggered: shouldTrigger,
    atrRatio,
    sigmaRatio,
    wickRatio: recentWickRatio,
    persistentBars: history.persistentCount,
    reason,
  };
}

export function resetVolatilityGuard(exchange: string, symbol: string): void {
  const key = getBufferKey(exchange, symbol);
  triggerHistory.delete(key);
}

export function clearVolatilityBuffer(exchange: string, symbol: string): void {
  const key = getBufferKey(exchange, symbol);
  volatilityBuffers.delete(key);
  triggerHistory.delete(key);
}

export class VolatilityGuard {
  private config: VolatilityGuardConfig;
  private exchange: string;
  private symbol: string;
  
  constructor(exchange: string, symbol: string, config?: Partial<VolatilityGuardConfig>) {
    this.exchange = exchange;
    this.symbol = symbol;
    this.config = { ...defaultVolatilityGuardConfig, ...config };
  }
  
  updateConfig(config: Partial<VolatilityGuardConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  update(klines: Kline[]): void {
    updateVolatilityBuffer(this.exchange, this.symbol, klines);
  }
  
  check(): VolatilityCheckResult {
    return checkVolatility(this.exchange, this.symbol, this.config);
  }
  
  reset(): void {
    resetVolatilityGuard(this.exchange, this.symbol);
  }
  
  clear(): void {
    clearVolatilityBuffer(this.exchange, this.symbol);
  }
  
  isEnabled(): boolean {
    return this.config.enabled;
  }
  
  getConfig(): VolatilityGuardConfig {
    return { ...this.config };
  }
}

const volatilityGuards: Map<string, VolatilityGuard> = new Map();

export function getVolatilityGuard(
  exchange: string,
  symbol: string,
  config?: Partial<VolatilityGuardConfig>
): VolatilityGuard {
  const key = getBufferKey(exchange, symbol);
  let guard = volatilityGuards.get(key);
  
  if (!guard) {
    guard = new VolatilityGuard(exchange, symbol, config);
    volatilityGuards.set(key, guard);
  } else if (config) {
    guard.updateConfig(config);
  }
  
  return guard;
}

export function removeVolatilityGuard(exchange: string, symbol: string): void {
  const key = getBufferKey(exchange, symbol);
  const guard = volatilityGuards.get(key);
  if (guard) {
    guard.clear();
    volatilityGuards.delete(key);
  }
}
