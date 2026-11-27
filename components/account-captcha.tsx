"use client";

import Script from "next/script";
import type { CaptchaAction, CaptchaMode } from "@/lib/signup-captcha";
import { useRef, useState } from "react";

type Recaptcha = {
  ready?: (callback: () => void) => void;
  execute?: (siteKey: string, options: { action: CaptchaAction }) => Promise<string>;
  render: (element: HTMLElement, options: {
    sitekey: string;
    size: "compact";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => number;
  reset: (id: number) => void;
};

function recaptcha() {
  return (window as Window & { grecaptcha?: Recaptcha }).grecaptcha;
}

export function useAccountCaptcha(siteKey: string | null, mode: CaptchaMode, action: CaptchaAction) {
  const [captchaToken, setCaptchaToken] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [captchaError, setCaptchaError] = useState("");
  const captchaElement = useRef<HTMLDivElement>(null);
  const captchaWidget = useRef<number | null>(null);

  function captchaUnavailable() {
    setCaptchaToken("");
    setScriptReady(false);
    setCaptchaError("The security check could not load. Check your connection and refresh this page.");
  }

  function renderCaptcha() {
    const widget = recaptcha();
    if (!captchaElement.current || captchaWidget.current !== null) return;
    if (!widget || typeof widget.render !== "function") {
      captchaUnavailable();
      return;
    }
    try {
      captchaWidget.current = widget.render(captchaElement.current, {
        sitekey: siteKey ?? "",
        size: "compact",
        callback: (response) => { setCaptchaToken(response); setCaptchaError(""); },
        "expired-callback": () => setCaptchaToken(""),
        "error-callback": captchaUnavailable,
      });
    } catch {
      captchaUnavailable();
    }
  }

  function waitForCaptcha() {
    const widget = recaptcha();
    if (mode === "v3") {
      const markReady = () => {
        if (typeof recaptcha()?.execute === "function") { setScriptReady(true); setCaptchaError(""); }
        else captchaUnavailable();
      };
      if (typeof widget?.ready === "function") widget.ready(markReady);
      else if (typeof widget?.execute === "function") markReady();
      else captchaUnavailable();
      return;
    }
    if (typeof widget?.render === "function") renderCaptcha();
    else if (typeof widget?.ready === "function") widget.ready(renderCaptcha);
    else captchaUnavailable();
  }

  function resetCaptcha() {
    if (captchaWidget.current !== null) recaptcha()?.reset(captchaWidget.current);
    setCaptchaToken("");
  }

  async function responseToken() {
    if (!siteKey || mode === "v2") return captchaToken;
    const provider = recaptcha();
    if (!provider?.execute) throw new Error("The security check is unavailable. Refresh the page and try again.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const token = await Promise.race([
        provider.execute(siteKey, { action }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("The security check timed out.")), 8000);
        }),
      ]);
      if (!token) throw new Error("Missing security response.");
      return token;
    } catch {
      throw new Error("Could not complete the security check. Please try again.");
    } finally {
      clearTimeout(timer);
    }
  }

  const renderParam = mode === "v3" ? encodeURIComponent(siteKey ?? "") : "explicit";
  const widget = siteKey === null ? null : <>
    {siteKey && <>
      {mode === "v2" && <div ref={captchaElement} />}
      <Script src={`https://www.google.com/recaptcha/api.js?render=${renderParam}`} onReady={waitForCaptcha} onError={captchaUnavailable} />
    </>}
    {(!siteKey || captchaError) && <p className="auth-message auth-error" role="alert">{captchaError || "Account security check is temporarily unavailable."}</p>}
  </>;

  return {
    widget,
    responseToken,
    ready: siteKey === null || (mode === "v3" ? scriptReady : Boolean(captchaToken)),
    reset: resetCaptcha,
    clearWidget() { captchaWidget.current = null; },
  };
}
