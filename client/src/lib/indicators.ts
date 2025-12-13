import { SMA, EMA, MACD, RSI, BollingerBands } from "technicalindicators";

export interface IndicatorDataPoint {
  time: number;
  value: number;
}

export interface MACDDataPoint {
  time: number;
  MACD: number;
  signal: number;
  histogram: number;
}

export interface BollingerBandsDataPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

export function calculateSMA(
  times: number[],
  closes: number[],
  period: number
): IndicatorDataPoint[] {
  const result = SMA.calculate({ period, values: closes });
  const offset = closes.length - result.length;
  
  return result.map((value, i) => ({
    time: times[i + offset],
    value,
  }));
}

export function calculateEMA(
  times: number[],
  closes: number[],
  period: number
): IndicatorDataPoint[] {
  const result = EMA.calculate({ period, values: closes });
  const offset = closes.length - result.length;
  
  return result.map((value, i) => ({
    time: times[i + offset],
    value,
  }));
}

export function calculateMACD(
  times: number[],
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDDataPoint[] {
  const result = MACD.calculate({
    values: closes,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  
  const offset = closes.length - result.length;
  
  return result
    .filter((r) => r.MACD !== undefined && r.signal !== undefined && r.histogram !== undefined)
    .map((r, i) => ({
      time: times[i + offset],
      MACD: r.MACD!,
      signal: r.signal!,
      histogram: r.histogram!,
    }));
}

export function calculateRSI(
  times: number[],
  closes: number[],
  period: number = 14
): IndicatorDataPoint[] {
  const result = RSI.calculate({ period, values: closes });
  const offset = closes.length - result.length;
  
  return result.map((value, i) => ({
    time: times[i + offset],
    value,
  }));
}

export function calculateBollingerBands(
  times: number[],
  closes: number[],
  period: number = 20,
  stdDev: number = 2
): BollingerBandsDataPoint[] {
  const result = BollingerBands.calculate({
    period,
    values: closes,
    stdDev,
  });
  
  const offset = closes.length - result.length;
  
  return result.map((r, i) => ({
    time: times[i + offset],
    upper: r.upper,
    middle: r.middle,
    lower: r.lower,
  }));
}

export interface SignalMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
}

export function generateMACDSignals(
  macdData: MACDDataPoint[]
): SignalMarker[] {
  const signals: SignalMarker[] = [];
  
  for (let i = 1; i < macdData.length; i++) {
    const prev = macdData[i - 1];
    const curr = macdData[i];
    
    if (prev.histogram < 0 && curr.histogram > 0) {
      signals.push({
        time: curr.time,
        position: "belowBar",
        color: "#22c55e",
        shape: "arrowUp",
        text: "MACD Buy",
      });
    }
    
    if (prev.histogram > 0 && curr.histogram < 0) {
      signals.push({
        time: curr.time,
        position: "aboveBar",
        color: "#ef4444",
        shape: "arrowDown",
        text: "MACD Sell",
      });
    }
  }
  
  return signals;
}

export function generateRSISignals(
  rsiData: IndicatorDataPoint[],
  oversoldLevel: number = 30,
  overboughtLevel: number = 70
): SignalMarker[] {
  const signals: SignalMarker[] = [];
  
  for (let i = 1; i < rsiData.length; i++) {
    const prev = rsiData[i - 1];
    const curr = rsiData[i];
    
    if (prev.value <= oversoldLevel && curr.value > oversoldLevel) {
      signals.push({
        time: curr.time,
        position: "belowBar",
        color: "#22c55e",
        shape: "circle",
        text: "RSI Oversold",
      });
    }
    
    if (prev.value >= overboughtLevel && curr.value < overboughtLevel) {
      signals.push({
        time: curr.time,
        position: "aboveBar",
        color: "#ef4444",
        shape: "circle",
        text: "RSI Overbought",
      });
    }
  }
  
  return signals;
}
