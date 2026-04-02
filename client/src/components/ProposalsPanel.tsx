import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function ProposalsPanel() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<any | null>(null);

  const { data, isLoading } = useQuery<{ proposals: any[] }>({
    queryKey: ["/api/agent/proposals"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/agent/proposals");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/agent/proposals/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/proposals"] });
      toast({ title: "Proposal approved", description: "Execution started." });
    },
    onError: (err: any) => {
      toast({ title: "Approve failed", description: err?.message || "Failed to approve proposal.", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/agent/proposals/${id}/reject`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/proposals"] });
      toast({ title: "Proposal rejected", description: "Proposal marked rejected." });
    },
    onError: (err: any) => {
      toast({ title: "Reject failed", description: err?.message || "Failed to reject proposal.", variant: "destructive" });
    },
  });

  const proposals = data?.proposals || [];

  return (
    <Card data-testid="proposals-panel">
      <CardHeader>
        <CardTitle className="text-base">LLM Proposals</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex gap-4">
          <div className="w-1/2 border-r">
            <ScrollArea className="h-64 p-2">
              {isLoading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading...</div>
              ) : proposals.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No proposals</div>
              ) : (
                proposals.map((p: any) => (
                  <div key={p.id} className={`p-2 cursor-pointer hover:bg-muted/10 ${selected?.id === p.id ? 'bg-muted/10' : ''}`} onClick={() => setSelected(p)}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">{p.algorithm?.name || 'Proposal'}</div>
                      <div className="text-xs text-muted-foreground">{p.status}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</div>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>
          <div className="w-1/2 p-3">
            {selected ? (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{selected.algorithm?.name || 'Proposal'}</div>
                  <div className="text-xs text-muted-foreground">{selected.status}</div>
                </div>
                <pre className="text-xs font-mono bg-muted/10 p-2 rounded max-h-40 overflow-auto">{JSON.stringify(selected.algorithm, null, 2)}</pre>
                {selected.message && <div className="mt-2 text-sm text-muted-foreground">{selected.message}</div>}
                <div className="flex gap-2 mt-3">
                  <Button onClick={() => approveMutation.mutate(selected.id)} disabled={approveMutation.isPending || selected.status === 'approved'} size="sm">Approve & Execute</Button>
                  <Button variant="outline" onClick={() => rejectMutation.mutate(selected.id)} disabled={rejectMutation.isPending || selected.status === 'rejected'} size="sm">Reject</Button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Select a proposal to preview</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
