import { ArrowUp, ArrowDown, X, Loader2, Shield, Target, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTradingContext } from "@/lib/tradingContext";
import { cn } from "@/lib/utils";
import type { Position } from "@shared/schema";

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

function PositionRow({ position }: { position: Position }) {
  const isProfitable = position.unrealizedPnl >= 0;
  const isLong = position.side === "long";
  const hasRiskOrders = position.stopLossPrice || position.takeProfitPrice || position.trailingStopDistance;

  return (
    <TableRow 
      className="hover-elevate"
      data-testid={`row-position-${position.id}`}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-6 h-6 rounded flex items-center justify-center",
            isLong ? "bg-profit/10" : "bg-loss/10"
          )}>
            {isLong ? (
              <ArrowUp className="h-3.5 w-3.5 text-profit" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5 text-loss" />
            )}
          </div>
          <div>
            <span className="font-mono font-medium">{position.symbol}</span>
            <div className="flex items-center gap-1 mt-0.5">
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[10px] px-1 py-0",
                  isLong ? "text-profit border-profit/30" : "text-loss border-loss/30"
                )}
              >
                {position.side.toUpperCase()}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1 py-0">
                {position.leverage}x
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize">
                {position.marginType}
              </Badge>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatPrice(position.entryPrice)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatPrice(position.markPrice)}
      </TableCell>
      <TableCell className={cn(
        "text-right font-mono tabular-nums font-medium",
        isProfitable ? "text-profit" : "text-loss"
      )}>
        <div>
          {isProfitable ? "+" : ""}{formatPrice(position.unrealizedPnl)}
        </div>
        <div className="text-xs">
          ({isProfitable ? "+" : ""}{position.unrealizedPnlPercent.toFixed(2)}%)
        </div>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {position.quantity.toFixed(4)}
      </TableCell>
      <TableCell className="text-right">
        {hasRiskOrders ? (
          <div className="flex items-center justify-end gap-1.5">
            {position.stopLossPrice && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-0.5 text-xs text-loss">
                    <Shield className="h-3 w-3" />
                    <span className="font-mono">{formatPrice(position.stopLossPrice)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Stop Loss @ {formatPrice(position.stopLossPrice)}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {position.takeProfitPrice && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-0.5 text-xs text-profit">
                    <Target className="h-3 w-3" />
                    <span className="font-mono">{formatPrice(position.takeProfitPrice)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Take Profit @ {formatPrice(position.takeProfitPrice)}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {position.trailingStopDistance && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-0.5 text-xs text-amber-500">
                    <TrendingUp className="h-3 w-3" />
                    <span className="font-mono">{position.trailingStopDistance}%</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Trailing Stop ({position.trailingStopDistance}% distance)</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-loss">
        {formatPrice(position.liquidationPrice)}
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-loss"
          data-testid={`button-close-position-${position.id}`}
        >
          <X className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function PositionsTable() {
  const { positions, connectionState } = useTradingContext();
  const isLoading = connectionState.status === "connecting";

  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const isProfitable = totalPnl >= 0;

  return (
    <Card data-testid="positions-table">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base flex items-center gap-2">
            Open Positions
            {positions.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {positions.length}
              </Badge>
            )}
          </CardTitle>
          {positions.length > 0 && (
            <div className={cn(
              "text-sm font-mono font-medium",
              isProfitable ? "text-profit" : "text-loss"
            )}>
              Total: {isProfitable ? "+" : ""}{formatPrice(totalPnl)}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Entry Price</TableHead>
                <TableHead className="text-right">Mark Price</TableHead>
                <TableHead className="text-right">PnL</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">SL / TP</TableHead>
                <TableHead className="text-right">Liq. Price</TableHead>
                <TableHead className="text-right w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 mr-2 animate-spin inline" />
                    Loading positions...
                  </TableCell>
                </TableRow>
              ) : positions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    <p className="text-sm">No open positions</p>
                    <p className="text-xs mt-1">Positions will appear here when orders are executed</p>
                  </TableCell>
                </TableRow>
              ) : (
                positions.map((position) => (
                  <PositionRow key={position.id} position={position} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
