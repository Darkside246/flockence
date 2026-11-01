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
import { ThemeProvider } from "@/components/theme-provider";
import { AppearanceControl } from "@/components/appearance-control";
import { AuthGate } from "@/components/auth-gate";
import { BannerPhoto } from "@/components/banner-photo";
import "./crystal-photos.css";

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><ThemeProvider><PwaRegister /><BannerPhoto /><AppearanceControl /><AuthGate>{children}</AuthGate></ThemeProvider></body></html>;
}
