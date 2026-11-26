"use client";

import Script from "next/script";
import { useRef, useState } from "react";

type Recaptcha = {
  ready?: (callback: () => void) => void;
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

export function useAccountCaptcha(siteKey: string | null) {
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaError, setCaptchaError] = useState("");
  const captchaElement = useRef<HTMLDivElement>(null);
  const captchaWidget = useRef<number | null>(null);

  function captchaUnavailable() {
    setCaptchaToken("");
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
    if (typeof widget?.render === "function") renderCaptcha();
    else if (typeof widget?.ready === "function") widget.ready(renderCaptcha);
    else captchaUnavailable();
  }

  function resetCaptcha() {
    if (captchaWidget.current !== null) recaptcha()?.reset(captchaWidget.current);
    setCaptchaToken("");
  }

  const widget = siteKey === null ? null : <>
    {siteKey && <>
      <div ref={captchaElement} />
      <Script src="https://www.google.com/recaptcha/api.js?render=explicit" onReady={waitForCaptcha} onError={captchaUnavailable} />
    </>}
    {(!siteKey || captchaError) && <p className="auth-message auth-error" role="alert">{captchaError || "Account security check is temporarily unavailable."}</p>}
  </>;

  return {
    widget,
    token: captchaToken,
    ready: siteKey === null || Boolean(captchaToken),
    reset: resetCaptcha,
    clearWidget() { captchaWidget.current = null; },
  };
}
