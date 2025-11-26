import { ArrowUp, ArrowDown, Minus, Activity, BarChart2, TrendingUp, TrendingDown } from "lucide-react";
import { useTradingContext } from "@/lib/tradingContext";
import { cn } from "@/lib/utils";

function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K";
  }
  return num.toFixed(decimals);
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (price >= 1) {
    return price.toFixed(4);
  }
  return price.toFixed(8);
}

export function TickerBar() {
  const { ticker, selectedMarket, connectionState } = useTradingContext();

  if (!selectedMarket) {
    return (
      <div className="h-14 bg-card border-t flex items-center justify-center text-muted-foreground text-sm">
        <Activity className="h-4 w-4 mr-2" />
        Select a market to view ticker data
      </div>
    );
  }

  if (!ticker) {
    return (
      <div className="h-14 bg-card border-t flex items-center justify-center text-muted-foreground text-sm">
        <Activity className="h-4 w-4 mr-2 animate-pulse" />
        Loading ticker data...
      </div>
    );
  }

  const isPriceUp = ticker.priceChangePercent >= 0;
  const PriceIcon = isPriceUp ? ArrowUp : ArrowDown;
  const TrendIcon = isPriceUp ? TrendingUp : TrendingDown;

  return (
    <div 
      className="h-14 bg-card border-t flex items-center justify-between px-4 gap-6 overflow-x-auto scrollbar-trading"
      data-testid="ticker-bar"
    >
      {/* Symbol & Last Price */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <TrendIcon className={cn("h-5 w-5", isPriceUp ? "text-profit" : "text-loss")} />
          <span className="font-mono font-semibold text-lg">
            {selectedMarket.baseAsset}
            <span className="text-muted-foreground">/{selectedMarket.quoteAsset}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span 
            className={cn(
              "font-mono text-xl font-bold tabular-nums",
              isPriceUp ? "text-profit" : "text-loss"
            )}
            data-testid="text-last-price"
          >
            {formatPrice(ticker.lastPrice)}
          </span>
          <div
            className={cn(
              "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium",
              isPriceUp ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
            )}
          >
            <PriceIcon className="h-3 w-3" />
            <span className="font-mono" data-testid="text-price-change">
              {Math.abs(ticker.priceChangePercent).toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* 24h Stats */}
      <div className="flex items-center gap-6 text-sm shrink-0">
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">24h High</span>
          <span className="font-mono text-profit tabular-nums" data-testid="text-high-24h">
            {formatPrice(ticker.high24h)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">24h Low</span>
          <span className="font-mono text-loss tabular-nums" data-testid="text-low-24h">
            {formatPrice(ticker.low24h)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">24h Volume</span>
          <span className="font-mono tabular-nums" data-testid="text-volume-24h">
            {formatNumber(ticker.volume24h)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground text-xs">24h Change</span>
          <span 
            className={cn(
              "font-mono tabular-nums",
              ticker.priceChange >= 0 ? "text-profit" : "text-loss"
            )}
            data-testid="text-price-change-abs"
          >
            {ticker.priceChange >= 0 ? "+" : ""}
            {formatPrice(ticker.priceChange)}
          </span>
        </div>
      </div>

      {/* Connection indicator */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className={cn(
            "w-2 h-2 rounded-full",
            connectionState.status === "connected" ? "bg-profit" : 
            connectionState.status === "connecting" ? "bg-yellow-500 pulse-connecting" : 
            "bg-loss"
          )}
        />
        <span className="text-xs text-muted-foreground">
          {connectionState.status === "connected" ? "Live" : 
           connectionState.status === "connecting" ? "Connecting" : "Offline"}
        </span>
      </div>
    </div>
  );
}
