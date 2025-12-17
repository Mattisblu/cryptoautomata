import { randomUUID } from "crypto";
import { storage } from "./storage";
import type { 
  LogicalPosition, 
  InsertLogicalPosition, 
  Fill,
  PositionSide 
} from "@shared/schema";

interface OpenPositionParams {
  sessionId: string;
  algorithmId: string;
  exchange: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  leverage: number;
  allocatedMargin: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  trailingStopPercent?: number;
  exchangePositionId?: string;
  metadata?: Record<string, any>;
}

interface ClosePositionParams {
  logicalPositionId: string;
  exitPrice: number;
  quantity?: number;
  reason: string;
}

interface ExchangePositionInfo {
  exchange: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  unrealizedPnl: number;
}

interface TriggeredStop {
  position: LogicalPosition;
  trigger: "take_profit" | "stop_loss" | "trailing_stop";
  roi: number;
}

export class PositionBroker {
  private exchange: string;
  private symbol: string;
  private initialized: boolean = false;
  private trailingHighWaterMarks: Map<string, number> = new Map();
  private trailingActivated: Set<string> = new Set();

  constructor(exchange: string, symbol: string) {
    this.exchange = exchange;
    this.symbol = symbol;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
    console.log(`[PositionBroker] Initialized for ${this.exchange}:${this.symbol}`);
  }

  async openPosition(params: OpenPositionParams): Promise<LogicalPosition> {
    const id = randomUUID();
    const now = new Date();

    const logicalPosition: InsertLogicalPosition = {
      id,
      sessionId: params.sessionId,
      algorithmId: params.algorithmId,
      exchange: params.exchange,
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      remainingQuantity: params.quantity,
      entryPrice: params.entryPrice,
      leverage: params.leverage,
      allocatedMargin: params.allocatedMargin,
      takeProfitPercent: params.takeProfitPercent ?? null,
      stopLossPercent: params.stopLossPercent ?? null,
      trailingStopPercent: params.trailingStopPercent ?? null,
      status: "open",
      realizedPnl: 0,
      fees: 0,
      closeReason: null,
      openedAt: now,
      closedAt: null,
      exchangePositionId: params.exchangePositionId ?? null,
    };

    const created = await storage.createLogicalPosition(logicalPosition);

    await storage.createFill({
      logicalPositionId: id,
      orderId: null,
      exchange: params.exchange,
      symbol: params.symbol,
      side: params.side === "long" ? "buy" : "sell",
      fillType: "entry",
      quantity: params.quantity,
      price: params.entryPrice,
      fee: 0,
      feeAsset: "USDT",
      timestamp: now,
    });

    console.log(`[PositionBroker] Opened logical position ${id}: ${params.side} ${params.quantity} ${params.symbol} @ ${params.entryPrice}`);
    return created;
  }

  async closePosition(params: ClosePositionParams): Promise<{ pnl: number; closed: boolean }> {
    const position = await storage.getLogicalPosition(params.logicalPositionId);
    if (!position) {
      console.warn(`[PositionBroker] Position ${params.logicalPositionId} not found`);
      return { pnl: 0, closed: false };
    }

    if (position.status !== "open" && position.status !== "partial") {
      console.warn(`[PositionBroker] Position ${params.logicalPositionId} is already ${position.status}`);
      return { pnl: position.realizedPnl ?? 0, closed: false };
    }

    const closeQty = params.quantity ?? position.remainingQuantity;
    const actualCloseQty = Math.min(closeQty, position.remainingQuantity ?? position.quantity);

    const pnl = this.calculatePnl(
      position.side,
      position.entryPrice,
      params.exitPrice,
      actualCloseQty,
      position.leverage
    );

    const now = new Date();
    await storage.createFill({
      logicalPositionId: params.logicalPositionId,
      orderId: null,
      exchange: position.exchange,
      symbol: position.symbol,
      side: position.side === "long" ? "sell" : "buy",
      fillType: "exit",
      quantity: actualCloseQty,
      price: params.exitPrice,
      fee: 0,
      feeAsset: "USDT",
      timestamp: now,
    });

    const newRemainingQty = (position.remainingQuantity ?? position.quantity) - actualCloseQty;
    const totalRealizedPnl = (position.realizedPnl ?? 0) + pnl;

    this.trailingHighWaterMarks.delete(params.logicalPositionId);
    this.trailingActivated.delete(params.logicalPositionId);

    if (newRemainingQty <= 0.00001) {
      await storage.closeLogicalPosition(params.logicalPositionId, totalRealizedPnl, params.reason);
      console.log(`[PositionBroker] Closed logical position ${params.logicalPositionId}: PnL=${pnl.toFixed(4)} USDT, reason=${params.reason}`);
      return { pnl: totalRealizedPnl, closed: true };
    } else {
      await storage.updateLogicalPosition(params.logicalPositionId, {
        remainingQuantity: newRemainingQty,
        status: "partial",
        realizedPnl: totalRealizedPnl,
      });
      console.log(`[PositionBroker] Partially closed position ${params.logicalPositionId}: closed ${actualCloseQty}, remaining ${newRemainingQty}`);
      return { pnl: totalRealizedPnl, closed: false };
    }
  }

