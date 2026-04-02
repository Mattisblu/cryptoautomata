import { useTradingContext } from "@/lib/tradingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import React from "react";

export function AgentMessagePanel() {
  const { agentMessages, clearAgentMessages } = useTradingContext();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Agent Messages</CardTitle>
        <div className="ml-auto">
          <Button size="sm" variant="ghost" onClick={() => clearAgentMessages()}>
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-56 overflow-auto">
        {agentMessages && agentMessages.length > 0 ? (
          agentMessages.slice().reverse().map((m: any) => (
            <div key={m.id} className="text-xs p-2 rounded-md bg-muted/30">
              <div className="font-medium">{m.type}</div>
              <div className="text-[11px] text-muted-foreground break-words">{typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">{new Date(m.timestamp || Date.now()).toLocaleTimeString()}</div>
            </div>
          ))
        ) : (
          <div className="text-xs text-muted-foreground">No agent messages yet</div>
        )}
      </CardContent>
    </Card>
  );
}

export default AgentMessagePanel;
