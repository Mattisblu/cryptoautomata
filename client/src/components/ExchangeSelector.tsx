import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTradingContext } from "@/lib/tradingContext";
import type { Exchange } from "@shared/schema";

const exchangeInfo: Record<Exchange, { name: string; logo: string }> = {
  coinstore: { name: "Coinstore", logo: "CS" },
  bydfi: { name: "BYDFI", logo: "BY" },
  bitunex: { name: "Bitunex", logo: "BX" },
  toobit: { name: "Toobit", logo: "TB" },
};

export function ExchangeSelector() {
  const { selectedExchange, setSelectedExchange, setSelectedMarket, setMarkets } = useTradingContext();

  const handleExchangeChange = (value: string) => {
    const exchange = value as Exchange;
    setSelectedExchange(exchange);
    setSelectedMarket(null);
    setMarkets([]);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Building2 className="h-4 w-4" />
        <span className="text-sm font-medium">Exchange</span>
      </div>
      <Select
        value={selectedExchange || ""}
        onValueChange={handleExchangeChange}
      >
        <SelectTrigger 
          className="w-[160px]" 
          data-testid="select-exchange"
        >
          <SelectValue placeholder="Select exchange" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(exchangeInfo).map(([key, info]) => (
            <SelectItem 
              key={key} 
              value={key}
              data-testid={`select-exchange-${key}`}
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                  {info.logo}
                </div>
                <span>{info.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