  calculatePnl(
    side: string,
    entryPrice: number,
    exitPrice: number,
    quantity: number,
    leverage: number
  ): number {
    const priceChange = exitPrice - entryPrice;
    const pricePct = priceChange / entryPrice;
    const roiMultiplier = side === "long" ? pricePct : -pricePct;
    const notionalValue = entryPrice * quantity;
    const margin = notionalValue / leverage;
    const pnl = margin * roiMultiplier * leverage;
    return pnl;
  }

  calculateRoi(
    side: string,
    entryPrice: number,
    currentPrice: number,
    leverage: number
  ): number {
    const priceChangePct = ((currentPrice - entryPrice) / entryPrice) * 100;
    const roi = side === "long" ? priceChangePct * leverage : -priceChangePct * leverage;
    return roi;
  }

  async getOpenPositions(): Promise<LogicalPosition[]> {
    return storage.getOpenLogicalPositions(this.exchange, this.symbol);
  }

  async getSessionPositions(sessionId: string): Promise<LogicalPosition[]> {
    return storage.getLogicalPositions({
      sessionId,
      exchange: this.exchange,
      symbol: this.symbol,
      status: "open"
    });
  }

  async checkStopConditions(currentPrice: number): Promise<TriggeredStop[]> {
    const openPositions = await this.getOpenPositions();
    const triggered: TriggeredStop[] = [];

    for (const position of openPositions) {
      const roi = this.calculateRoi(position.side, position.entryPrice, currentPrice, position.leverage);

      if (position.takeProfitPercent !== null && roi >= position.takeProfitPercent) {
        triggered.push({ position, trigger: "take_profit", roi });
        continue;
      }

      if (position.stopLossPercent !== null && roi <= -position.stopLossPercent) {
        triggered.push({ position, trigger: "stop_loss", roi });
        continue;
      }

      if (position.trailingStopPercent !== null) {
        const highWaterMark = this.trailingHighWaterMarks.get(position.id) ?? roi;
        
        if (roi > highWaterMark) {
          this.trailingHighWaterMarks.set(position.id, roi);
          this.trailingActivated.add(position.id);
        } else if (this.trailingActivated.has(position.id)) {
          const currentHigh = this.trailingHighWaterMarks.get(position.id) ?? 0;
          if (currentHigh - roi >= position.trailingStopPercent) {
            triggered.push({ position, trigger: "trailing_stop", roi });
          }
        }
      }
    }

    return triggered;
  }

