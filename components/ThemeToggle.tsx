"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("gitdash-theme", next);
    } catch {
      // private mode / disabled storage — non-fatal
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Toggle theme"}
      title={mounted ? `Switch to ${theme === "dark" ? "light" : "dark"} mode` : "Toggle theme"}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-subtle text-fg-muted transition-colors hover:border-border hover:bg-bg-hover hover:text-fg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg sm:h-8 sm:w-8"
    >
      {/* Render both, hide the inactive one — avoids hydration mismatch on initial paint */}
      <Sun className={`h-3.5 w-3.5 ${mounted && theme === "dark" ? "" : "hidden"}`} />
      <Moon className={`h-3.5 w-3.5 ${mounted && theme === "dark" ? "hidden" : ""}`} />
    </button>
  );
}
