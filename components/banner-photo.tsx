"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Chooses which farm photo the page banners show, by area of the app. Set on <html> so CSS can pick the image. */
function bannerFor(path: string): "eggs" | "hens" | "chick" {
  if (/^\/(layers|inventory)/.test(path)) return "eggs";
  if (/^\/(health|pens|house|batches|operations|planning|vision|trace)/.test(path)) return "hens";
  return "chick";
}

export function BannerPhoto() {
  const path = usePathname();
  useEffect(() => { document.documentElement.dataset.banner = bannerFor(path || "/"); }, [path]);
  return null;
}
