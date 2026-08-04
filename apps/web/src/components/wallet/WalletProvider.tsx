'use client';

import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { arcTestnet, supportedChains } from '@/lib/wallet-chains';
import { baseSepolia } from 'viem/chains';

// Connectors come from EIP-6963 discovery (on by default), so every
// injected wallet the browser exposes -- MetaMask, Rabby, Brave, Coinbase
// extension -- shows up on its own.
//
// Deliberately NOT importing from 'wagmi/connectors': that barrel pulls in
// @wagmi/core's tempo export, which fails to resolve an 'accounts' module
// and breaks `next build` outright. Discovery gives the same wallets here
// without the broken dependency.
//
// No WalletConnect either -- it needs a project ID from an external
// service, and the non-custodial flow works without it. Add it if mobile
// wallets become a requirement.
const config = createConfig({
  chains: supportedChains,
  transports: {
    [arcTestnet.id]: http(),
    [baseSepolia.id]: http(),
  },
  ssr: true,
});

export function WalletProvider({ children }: { readonly children: ReactNode }) {
  // Created in state so the client isn't shared across requests during SSR.
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
