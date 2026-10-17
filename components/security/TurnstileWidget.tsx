"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};
declare global { interface Window { turnstile?: TurnstileApi } }

export const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";
const scriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadScript() {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { scriptPromise = null; reject(new Error("turnstile_unavailable")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileHandle = { reset: () => void };

// Renders Cloudflare Turnstile only when a site key is configured; otherwise nothing.
export const TurnstileWidget = forwardRef<TurnstileHandle, { onToken: (token: string) => void; action: string }>(
  function TurnstileWidget({ onToken, action }, ref) {
    const container = useRef<HTMLDivElement>(null);
    const widget = useRef<string | undefined>(undefined);
    const callback = useRef(onToken);
    useEffect(() => { callback.current = onToken; }, [onToken]);
    useImperativeHandle(ref, () => ({ reset() { callback.current(""); if (widget.current) window.turnstile?.reset(widget.current); } }), []);

    useEffect(() => {
      if (!turnstileSiteKey) return;
      let cancelled = false;
      loadScript().then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widget.current = window.turnstile.render(container.current, {
          sitekey: turnstileSiteKey, action, language: "es",
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(""),
          "error-callback": () => callback.current(""),
        });
      }).catch(() => callback.current(""));
      return () => { cancelled = true; if (widget.current) window.turnstile?.remove(widget.current); widget.current = undefined; };
    }, [action]);

    return turnstileSiteKey ? <div ref={container} style={{ minHeight: 65 }} /> : null;
  },
);
