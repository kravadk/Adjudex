import { createApiServices } from "./api/create-api-services";
import { createOnchainServices } from "./onchain";
import type { PariServices } from "./types";

let services: PariServices | null = null;

/**
 * Backend selection.
 *
 * Default: `api` so the UI reads indexed/backend state and fails closed when
 * backend configuration is missing. `onchain` is available only when explicitly
 * selected for direct contract reads, and does not replace indexed proof surfaces.
 */
export function getServices(): PariServices {
  if (services) return services;

  const backend = (process.env.NEXT_PUBLIC_BACKEND ?? "api").toLowerCase();

  if (backend === "api") {
    services = createApiServices(process.env.NEXT_PUBLIC_API_URL ?? "");
    return services;
  }

  if (backend === "onchain") {
    services = createOnchainServices();
    return services;
  }

  throw new Error(`Unsupported NEXT_PUBLIC_BACKEND value: ${backend}`);
}

export function setServicesForTests(nextServices: PariServices | null) {
  services = nextServices;
}
