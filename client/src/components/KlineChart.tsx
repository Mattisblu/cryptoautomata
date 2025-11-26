import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi, type ISeriesApi, type CandlestickData, type Time } from "lightweight-charts";
import { useTradingContext } from "@/lib/tradingContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RefreshCw, Maximize2, Minimize2 } from "lucide-react";

const timeframes = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1h" },
  { label: "4H", value: "4h" },
  { label: "1D", value: "1d" },
];

export function KlineChart() {
  const { klines, selectedMarket, theme } = useTradingContext();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState("15m");
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const isDark = theme === "dark";
    
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: isDark ? "#a1a1aa" : "#71717a",
        fontFamily: "JetBrains Mono, monospace",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
      },
      crosshair: {
        vertLine: { 
          color: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
          labelBackgroundColor: isDark ? "#27272a" : "#e4e4e7",
        },
        horzLine: { 
          color: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
          labelBackgroundColor: isDark ? "#27272a" : "#e4e4e7",
        },
      },
      timeScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { vertTouchDrag: true },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [theme]);

  // Update chart data when klines change
  useEffect(() => {
    if (seriesRef.current && klines.length > 0) {
      const chartData: CandlestickData<Time>[] = klines.map((k) => ({
        time: (k.time / 1000) as Time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      }));
      seriesRef.current.setData(chartData);
      chartRef.current?.timeScale().fitContent();
    }
  }, [klines]);

  if (!selectedMarket) {
    return (
      <div className={cn(
        "bg-card rounded-md border flex items-center justify-center text-muted-foreground",
        isExpanded ? "h-[500px]" : "h-[350px]"
      )}>
        <div className="text-center">
          <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Select a market to view chart</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "bg-card rounded-md border flex flex-col",
        isExpanded ? "h-[500px]" : "h-[350px]"
      )}
      data-testid="kline-chart"
    >
      {/* Chart Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b gap-4">
        <div className="flex items-center gap-1">
          {timeframes.map((tf) => (
            <Button
              key={tf.value}
              variant={selectedTimeframe === tf.value ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs font-mono"
              onClick={() => setSelectedTimeframe(tf.value)}
              data-testid={`button-timeframe-${tf.value}`}
            >
              {tf.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => chartRef.current?.timeScale().fitContent()}
            data-testid="button-chart-reset"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsExpanded(!isExpanded)}
            data-testid="button-chart-expand"
          >
            {isExpanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
      
      {/* Chart Container */}
      <div 
        ref={chartContainerRef} 
        className="flex-1 min-h-0"
      />
    </div>
  );
}
