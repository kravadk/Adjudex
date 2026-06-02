"use client";

import { useEffect } from "react";

export function PwaServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const enabled =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_ENABLE_PWA_DEV === "1";
    if (!enabled) return;

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // PWA registration must not break the product shell.
    });
  }, []);

  return null;
}
