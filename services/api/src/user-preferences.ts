export type SettingsPatch = {
  preferredChain?: unknown;
  currencyDisplay?: unknown;
  notificationsEnabled?: unknown;
  animationsEnabled?: unknown;
  compactMode?: unknown;
  defaultStakeUsd?: unknown;
  explorerPreference?: unknown;
};

export type ValidatedSettingsPatch = {
  preferredChain?: "arbitrum-sepolia" | "rhc";
  currencyDisplay?: "USD" | "USDC";
  notificationsEnabled?: boolean;
  animationsEnabled?: boolean;
  compactMode?: boolean;
  defaultStakeUsd?: number;
  explorerPreference?: "default" | "arbiscan" | "rhc";
};

const allowedPreferredChains = new Set(["arbitrum-sepolia", "rhc"]);
const allowedCurrencyDisplays = new Set(["USD", "USDC"]);
const allowedExplorerPreferences = new Set(["default", "arbiscan", "rhc"]);

export function validateSettingsPatch(input: SettingsPatch): { ok: true; value: ValidatedSettingsPatch } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value: ValidatedSettingsPatch = {};

  if ("preferredChain" in input) {
    if (typeof input.preferredChain === "string" && allowedPreferredChains.has(input.preferredChain)) {
      value.preferredChain = input.preferredChain as ValidatedSettingsPatch["preferredChain"];
    } else {
      errors.push("preferred_chain_invalid");
    }
  }

  if ("currencyDisplay" in input) {
    if (typeof input.currencyDisplay === "string" && allowedCurrencyDisplays.has(input.currencyDisplay)) {
      value.currencyDisplay = input.currencyDisplay as ValidatedSettingsPatch["currencyDisplay"];
    } else {
      errors.push("currency_display_invalid");
    }
  }

  if ("notificationsEnabled" in input) {
    if (typeof input.notificationsEnabled === "boolean") value.notificationsEnabled = input.notificationsEnabled;
    else errors.push("notifications_enabled_invalid");
  }

  if ("animationsEnabled" in input) {
    if (typeof input.animationsEnabled === "boolean") value.animationsEnabled = input.animationsEnabled;
    else errors.push("animations_enabled_invalid");
  }

  if ("compactMode" in input) {
    if (typeof input.compactMode === "boolean") value.compactMode = input.compactMode;
    else errors.push("compact_mode_invalid");
  }

  if ("defaultStakeUsd" in input) {
    const stake = typeof input.defaultStakeUsd === "number" ? input.defaultStakeUsd : Number(input.defaultStakeUsd);
    if (Number.isFinite(stake) && stake >= 1 && stake <= 100_000) value.defaultStakeUsd = stake;
    else errors.push("default_stake_usd_invalid");
  }

  if ("explorerPreference" in input) {
    if (typeof input.explorerPreference === "string" && allowedExplorerPreferences.has(input.explorerPreference)) {
      value.explorerPreference = input.explorerPreference as ValidatedSettingsPatch["explorerPreference"];
    } else {
      errors.push("explorer_preference_invalid");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}
