import { Clock, CheckCircle, XCircle, AlertCircle, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTradingContext } from "@/lib/tradingContext";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus } from "@shared/schema";

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

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getStatusConfig(status: OrderStatus) {
  switch (status) {
    case "filled":
      return {
        icon: CheckCircle,
        color: "text-profit",
        bgColor: "bg-profit/10",
        label: "Filled",
      };
    case "cancelled":
      return {
        icon: XCircle,
        color: "text-loss",
        bgColor: "bg-loss/10",
        label: "Cancelled",
      };
    case "partial":
      return {
        icon: AlertCircle,
        color: "text-yellow-500",
        bgColor: "bg-yellow-500/10",
        label: "Partial",
      };
    default:
      return {
        icon: Clock,
        color: "text-muted-foreground",
        bgColor: "bg-muted",
        label: "Pending",
      };
  }
}

function OrderRow({ order }: { order: Order }) {
  const isBuy = order.side === "buy";
  const statusConfig = getStatusConfig(order.status);
  const StatusIcon = statusConfig.icon;

  return (
    <TableRow 
      className="hover-elevate"
      data-testid={`row-order-${order.id}`}
    >
      <TableCell className="font-mono text-xs text-muted-foreground">
        {order.id.slice(0, 8)}...
      </TableCell>
      <TableCell>
        <span className="font-mono font-medium">{order.symbol}</span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              isBuy ? "text-profit border-profit/30" : "text-loss border-loss/30"
            )}
          >
            {order.side.toUpperCase()}
          </Badge>
          <Badge variant="outline" className="text-xs capitalize">
            {order.type}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatPrice(order.price)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {order.quantity.toFixed(4)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
        {order.filledQuantity.toFixed(4)}
      </TableCell>
      <TableCell>
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md w-fit",
          statusConfig.bgColor
        )}>
          <StatusIcon className={cn("h-3.5 w-3.5", statusConfig.color)} />
          <span className={cn("text-xs font-medium", statusConfig.color)}>
            {statusConfig.label}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-muted-foreground">
        {formatTime(order.timestamp)}
      </TableCell>
    </TableRow>
  );
}

export function OrdersTable() {
  const { orders, setOrders, connectionState } = useTradingContext();
  const isLoading = connectionState.status === "connecting";

  const recentOrders = orders
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20);

  const handleClearOrders = () => {
    setOrders([]);
  };

  return (
    <Card data-testid="orders-table">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base flex items-center gap-2">
            Order History
            {orders.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {orders.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {orders.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={handleClearOrders}
                data-testid="button-clear-orders"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            )}
            {orders.length > 20 && (
              <Button variant="ghost" size="sm" className="text-xs">
                View all
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            Loading orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <p className="text-sm">No orders yet</p>
            <p className="text-xs mt-1">Order history will appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[300px] scrollbar-trading">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Filled</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
