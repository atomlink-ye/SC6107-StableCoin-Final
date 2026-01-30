import { anvil, sepolia, type Chain } from 'viem/chains';
import { type Address } from 'viem';

export type ContractConfig = {
  STABLE_COIN: Address;
  STABLE_COIN_ENGINE: Address;
  PSM: Address;
  LIQUIDATION_AUCTION: Address;
  WETH: Address;
  WBTC: Address;
  WETH_PRICE_FEED: Address;
  WBTC_PRICE_FEED: Address;
  SC_PRICE_FEED: Address;
};

export type NetworkConfig = {
  chain: Chain;
  contracts: ContractConfig;
  rpcUrl: string;
};

const anvilConfig: NetworkConfig = {
  chain: anvil,
  rpcUrl: process.env.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545',
  contracts: {
    STABLE_COIN: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_STABLE_COIN as Address || '0xc6e7DF5E7b4f2A278906862b61205850344D4e7d',
    STABLE_COIN_ENGINE: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_STABLE_COIN_ENGINE as Address || '0x59b670e9fA9D0A427751Af201D676719a970857b',
    PSM: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_PSM as Address || '0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44',
    LIQUIDATION_AUCTION: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_LIQUIDATION_AUCTION as Address || '0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1',
    WETH: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_WETH as Address || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    WBTC: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_WBTC as Address || '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    WETH_PRICE_FEED: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_WETH_PRICE_FEED as Address || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    WBTC_PRICE_FEED: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_WBTC_PRICE_FEED as Address || '0x9fE46736679D2D9a65F0992F2272dE9f3c7fa6e0',
    SC_PRICE_FEED: process.env.NEXT_PUBLIC_ANVIL_CONTRACT_SC_PRICE_FEED as Address || '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9',
  },
};

const sepoliaConfig: NetworkConfig = {
  chain: sepolia,
  rpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/8LK7JlayOjp7ZbezGHQ0o',
  contracts: {
    STABLE_COIN: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_STABLE_COIN as Address || '0xb4B1BF77382bB25BD318b8Ad451A070BCd6dB54E',
    STABLE_COIN_ENGINE: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_STABLE_COIN_ENGINE as Address || '0xA7b5aFbcAAd3980F09f6c9555Bc186da60e9F423',
    PSM: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_PSM as Address || '0x75F653931b11A6dC3b0Be102224ECc3C24fb2C19',
    LIQUIDATION_AUCTION: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_LIQUIDATION_AUCTION as Address || '0x8988baD9c1841F5a70f24A696C1645f290Dc4Cf1',
    WETH: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_WETH as Address || '0x4665313Bcf83ef598378A92e066c58A136334479',
    WBTC: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_WBTC as Address || '0x45e4F73c826a27A984C76E385Ae34DDa904d9fcB',
    WETH_PRICE_FEED: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_WETH_PRICE_FEED as Address || '0x694AA1769357215DE4FAC081bf1f309aDC325306',
    WBTC_PRICE_FEED: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_WBTC_PRICE_FEED as Address || '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43',
    SC_PRICE_FEED: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_SC_PRICE_FEED as Address || '0x26818a983a4c93D211515d142B77c6566EdfE2E7',
  },
};

export const configs: Record<number, NetworkConfig> = {
  [anvil.id]: anvilConfig,
  [sepolia.id]: sepoliaConfig,
};

export const getActiveConfig = (): NetworkConfig => {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || anvil.id);
  const config = configs[chainId];
  if (!config) {
    throw new Error(`No config found for chain ID ${chainId}`);
  }
  return config;
};
