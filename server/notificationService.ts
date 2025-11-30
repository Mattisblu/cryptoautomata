import { storage } from "./storage";
import type { InsertNotification, NotificationType, NotificationSettings } from "@shared/schema";

interface NotificationPayload {
  type: NotificationType;
  title: string;
  message: string;
  exchange?: string;
  symbol?: string;
  pnl?: number;
  data?: Record<string, unknown>;
}

interface WSClient {
  readyState: number;
  send: (data: string) => void;
}

class NotificationService {
  private wsClients: Set<WSClient> = new Set();
  private settings: NotificationSettings | null = null;

  registerClient(ws: WSClient): void {
    this.wsClients.add(ws);
  }

  unregisterClient(ws: WSClient): void {
    this.wsClients.delete(ws);
  }

  private async getSettings(): Promise<NotificationSettings | null> {
    if (!this.settings) {
      this.settings = await storage.getNotificationSettings();
    }
    return this.settings;
  }

  invalidateSettings(): void {
    this.settings = null;
  }

  private shouldNotify(type: NotificationType, settings: NotificationSettings | null, pnl?: number): boolean {
    if (!settings) return true;

    switch (type) {
      case "trade_open":
        return settings.tradeOpenEnabled;
      case "trade_close":
        if (!settings.tradeCloseEnabled) return false;
        if (settings.minPnlAlert && pnl !== undefined) {
          return Math.abs(pnl) >= settings.minPnlAlert;
        }
        return true;
      case "stop_loss":
        return settings.stopLossEnabled;
      case "take_profit":
        return settings.takeProfitEnabled;
      case "trailing_stop":
        // Trailing stop uses stop loss setting since both are exit mechanisms
        return settings.stopLossEnabled;
      case "error":
      case "info":
        return true;
      default:
        return true;
    }
  }

  async notify(payload: NotificationPayload): Promise<void> {
    const settings = await this.getSettings();
    
    if (!this.shouldNotify(payload.type, settings, payload.pnl)) {
      return;
    }

    try {
      const notification: InsertNotification = {
        type: payload.type,
        title: payload.title,
        message: payload.message,
        exchange: payload.exchange || null,
        symbol: payload.symbol || null,
        pnl: payload.pnl || null,
        data: payload.data ? JSON.stringify(payload.data) : null,
        isRead: false,
      };

      const savedNotification = await storage.createNotification(notification);

      this.broadcastToClients({
        type: "notification",
        notification: savedNotification,
      });

      if (settings?.browserEnabled) {
        this.broadcastToClients({
          type: "browser_notification",
          title: payload.title,
          message: payload.message,
          notificationType: payload.type,
        });
      }

      if (settings?.soundEnabled) {
        this.broadcastToClients({
          type: "play_sound",
          sound: payload.type === "error" ? "error" : payload.pnl && payload.pnl > 0 ? "profit" : "loss",
        });
      }

    } catch (error) {
      console.error("Failed to create notification:", error);
    }
  }

  private broadcastToClients(message: unknown): void {
    const data = JSON.stringify(message);
    this.wsClients.forEach((client) => {
      try {
        if (client.readyState === 1) {
          client.send(data);
        }
      } catch (error) {
        console.error("Failed to send to WebSocket client:", error);
      }
    });
  }

  async notifyTradeOpen(
    exchange: string,
    symbol: string,
    side: string,
    quantity: number,
    price: number,
    executionMode: string
  ): Promise<void> {
    const modeLabel = executionMode === "paper" ? "[PAPER]" : "[REAL]";
    await this.notify({
      type: "trade_open",
      title: `${modeLabel} Position Opened`,
      message: `Opened ${side.toUpperCase()} ${quantity.toFixed(6)} ${symbol} @ $${price.toFixed(2)}`,
      exchange,
      symbol,
      data: { side, quantity, price, executionMode },
    });
  }

  async notifyTradeClose(
    exchange: string,
    symbol: string,
    side: string,
    pnl: number,
    closeReason: string,
    executionMode: string
  ): Promise<void> {
    const modeLabel = executionMode === "paper" ? "[PAPER]" : "[REAL]";
    const pnlLabel = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    await this.notify({
      type: "trade_close",
      title: `${modeLabel} Position Closed`,
      message: `Closed ${side.toUpperCase()} ${symbol} with PnL: ${pnlLabel} (${closeReason})`,
      exchange,
      symbol,
      pnl,
      data: { side, closeReason, executionMode },
    });
  }

  async notifyStopLoss(
    exchange: string,
    symbol: string,
    side: string,
    pnl: number,
    executionMode: string
  ): Promise<void> {
    const modeLabel = executionMode === "paper" ? "[PAPER]" : "[REAL]";
    await this.notify({
      type: "stop_loss",
      title: `${modeLabel} Stop-Loss Triggered`,
      message: `Stop-loss hit on ${side.toUpperCase()} ${symbol}. Loss: $${Math.abs(pnl).toFixed(2)}`,
      exchange,
      symbol,
      pnl,
      data: { side, executionMode },
    });
  }

  async notifyTakeProfit(
    exchange: string,
    symbol: string,
    side: string,
    pnl: number,
    executionMode: string
  ): Promise<void> {
    const modeLabel = executionMode === "paper" ? "[PAPER]" : "[REAL]";
    await this.notify({
      type: "take_profit",
      title: `${modeLabel} Take-Profit Hit`,
      message: `Take-profit reached on ${side.toUpperCase()} ${symbol}. Profit: +$${pnl.toFixed(2)}`,
      exchange,
      symbol,
      pnl,
      data: { side, executionMode },
    });
  }

  async notifyTrailingStop(
    exchange: string,
    symbol: string,
    side: string,
    pnl: number,
    executionMode: string
  ): Promise<void> {
    const modeLabel = executionMode === "paper" ? "[PAPER]" : "[REAL]";
    const pnlLabel = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
    await this.notify({
      type: "trailing_stop",
      title: `${modeLabel} Trailing Stop Triggered`,
      message: `Trailing stop hit on ${side.toUpperCase()} ${symbol}. PnL: ${pnlLabel}`,
      exchange,
      symbol,
      pnl,
      data: { side, executionMode },
    });
  }

  async notifyError(message: string, details?: Record<string, unknown>): Promise<void> {
    await this.notify({
      type: "error",
      title: "Trading Error",
      message,
      data: details,
    });
  }

  async notifyInfo(title: string, message: string): Promise<void> {
    await this.notify({
      type: "info",
      title,
      message,
    });
  }
}

export const notificationService = new NotificationService();
