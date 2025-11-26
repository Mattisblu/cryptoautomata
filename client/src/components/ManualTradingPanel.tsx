import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUp, ArrowDown, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTradingContext } from "@/lib/tradingContext";
import { manualOrderSchema, type ManualOrderInput, type OrderType, type OrderSide } from "@shared/schema";
import { cn } from "@/lib/utils";

export function ManualTradingPanel() {
  const { selectedMarket, ticker, isAuthenticated, tradeCycleState } = useTradingContext();
  const [orderSide, setOrderSide] = useState<OrderSide>("buy");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [leverage, setLeverage] = useState([10]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ManualOrderInput>({
    resolver: zodResolver(manualOrderSchema),
    defaultValues: {
      symbol: selectedMarket?.symbol || "",
      type: "market",
      side: "buy",
      quantity: 0,
      price: undefined,
      leverage: 10,
    },
  });

  const onSubmit = async (data: ManualOrderInput) => {
    setIsSubmitting(true);
    try {
      // API call would go here
      console.log("Submitting order:", {
        ...data,
        side: orderSide,
        type: orderType,
        leverage: leverage[0],
      });
      form.reset();
    } catch (error) {
      console.error("Order failed:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDisabled = !isAuthenticated || !selectedMarket || tradeCycleState.status === "running";

  return (
    <Card data-testid="manual-trading-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Manual Order
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Place orders manually using isolated margin</p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Order Side Toggle */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={orderSide === "buy" ? "default" : "outline"}
            className={cn(
              "flex items-center gap-2",
              orderSide === "buy" && "bg-profit hover:bg-profit/90 text-white border-profit"
            )}
            onClick={() => setOrderSide("buy")}
            disabled={isDisabled}
            data-testid="button-order-buy"
          >
            <ArrowUp className="h-4 w-4" />
            Long
          </Button>
          <Button
            type="button"
            variant={orderSide === "sell" ? "default" : "outline"}
            className={cn(
              "flex items-center gap-2",
              orderSide === "sell" && "bg-loss hover:bg-loss/90 text-white border-loss"
            )}
            onClick={() => setOrderSide("sell")}
            disabled={isDisabled}
            data-testid="button-order-sell"
          >
            <ArrowDown className="h-4 w-4" />
            Short
          </Button>
        </div>

        {/* Order Type */}
        <Tabs value={orderType} onValueChange={(v) => setOrderType(v as OrderType)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="market" data-testid="tab-order-market">Market</TabsTrigger>
            <TabsTrigger value="limit" data-testid="tab-order-limit">Limit</TabsTrigger>
          </TabsList>
        </Tabs>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Price (for Limit orders) */}
            {orderType === "limit" && (
              <div className="space-y-2">
                <Label htmlFor="price">Price</Label>
                <Input
                  id="price"
                  type="number"
                  step="any"
                  placeholder={ticker ? ticker.lastPrice.toString() : "0.00"}
                  {...form.register("price", { valueAsNumber: true })}
                  disabled={isDisabled}
                  className="font-mono"
                  data-testid="input-order-price"
                />
              </div>
            )}

            {/* Quantity */}
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="any"
                      placeholder="0.00"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      disabled={isDisabled}
                      className="font-mono"
                      data-testid="input-order-quantity"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Leverage Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Leverage</Label>
                <span className="text-sm font-mono font-medium">{leverage[0]}x</span>
              </div>
              <Slider
                value={leverage}
                onValueChange={setLeverage}
                min={1}
                max={125}
                step={1}
                disabled={isDisabled}
                className="py-2"
                data-testid="slider-leverage"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1x</span>
                <span>25x</span>
                <span>50x</span>
                <span>100x</span>
                <span>125x</span>
              </div>
            </div>

            {/* Isolated Margin Notice */}
            <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md">
              <span className="text-sm text-muted-foreground">Isolated Margin</span>
              <Switch checked disabled />
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className={cn(
                "w-full",
                orderSide === "buy" 
                  ? "bg-profit hover:bg-profit/90 text-white" 
                  : "bg-loss hover:bg-loss/90 text-white"
              )}
              disabled={isDisabled || isSubmitting}
              data-testid="button-submit-order"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Placing Order...
                </>
              ) : (
                <>
                  {orderSide === "buy" ? "Long" : "Short"} {selectedMarket?.baseAsset || "---"}
                </>
              )}
            </Button>

            {!isAuthenticated && (
              <p className="text-xs text-center text-muted-foreground">
                Connect your API credentials to place orders
              </p>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
