import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "ui-serif", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        bg: "hsl(var(--bg))",
        "bg-elevated": "hsl(var(--bg-elevated))",
        "bg-hover": "hsl(var(--bg-hover))",
        fg: "hsl(var(--fg))",
        "fg-muted": "hsl(var(--fg-muted))",
        "fg-dim": "hsl(var(--fg-dim))",
        border: "hsl(var(--border))",
        "border-subtle": "hsl(var(--border-subtle))",
        ring: "hsl(var(--ring))",
        accent: {
          push: "hsl(var(--push))",
          pull: "hsl(var(--pull))",
          diverged: "hsl(var(--diverged))",
          attention: "hsl(var(--attention))",
          dirty: "hsl(var(--dirty))",
          clean: "hsl(var(--clean))",
          "local-only": "hsl(var(--local-only))",
        },
      },
      letterSpacing: {
        tightest: "-0.04em",
        "display-tight": "-0.02em",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 480ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [animate],
};

export default config;
