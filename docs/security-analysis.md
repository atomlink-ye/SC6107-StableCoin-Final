# Security Analysis

The StableCoin Protocol implements multiple layers of security to protect user funds and maintain the stability of the SC token.

## 1. Oracle Safety (OracleLib)
The protocol's biggest risk is oracle manipulation or stale data.
- **Stale Price Checks**: Every price read goes through `OracleLib.staleCheckLatestRoundData()`. If the heartbeat (3 hours) is exceeded, the protocol reverts.
- **Zero/Negative Price Protection**: The engine and PSM explicitly check for `price <= 0` and revert to prevent catastrophic miscalculations.
- **Decimals Normalization**: Prices are normalized to 18 decimals to ensure consistency across different collateral types and price feeds.

## 2. Access Control
- **Role-Based Access**: The `StableCoin` token uses OpenZeppelin's `AccessControl`. Only the `StableCoinEngine` and `PSM` are granted `MINTER_ROLE` and `BURNER_ROLE`.
- **Admin Control**: The deployer initially holds the `DEFAULT_ADMIN_ROLE`, which can be transferred to a multisig or DAO for decentralized governance.

## 3. Reentrancy Protection
- **ReentrancyGuard**: All state-changing functions in `StableCoinEngine` and `PSM` (deposit, redeem, mint, burn, swap, liquidate) use the `nonReentrant` modifier.
- **CEI Pattern**: The protocol follows the Checks-Effects-Interactions pattern. Internal state (e.g., `s_collateralDeposited`) is updated before external token transfers.

## 4. Solvency and Liquidation
- **Over-collateralization**: The protocol requires a minimum of 150% collateralization (Liquidation Threshold = 50%).
- **Incentivized Liquidation**: A 10% bonus encourages liquidators to quickly close under-collateralized positions, preventing bad debt.
- **Health Factor Enforcement**: Every action that reduces collateral or increases debt (redeem, mint) triggers a health factor check that reverts if the HF falls below 1.

## 5. PSM Peg Safety
- **Peg Bounds**: The PSM only allows swaps if the collateral stablecoin (e.g., USDC) is trading between $0.99 and $1.01. This prevents the protocol from being used as a "dumping ground" for depegged assets.
- **Liquidity Checks**: The PSM ensures it has sufficient collateral balance before allowing a swap from SC back to the collateral stable.

## 6. Mathematical Safety
- **Solidity 0.8.x**: Built-in overflow/underflow protection.
- **Precision Management**: Uses a consistent `1e18` precision for calculations to minimize rounding errors.

## 7. Security Review & Tooling
- **Manual Review**: A comprehensive manual security review was performed on all core contracts, focusing on logic flow, access control, and mathematical correctness.
- **Static Analysis (Slither)**: Static analysis using Slither was considered for this project. However, due to environment limitations (Slither not being pre-installed), a rigorous manual audit was conducted in its place to identify common vulnerabilities such as uninitialized variables, shadowing, and reentrancy risks.
- **Stateful Fuzzing**: Foundry's invariant testing was used to ensure system-wide properties hold true under arbitrary sequences of actions.
