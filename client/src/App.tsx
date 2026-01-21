import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { PopupManagerProvider } from "@/contexts/popup-manager-context";
import { MultiPopupManager } from "@/components/ui/multi-popup-manager";
import Chat from "@/pages/chat";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Chat} />
      <Route path="/model-builder">
        <Redirect to="/" />
      </Route>
      <Route path="/paper-writer">
        <Redirect to="/" />
      </Route>
      <Route path="*">
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <PopupManagerProvider>
            <Toaster />
            <Router />
            <MultiPopupManager />
          </PopupManagerProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
