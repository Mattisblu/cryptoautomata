import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Key, Lock, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { useTradingContext } from "@/lib/tradingContext";
import { apiCredentialsSchema, type ApiCredentials } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Wallet, RefreshCw } from "lucide-react";

interface ExchangeBalance {
  asset: string;
  available: number;
  frozen: number;
  total: number;
  unrealizedPnl: number;
  marginBalance: number;
}

export function CredentialsForm() {
  const { selectedExchange, setCredentials, setConnectionState, isAuthenticated, credentials } = useTradingContext();
  const [showSecret, setShowSecret] = useState(false);
  const { toast } = useToast();

  const form = useForm<ApiCredentials>({
    resolver: zodResolver(apiCredentialsSchema),
    defaultValues: {
      exchange: selectedExchange || "coinstore",
      apiKey: "",
      secretKey: "",
      passphrase: "",
      saveCredentials: false,
    },
  });

  const connectMutation = useMutation({
    mutationFn: async (data: ApiCredentials) => {
      const response = await apiRequest("POST", "/api/auth/connect", data);
      return response;
    },
    onSuccess: (_, variables) => {
      setCredentials(variables);
      setConnectionState({
        status: "connected",
        exchange: variables.exchange,
        lastHeartbeat: Date.now(),
      });
      toast({
        title: "Connected Successfully",
        description: `Your ${variables.exchange.toUpperCase()} API credentials have been verified.`,
      });
    },
    onError: (error: Error) => {
      setConnectionState({
        status: "error",
        exchange: selectedExchange || "coinstore",
        error: error.message,
      });
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to exchange API.",
        variant: "destructive",
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/disconnect", {});
    },
    onSuccess: () => {
      setCredentials(null);
      setConnectionState({
        status: "disconnected",
        exchange: selectedExchange || "coinstore",
      });
      form.reset();
      toast({
        title: "Disconnected",
        description: "Your API credentials have been removed.",
      });
    },
  });

  const onSubmit = (data: ApiCredentials) => {
    setConnectionState({
      status: "connecting",
      exchange: data.exchange,
    });
    connectMutation.mutate({
      ...data,
      exchange: selectedExchange || "coinstore",
    });
  };

  const balanceQuery = useQuery<{ success: boolean; balances: ExchangeBalance[] }>({
    queryKey: ['/api/balance', credentials?.exchange],
    queryFn: async () => {
      const res = await fetch(`/api/balance?exchange=${credentials?.exchange}`);
      if (!res.ok) {
        throw new Error('Failed to fetch balance');
      }
      return res.json();
    },
    enabled: isAuthenticated && !!credentials?.exchange,
    refetchInterval: 30000,
  });

  const usdtBalance = balanceQuery.data?.balances?.find(b => b.asset === 'USDT');

  if (isAuthenticated && credentials) {
    return (
      <Card data-testid="credentials-connected">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-profit" />
            API Connected
          </CardTitle>
          <CardDescription>
            Connected to {credentials.exchange.toUpperCase()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 py-2 px-3 bg-profit/10 rounded-md">
            <div className="w-2 h-2 rounded-full bg-profit" />
            <span className="text-sm text-profit font-medium">
              Active Connection
            </span>
          </div>
          
          <div className="p-3 bg-muted/50 rounded-md space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Account Balance</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => balanceQuery.refetch()}
                disabled={balanceQuery.isFetching}
                data-testid="button-refresh-balance"
              >
                <RefreshCw className={`h-3 w-3 ${balanceQuery.isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            
            {balanceQuery.isLoading ? (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : balanceQuery.isError ? (
              <div className="text-xs text-muted-foreground text-center py-1">
                Balance unavailable
              </div>
            ) : usdtBalance ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Available</span>
                  <span className="font-mono font-medium text-profit" data-testid="text-balance-available">
                    {usdtBalance.available.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </span>
                </div>
                {usdtBalance.frozen > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Frozen</span>
                    <span className="font-mono text-warning" data-testid="text-balance-frozen">
                      {usdtBalance.frozen.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                    </span>
                  </div>
                )}
                {usdtBalance.unrealizedPnl !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Unrealized PnL</span>
                    <span className={`font-mono ${usdtBalance.unrealizedPnl >= 0 ? 'text-profit' : 'text-loss'}`} data-testid="text-balance-pnl">
                      {usdtBalance.unrealizedPnl >= 0 ? '+' : ''}{usdtBalance.unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                    </span>
                  </div>
                )}
                <div className="pt-1 border-t border-border/50">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Margin Balance</span>
                    <span className="font-mono font-semibold" data-testid="text-balance-margin">
                      {usdtBalance.marginBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-1">
                No USDT balance found
              </div>
            )}
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">API Key</span>
              <span className="font-mono">
                {credentials.apiKey.slice(0, 8)}...{credentials.apiKey.slice(-4)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Exchange</span>
              <span className="font-mono uppercase">{credentials.exchange}</span>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            data-testid="button-disconnect"
          >
            {disconnectMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Disconnecting...
              </>
            ) : (
              "Disconnect"
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="credentials-form">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Key className="h-4 w-4" />
          API Credentials
        </CardTitle>
        <CardDescription>
          Connect your exchange API to enable trading
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!selectedExchange && (
          <div className="mb-4 p-3 bg-muted/50 border border-dashed rounded-md text-center">
            <p className="text-sm text-muted-foreground">
              Select an exchange from the header first to enter your API credentials
            </p>
          </div>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API Key</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter your API key"
                      {...field}
                      disabled={!selectedExchange}
                      className="font-mono text-sm"
                      data-testid="input-api-key"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="secretKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Secret Key</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type={showSecret ? "text" : "password"}
                        placeholder="Enter your secret key"
                        {...field}
                        disabled={!selectedExchange}
                        className="font-mono text-sm pr-10"
                        data-testid="input-secret-key"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setShowSecret(!showSecret)}
                      >
                        {showSecret ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="passphrase"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Passphrase (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="API passphrase if required"
                      {...field}
                      disabled={!selectedExchange}
                      className="font-mono text-sm"
                      data-testid="input-passphrase"
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Some exchanges require an additional passphrase
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="saveCredentials"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 py-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-save-credentials"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm font-normal">
                      Save credentials securely
                    </FormLabel>
                    <FormDescription className="text-xs">
                      Credentials are encrypted and stored locally
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={!selectedExchange || connectMutation.isPending}
              data-testid="button-connect"
            >
              {connectMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  Connect & Authorize
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
