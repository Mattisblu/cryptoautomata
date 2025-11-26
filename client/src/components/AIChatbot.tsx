import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Copy, Check, Loader2, Code, Sparkles, Trash2 } from "lucide-react";
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
import type { ChatMessage, TradingAlgorithm } from "@shared/schema";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AlgorithmDisplay({ algorithm, onLoad }: { algorithm: TradingAlgorithm; onLoad: () => void }) {
  const [copied, setCopied] = useState(false);
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
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Code className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{algorithm.name}</span>
          <Badge variant="outline" className="text-[10px]">
            v{algorithm.version}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
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
            variant={isActive ? "secondary" : "default"}
            size="sm"
            className="h-7 text-xs"
            onClick={loadAlgorithm}
            disabled={isActive}
            data-testid="button-load-algorithm"
          >
            {isActive ? "Loaded" : "Load Algorithm"}
          </Button>
        </div>
      </div>
      <pre className="p-3 text-xs font-mono overflow-x-auto max-h-[200px] scrollbar-trading">
        {JSON.stringify(algorithm, null, 2)}
      </pre>
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
        },
      });
      return response.json();
    },
    onSuccess: (data: { message: string; algorithm?: any }) => {
      addChatMessage({
        role: "assistant",
        content: data.message,
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
              <p className="text-sm text-muted-foreground mb-2">
                Ask me to analyze market data or generate trading strategies
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                <Badge 
                  variant="outline" 
                  className="cursor-pointer hover-elevate"
                  onClick={() => setInput("Analyze the current market trend")}
                >
                  Analyze market trend
                </Badge>
                <Badge 
                  variant="outline" 
                  className="cursor-pointer hover-elevate"
                  onClick={() => setInput("Generate a scalping strategy for the current conditions")}
                >
                  Generate scalping strategy
                </Badge>
                <Badge 
                  variant="outline" 
                  className="cursor-pointer hover-elevate"
                  onClick={() => setInput("What are the key support and resistance levels?")}
                >
                  Support/resistance levels
                </Badge>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
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
        <div className="flex-shrink-0 p-4 border-t bg-card">
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
