import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTradingContext } from "@/lib/tradingContext";

export function AgentTradingPanel() {
  const { selectedMarket, selectedExchange, isAuthenticated, tradeCycleState, tradingMode } = useTradingContext();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState(0);
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [leverage, setLeverage] = useState(10);
  const [status, setStatus] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [objective, setObjective] = useState<string>("");
  const [approvalMode, setApprovalMode] = useState<'suggest' | 'auto' | 'manual'>('suggest');

  const isDisabled = !isAuthenticated || !selectedMarket || tradeCycleState.status === "running";

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setStatus("");
        try {
      const res = await fetch("/api/agent/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedMarket?.symbol,
          exchange: selectedExchange,
          side,
          quantity,
          price,
          leverage,
          userId: "local-user", // Replace with real user context
              // When approvalMode is 'manual' we should not request an LLM objective
              objective: approvalMode === 'manual' ? undefined : (objective || undefined),
              autoApprove: approvalMode === 'auto',
              tradingMode,
          timeframe: tradeCycleState?.timeframe || undefined,
        }),
      });
      const data = await res.json();
      if (data && data.length) {
        // If a proposal was returned, show proposal id and suggestion message
        const proposalMsg = (data as any[]).find(m => m.type === 'NOTIFY' && m.payload?.proposalId);
        if (proposalMsg) {
          setStatus(`Proposal created: ${proposalMsg.payload.proposalId} — review in Proposals panel.`);
        } else {
          setStatus("Trade processed: " + JSON.stringify(data.map((m: any) => m.type + (m.payload?.reason ? ` (${m.payload.reason})` : ""))));
        }
      } else {
        setStatus("No response from agent workflow.");
      }
    } catch (err) {
      setStatus("Error: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card data-testid="agent-trading-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Agent Workflow Order
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={side === "buy" ? "default" : "outline"}
            onClick={() => setSide("buy")}
            disabled={isDisabled}
          >
            Long
          </Button>
          <Button
            type="button"
            variant={side === "sell" ? "default" : "outline"}
            onClick={() => setSide("sell")}
            disabled={isDisabled}
          >
            Short
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="objective">Objective (optional)</Label>
          <Input
            id="objective"
            placeholder="e.g. Follow trend, target 5% ROI in 24h"
            value={objective}
            onChange={e => setObjective(e.target.value)}
            disabled={isDisabled}
          />
          <Label htmlFor="approvalMode">Approval Mode</Label>
          <select
            id="approvalMode"
            value={approvalMode}
            onChange={e => setApprovalMode(e.target.value as any)}
            className="w-full border rounded px-2 py-1"
            disabled={isDisabled}
          >
            <option value="suggest">Suggest only (requires approval)</option>
            <option value="auto">Auto-approve (execute immediately)</option>
            <option value="manual">Manual (no LLM proposal, direct order)</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            type="number"
            value={quantity}
            onChange={e => setQuantity(Number(e.target.value))}
            disabled={isDisabled}
            min={0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="price">Price (optional)</Label>
          <Input
            id="price"
            type="number"
            value={price ?? ""}
            onChange={e => setPrice(e.target.value ? Number(e.target.value) : undefined)}
            disabled={isDisabled}
            min={0}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="leverage">Leverage</Label>
          <Input
            id="leverage"
            type="number"
            value={leverage}
            onChange={e => setLeverage(Number(e.target.value))}
            disabled={isDisabled}
            min={1}
            max={100}
          />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={isDisabled || isSubmitting}
          className="w-full"
        >
          {isSubmitting ? "Submitting..." : "Submit to Agent Workflow"}
        </Button>
        {status && <div className="mt-2 text-xs text-muted-foreground">{status}</div>}
      </CardContent>
    </Card>
  );
}
