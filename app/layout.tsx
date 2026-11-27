import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./accessibility-theme.css";
import "./premium.css";
import "./premium-fixes.css";
import "./vision/vision.css";
import "./auth.css";
import "./crystal.css";
import "./crystal-depth.css";
import "./crystal-pages.css";
import { PwaRegister } from "@/components/pwa-register";
import { AuthGate } from "@/components/auth-gate";
import { BannerPhoto } from "@/components/banner-photo";
import "./crystal-photos.css";
import "./poultry.css";
import "./theme-system.css";
import "./theme-photography.css";
import "./poultry-refinement.css";
import "./farm-records.css";
import { DEFAULT_THEME, themeIds } from "@/lib/theme-registry";

export const metadata: Metadata = {
  title: "Flockence | Intelligent Poultry Management",
  description: "Intelligent poultry management for broiler and layer operations. Powered by Oriya.",
  manifest: "/manifest.webmanifest",
  // Home-screen icons and full-screen launch on phones (public/icons, drawn by scripts/make-icons.mjs).
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Flockence", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#F7F8F4",
  width: "device-width",
  initialScale: 1
};

// Restore only visual preferences while the authenticated account loads.
const appearanceBootstrap = `try {
  var saved = JSON.parse(localStorage.getItem("flockence-active-appearance") || localStorage.getItem("flockence-appearance-v3") || "null");
  if (saved && ${JSON.stringify(themeIds)}.includes(saved.theme)) {
    var root = document.documentElement;
    root.dataset.theme = saved.theme;
    if (["comfortable","compact"].includes(saved.density)) root.dataset.density = saved.density;
    if (["soft","sharp"].includes(saved.radius)) root.dataset.radius = saved.radius;
  }
} catch {}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} /></head><body><PwaRegister /><BannerPhoto /><AuthGate>{children}</AuthGate></body></html>;
}
