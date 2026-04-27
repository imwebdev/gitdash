import type { Metadata } from "next";
import { Instrument_Serif, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { VersionBadge } from "@/components/VersionBadge";
import { UpdateBanner } from "@/components/UpdateBanner";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { displayLabel } from "@/lib/security/label";
import { hostname } from "node:os";

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

async function getStoredLabel(): Promise<string | null> {
  try {
    const xdg = process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? ".", ".config");
    const configPath = path.join(xdg, "gitdash", "config.json");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.machineLabel === "string" ? parsed.machineLabel : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const stored = await getStoredLabel();
  const label = displayLabel(stored, hostname());
  const isDefault = !stored || stored.trim().length === 0;
  const title = isDefault ? "gitdash" : `${label} · gitdash`;
  return {
    title,
    description: "Local git repo status dashboard",
  };
}

// Runs before paint to set the theme class — prevents the wrong-theme flash
// on first render. Reads localStorage('gitdash-theme'), falls back to OS preference.
const themeBootScript = `(function(){try{var t=localStorage.getItem('gitdash-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <UpdateBanner />
        <VersionBadge />
      </body>
    </html>
  );
}
