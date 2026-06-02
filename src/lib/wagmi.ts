import { createConfig, http } from "wagmi";
import { arbitrumSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { robinhoodChainTestnet } from "@/lib/onchain-config";

export { robinhoodChainTestnet };

export const wagmiConfig = process.env.NEXT_PUBLIC_RHC_RPC_URL
  ? createConfig({
      chains: [arbitrumSepolia, robinhoodChainTestnet],
      ssr: true,
      connectors: [injected()],
      transports: {
        [arbitrumSepolia.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL),
        [robinhoodChainTestnet.id]: http(process.env.NEXT_PUBLIC_RHC_RPC_URL),
      },
    })
  : createConfig({
      chains: [arbitrumSepolia],
      ssr: true,
      connectors: [injected()],
      transports: {
        [arbitrumSepolia.id]: http(process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL),
      },
    });