  async reconcileWithExchange(exchangePosition: ExchangePositionInfo | null): Promise<{
    hasDrift: boolean;
    localNetQty: number;
    exchangeNetQty: number;
    driftQty: number;
  }> {
    const openPositions = await this.getOpenPositions();

    let localLongQty = 0;
    let localShortQty = 0;
    let totalEntryValue = 0;
    let totalQty = 0;
    
    for (const pos of openPositions) {
      const qty = pos.remainingQuantity ?? pos.quantity;
      if (pos.side === "long") {
        localLongQty += qty;
      } else {
        localShortQty += qty;
      }
      totalEntryValue += pos.entryPrice * qty;
      totalQty += qty;
    }
    
    const localNetQty = localLongQty - localShortQty;
    const localAvgEntry = totalQty > 0 ? totalEntryValue / totalQty : 0;
    const localSide = localLongQty > localShortQty ? "long" : localShortQty > localLongQty ? "short" : null;

    const exchangeNetQty = exchangePosition
      ? (exchangePosition.side === "long" ? exchangePosition.quantity : -exchangePosition.quantity)
      : 0;
    const exchangeAvgEntry = exchangePosition?.entryPrice ?? 0;
    const exchangeSide = exchangePosition?.side ?? null;

    const driftQty = Math.abs(exchangeNetQty - localNetQty);
    const priceDrift = Math.abs(exchangeAvgEntry - localAvgEntry);
    const hasDrift = driftQty > 0.00001;

    if (hasDrift) {
      console.warn(`[PositionBroker] Drift detected for ${this.exchange}:${this.symbol}: local=${localNetQty}, exchange=${exchangeNetQty}, drift=${driftQty}`);

      await storage.createReconciliationSnapshot({
        exchange: this.exchange,
        symbol: this.symbol,
        localQuantity: Math.abs(localNetQty),
        localAvgEntryPrice: localAvgEntry,
        localSide: localSide,
        exchangeQuantity: Math.abs(exchangeNetQty),
        exchangeAvgEntryPrice: exchangeAvgEntry,
        exchangeSide: exchangeSide,
        quantityDrift: driftQty,
        priceDrift: priceDrift,
        hasDrift: true,
        driftResolved: false,
        resolutionNote: null,
      });
    }

    return { hasDrift, localNetQty, exchangeNetQty, driftQty };
  }

  async closeAllPositions(sessionId: string, currentPrice: number, reason: string): Promise<number> {
    const positions = await this.getSessionPositions(sessionId);
    let totalPnl = 0;

    for (const position of positions) {
      const result = await this.closePosition({
        logicalPositionId: position.id,
        exitPrice: currentPrice,
        reason,
      });
      totalPnl += result.pnl;
    }

    console.log(`[PositionBroker] Closed ${positions.length} positions for session ${sessionId}, total PnL: ${totalPnl.toFixed(4)}`);
    return totalPnl;
  }

  async closePositionsByReason(
    currentPrice: number,
    reason: string,
    filter?: { sessionId?: string }
  ): Promise<{ closedCount: number; totalPnl: number; closedPositions: LogicalPosition[] }> {
    let positions: LogicalPosition[];
    
    if (filter?.sessionId) {
      positions = await this.getSessionPositions(filter.sessionId);
    } else {
      positions = await this.getOpenPositions();
    }

    let totalPnl = 0;
    const closedPositions: LogicalPosition[] = [];

    for (const position of positions) {
      const result = await this.closePosition({
        logicalPositionId: position.id,
        exitPrice: currentPrice,
        reason,
      });
      
      if (result.closed) {
        totalPnl += result.pnl;
        closedPositions.push(position);
      }
    }

    console.log(`[PositionBroker] Bulk closed ${closedPositions.length} positions for reason "${reason}", total PnL: ${totalPnl.toFixed(4)}`);
    return { closedCount: closedPositions.length, totalPnl, closedPositions };
  }

  async getPositionCount(sessionId?: string): Promise<number> {
    if (sessionId) {
      const positions = await this.getSessionPositions(sessionId);
      return positions.length;
    }
    const positions = await this.getOpenPositions();
    return positions.length;
  }
}

const brokerInstances: Map<string, PositionBroker> = new Map();

export function getPositionBroker(exchange: string, symbol: string): PositionBroker {
  const key = `${exchange}:${symbol}`;
  let broker = brokerInstances.get(key);
  if (!broker) {
    broker = new PositionBroker(exchange, symbol);
    broker.initialize();
    brokerInstances.set(key, broker);
  }
  return broker;
}

export function clearPositionBrokers(): void {
  brokerInstances.clear();
}
