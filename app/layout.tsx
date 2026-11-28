import type { Metadata, Viewport } from "next";
// Stylesheet order (2026 redesign): font, design tokens, base elements, components, shell,
// page sheets, then the theme layers (Crystal skin, per-theme palettes, photography, Poultry
// Farm brand palette). See docs/REDESIGN_WIREFRAMES.md, "Design-system plan".
import "@fontsource-variable/manrope";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./vision/vision.css";
import "./auth.css";
import "./crystal.css";
import "./theme-system.css";
import "./theme-photography.css";
import "./poultry-refinement.css";
import "./farm-records.css";
import "./styles/dashboard.css";
import { PwaRegister } from "@/components/pwa-register";
import { AuthGate } from "@/components/auth-gate";
import { BannerPhoto } from "@/components/banner-photo";
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
  themeColor: "#F5F6F1",
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
