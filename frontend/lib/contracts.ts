import { createPublicClient, http, type Address } from 'viem';
import { getActiveConfig } from './config';

const activeConfig = getActiveConfig();

export const activeChain = activeConfig.chain;

export const STABLE_COIN_ADDRESS = activeConfig.contracts.STABLE_COIN;
export const STABLE_COIN_ENGINE_ADDRESS = activeConfig.contracts.STABLE_COIN_ENGINE;
export const PSM_ADDRESS = activeConfig.contracts.PSM;
export const LIQUIDATION_AUCTION_ADDRESS = activeConfig.contracts.LIQUIDATION_AUCTION;
export const WETH_ADDRESS = activeConfig.contracts.WETH;
export const WBTC_ADDRESS = activeConfig.contracts.WBTC;
export const WETH_PRICE_FEED_ADDRESS = activeConfig.contracts.WETH_PRICE_FEED;
export const WBTC_PRICE_FEED_ADDRESS = activeConfig.contracts.WBTC_PRICE_FEED;
export const SC_PRICE_FEED_ADDRESS = activeConfig.contracts.SC_PRICE_FEED;

export const CONTRACTS = {
  STABLE_COIN: STABLE_COIN_ADDRESS,
  STABLE_COIN_ENGINE: STABLE_COIN_ENGINE_ADDRESS,
  PSM: PSM_ADDRESS,
  LIQUIDATION_AUCTION: LIQUIDATION_AUCTION_ADDRESS,
  WETH: WETH_ADDRESS,
  WBTC: WBTC_ADDRESS,
  WETH_PRICE_FEED: WETH_PRICE_FEED_ADDRESS,
  WBTC_PRICE_FEED: WBTC_PRICE_FEED_ADDRESS,
  SC_PRICE_FEED: SC_PRICE_FEED_ADDRESS,
} as const;

export const ANVIL_ACCOUNTS = {
  deployer: (process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266') as Address,
} as const;

export const TOKENS = {
  WETH: {
    address: CONTRACTS.WETH,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    priceFeed: CONTRACTS.WETH_PRICE_FEED,
  },
  WBTC: {
    address: CONTRACTS.WBTC,
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    decimals: 18,
    priceFeed: CONTRACTS.WBTC_PRICE_FEED,
  },
} as const;

export const activeRpcUrl = activeConfig.rpcUrl;

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(activeRpcUrl),
});


