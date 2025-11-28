import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Shield, TrendingUp, TrendingDown, Activity, Save, RefreshCw } from "lucide-react";
import type { RiskParameters } from "@shared/schema";

const defaultRiskParams: RiskParameters = {
  maxPositionSize: 1000,
  maxLeverage: 10,
  stopLossPercent: 2,
  takeProfitPercent: 4,
  maxDailyLoss: 1000,
  trailingStop: false,
  trailingStopPercent: 1.5,
  autoStopLoss: true,
  autoTakeProfit: true,
  breakEvenTrigger: 2,
};

interface InputState {
  maxPositionSize: string;
  maxLeverage: string;
  maxDailyLoss: string;
}

export function RiskParametersCard() {
  const { toast } = useToast();
  const [params, setParams] = useState<RiskParameters>(defaultRiskParams);
  const [hasChanges, setHasChanges] = useState(false);
  const [inputValues, setInputValues] = useState<InputState>({
    maxPositionSize: "1000",
    maxLeverage: "10",
    maxDailyLoss: "1000",
  });

  const { data, isLoading } = useQuery<{ success: boolean; params: RiskParameters }>({
    queryKey: ['/api/risk-parameters'],
  });

  useEffect(() => {
    if (data?.params) {
      const mergedParams = {
        ...defaultRiskParams,
        ...data.params,
      };
      setParams(mergedParams);
      setInputValues({
        maxPositionSize: String(mergedParams.maxPositionSize),
        maxLeverage: String(mergedParams.maxLeverage),
        maxDailyLoss: String(mergedParams.maxDailyLoss),
      });
      setHasChanges(false);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (newParams: RiskParameters) => {
      return apiRequest('POST', '/api/risk-parameters', newParams);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/risk-parameters'] });
      setHasChanges(false);
      toast({
        title: "Risk parameters saved",
        description: "Your risk management settings have been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to save",
        description: (error as Error).message,
        variant: "destructive",
      });
    },
  });

  const updateParam = <K extends keyof RiskParameters>(key: K, value: RiskParameters[K]) => {
    setParams(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleInputChange = (key: keyof InputState, value: string) => {
    setInputValues(prev => ({ ...prev, [key]: value }));
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      updateParam(key, numValue);
    } else if (value === "") {
      setHasChanges(true);
    }
  };

  const handleInputBlur = (key: keyof InputState) => {
    const numValue = parseFloat(inputValues[key]);
    if (isNaN(numValue) || numValue < 0 || inputValues[key] === "") {
      setInputValues(prev => ({ ...prev, [key]: String(params[key]) }));
    } else {
      setInputValues(prev => ({ ...prev, [key]: String(numValue) }));
    }
  };

  const handleSave = () => {
    saveMutation.mutate(params);
  };

  const handleReset = () => {
    if (data?.params) {
      const mergedParams = { ...defaultRiskParams, ...data.params };
      setParams(mergedParams);
      setInputValues({
        maxPositionSize: String(mergedParams.maxPositionSize),
        maxLeverage: String(mergedParams.maxLeverage),
        maxDailyLoss: String(mergedParams.maxDailyLoss),
      });
      setHasChanges(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Risk Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="h-8 bg-muted rounded" />
            <div className="h-8 bg-muted rounded" />
            <div className="h-8 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-primary" />
            Risk Management
          </CardTitle>
          {hasChanges && (
            <Badge variant="outline" className="text-amber-500 border-amber-500">
              Unsaved Changes
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Max Position Size ($)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={inputValues.maxPositionSize}
                onChange={(e) => handleInputChange('maxPositionSize', e.target.value)}
                onBlur={() => handleInputBlur('maxPositionSize')}
                data-testid="input-max-position-size"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Max Leverage</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={inputValues.maxLeverage}
                onChange={(e) => handleInputChange('maxLeverage', e.target.value)}
                onBlur={() => handleInputBlur('maxLeverage')}
                data-testid="input-max-leverage"
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Max Daily Loss ($)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={inputValues.maxDailyLoss}
              onChange={(e) => handleInputChange('maxDailyLoss', e.target.value)}
              onBlur={() => handleInputBlur('maxDailyLoss')}
              data-testid="input-max-daily-loss"
              className="font-mono"
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <Label>Auto Stop-Loss</Label>
            </div>
            <Switch
              checked={params.autoStopLoss}
              onCheckedChange={(checked) => updateParam('autoStopLoss', checked)}
              data-testid="switch-auto-stop-loss"
            />
          </div>
          
          {params.autoStopLoss && (
            <div className="space-y-2 pl-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Stop Loss %</span>
                <span className="font-mono text-red-500">{params.stopLossPercent}%</span>
              </div>
              <Slider
                value={[params.stopLossPercent]}
                onValueChange={([value]) => updateParam('stopLossPercent', value)}
                min={0.5}
                max={20}
                step={0.5}
                data-testid="slider-stop-loss"
                className="w-full"
              />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <Label>Auto Take-Profit</Label>
            </div>
            <Switch
              checked={params.autoTakeProfit}
              onCheckedChange={(checked) => updateParam('autoTakeProfit', checked)}
              data-testid="switch-auto-take-profit"
            />
          </div>
          
          {params.autoTakeProfit && (
            <div className="space-y-2 pl-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Take Profit %</span>
                <span className="font-mono text-green-500">{params.takeProfitPercent}%</span>
              </div>
              <Slider
                value={[params.takeProfitPercent]}
                onValueChange={([value]) => updateParam('takeProfitPercent', value)}
                min={0.5}
                max={50}
                step={0.5}
                data-testid="slider-take-profit"
                className="w-full"
              />
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-500" />
              <Label>Trailing Stop</Label>
            </div>
            <Switch
              checked={params.trailingStop}
              onCheckedChange={(checked) => updateParam('trailingStop', checked)}
              data-testid="switch-trailing-stop"
            />
          </div>
          
          {params.trailingStop && (
            <div className="space-y-2 pl-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Trail Distance %</span>
                <span className="font-mono text-amber-500">{params.trailingStopPercent || 1.5}%</span>
              </div>
              <Slider
                value={[params.trailingStopPercent || 1.5]}
                onValueChange={([value]) => updateParam('trailingStopPercent', value)}
                min={0.5}
                max={10}
                step={0.25}
                data-testid="slider-trailing-stop"
                className="w-full"
              />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Break-Even Trigger</Label>
            <span className="text-xs text-muted-foreground">
              Move SL to entry after {params.breakEvenTrigger || 2}% profit
            </span>
          </div>
          <Slider
            value={[params.breakEvenTrigger || 2]}
            onValueChange={([value]) => updateParam('breakEvenTrigger', value)}
            min={0.5}
            max={10}
            step={0.5}
            data-testid="slider-break-even"
            className="w-full"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saveMutation.isPending}
            className="flex-1"
            data-testid="button-save-risk-params"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
          {hasChanges && (
            <Button
              variant="outline"
              onClick={handleReset}
              data-testid="button-reset-risk-params"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
