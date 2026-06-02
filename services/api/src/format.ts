export function asNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export function walletShort(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function toIso(value: Date | string) {
  return new Date(value).toISOString();
}
