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

export const metadata: Metadata = {
  title: "Flockence | Intelligent Poultry Management",
  description: "Intelligent poultry management for broiler and layer operations. Powered by Oriya.",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#050A12",
  width: "device-width",
  initialScale: 1
};

// Restore only visual preferences while the authenticated account loads.
const appearanceBootstrap = `try {
  var saved = JSON.parse(localStorage.getItem("flockence-active-appearance") || localStorage.getItem("flockence-appearance-v3") || "null");
  if (saved && ["poultry","crystal","aero","heritage","workhorse","sol","terra"].includes(saved.theme)) {
    var root = document.documentElement;
    root.dataset.theme = saved.theme;
    if (["comfortable","compact"].includes(saved.density)) root.dataset.density = saved.density;
    if (["soft","sharp"].includes(saved.radius)) root.dataset.radius = saved.radius;
  }
} catch {}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} /></head><body><PwaRegister /><BannerPhoto /><AuthGate>{children}</AuthGate></body></html>;
}
