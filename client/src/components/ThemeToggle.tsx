import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTradingContext } from "@/lib/tradingContext";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTradingContext();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      data-testid="button-theme-toggle"
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}
