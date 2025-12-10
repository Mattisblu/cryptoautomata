import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Plus, Trash2, Save, CheckCircle, XCircle, GripVertical, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TradingAlgorithm, TradingRule } from "@shared/schema";

interface RuleWarning {
  ruleIndex: number;
  condition: string;
  action: string;
  warning: string;
  isUnrecognized: boolean;
}

interface RuleEditorProps {
  algorithm: TradingAlgorithm | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (algorithm: TradingAlgorithm) => void;
}

const RECOGNIZED_CONDITIONS = [
  { label: "Price Conditions", options: [
    "price above sma", "price below sma", "price > [value]", "price < [value]",
    "price breaks above [value]", "price breaks below [value]"
  ]},
  { label: "MACD Conditions", options: [
    "macd bullish crossover", "macd bearish crossover", "macd bullish", "macd bearish",
    "macd above signal", "macd below signal", "macd histogram positive", "macd histogram negative"
  ]},
  { label: "Volume Conditions", options: [
    "volume spike", "high volume", "low volume", "volume increasing", "volume decreasing"
  ]},
  { label: "Combined Conditions", options: [
    "macd bullish with volume", "macd bearish with volume", "bullish breakout", "bearish breakdown"
  ]},
  { label: "Position Conditions", options: [
    "no position", "has position", "immediate entry", "enter now"
  ]},
  { label: "Exit Conditions", options: [
    "take profit [X]%", "stop loss [X]%", "price increases by [X]%", "price decreases by [X]%"
  ]},
];

