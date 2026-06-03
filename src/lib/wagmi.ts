import { createConfig, http } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import {
  getPublicArbitrumSepoliaRpcUrl,
  getPublicRhcRpcUrl,
  robinhoodChainTestnet,
} from "@/lib/onchain-config";

export { robinhoodChainTestnet };

const arbitrumSepoliaRpcUrl = getPublicArbitrumSepoliaRpcUrl();
const rhcRpcUrl = getPublicRhcRpcUrl();

// Transient-RPC resilience: retry a few times with backoff and cap the wait so
// a slow/unreachable node surfaces a clean error instead of hanging forever.
const RPC_TRANSPORT_OPTS = { retryCount: 3, retryDelay: 250, timeout: 20_000 } as const;

export const wagmiConfig = rhcRpcUrl
  ? createConfig({
      chains: [arbitrumSepolia, robinhoodChainTestnet],
      ssr: true,
      connectors: [injected()],
      transports: {
        [arbitrumSepolia.id]: http(arbitrumSepoliaRpcUrl, RPC_TRANSPORT_OPTS),
        [robinhoodChainTestnet.id]: http(rhcRpcUrl, RPC_TRANSPORT_OPTS),
      },
    })
  : createConfig({
      chains: [arbitrumSepolia],
      ssr: true,
      connectors: [injected()],
      transports: {
        [arbitrumSepolia.id]: http(arbitrumSepoliaRpcUrl, RPC_TRANSPORT_OPTS),
      },
    });
