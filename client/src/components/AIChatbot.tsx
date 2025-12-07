import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Copy, Check, Loader2, Code, Sparkles, Trash2, Wand2, Brain, TrendingUp, AlertTriangle, CheckCircle2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTradingContext } from "@/lib/tradingContext";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessage, TradingAlgorithm, OptimizationSuggestion } from "@shared/schema";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AlgorithmDisplay({ algorithm, onLoad }: { algorithm: TradingAlgorithm; onLoad: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const { activeAlgorithm, setActiveAlgorithm } = useTradingContext();
  const isActive = activeAlgorithm?.id === algorithm.id;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(algorithm, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const loadAlgorithm = () => {
    setActiveAlgorithm(algorithm);
    onLoad();
  };

  return (
    <div className="mt-3 border rounded-md bg-muted/30 overflow-hidden">
      {/* Header with algorithm info */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50">
        <Code className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="text-sm font-medium truncate">{algorithm.name}</span>
        <Badge variant="outline" className="text-[10px] flex-shrink-0">
          v{algorithm.version}
        </Badge>
      </div>
      
      {/* Action buttons - Always visible at top */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-background/50">
        <Button
          variant={isActive ? "secondary" : "default"}
          size="sm"
          className="h-8 text-xs flex-1"
          onClick={loadAlgorithm}
          disabled={isActive}
          data-testid="button-load-algorithm"
        >
          {isActive ? "Algorithm Loaded" : "Load Algorithm"}
        </Button>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={copyToClipboard}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-profit" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy JSON</TooltipContent>
          </Tooltip>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setShowJson(!showJson)}
          >
            {showJson ? "Hide" : "View"} JSON
          </Button>
        </div>
      </div>
      
      {/* Collapsible JSON display */}
      {showJson && (
        <pre className="p-3 text-xs font-mono overflow-x-auto max-h-[150px] scrollbar-trading border-t">
          {JSON.stringify(algorithm, null, 2)}
        </pre>
      )}
    </div>
  );
}

function OptimizationSuggestionCard({ 
  suggestion, 
  onApprove, 
  onReject 
}: { 
  suggestion: OptimizationSuggestion; 
  onApprove: () => void;
  onReject: () => void;
}) {
  const isPending = suggestion.status === "pending";
  const isAutoApplied = suggestion.status === "auto-applied";

  return (
    <div className={cn(
      "border rounded-md p-3 mb-3",
      isPending ? "border-primary/50 bg-primary/5" : 
      isAutoApplied ? "border-profit/50 bg-profit/5" :
      suggestion.status === "approved" ? "border-profit/30 bg-profit/5" :
      "border-muted bg-muted/30"
    )}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
          <Brain className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">Strategy Optimization</span>
            <Badge variant={
              isPending ? "default" : 
              isAutoApplied ? "secondary" :
              suggestion.status === "approved" ? "secondary" : "outline"
            } className="text-[10px]">
              {isPending ? "Pending Review" : 
               isAutoApplied ? "Auto-Applied" :
               suggestion.status === "approved" ? "Approved" : "Rejected"}
            </Badge>
            <Badge variant="outline" className="text-[10px] gap-1">
              <TrendingUp className="h-2.5 w-2.5" />
              {suggestion.performanceContext.winRate.toFixed(1)}% Win
            </Badge>
          </div>
          
          <p className="text-xs text-muted-foreground mb-2 line-clamp-3">
            {suggestion.reason}
          </p>
          
          {/* Performance context */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
            <span>PnL: ${suggestion.performanceContext.totalPnl.toFixed(2)}</span>
            <span>Trades: {suggestion.performanceContext.recentTrades}</span>
            {suggestion.performanceContext.drawdown > 0 && (
              <span className="text-loss flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5" />
                DD: ${suggestion.performanceContext.drawdown.toFixed(2)}
              </span>
            )}
          </div>

          {/* Actions for pending suggestions */}
          {isPending && (
            <div className="flex items-center gap-2">
              <Button 
                size="sm" 
                onClick={onApprove}
                className="h-7 text-xs gap-1"
                data-testid={`button-approve-suggestion-${suggestion.id}`}
              >
                <CheckCircle2 className="h-3 w-3" />
                Apply Changes
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onReject}
                className="h-7 text-xs gap-1"
                data-testid={`button-reject-suggestion-${suggestion.id}`}
              >
                <XCircle className="h-3 w-3" />
                Dismiss
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatMessageBubble({ message, onLoadAlgorithm }: { message: ChatMessage; onLoadAlgorithm: () => void }) {
  const isUser = message.role === "user";

  return (
    <div 
      className={cn(
        "flex gap-3 animate-slide-in",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
      data-testid={`chat-message-${message.id}`}
    >
      <div className={cn(
        "flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center",
        isUser ? "bg-primary" : "bg-muted"
      )}>
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className={cn(
        "flex-1 max-w-[85%]",
        isUser && "flex flex-col items-end"
      )}>
        <div className={cn(
          "rounded-lg px-4 py-3",
          isUser 
            ? "bg-primary text-primary-foreground" 
            : "bg-muted"
        )}>
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          {message.algorithmJson && (
            <AlgorithmDisplay 
              algorithm={message.algorithmJson} 
              onLoad={onLoadAlgorithm}
            />
          )}
        </div>
        <span className="text-[10px] text-muted-foreground mt-1 px-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

export function AIChatbot() {
  const { 
    chatMessages, 
    addChatMessage, 
    clearChatMessages,
    selectedMarket, 
    ticker, 
    klines,
    positions,
    tradingMode,
    activeAlgorithm,
    setActiveAlgorithm,
    timeframe,
    riskParameters,
    executionMode,
    optimizationSuggestions,
    updateOptimizationSuggestion,
    tradeCycleState,
    liveMetrics,
  } = useTradingContext();
  const [input, setInput] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const sendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await apiRequest("POST", "/api/chat", {
        content,
        context: {
          symbol: selectedMarket?.symbol,
          ticker,
          klines: klines.slice(-50),
          positions,
          tradingMode,
          currentAlgorithm: activeAlgorithm,
          timeframe,
          riskParameters,
          executionMode,
          marketMaxLeverage: selectedMarket?.maxLeverage,
        },
      });
      return response.json();
    },
    onSuccess: (data: { message: string; algorithm?: any }) => {
      const content = data.message?.trim() || "I apologize, but I couldn't generate a response. Please try again.";
      addChatMessage({
        role: "assistant",
        content,
        algorithmJson: data.algorithm,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Message Failed",
        description: error.message || "Failed to get AI response.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!input.trim() || sendMessageMutation.isPending) return;

    const userMessage = input.trim();
    addChatMessage({
      role: "user",
      content: userMessage,
    });
    setInput("");
    sendMessageMutation.mutate(userMessage);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleAlgorithmLoaded = () => {
    toast({
      title: "Algorithm Loaded",
      description: "The trading algorithm has been loaded and is ready for execution.",
    });
  };

  const handleApproveSuggestion = (suggestion: OptimizationSuggestion) => {
    if (suggestion.suggestedAlgorithm) {
      setActiveAlgorithm(suggestion.suggestedAlgorithm);
      toast({
        title: "Strategy Updated",
        description: "The optimized strategy has been applied.",
      });
    }
    updateOptimizationSuggestion(suggestion.id, "approved");
  };

  const handleRejectSuggestion = (suggestion: OptimizationSuggestion) => {
    updateOptimizationSuggestion(suggestion.id, "rejected");
    toast({
      title: "Suggestion Dismissed",
      description: "The optimization suggestion has been dismissed.",
    });
  };

  const pendingSuggestions = optimizationSuggestions.filter(s => s.status === "pending");
  const isTrading = tradeCycleState.status === "running" || tradeCycleState.status === "paused";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [chatMessages]);

  return (
    <Card className="flex flex-col h-full" data-testid="ai-chatbot">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Trading Assistant
          </CardTitle>
          {chatMessages.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={clearChatMessages}
                  data-testid="button-clear-chat"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear chat</TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 min-h-0">
        {/* Messages Area */}
        <ScrollArea ref={scrollAreaRef} className="flex-1 px-4">
          {chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <Bot className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-sm text-muted-foreground mb-4">
                {tradingMode === "manual" 
                  ? "You're in Manual mode. Switch to AI Trading or AI Scalping to use automated strategies."
                  : `Ready to generate a ${tradingMode === "ai-scalping" ? "scalping" : "trading"} strategy for ${selectedMarket?.symbol || "your selected market"}`
                }
              </p>
              {tradingMode !== "manual" && (
                <Button
                  onClick={() => {
                    const prompt = tradingMode === "ai-scalping"
                      ? "Analyze the current market conditions and generate an optimized scalping strategy with quick entry/exit rules, tight stop-losses, and small profit targets suitable for high-frequency trading."
                      : "Analyze the current market conditions and generate a comprehensive AI trading strategy with entry/exit rules, stop-loss levels, take-profit targets, and position sizing based on the current trend and indicators.";
                    addChatMessage({
                      role: "user",
                      content: prompt,
                    });
                    sendMessageMutation.mutate(prompt);
                  }}
                  disabled={!selectedMarket || sendMessageMutation.isPending}
                  className="gap-2"
                  data-testid="button-generate-strategy"
                >
                  {sendMessageMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  Generate {tradingMode === "ai-scalping" ? "Scalping" : "AI Trading"} Strategy
                </Button>
              )}
              {tradingMode === "manual" && (
                <p className="text-xs text-muted-foreground mt-2">
                  In Manual mode, you control all trades directly without AI automation.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {/* Live Metrics Display during trading */}
              {isTrading && liveMetrics && (
                <div className="border rounded-md p-3 mb-3 bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Live Performance</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">
                      {tradeCycleState.optimizationMode} mode
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <span className="text-muted-foreground">Win Rate:</span>
                      <span className={cn("ml-1 font-medium", 
                        liveMetrics.tradesExecuted > 0 
                          ? (liveMetrics.winningTrades / liveMetrics.tradesExecuted * 100) >= 50 ? "text-profit" : "text-loss"
                          : "text-muted-foreground"
                      )}>
                        {liveMetrics.tradesExecuted > 0 
                          ? (liveMetrics.winningTrades / liveMetrics.tradesExecuted * 100).toFixed(1) 
                          : "0.0"}%
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">PnL:</span>
                      <span className={cn("ml-1 font-medium", liveMetrics.totalPnl >= 0 ? "text-profit" : "text-loss")}>
                        ${liveMetrics.totalPnl.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Trades:</span>
                      <span className="ml-1 font-medium">{liveMetrics.tradesExecuted}</span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Pending Optimization Suggestions */}
              {pendingSuggestions.map((suggestion) => (
                <OptimizationSuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  onApprove={() => handleApproveSuggestion(suggestion)}
                  onReject={() => handleRejectSuggestion(suggestion)}
                />
              ))}
              
              {chatMessages.map((message) => (
                <ChatMessageBubble 
                  key={message.id} 
                  message={message} 
                  onLoadAlgorithm={handleAlgorithmLoaded}
                />
              ))}
              {sendMessageMutation.isPending && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="bg-muted rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">Analyzing...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Input Area */}
        <div className="flex-shrink-0 p-4 border-t bg-card space-y-3">
          {/* Preset Strategy Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => {
                setInput("Generate a momentum scalping strategy for " + selectedMarket?.symbol + " with 1% stop loss and 2% take profit");
              }}
              disabled={!selectedMarket || sendMessageMutation.isPending}
              data-testid="button-strategy-momentum"
            >
              <Zap className="h-3 w-3 mr-1" />
              Momentum Scalp
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => {
                setInput("Generate a mean reversion strategy for " + selectedMarket?.symbol + " with 1.5% stop loss and 3% take profit");
              }}
              disabled={!selectedMarket || sendMessageMutation.isPending}
              data-testid="button-strategy-reversion"
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              Mean Reversion
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => {
                setInput("Generate a trend following strategy for " + selectedMarket?.symbol + " with 2% stop loss and 5% take profit");
              }}
              disabled={!selectedMarket || sendMessageMutation.isPending}
              data-testid="button-strategy-trend"
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              Trend Follow
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => {
                setInput("Generate a range breakout strategy for " + selectedMarket?.symbol + " with 1.5% stop loss and 4% take profit");
              }}
              disabled={!selectedMarket || sendMessageMutation.isPending}
              data-testid="button-strategy-breakout"
            >
              <Wand2 className="h-3 w-3 mr-1" />
              Range Breakout
            </Button>
          </div>

          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedMarket 
                ? "Ask AI to analyze market or generate strategy..." 
                : "Select a market to start chatting..."
              }
              disabled={!selectedMarket || sendMessageMutation.isPending}
              className="min-h-[44px] max-h-[120px] resize-none"
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleSubmit}
              disabled={!input.trim() || !selectedMarket || sendMessageMutation.isPending}
              size="icon"
              className="h-11 w-11"
              data-testid="button-send-message"
            >
              {sendMessageMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          {activeAlgorithm && (
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <Code className="h-3 w-3" />
              <span>Active: {activeAlgorithm.name}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