export const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const STABLE_COIN_ENGINE_ABI = [
  { type: 'error', name: 'StableCoinEngine__BreaksHealthFactor', inputs: [{ name: 'healthFactor', type: 'uint256' }] },
  { type: 'error', name: 'StableCoinEngine__BurnAmountExceedsMinted', inputs: [{ name: 'burnAmount', type: 'uint256' }, { name: 'mintedAmount', type: 'uint256' }] },
  { type: 'error', name: 'StableCoinEngine__InsufficientCollateral', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__HealthFactorOk', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__HealthFactorNotImproved', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__AmountMustBeMoreThanZero', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__TransferFailed', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__MintFailed', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__TokenNotAllowed', inputs: [{ name: 'tokenCollateralAddress', type: 'address' }] },
  { type: 'error', name: 'StableCoinEngine__ZeroAddress', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__ArrayLengthMismatch', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__InvalidPrice', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__Unauthorized', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__LiquidationAuctionNotConfigured', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__LiquidationAuctionAlreadyConfigured', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__OnlyLiquidationAuction', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__ActiveLiquidationAuctionExists', inputs: [{ name: 'user', type: 'address' }, { name: 'tokenCollateralAddress', type: 'address' }] },
  { type: 'error', name: 'StableCoinEngine__DebtReservedForAuction', inputs: [{ name: 'reservedDebt', type: 'uint256' }, { name: 'burnAmount', type: 'uint256' }] },
  { type: 'error', name: 'StableCoinEngine__DebtNotAvailableForLiquidation', inputs: [{ name: 'availableDebt', type: 'uint256' }, { name: 'requestedDebt', type: 'uint256' }] },
  { type: 'error', name: 'StableCoinEngine__AuctionNotActive', inputs: [{ name: 'auctionId', type: 'uint256' }] },
  { type: 'error', name: 'StableCoinEngine__InvalidAuctionSettlement', inputs: [] },
  { type: 'error', name: 'StableCoinEngine__AuctionBurnExceedsDebt', inputs: [{ name: 'burnAmount', type: 'uint256' }, { name: 'mintedAmount', type: 'uint256' }] },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getAccountInformation',
    outputs: [
      { name: 'totalStableCoinMinted', type: 'uint256' },
      { name: 'collateralValueInUsd', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getHealthFactor',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'tokenCollateralAddress', type: 'address' },
    ],
    name: 'getCollateralBalanceOfUser',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getStableCoinMinted',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getCollateralTokens',
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenCollateralAddress', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'getUsdValue',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenCollateralAddress', type: 'address' },
      { name: 'usdAmountInWei', type: 'uint256' },
    ],
    name: 'getTokenAmountFromUsd',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getLiquidationThreshold',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getLiquidationBonus',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getMinHealthFactor',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getRate',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getCurrentStabilityFeeBps',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getProtocolReserve',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getProtocolBadDebt',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getStableCoinAddress',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getAccountCollateralValueInUsd',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenCollateralAddress', type: 'address' },
      { name: 'amountCollateral', type: 'uint256' },
    ],
    name: 'depositCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenCollateralAddress', type: 'address' },
      { name: 'amountCollateral', type: 'uint256' },
    ],
    name: 'redeemCollateral',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'amountStableCoinToMint', type: 'uint256' }],
    name: 'mintStableCoin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'burnStableCoin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenCollateralAddress', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'debtToCover', type: 'uint256' },
    ],
    name: 'liquidate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const PSM_ABI = [
  {
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'collateralAmountIn', type: 'uint256' },
    ],
    name: 'swapStableForStableCoin',
    outputs: [{ name: 'stableCoinAmountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'stableCoinAmountIn', type: 'uint256' },
    ],
    name: 'swapStableCoinForStable',
    outputs: [{ name: 'collateralAmountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getSupportedCollateralTokens',
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'collateralToken', type: 'address' }],
    name: 'getTokenConfig',
    outputs: [
      {
        components: [
          { name: 'priceFeed', type: 'address' },
          { name: 'decimals', type: 'uint8' },
          { name: 'feeBps', type: 'uint16' },
          { name: 'supported', type: 'bool' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const PRICE_FEED_ABI = [
  {
    inputs: [],
    name: 'latestRoundData',
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export const LIQUIDATION_AUCTION_ABI = [
  {
    inputs: [
      { name: 'auctionId', type: 'uint256' },
      { name: 'bidAmount', type: 'uint256' },
    ],
    name: 'placeBid',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    name: 'finalizeAuction',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'auctionId', type: 'uint256' }],
    name: 'getAuction',
    outputs: [
      {
        components: [
          { name: 'user', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'collateralAmount', type: 'uint256' },
          { name: 'targetDebt', type: 'uint256' },
          { name: 'minimumBid', type: 'uint256' },
          { name: 'highestBid', type: 'uint256' },
          { name: 'highestBidder', type: 'address' },
          { name: 'endTime', type: 'uint64' },
          { name: 'settled', type: 'bool' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getNextAuctionId',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    type: 'event',
    name: 'AuctionCreated',
    inputs: [
      { name: 'auctionId', type: 'uint256', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'collateralToken', type: 'address', indexed: true },
      { name: 'collateralAmount', type: 'uint256', indexed: false },
      { name: 'targetDebt', type: 'uint256', indexed: false },
      { name: 'minimumBid', type: 'uint256', indexed: false },
      { name: 'endTime', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BidPlaced',
    inputs: [
      { name: 'auctionId', type: 'uint256', indexed: true },
      { name: 'bidder', type: 'address', indexed: true },
      { name: 'bidAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AuctionSettled',
    inputs: [
      { name: 'auctionId', type: 'uint256', indexed: true },
      { name: 'winner', type: 'address', indexed: true },
      { name: 'winningBid', type: 'uint256', indexed: false },
      { name: 'collateralAwarded', type: 'uint256', indexed: false },
      { name: 'collateralReturned', type: 'uint256', indexed: false },
    ],
  },
] as const;

// Minimal ABI for the MockV3Aggregator SC price feed deployed on Sepolia.
// updateAnswer() is public — anyone can call it to reset the stale-price timer.
export const MOCK_V3_AGGREGATOR_ABI = [
  {
    inputs: [{ name: '_answer', type: 'int256' }],
    name: 'updateAnswer',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const defaultAccount = ANVIL_ACCOUNTS.deployer;


