import { describe, expect, it } from "vitest";
import { validateSettingsPatch } from "../user-preferences";

describe("user preference validation", () => {
  it("accepts supported wallet-scoped settings", () => {
    const result = validateSettingsPatch({
      preferredChain: "arbitrum-sepolia",
      currencyDisplay: "USDC",
      notificationsEnabled: true,
      animationsEnabled: false,
      compactMode: true,
      defaultStakeUsd: 25,
      explorerPreference: "arbiscan",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        preferredChain: "arbitrum-sepolia",
        currencyDisplay: "USDC",
        notificationsEnabled: true,
        animationsEnabled: false,
        compactMode: true,
        defaultStakeUsd: 25,
        explorerPreference: "arbiscan",
      },
    });
  });

  it("rejects unsupported chains, currencies, explorers, and stake values", () => {
    const result = validateSettingsPatch({
      preferredChain: "mainnet",
      currencyDisplay: "EUR",
      defaultStakeUsd: 0,
      explorerPreference: "unknown",
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        "preferred_chain_invalid",
        "currency_display_invalid",
        "default_stake_usd_invalid",
        "explorer_preference_invalid",
      ],
    });
  });

  it("rejects non-boolean notification and display toggles", () => {
    const result = validateSettingsPatch({
      notificationsEnabled: "true",
      animationsEnabled: 1,
      compactMode: "false",
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        "notifications_enabled_invalid",
        "animations_enabled_invalid",
        "compact_mode_invalid",
      ],
    });
  });
});