export function RuleEditor({ algorithm, open, onOpenChange, onSave }: RuleEditorProps) {
  const [rules, setRules] = useState<TradingRule[]>([]);
  const [warnings, setWarnings] = useState<RuleWarning[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (algorithm && open) {
      setRules(algorithm.rules || []);
      setJsonText(JSON.stringify(algorithm.rules || [], null, 2));
      setWarnings([]);
      setJsonError(null);
    }
  }, [algorithm, open]);

  const validateRules = async (rulesToValidate: TradingRule[]) => {
    if (!algorithm) return [];
    setIsValidating(true);
    try {
      const response = await apiRequest("POST", `/api/algorithms/${algorithm.id}/validate-rules`, { rules: rulesToValidate });
      const data = await response.json();
      setWarnings(data.warnings || []);
      return data.warnings || [];
    } catch (error) {
      console.error("Validation error:", error);
      return [];
    } finally {
      setIsValidating(false);
    }
  };

  const handleAddRule = () => {
    const newRule: TradingRule = {
      id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      condition: "",
      action: "hold",
      priority: rules.length + 1,
      priceType: "market",
    };
    setRules([...rules, newRule]);
  };

  const handleRemoveRule = (index: number) => {
    const newRules = rules.filter((_, i) => i !== index);
    newRules.forEach((r, i) => r.priority = i + 1);
    setRules(newRules);
    validateRules(newRules);
  };

  const handleRuleChange = (index: number, field: keyof TradingRule, value: string | number) => {
    const newRules = [...rules];
    (newRules[index] as any)[field] = value;
    setRules(newRules);
  };

  const handleConditionBlur = () => {
    validateRules(rules);
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        setRules(parsed);
        setJsonError(null);
        validateRules(parsed);
      } else {
        setJsonError("Rules must be an array");
      }
    } catch (e) {
      setJsonError("Invalid JSON syntax");
    }
  };

  const handleSave = async () => {
    if (!algorithm) return;
    
    setIsSaving(true);
    try {
      const currentWarnings = await validateRules(rules);
      
      if (currentWarnings.some((w: RuleWarning) => w.isUnrecognized)) {
        const proceed = window.confirm(
          `There are ${currentWarnings.filter((w: RuleWarning) => w.isUnrecognized).length} unrecognized rule(s). ` +
          "These rules may not work as expected. Do you want to save anyway?"
        );
        if (!proceed) {
          setIsSaving(false);
          return;
        }
      }

      const response = await apiRequest("PATCH", `/api/algorithms/${algorithm.id}/rules`, { rules });
      const data = await response.json();
      
      if (data.success) {
        toast({ title: "Algorithm updated", description: "Rules have been saved successfully." });
        queryClient.invalidateQueries({ queryKey: ["/api/algorithms"] });
        onSave?.(data.algorithm);
        onOpenChange(false);
      } else {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to save algorithm", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const getWarningForRule = (index: number) => {
    return warnings.find(w => w.ruleIndex === index);
  };

  if (!algorithm) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]" data-testid="dialog-rule-editor">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-rule-editor-title">
            Edit Algorithm Rules: {algorithm.name}
          </DialogTitle>
          <DialogDescription>
            Modify the trading rules for this algorithm. Unrecognized conditions will be highlighted.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="visual" className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="visual" data-testid="tab-visual-editor">Visual Editor</TabsTrigger>
            <TabsTrigger value="json" data-testid="tab-json-editor">JSON Editor</TabsTrigger>
          </TabsList>

          <TabsContent value="visual" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {rules.map((rule, index) => {
                  const warning = getWarningForRule(index);
                  return (
                    <Card 
                      key={index} 
                      className={warning?.isUnrecognized ? "border-amber-500" : ""}
                      data-testid={`card-rule-${index}`}
                    >
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-3">
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <GripVertical className="h-4 w-4" />
                            <span className="text-sm font-mono">{index + 1}</span>
                          </div>
                          
                          <div className="flex-1 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label className="text-xs">Condition</Label>
                                <Input
                                  value={rule.condition}
                                  onChange={(e) => handleRuleChange(index, "condition", e.target.value)}
                                  onBlur={handleConditionBlur}
                                  placeholder="e.g., macd bullish crossover"
                                  className={warning?.isUnrecognized ? "border-amber-500" : ""}
                                  data-testid={`input-condition-${index}`}
                                />
                              </div>
                              <div>
                                <Label className="text-xs">Action</Label>
                                <Select
                                  value={rule.action}
                                  onValueChange={(v) => handleRuleChange(index, "action", v)}
                                  data-testid={`select-action-${index}`}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="buy">Buy (Open Long)</SelectItem>
                                    <SelectItem value="sell">Sell (Open Short)</SelectItem>
                                    <SelectItem value="close">Close Position</SelectItem>
                                    <SelectItem value="hold">Hold (No Action)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4">
                              <div className="w-24">
                                <Label className="text-xs">Priority</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  value={rule.priority}
                                  onChange={(e) => handleRuleChange(index, "priority", parseInt(e.target.value) || 1)}
                                  data-testid={`input-priority-${index}`}
                                />
                              </div>
                              <div className="flex-1">
                                <Label className="text-xs">Order Type</Label>
                                <Select
                                  value={rule.priceType || "market"}
                                  onValueChange={(v) => handleRuleChange(index, "priceType", v)}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="market">Market Order</SelectItem>
                                    <SelectItem value="limit">Limit Order</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {warning && (
                              <div className="flex items-center gap-2 text-amber-600 text-sm" data-testid={`warning-rule-${index}`}>
                                <AlertTriangle className="h-4 w-4" />
                                <span>{warning.warning}</span>
                              </div>
                            )}
                          </div>

                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveRule(index)}
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-rule-${index}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}

                <Button
                  variant="outline"
                  onClick={handleAddRule}
                  className="w-full"
                  data-testid="button-add-rule"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Rule
                </Button>
              </div>
            </ScrollArea>

            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recognized Condition Patterns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {RECOGNIZED_CONDITIONS.map((group) => (
                    group.options.slice(0, 3).map((opt) => (
                      <Badge key={opt} variant="secondary" className="text-xs cursor-pointer hover-elevate"
                        onClick={() => {
                          if (rules.length > 0) {
                            const lastIndex = rules.length - 1;
                            if (!rules[lastIndex].condition) {
                              handleRuleChange(lastIndex, "condition", opt);
                            }
                          }
                        }}
                      >
                        {opt}
                      </Badge>
                    ))
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="json" className="mt-4">
            <div className="space-y-2">
              <Textarea
                value={jsonText}
                onChange={(e) => handleJsonChange(e.target.value)}
                className="font-mono text-sm h-[400px]"
                placeholder="Enter rules as JSON array..."
                data-testid="textarea-json-rules"
              />
              {jsonError && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <XCircle className="h-4 w-4" />
                  <span>{jsonError}</span>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {warnings.length > 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20" data-testid="alert-warnings">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <span className="text-sm">
              {warnings.filter(w => w.isUnrecognized).length} unrecognized rule(s) detected. 
              These may not be evaluated by the trading bot.
            </span>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !!jsonError}
            data-testid="button-save-rules"
          >
            {isSaving ? "Saving..." : "Save Rules"}
            {!isSaving && warnings.length === 0 && <CheckCircle className="h-4 w-4 ml-2" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
