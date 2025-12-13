import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createChart, ColorType, CandlestickSeries, LineSeries, HistogramSeries, type IChartApi, type ISeriesApi, type CandlestickData, type Time, type LineData, type HistogramData, type SeriesMarker } from "lightweight-charts";
import { useTradingContext } from "@/lib/tradingContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RefreshCw, Maximize2, Minimize2, TrendingUp, Activity, BarChart3 } from "lucide-react";
import {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateBollingerBands,
  generateMACDSignals,
  type IndicatorDataPoint,
  type MACDDataPoint,
  type BollingerBandsDataPoint,
} from "@/lib/indicators";

const timeframes = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1h" },
  { label: "4H", value: "4h" },
  { label: "1D", value: "1d" },
];

interface IndicatorState {
  sma: boolean;
  ema: boolean;
  macd: boolean;
  bb: boolean;
  signals: boolean;
}

export function KlineChart() {
  const { klines, selectedMarket, theme, timeframe, setTimeframe } = useTradingContext();
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [macdContainerEl, setMacdContainerEl] = useState<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMiddleRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistogramRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorState>({
    sma: false,
    ema: true,
    macd: false,
    bb: false,
    signals: true,
  });

  const containerRefCallback = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  const macdContainerRefCallback = useCallback((node: HTMLDivElement | null) => {
    setMacdContainerEl(node);
  }, []);

  const toggleIndicator = (key: keyof IndicatorState) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isDark = theme === "dark";

  useEffect(() => {
    if (!containerEl) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
      bbUpperRef.current = null;
      bbMiddleRef.current = null;
      bbLowerRef.current = null;
    }

    const chart = createChart(containerEl, {
      width: containerEl.clientWidth,
      height: containerEl.clientHeight,
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

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const smaSeries = chart.addSeries(LineSeries, {
      color: "#3b82f6",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const emaSeries = chart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbUpper = chart.addSeries(LineSeries, {
      color: "#8b5cf6",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbMiddle = chart.addSeries(LineSeries, {
      color: "#8b5cf6",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const bbLower = chart.addSeries(LineSeries, {
      color: "#8b5cf6",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;
    smaSeriesRef.current = smaSeries;
    emaSeriesRef.current = emaSeries;
    bbUpperRef.current = bbUpper;
    bbMiddleRef.current = bbMiddle;
    bbLowerRef.current = bbLower;

    const handleResize = () => {
      if (containerEl && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerEl.clientWidth,
          height: containerEl.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
      bbUpperRef.current = null;
      bbMiddleRef.current = null;
      bbLowerRef.current = null;
    };
  }, [containerEl, isDark]);

  useEffect(() => {
    if (!macdContainerEl || !indicators.macd) return;

    if (macdChartRef.current) {
      macdChartRef.current.remove();
      macdChartRef.current = null;
      macdLineRef.current = null;
      macdSignalRef.current = null;
      macdHistogramRef.current = null;
    }

    const macdChart = createChart(macdContainerEl, {
      width: macdContainerEl.clientWidth,
      height: macdContainerEl.clientHeight,
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

    const macdHistogram = macdChart.addSeries(HistogramSeries, {
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const macdLine = macdChart.addSeries(LineSeries, {
      color: "#3b82f6",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const macdSignal = macdChart.addSeries(LineSeries, {
      color: "#f59e0b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    macdChartRef.current = macdChart;
    macdHistogramRef.current = macdHistogram;
    macdLineRef.current = macdLine;
    macdSignalRef.current = macdSignal;

    // Set initial data if available
    if (klines.length >= 30) {
      const times = klines.map((k) => k.time / 1000);
      const closes = klines.map((k) => k.close);
      const initialMacdData = calculateMACD(times, closes, 12, 26, 9);
      
      if (initialMacdData.length > 0) {
        macdLine.setData(initialMacdData.map((d) => ({ time: d.time as Time, value: d.MACD })));
        macdSignal.setData(initialMacdData.map((d) => ({ time: d.time as Time, value: d.signal })));
        macdHistogram.setData(
          initialMacdData.map((d) => ({
            time: d.time as Time,
            value: d.histogram,
            color: d.histogram >= 0 ? "#22c55e" : "#ef4444",
          }))
        );
        macdChart.timeScale().fitContent();
      }
    }

    const handleResize = () => {
      if (macdContainerEl && macdChartRef.current) {
        macdChartRef.current.applyOptions({
          width: macdContainerEl.clientWidth,
          height: macdContainerEl.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (macdChartRef.current) {
        macdChartRef.current.remove();
        macdChartRef.current = null;
        macdLineRef.current = null;
        macdSignalRef.current = null;
        macdHistogramRef.current = null;
      }
    };
  }, [macdContainerEl, indicators.macd, isDark, klines]);

  const { smaData, emaData, bbData, macdData } = useMemo(() => {
    if (klines.length < 30) {
      return { smaData: [], emaData: [], bbData: [], macdData: [] };
    }

    const times = klines.map((k) => k.time / 1000);
    const closes = klines.map((k) => k.close);

    return {
      smaData: calculateSMA(times, closes, 20),
      emaData: calculateEMA(times, closes, 20),
      bbData: calculateBollingerBands(times, closes, 20, 2),
      macdData: calculateMACD(times, closes, 12, 26, 9),
    };
  }, [klines]);

  const macdSignals = useMemo(() => {
    if (!indicators.signals || macdData.length === 0) return [];
    return generateMACDSignals(macdData);
  }, [macdData, indicators.signals]);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    if (klines.length > 0) {
      const chartData: CandlestickData<Time>[] = klines.map((k) => ({
        time: (k.time / 1000) as Time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      }));
      seriesRef.current.setData(chartData);

      if (indicators.signals && macdSignals.length > 0) {
        const markers: SeriesMarker<Time>[] = macdSignals.map((s) => ({
          time: s.time as Time,
          position: s.position,
          color: s.color,
          shape: s.shape,
          text: s.text,
        }));
        seriesRef.current.setMarkers(markers);
      } else {
        seriesRef.current.setMarkers([]);
      }

      chartRef.current.timeScale().fitContent();
    }
  }, [klines, macdSignals, indicators.signals]);

  useEffect(() => {
    if (!smaSeriesRef.current) return;

    if (indicators.sma && smaData.length > 0) {
      const data: LineData<Time>[] = smaData.map((d) => ({
        time: d.time as Time,
        value: d.value,
      }));
      smaSeriesRef.current.setData(data);
      smaSeriesRef.current.applyOptions({ visible: true });
    } else {
      smaSeriesRef.current.setData([]);
      smaSeriesRef.current.applyOptions({ visible: false });
    }
  }, [smaData, indicators.sma]);

  useEffect(() => {
    if (!emaSeriesRef.current) return;

    if (indicators.ema && emaData.length > 0) {
      const data: LineData<Time>[] = emaData.map((d) => ({
        time: d.time as Time,
        value: d.value,
      }));
      emaSeriesRef.current.setData(data);
      emaSeriesRef.current.applyOptions({ visible: true });
    } else {
      emaSeriesRef.current.setData([]);
      emaSeriesRef.current.applyOptions({ visible: false });
    }
  }, [emaData, indicators.ema]);

  useEffect(() => {
    if (!bbUpperRef.current || !bbMiddleRef.current || !bbLowerRef.current) return;

    if (indicators.bb && bbData.length > 0) {
      bbUpperRef.current.setData(bbData.map((d) => ({ time: d.time as Time, value: d.upper })));
      bbMiddleRef.current.setData(bbData.map((d) => ({ time: d.time as Time, value: d.middle })));
      bbLowerRef.current.setData(bbData.map((d) => ({ time: d.time as Time, value: d.lower })));
      bbUpperRef.current.applyOptions({ visible: true });
      bbMiddleRef.current.applyOptions({ visible: true });
      bbLowerRef.current.applyOptions({ visible: true });
    } else {
      bbUpperRef.current.setData([]);
      bbMiddleRef.current.setData([]);
      bbLowerRef.current.setData([]);
      bbUpperRef.current.applyOptions({ visible: false });
      bbMiddleRef.current.applyOptions({ visible: false });
      bbLowerRef.current.applyOptions({ visible: false });
    }
  }, [bbData, indicators.bb]);

  useEffect(() => {
    if (!macdLineRef.current || !macdSignalRef.current || !macdHistogramRef.current) return;

    if (indicators.macd && macdData.length > 0) {
      macdLineRef.current.setData(macdData.map((d) => ({ time: d.time as Time, value: d.MACD })));
      macdSignalRef.current.setData(macdData.map((d) => ({ time: d.time as Time, value: d.signal })));
      macdHistogramRef.current.setData(
        macdData.map((d) => ({
          time: d.time as Time,
          value: d.histogram,
          color: d.histogram >= 0 ? "#22c55e" : "#ef4444",
        }))
      );

      if (macdChartRef.current) {
        macdChartRef.current.timeScale().fitContent();
      }
    }
  }, [macdData, indicators.macd]);

  if (!selectedMarket) {
    return (
      <div
        className={cn(
          "bg-card rounded-md border flex items-center justify-center text-muted-foreground",
          isExpanded ? "h-[500px]" : "h-[350px]"
        )}
      >
        <div className="text-center">
          <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Select a market to view chart</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("bg-card rounded-md border flex flex-col", isExpanded ? "h-[600px]" : "h-[400px]")}
      data-testid="kline-chart"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b gap-4 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {timeframes.map((tf) => (
            <Button
              key={tf.value}
              variant={timeframe === tf.value ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs font-mono"
              onClick={() => setTimeframe(tf.value)}
              data-testid={`button-timeframe-${tf.value}`}
            >
              {tf.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          <Button
            variant={indicators.sma ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs font-mono"
            onClick={() => toggleIndicator("sma")}
            data-testid="button-indicator-sma"
          >
            <TrendingUp className="h-3 w-3 mr-1" style={{ color: "#3b82f6" }} />
            SMA
          </Button>
          <Button
            variant={indicators.ema ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs font-mono"
            onClick={() => toggleIndicator("ema")}
            data-testid="button-indicator-ema"
          >
            <TrendingUp className="h-3 w-3 mr-1" style={{ color: "#f59e0b" }} />
            EMA
          </Button>
          <Button
            variant={indicators.bb ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs font-mono"
            onClick={() => toggleIndicator("bb")}
            data-testid="button-indicator-bb"
          >
            <Activity className="h-3 w-3 mr-1" style={{ color: "#8b5cf6" }} />
            BB
          </Button>
          <Button
            variant={indicators.macd ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs font-mono"
            onClick={() => toggleIndicator("macd")}
            data-testid="button-indicator-macd"
          >
            <BarChart3 className="h-3 w-3 mr-1" />
            MACD
          </Button>
          <Button
            variant={indicators.signals ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs font-mono"
            onClick={() => toggleIndicator("signals")}
            data-testid="button-indicator-signals"
          >
            Signals
          </Button>
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
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div ref={containerRefCallback} className={cn("min-h-0", indicators.macd ? "flex-[3]" : "flex-1")} />

      {indicators.macd && (
        <div className="border-t">
          <div className="px-4 py-1 text-xs text-muted-foreground font-mono">MACD (12, 26, 9)</div>
          <div ref={macdContainerRefCallback} className="h-[120px]" />
        </div>
      )}
    </div>
  );
}
