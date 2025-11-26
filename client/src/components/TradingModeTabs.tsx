import { Bot, Zap, Hand } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTradingContext } from "@/lib/tradingContext";
import type { TradingMode } from "@shared/schema";

interface TradingModeConfig {
  value: TradingMode;
  label: string;
  icon: typeof Bot;
  description: string;
}

const tradingModes: TradingModeConfig[] = [
  {
    value: "ai-trading",
    label: "AI Trading",
    icon: Bot,
    description: "Automated trading with AI-generated algorithms",
  },
  {
    value: "ai-scalping",
    label: "AI Scalping",
    icon: Zap,
    description: "High-frequency automated scalping strategies",
  },
  {
    value: "manual",
    label: "Manual",
    icon: Hand,
    description: "Execute trades manually with full control",
  },
];

export function TradingModeTabs() {
  const { tradingMode, setTradingMode, tradeCycleState } = useTradingContext();
  const isRunning = tradeCycleState.status === "running";

  return (
    <Tabs
      value={tradingMode}
      onValueChange={(v) => setTradingMode(v as TradingMode)}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-3 bg-muted/50">
        {tradingModes.map((mode) => {
          const Icon = mode.icon;
          return (
            <TabsTrigger
              key={mode.value}
              value={mode.value}
              disabled={isRunning && mode.value !== tradingMode}
              className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              data-testid={`tab-${mode.value}`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{mode.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
