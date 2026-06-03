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

export const wagmiConfig = rhcRpcUrl
  ? createConfig({
      chains: [arbitrumSepolia, robinhoodChainTestnet],
      ssr: true,
      connectors: [injected()],
      transports: {
        [arbitrumSepolia.id]: http(arbitrumSepoliaRpcUrl),
        [robinhoodChainTestnet.id]: http(rhcRpcUrl),
      },
    })
  : createConfig({
      chains: [arbitrumSepolia],
      ssr: true,
      connectors: [injected()],
      transports: {
        [arbitrumSepolia.id]: http(arbitrumSepoliaRpcUrl),
      },
    });
