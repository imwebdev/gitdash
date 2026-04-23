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
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        status: {
          clean: "hsl(215 16% 47%)",
          ahead: "hsl(217 91% 60%)",
          behind: "hsl(38 92% 50%)",
          diverged: "hsl(0 84% 60%)",
          dirty: "hsl(25 95% 53%)",
          weird: "hsl(0 84% 60%)",
          noupstream: "hsl(240 5% 65%)",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "status-stripe": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "40px 0" },
        },
      },
      animation: {
        "status-stripe": "status-stripe 1.5s linear infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;
