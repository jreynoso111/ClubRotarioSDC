"use client";

import { useEffect, useState } from "react";
import styles from "./platform.module.css";

const loadedDeploymentId = process.env.CLUB_DEPLOYMENT_ID ?? "";
const CHECK_EVERY_MS = 120_000;

// After a release, a tab opened earlier still calls the previous Server Actions and
// its modules fail to load. This notices the new release (when the tab regains focus
// and every two minutes) and offers a reload instead of showing load errors.
export function PlatformVersionWatcher() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!loadedDeploymentId) return;
    let cancelled = false;
    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const { deploymentId } = await response.json() as { deploymentId?: string };
        if (!cancelled && deploymentId && deploymentId !== loadedDeploymentId) setStale(true);
      } catch { /* offline or restarting: try again later */ }
    }
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, []);
  if (!stale) return null;
  return <div className={styles.versionNotice} role="status">
    <span>Se publicó una versión nueva de la plataforma. Recarga la página para seguir trabajando sin errores.</span>
    <button type="button" onClick={() => window.location.reload()}>Recargar</button>
  </div>;
}
