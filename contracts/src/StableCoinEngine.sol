// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AggregatorV3Interface} from "chainlink-brownie-contracts/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {StableCoin} from "./StableCoin.sol";
import {OracleLib} from "./libraries/OracleLib.sol";
import {LiquidationAuction} from "./LiquidationAuction.sol";

/**
 * @title StableCoinEngine
 * @author SCP Team
 * @notice Core logic for collateralized debt positions and liquidation flow.
 * @dev Uses Chainlink feeds via OracleLib stale checks for all price reads.
 */
contract StableCoinEngine is ReentrancyGuard, Pausable {
    using OracleLib for AggregatorV3Interface;

    error StableCoinEngine__ArrayLengthMismatch();
    error StableCoinEngine__ZeroAddress();
    error StableCoinEngine__AmountMustBeMoreThanZero();
    error StableCoinEngine__TokenNotAllowed(address tokenCollateralAddress);
    error StableCoinEngine__TransferFailed();
    error StableCoinEngine__BreaksHealthFactor(uint256 healthFactor);
    error StableCoinEngine__MintFailed();
    error StableCoinEngine__HealthFactorOk();
    error StableCoinEngine__HealthFactorNotImproved();
    error StableCoinEngine__InsufficientCollateral();
    error StableCoinEngine__BurnAmountExceedsMinted(uint256 burnAmount, uint256 mintedAmount);
    error StableCoinEngine__InvalidPrice();
    error StableCoinEngine__Unauthorized();
    error StableCoinEngine__LiquidationAuctionNotConfigured();
    error StableCoinEngine__LiquidationAuctionAlreadyConfigured();
    error StableCoinEngine__OnlyLiquidationAuction();
    error StableCoinEngine__ActiveLiquidationAuctionExists(address user, address tokenCollateralAddress);
    error StableCoinEngine__DebtReservedForAuction(uint256 reservedDebt, uint256 burnAmount);
    error StableCoinEngine__DebtNotAvailableForLiquidation(uint256 availableDebt, uint256 requestedDebt);
    error StableCoinEngine__AuctionNotActive(uint256 auctionId);
    error StableCoinEngine__InvalidAuctionSettlement();
    error StableCoinEngine__AuctionBurnExceedsDebt(uint256 burnAmount, uint256 mintedAmount);

    event CollateralDeposited(address indexed user, address indexed tokenCollateralAddress, uint256 amountCollateral);
    event CollateralRedeemed(
        address indexed redeemedFrom,
        address indexed redeemedTo,
        address indexed tokenCollateralAddress,
        uint256 amountCollateral
    );
    event StableCoinMinted(address indexed user, uint256 amount);
    event StableCoinBurned(address indexed user, uint256 amount);
    event StabilityFeeAccrued(uint256 annualizedFeeBps, uint256 updatedRate, uint256 timeElapsed);
    event LiquidationAuctionConfigured(address indexed liquidationAuction);
    event LiquidationAuctionStarted(
        uint256 indexed auctionId,
        address indexed user,
        address indexed tokenCollateralAddress,
        uint256 debtToCover,
        uint256 collateralAmount
    );
    event LiquidationAuctionSettled(
        uint256 indexed auctionId,
        address indexed user,
        address indexed tokenCollateralAddress,
        uint256 stableCoinBurned,
        uint256 collateralReturned
    );
    event ProtocolRevenueAccrued(uint256 revenueAccrued, uint256 protocolReserve, uint256 protocolBadDebt);
    event BadDebtSocialized(
        uint256 indexed auctionId, address indexed user, uint256 badDebt, uint256 reserveUsed, uint256 deficitIncrease
    );
    event LiquidationThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event LiquidationBonusUpdated(uint256 oldBonus, uint256 newBonus);
    event StabilityFeeSensitivityUpdated(uint256 belowPeg, uint256 abovePeg);
    event StabilityFeeCapsUpdated(uint256 minFee, uint256 maxFee);
    event BaseStabilityFeeUpdated(uint256 oldFee, uint256 newFee);

    struct PendingLiquidationAuction {
        address user;
        address tokenCollateralAddress;
        uint256 debtToCover;
        uint256 collateralAmount;
        bool active;
    }

    uint256 private constant PRECISION = 1e18;
    uint256 private constant RAY = 1e27;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant PEG_PRICE = 1e18;

    uint256 private constant ORACLE_MAX_DEVIATION_BPS = 3_000; // 30%
    uint256 private constant ORACLE_CIRCUIT_BREAKER_WINDOW = 30 minutes;
    uint256 private constant ORACLE_CIRCUIT_BREAKER_RESET = 1 hours;
    uint256 private constant ORACLE_TWAP_WINDOW = 30 minutes;

    uint256 private s_liquidationThreshold = 50;
    uint256 private constant LIQUIDATION_PRECISION = 100;
    uint256 private constant MIN_HEALTH_FACTOR = 1e18;
    uint256 private s_liquidationBonus = 10;
    uint256 private constant LIQUIDATION_AUCTION_DURATION = 2 hours;
    uint256 private constant LIQUIDATION_AUCTION_MIN_OPENING_BID_BPS = 8_000; // 80%

    uint256 private s_baseStabilityFeeBps = 200; // 2.00%
    uint256 private s_minStabilityFeeBps = 0;
    uint256 private s_maxStabilityFeeBps = 2_500; // 25.00%
    uint256 private constant PEG_DEVIATION_DEADBAND_BPS = 10; // 0.10%
    uint256 private s_belowPegFeeSensitivity = 3;
    uint256 private s_abovePegFeeSensitivity = 2;

    mapping(address => address) private s_priceFeeds;
    mapping(address => OracleLib.OracleState) private s_collateralOracleStates;
    mapping(address => mapping(address => uint256)) private s_collateralDeposited;
    mapping(address => uint256) private s_normalizedDebt;
    mapping(address => uint256) private s_debtReservedForAuction;
    mapping(address => mapping(address => bool)) private s_hasActiveLiquidationAuction;
    mapping(uint256 => PendingLiquidationAuction) private s_pendingLiquidationAuctions;

    uint256 private s_rate;
    uint256 private s_lastStabilityFeeTimestamp;
    uint256 private s_currentStabilityFeeBps;
    uint256 private s_totalNormalizedDebt;
    uint256 private s_protocolReserve;
    uint256 private s_protocolBadDebt;

    address[] private s_collateralTokens;
    StableCoin private immutable i_stableCoin;
    AggregatorV3Interface private immutable i_stableCoinPriceFeed;
    OracleLib.OracleState private s_stableCoinOracleState;
    LiquidationAuction private s_liquidationAuction;

    modifier moreThanZero(uint256 amount) {
        if (amount == 0) {
            revert StableCoinEngine__AmountMustBeMoreThanZero();
        }
        _;
    }

    modifier isAllowedToken(address tokenCollateralAddress) {
        if (s_priceFeeds[tokenCollateralAddress] == address(0)) {
            revert StableCoinEngine__TokenNotAllowed(tokenCollateralAddress);
        }
        _;
    }

    constructor(
        address[] memory tokenCollateralAddresses,
        address[] memory priceFeedAddresses,
        address stableCoinAddress,
        address stableCoinPriceFeedAddress
    ) {
        if (tokenCollateralAddresses.length != priceFeedAddresses.length) {
            revert StableCoinEngine__ArrayLengthMismatch();
        }
        if (stableCoinAddress == address(0) || stableCoinPriceFeedAddress == address(0)) {
            revert StableCoinEngine__ZeroAddress();
        }

        for (uint256 i = 0; i < tokenCollateralAddresses.length; i++) {
            address token = tokenCollateralAddresses[i];
            address priceFeed = priceFeedAddresses[i];
            if (token == address(0) || priceFeed == address(0)) {
                revert StableCoinEngine__ZeroAddress();
            }
            s_priceFeeds[token] = priceFeed;
            s_collateralTokens.push(token);
        }

        i_stableCoin = StableCoin(stableCoinAddress);
        i_stableCoinPriceFeed = AggregatorV3Interface(stableCoinPriceFeedAddress);

        s_rate = RAY;
        s_lastStabilityFeeTimestamp = block.timestamp;
        s_currentStabilityFeeBps = s_baseStabilityFeeBps;
    }

    modifier onlyAdmin() {
        if (!i_stableCoin.hasRole(i_stableCoin.DEFAULT_ADMIN_ROLE(), msg.sender)) {
            revert StableCoinEngine__Unauthorized();
        }
        _;
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function setLiquidationThreshold(uint256 newThreshold) external onlyAdmin {
        emit LiquidationThresholdUpdated(s_liquidationThreshold, newThreshold);
        s_liquidationThreshold = newThreshold;
    }

    function setLiquidationBonus(uint256 newBonus) external onlyAdmin {
        emit LiquidationBonusUpdated(s_liquidationBonus, newBonus);
        s_liquidationBonus = newBonus;
    }

    function setStabilityFeeSensitivity(uint256 belowPeg, uint256 abovePeg) external onlyAdmin {
        emit StabilityFeeSensitivityUpdated(belowPeg, abovePeg);
        s_belowPegFeeSensitivity = belowPeg;
        s_abovePegFeeSensitivity = abovePeg;
    }

    function setStabilityFeeCaps(uint256 minFee, uint256 maxFee) external onlyAdmin {
        emit StabilityFeeCapsUpdated(minFee, maxFee);
        s_minStabilityFeeBps = minFee;
        s_maxStabilityFeeBps = maxFee;
    }

    function setBaseStabilityFee(uint256 newFee) external onlyAdmin {
        emit BaseStabilityFeeUpdated(s_baseStabilityFeeBps, newFee);
        s_baseStabilityFeeBps = newFee;
    }

    function setLiquidationAuction(address liquidationAuction) external {
        if (!i_stableCoin.hasRole(i_stableCoin.DEFAULT_ADMIN_ROLE(), msg.sender)) {
            revert StableCoinEngine__Unauthorized();
        }
        if (liquidationAuction == address(0)) {
            revert StableCoinEngine__ZeroAddress();
        }
        if (address(s_liquidationAuction) != address(0)) {
            revert StableCoinEngine__LiquidationAuctionAlreadyConfigured();
        }

        s_liquidationAuction = LiquidationAuction(liquidationAuction);
        emit LiquidationAuctionConfigured(liquidationAuction);
    }

    function depositCollateral(address tokenCollateralAddress, uint256 amountCollateral)
        external
        moreThanZero(amountCollateral)
        isAllowedToken(tokenCollateralAddress)
        whenNotPaused
        nonReentrant
    {
        s_collateralDeposited[msg.sender][tokenCollateralAddress] += amountCollateral;
        emit CollateralDeposited(msg.sender, tokenCollateralAddress, amountCollateral);

        bool success = IERC20(tokenCollateralAddress).transferFrom(msg.sender, address(this), amountCollateral);
        if (!success) {
            revert StableCoinEngine__TransferFailed();
        }

        _syncCollateralOraclesForUser(msg.sender);
    }

    function redeemCollateral(address tokenCollateralAddress, uint256 amountCollateral)
        external
        moreThanZero(amountCollateral)
        isAllowedToken(tokenCollateralAddress)
        whenNotPaused
        nonReentrant
    {
        uint256 currentRate = _accrueStabilityFee();
        _syncCollateralOraclesForUser(msg.sender);
        _redeemCollateral(tokenCollateralAddress, amountCollateral, msg.sender, msg.sender);
        _revertIfHealthFactorIsBroken(msg.sender, currentRate);
    }

    function mintStableCoin(uint256 amountStableCoinToMint) external moreThanZero(amountStableCoinToMint) whenNotPaused nonReentrant {
        uint256 currentRate = _accrueStabilityFee();
        _syncCollateralOraclesForUser(msg.sender);

        uint256 currentDebt = _debtFromNormalized(s_normalizedDebt[msg.sender], currentRate);
        uint256 updatedNormalizedDebt = _toNormalizedDebt(currentDebt + amountStableCoinToMint, currentRate);
        _setNormalizedDebt(msg.sender, updatedNormalizedDebt);
        _revertIfHealthFactorIsBroken(msg.sender, currentRate);

        bool minted = i_stableCoin.mint(msg.sender, amountStableCoinToMint);
        if (!minted) {
            revert StableCoinEngine__MintFailed();
        }

        emit StableCoinMinted(msg.sender, amountStableCoinToMint);
    }

    function burnStableCoin(uint256 amount) external moreThanZero(amount) whenNotPaused nonReentrant {
        uint256 currentRate = _accrueStabilityFee();
        _syncCollateralOraclesForUser(msg.sender);
        _burnStableCoin(amount, msg.sender, msg.sender, currentRate);
        _revertIfHealthFactorIsBroken(msg.sender, currentRate);
    }

    function liquidate(address tokenCollateralAddress, address user, uint256 debtToCover)
        external
        moreThanZero(debtToCover)
        isAllowedToken(tokenCollateralAddress)
        whenNotPaused
        nonReentrant
    {
        if (address(s_liquidationAuction) == address(0)) {
            revert StableCoinEngine__LiquidationAuctionNotConfigured();
        }
        if (s_hasActiveLiquidationAuction[user][tokenCollateralAddress]) {
            revert StableCoinEngine__ActiveLiquidationAuctionExists(user, tokenCollateralAddress);
        }

        uint256 currentRate = _accrueStabilityFee();
        _syncCollateralOraclesForUser(user);

        if (_healthFactor(user, currentRate) >= MIN_HEALTH_FACTOR) {
            revert StableCoinEngine__HealthFactorOk();
        }

        uint256 reservedDebt = s_debtReservedForAuction[user];
        {
            uint256 mintedAmount = _debtFromNormalized(s_normalizedDebt[user], currentRate);
            uint256 availableDebt = mintedAmount > reservedDebt ? mintedAmount - reservedDebt : 0;
            if (availableDebt < debtToCover) {
                revert StableCoinEngine__DebtNotAvailableForLiquidation(availableDebt, debtToCover);
            }
        }

        uint256 totalCollateralToAuction = _getLiquidationCollateralAmount(tokenCollateralAddress, debtToCover);

        _redeemCollateral(tokenCollateralAddress, totalCollateralToAuction, user, address(s_liquidationAuction));

        uint256 auctionId = _startLiquidationAuction(user, tokenCollateralAddress, debtToCover, totalCollateralToAuction);

        s_pendingLiquidationAuctions[auctionId] = PendingLiquidationAuction({
            user: user,
            tokenCollateralAddress: tokenCollateralAddress,
            debtToCover: debtToCover,
            collateralAmount: totalCollateralToAuction,
            active: true
        });
        s_hasActiveLiquidationAuction[user][tokenCollateralAddress] = true;
        s_debtReservedForAuction[user] = reservedDebt + debtToCover;

        emit LiquidationAuctionStarted(auctionId, user, tokenCollateralAddress, debtToCover, totalCollateralToAuction);
    }

    function finalizeLiquidationAuction(uint256 auctionId) external {
        if (address(s_liquidationAuction) == address(0)) {
            revert StableCoinEngine__LiquidationAuctionNotConfigured();
        }
        s_liquidationAuction.finalizeAuction(auctionId);
    }

    function onAuctionSettled(uint256 auctionId, uint256 stableCoinToBurn, uint256 collateralToReturn)
        external
        nonReentrant
    {
        if (msg.sender != address(s_liquidationAuction)) {
            revert StableCoinEngine__OnlyLiquidationAuction();
        }

        PendingLiquidationAuction memory pendingAuction = s_pendingLiquidationAuctions[auctionId];
        if (!pendingAuction.active) {
            revert StableCoinEngine__AuctionNotActive(auctionId);
        }
        if (stableCoinToBurn > pendingAuction.debtToCover || collateralToReturn > pendingAuction.collateralAmount) {
            revert StableCoinEngine__InvalidAuctionSettlement();
        }

        delete s_pendingLiquidationAuctions[auctionId];
        s_hasActiveLiquidationAuction[pendingAuction.user][pendingAuction.tokenCollateralAddress] = false;

        uint256 reservedDebt = s_debtReservedForAuction[pendingAuction.user];
        if (reservedDebt < pendingAuction.debtToCover) {
            revert StableCoinEngine__InvalidAuctionSettlement();
        }
        s_debtReservedForAuction[pendingAuction.user] = reservedDebt - pendingAuction.debtToCover;

        if (collateralToReturn > 0) {
            s_collateralDeposited[pendingAuction.user][pendingAuction.tokenCollateralAddress] += collateralToReturn;
        }

        uint256 currentRate = _accrueStabilityFee();
        uint256 mintedAmount = _debtFromNormalized(s_normalizedDebt[pendingAuction.user], currentRate);
        if (mintedAmount < stableCoinToBurn) {
            revert StableCoinEngine__AuctionBurnExceedsDebt(stableCoinToBurn, mintedAmount);
        }
        if (mintedAmount < pendingAuction.debtToCover) {
            revert StableCoinEngine__InvalidAuctionSettlement();
        }

        uint256 badDebt = pendingAuction.debtToCover - stableCoinToBurn;
        uint256 reserveUsed;
        uint256 deficitIncrease;
        if (badDebt > 0) {
            reserveUsed = badDebt > s_protocolReserve ? s_protocolReserve : badDebt;
            if (reserveUsed > 0) {
                s_protocolReserve -= reserveUsed;
            }

            deficitIncrease = badDebt - reserveUsed;
            if (deficitIncrease > 0) {
                s_protocolBadDebt += deficitIncrease;
            }

            emit BadDebtSocialized(auctionId, pendingAuction.user, badDebt, reserveUsed, deficitIncrease);
        }

        uint256 updatedNormalizedDebt = _toNormalizedDebt(mintedAmount - pendingAuction.debtToCover, currentRate);
        _setNormalizedDebt(pendingAuction.user, updatedNormalizedDebt);

        if (stableCoinToBurn > 0) {
            i_stableCoin.burn(address(this), stableCoinToBurn);
            emit StableCoinBurned(pendingAuction.user, stableCoinToBurn);
        }

        emit LiquidationAuctionSettled(
            auctionId,
            pendingAuction.user,
            pendingAuction.tokenCollateralAddress,
            stableCoinToBurn,
            collateralToReturn
        );
    }

    function dripStabilityFee() external returns (uint256 updatedRate) {
        updatedRate = _accrueStabilityFee();
    }

    function getAccountInformation(address user)
        external
        view
        returns (uint256 totalStableCoinMinted, uint256 collateralValueInUsd)
    {
        return _getAccountInformation(user, _previewRate());
    }

    function getAccountCollateralValueInUsd(address user) external view returns (uint256) {
        return _getAccountCollateralValueInUsd(user);
    }

    function getHealthFactor(address user) external view returns (uint256) {
        return _healthFactor(user, _previewRate());
    }

    function getUsdValue(address tokenCollateralAddress, uint256 amount) public view returns (uint256) {
        address priceFeedAddress = s_priceFeeds[tokenCollateralAddress];
        if (priceFeedAddress == address(0)) {
            revert StableCoinEngine__TokenNotAllowed(tokenCollateralAddress);
        }

        uint256 validatedPrice = _peekCollateralPrice(tokenCollateralAddress);
        return (validatedPrice * amount) / PRECISION;
    }

    function getTokenAmountFromUsd(address tokenCollateralAddress, uint256 usdAmountInWei) public view returns (uint256) {
        address priceFeedAddress = s_priceFeeds[tokenCollateralAddress];
        if (priceFeedAddress == address(0)) {
            revert StableCoinEngine__TokenNotAllowed(tokenCollateralAddress);
        }

        uint256 validatedPrice = _peekCollateralPrice(tokenCollateralAddress);
        return (usdAmountInWei * PRECISION) / validatedPrice;
    }

    function getCollateralBalanceOfUser(address user, address tokenCollateralAddress) external view returns (uint256) {
        return s_collateralDeposited[user][tokenCollateralAddress];
    }

    function getStableCoinMinted(address user) external view returns (uint256) {
        return _debtFromNormalized(s_normalizedDebt[user], _previewRate());
    }

    function getNormalizedDebt(address user) external view returns (uint256) {
        return s_normalizedDebt[user];
    }

    function getCollateralTokens() external view returns (address[] memory) {
        return s_collateralTokens;
    }

    function getPriceFeed(address tokenCollateralAddress) external view returns (address) {
        return s_priceFeeds[tokenCollateralAddress];
    }

    function getStableCoinAddress() external view returns (address) {
        return address(i_stableCoin);
    }

    function getStableCoinPriceFeed() external view returns (address) {
        return address(i_stableCoinPriceFeed);
    }

    function getLiquidationAuctionAddress() external view returns (address) {
        return address(s_liquidationAuction);
    }

    function getDebtReservedForAuction(address user) external view returns (uint256) {
        return s_debtReservedForAuction[user];
    }

    function hasActiveLiquidationAuction(address user, address tokenCollateralAddress) external view returns (bool) {
        return s_hasActiveLiquidationAuction[user][tokenCollateralAddress];
    }

    function getPendingLiquidationAuction(uint256 auctionId)
        external
        view
        returns (address user, address tokenCollateralAddress, uint256 debtToCover, uint256 collateralAmount, bool active)
    {
        PendingLiquidationAuction memory pendingAuction = s_pendingLiquidationAuctions[auctionId];
        return (
            pendingAuction.user,
            pendingAuction.tokenCollateralAddress,
            pendingAuction.debtToCover,
            pendingAuction.collateralAmount,
            pendingAuction.active
        );
    }

    function getLiquidationThreshold() external view returns (uint256) {
        return s_liquidationThreshold;
    }

    function getLiquidationBonus() external view returns (uint256) {
        return s_liquidationBonus;
    }

    function getMinHealthFactor() external pure returns (uint256) {
        return MIN_HEALTH_FACTOR;
    }

    function getRate() external view returns (uint256) {
        return s_rate;
    }

    function getPreviewRate() external view returns (uint256) {
        return _previewRate();
    }

    function getCurrentStabilityFeeBps() external view returns (uint256) {
        return _targetStabilityFeeBps(_peekStableCoinPrice());
    }

    function getAppliedStabilityFeeBps() external view returns (uint256) {
        return s_currentStabilityFeeBps;
    }

    function getProtocolReserve() external view returns (uint256) {
        return s_protocolReserve;
    }

    function getProtocolBadDebt() external view returns (uint256) {
        return s_protocolBadDebt;
    }

    function getLastStabilityFeeTimestamp() external view returns (uint256) {
        return s_lastStabilityFeeTimestamp;
    }

    function getBaseStabilityFeeBps() external view returns (uint256) {
        return s_baseStabilityFeeBps;
    }

    function getMinStabilityFeeBps() external view returns (uint256) {
        return s_minStabilityFeeBps;
    }

    function getMaxStabilityFeeBps() external view returns (uint256) {
        return s_maxStabilityFeeBps;
    }

    function getPegPrice() external pure returns (uint256) {
        return PEG_PRICE;
    }

    function _startLiquidationAuction(address user, address tokenCollateralAddress, uint256 debtToCover, uint256 collateralAmount)
        internal
        returns (uint256)
    {
        uint256 minimumOpeningBid = (debtToCover * LIQUIDATION_AUCTION_MIN_OPENING_BID_BPS) / BPS_DENOMINATOR;
        if (minimumOpeningBid == 0) {
            minimumOpeningBid = 1;
        }

        return s_liquidationAuction.createAuction(
            user,
            tokenCollateralAddress,
            collateralAmount,
            debtToCover,
            minimumOpeningBid,
            LIQUIDATION_AUCTION_DURATION
        );
    }

    function _getLiquidationCollateralAmount(address tokenCollateralAddress, uint256 debtToCover)
        internal
        view
        returns (uint256)
    {
        uint256 tokenAmountFromDebtCovered = getTokenAmountFromUsd(tokenCollateralAddress, debtToCover);
        uint256 bonusCollateral = (tokenAmountFromDebtCovered * s_liquidationBonus) / LIQUIDATION_PRECISION;
        return tokenAmountFromDebtCovered + bonusCollateral;
    }

    function _burnStableCoin(uint256 amountStableCoinToBurn, address onBehalfOf, address stableCoinFrom, uint256 rate)
        internal
    {
        uint256 mintedAmount = _debtFromNormalized(s_normalizedDebt[onBehalfOf], rate);
        if (mintedAmount < amountStableCoinToBurn) {
            revert StableCoinEngine__BurnAmountExceedsMinted(amountStableCoinToBurn, mintedAmount);
        }
        if ((mintedAmount - amountStableCoinToBurn) < s_debtReservedForAuction[onBehalfOf]) {
            revert StableCoinEngine__DebtReservedForAuction(
                s_debtReservedForAuction[onBehalfOf], amountStableCoinToBurn
            );
        }

        uint256 updatedNormalizedDebt = _toNormalizedDebt(mintedAmount - amountStableCoinToBurn, rate);
        _setNormalizedDebt(onBehalfOf, updatedNormalizedDebt);
        i_stableCoin.burn(stableCoinFrom, amountStableCoinToBurn);

        emit StableCoinBurned(onBehalfOf, amountStableCoinToBurn);
    }

    function _redeemCollateral(address tokenCollateralAddress, uint256 amountCollateral, address from, address to) internal {
        uint256 collateralBalance = s_collateralDeposited[from][tokenCollateralAddress];
        if (collateralBalance < amountCollateral) {
            revert StableCoinEngine__InsufficientCollateral();
        }

        s_collateralDeposited[from][tokenCollateralAddress] = collateralBalance - amountCollateral;
        emit CollateralRedeemed(from, to, tokenCollateralAddress, amountCollateral);

        bool success = IERC20(tokenCollateralAddress).transfer(to, amountCollateral);
        if (!success) {
            revert StableCoinEngine__TransferFailed();
        }
    }

    function _getAccountInformation(address user, uint256 rate)
        internal
        view
        returns (uint256 totalStableCoinMinted, uint256 collateralValueInUsd)
    {
        totalStableCoinMinted = _debtFromNormalized(s_normalizedDebt[user], rate);
        collateralValueInUsd = _getAccountCollateralValueInUsd(user);
    }

    function _healthFactor(address user, uint256 rate) internal view returns (uint256) {
        (uint256 totalStableCoinMinted, uint256 collateralValueInUsd) = _getAccountInformation(user, rate);
        return _calculateHealthFactor(totalStableCoinMinted, collateralValueInUsd);
    }

    function _calculateHealthFactor(uint256 totalStableCoinMinted, uint256 collateralValueInUsd)
        internal
        view
        returns (uint256)
    {
        if (totalStableCoinMinted == 0) {
            return type(uint256).max;
        }

        uint256 collateralAdjustedForThreshold =
            (collateralValueInUsd * s_liquidationThreshold) / LIQUIDATION_PRECISION;
        return (collateralAdjustedForThreshold * PRECISION) / totalStableCoinMinted;
    }

    function _getAccountCollateralValueInUsd(address user) internal view returns (uint256 totalCollateralValueInUsd) {
        for (uint256 i = 0; i < s_collateralTokens.length; i++) {
            address tokenCollateralAddress = s_collateralTokens[i];
            uint256 amount = s_collateralDeposited[user][tokenCollateralAddress];
            if (amount == 0) {
                continue;
            }
            totalCollateralValueInUsd += getUsdValue(tokenCollateralAddress, amount);
        }
    }

    function _syncCollateralOraclesForUser(address user) internal {
        OracleLib.OracleConfig memory oracleConfig = _oracleConfig();

        for (uint256 i = 0; i < s_collateralTokens.length; i++) {
            address tokenCollateralAddress = s_collateralTokens[i];
            if (s_collateralDeposited[user][tokenCollateralAddress] == 0) {
                continue;
            }

            OracleLib.readValidatedPrice(
                AggregatorV3Interface(s_priceFeeds[tokenCollateralAddress]),
                s_collateralOracleStates[tokenCollateralAddress],
                oracleConfig
            );
        }
    }

    function _peekCollateralPrice(address tokenCollateralAddress) internal view returns (uint256) {
        return OracleLib.peekValidatedPrice(
            AggregatorV3Interface(s_priceFeeds[tokenCollateralAddress]),
            s_collateralOracleStates[tokenCollateralAddress],
            _oracleConfig()
        );
    }

    function _accrueStabilityFee() internal returns (uint256 updatedRate) {
        updatedRate = s_rate;
        uint256 previousRate = updatedRate;
        uint256 timeElapsed = block.timestamp - s_lastStabilityFeeTimestamp;
        if (timeElapsed == 0) {
            return updatedRate;
        }

        uint256 annualizedFeeBps = _targetStabilityFeeBps(_readStableCoinPrice());
        s_currentStabilityFeeBps = annualizedFeeBps;

        uint256 rateIncrease = (updatedRate * annualizedFeeBps * timeElapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        updatedRate += rateIncrease;

        if (rateIncrease > 0 && s_totalNormalizedDebt > 0) {
            uint256 debtBeforeAccrual = _debtFromNormalized(s_totalNormalizedDebt, previousRate);
            uint256 debtAfterAccrual = _debtFromNormalized(s_totalNormalizedDebt, updatedRate);
            uint256 protocolRevenue = debtAfterAccrual - debtBeforeAccrual;
            if (protocolRevenue > 0) {
                _recordProtocolRevenue(protocolRevenue);
                emit ProtocolRevenueAccrued(protocolRevenue, s_protocolReserve, s_protocolBadDebt);
            }
        }

        s_rate = updatedRate;
        s_lastStabilityFeeTimestamp = block.timestamp;
        emit StabilityFeeAccrued(annualizedFeeBps, updatedRate, timeElapsed);
    }

    function _setNormalizedDebt(address user, uint256 updatedNormalizedDebt) internal {
        uint256 previousNormalizedDebt = s_normalizedDebt[user];
        s_normalizedDebt[user] = updatedNormalizedDebt;

        if (updatedNormalizedDebt >= previousNormalizedDebt) {
            s_totalNormalizedDebt += updatedNormalizedDebt - previousNormalizedDebt;
            return;
        }

        s_totalNormalizedDebt -= previousNormalizedDebt - updatedNormalizedDebt;
    }

    function _recordProtocolRevenue(uint256 protocolRevenue) internal {
        uint256 remainingRevenue = protocolRevenue;
        uint256 protocolBadDebt = s_protocolBadDebt;

        if (protocolBadDebt > 0) {
            uint256 badDebtCovered = remainingRevenue > protocolBadDebt ? protocolBadDebt : remainingRevenue;
            s_protocolBadDebt = protocolBadDebt - badDebtCovered;
            remainingRevenue -= badDebtCovered;
        }

        if (remainingRevenue > 0) {
            s_protocolReserve += remainingRevenue;
        }
    }

    function _previewRate() internal view returns (uint256) {
        uint256 updatedRate = s_rate;
        uint256 timeElapsed = block.timestamp - s_lastStabilityFeeTimestamp;
        if (timeElapsed == 0) {
            return updatedRate;
        }

        uint256 annualizedFeeBps = _targetStabilityFeeBps(_peekStableCoinPrice());
        uint256 rateIncrease = (updatedRate * annualizedFeeBps * timeElapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        return updatedRate + rateIncrease;
    }

    function _targetStabilityFeeBps(uint256 stableCoinPrice) internal view returns (uint256) {

        if (stableCoinPrice < PEG_PRICE) {
            uint256 deviationBps = ((PEG_PRICE - stableCoinPrice) * BPS_DENOMINATOR) / PEG_PRICE;
            if (deviationBps <= PEG_DEVIATION_DEADBAND_BPS) {
                return s_baseStabilityFeeBps;
            }

            uint256 adjustedFeeBps =
                s_baseStabilityFeeBps + ((deviationBps - PEG_DEVIATION_DEADBAND_BPS) * s_belowPegFeeSensitivity);
            if (adjustedFeeBps > s_maxStabilityFeeBps) {
                return s_maxStabilityFeeBps;
            }
            return adjustedFeeBps;
        }

        uint256 positiveDeviationBps = ((stableCoinPrice - PEG_PRICE) * BPS_DENOMINATOR) / PEG_PRICE;
        if (positiveDeviationBps <= PEG_DEVIATION_DEADBAND_BPS) {
            return s_baseStabilityFeeBps;
        }

        uint256 feeReduction = (positiveDeviationBps - PEG_DEVIATION_DEADBAND_BPS) * s_abovePegFeeSensitivity;
        if (feeReduction >= s_baseStabilityFeeBps) {
            return s_minStabilityFeeBps;
        }

        uint256 reducedFeeBps = s_baseStabilityFeeBps - feeReduction;
        if (reducedFeeBps < s_minStabilityFeeBps) {
            return s_minStabilityFeeBps;
        }
        return reducedFeeBps;
    }

    function _readStableCoinPrice() internal returns (uint256) {
        return OracleLib.readValidatedPrice(i_stableCoinPriceFeed, s_stableCoinOracleState, _oracleConfig());
    }

    function _peekStableCoinPrice() internal view returns (uint256) {
        return OracleLib.peekValidatedPrice(i_stableCoinPriceFeed, s_stableCoinOracleState, _oracleConfig());
    }

    function _oracleConfig() internal pure returns (OracleLib.OracleConfig memory) {
        return OracleLib.OracleConfig({
            maxDeviationBps: ORACLE_MAX_DEVIATION_BPS,
            shortCircuitBreakerWindow: ORACLE_CIRCUIT_BREAKER_WINDOW,
            circuitBreakerResetWindow: ORACLE_CIRCUIT_BREAKER_RESET,
            twapWindow: ORACLE_TWAP_WINDOW
        });
    }

    function _toNormalizedDebt(uint256 debtAmount, uint256 rate) internal pure returns (uint256) {
        if (debtAmount == 0) {
            return 0;
        }
        return ((debtAmount * RAY) + rate - 1) / rate;
    }

    function _debtFromNormalized(uint256 normalizedDebt, uint256 rate) internal pure returns (uint256) {
        if (normalizedDebt == 0) {
            return 0;
        }
        return ((normalizedDebt * rate) + RAY - 1) / RAY;
    }

    function _revertIfHealthFactorIsBroken(address user, uint256 rate) internal view {
        uint256 userHealthFactor = _healthFactor(user, rate);
        if (userHealthFactor < MIN_HEALTH_FACTOR) {
            revert StableCoinEngine__BreaksHealthFactor(userHealthFactor);
        }
    }
}
