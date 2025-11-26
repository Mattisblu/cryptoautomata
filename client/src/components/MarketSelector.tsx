import { TrendingUp, Search, Loader2 } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useTradingContext } from "@/lib/tradingContext";
import { useQuery } from "@tanstack/react-query";
import type { Market, MarketsResponse } from "@shared/schema";

export function MarketSelector() {
  const { selectedExchange, selectedMarket, setSelectedMarket, markets, setMarkets } = useTradingContext();
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery<MarketsResponse>({
    queryKey: ["/api/markets", selectedExchange],
    enabled: !!selectedExchange,
  });

  // Update markets when data changes
  useEffect(() => {
    if (data?.markets) {
      setMarkets(data.markets);
    }
  }, [data, setMarkets]);

  const filteredMarkets = useMemo(() => {
    if (!searchQuery) return markets;
    const query = searchQuery.toLowerCase();
    return markets.filter(
      (m) =>
        m.symbol.toLowerCase().includes(query) ||
        m.baseAsset.toLowerCase().includes(query)
    );
  }, [markets, searchQuery]);

  const handleMarketChange = (symbol: string) => {
    const market = markets.find((m) => m.symbol === symbol);
    if (market) {
      setSelectedMarket(market);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <TrendingUp className="h-4 w-4" />
        <span className="text-sm font-medium">Market</span>
      </div>
      <Select
        value={selectedMarket?.symbol || ""}
        onValueChange={handleMarketChange}
        disabled={!selectedExchange || isLoading}
      >
        <SelectTrigger 
          className="w-[180px]" 
          data-testid="select-market"
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground">Loading...</span>
            </div>
          ) : (
            <SelectValue placeholder="Select market" />
          )}
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          <div className="sticky top-0 p-2 bg-popover border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search markets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8"
                data-testid="input-market-search"
              />
            </div>
          </div>
          <div className="p-1">
            {filteredMarkets.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {selectedExchange ? "No markets found" : "Select an exchange first"}
              </div>
            ) : (
              filteredMarkets.map((market) => (
                <SelectItem
                  key={market.symbol}
                  value={market.symbol}
                  data-testid={`select-market-${market.symbol}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{market.baseAsset}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-muted-foreground font-mono text-sm">
                      {market.quoteAsset}
                    </span>
                  </div>
                </SelectItem>
              ))
            )}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
