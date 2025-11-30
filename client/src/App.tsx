import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TradingProvider } from "@/lib/tradingContext";
import Dashboard from "@/pages/Dashboard";
import Analytics from "@/pages/Analytics";
import Strategies from "@/pages/Strategies";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/strategies" component={Strategies} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <TradingProvider>
          <Router />
          <Toaster />
        </TradingProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
