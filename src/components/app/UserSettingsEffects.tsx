"use client";

import React from "react";
import type { UserSettings } from "@/lib/types/domain";

export const USER_SETTINGS_EVENT = "adjudex:settings-updated";

export function UserSettingsEffects() {
  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (!response.ok) return;
        const settings = (await response.json()) as UserSettings;
        if (!cancelled) applyUserSettings(settings);
      } catch {
        if (!cancelled) clearUserSettingsEffects();
      }
    }

    function onSettingsUpdated(event: Event) {
      const settings = (event as CustomEvent<UserSettings>).detail;
      if (settings) applyUserSettings(settings);
    }

    window.addEventListener(USER_SETTINGS_EVENT, onSettingsUpdated);
    window.addEventListener("focus", load);
    void load();

    return () => {
      cancelled = true;
      window.removeEventListener(USER_SETTINGS_EVENT, onSettingsUpdated);
      window.removeEventListener("focus", load);
    };
  }, []);

  return null;
}

export function broadcastUserSettings(settings: UserSettings) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UserSettings>(USER_SETTINGS_EVENT, { detail: settings }));
}

function applyUserSettings(settings: UserSettings) {
  document.documentElement.dataset.animations = settings.animationsEnabled ? "on" : "off";
  document.documentElement.dataset.compact = settings.compactMode ? "on" : "off";
}

function clearUserSettingsEffects() {
  delete document.documentElement.dataset.animations;
  delete document.documentElement.dataset.compact;
}
