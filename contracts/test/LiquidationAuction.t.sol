// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

import {StableCoin} from "../src/StableCoin.sol";
import {LiquidationAuction} from "../src/LiquidationAuction.sol";

contract MockLiquidationEngine {
    error MockLiquidationEngine__AuctionAlreadySet();
    error MockLiquidationEngine__AuctionNotSet();
    error MockLiquidationEngine__OnlyAuction();
    error MockLiquidationEngine__TransferFailed();

    StableCoin private immutable i_stableCoin;
    LiquidationAuction private s_auction;

    uint256 private s_totalBurned;
    uint256 private s_lastAuctionId;
    uint256 private s_lastStableCoinToBurn;
    uint256 private s_lastCollateralToReturn;

    constructor(address stableCoin) {
        i_stableCoin = StableCoin(stableCoin);
    }

    function setAuction(address auction) external {
        if (address(s_auction) != address(0)) {
            revert MockLiquidationEngine__AuctionAlreadySet();
        }
        s_auction = LiquidationAuction(auction);
    }

    function startAuction(
        address user,
        address collateralToken,
        uint256 collateralAmount,
        uint256 targetDebt,
        uint256 minimumBid,
        uint256 duration
    ) external returns (uint256 auctionId) {
        if (address(s_auction) == address(0)) {
            revert MockLiquidationEngine__AuctionNotSet();
        }

        bool success = IERC20(collateralToken).transfer(address(s_auction), collateralAmount);
        if (!success) {
            revert MockLiquidationEngine__TransferFailed();
        }

        auctionId = s_auction.createAuction(user, collateralToken, collateralAmount, targetDebt, minimumBid, duration);
    }

    function onAuctionSettled(uint256 auctionId, uint256 stableCoinToBurn, uint256 collateralToReturn) external {
        if (msg.sender != address(s_auction)) {
            revert MockLiquidationEngine__OnlyAuction();
        }

        s_lastAuctionId = auctionId;
        s_lastStableCoinToBurn = stableCoinToBurn;
        s_lastCollateralToReturn = collateralToReturn;

        if (stableCoinToBurn > 0) {
            s_totalBurned += stableCoinToBurn;
            i_stableCoin.burn(address(this), stableCoinToBurn);
        }
    }

    function getTotalBurned() external view returns (uint256) {
        return s_totalBurned;
    }

    function getLastSettlement() external view returns (uint256 auctionId, uint256 stableCoinToBurn, uint256 collateralToReturn) {
        return (s_lastAuctionId, s_lastStableCoinToBurn, s_lastCollateralToReturn);
    }
}

contract LiquidationAuctionTest is Test {
    uint256 private constant AUCTION_DURATION = 2 hours;
    uint256 private constant TARGET_DEBT = 1_000e18;
    uint256 private constant MIN_OPENING_BID = 800e18;
    uint256 private constant COLLATERAL_AMOUNT = 1.1 ether;

    address private constant USER = address(1);
    address private constant BIDDER_ONE = address(2);
    address private constant BIDDER_TWO = address(3);

    StableCoin private s_stableCoin;
    ERC20Mock private s_collateral;
    MockLiquidationEngine private s_engine;
    LiquidationAuction private s_auction;

    function setUp() public {
        s_stableCoin = new StableCoin();
        s_collateral = new ERC20Mock();
        s_engine = new MockLiquidationEngine(address(s_stableCoin));
        s_auction = new LiquidationAuction(address(s_stableCoin), address(s_engine));
        s_engine.setAuction(address(s_auction));

        s_stableCoin.grantRole(s_stableCoin.MINTER_ROLE(), address(this));
        s_stableCoin.grantRole(s_stableCoin.BURNER_ROLE(), address(s_engine));
    }

    function testCreateAuctionOnlyEngine() public {
        vm.expectRevert(LiquidationAuction.LiquidationAuction__NotEngine.selector);
        s_auction.createAuction(USER, address(s_collateral), COLLATERAL_AMOUNT, TARGET_DEBT, MIN_OPENING_BID, AUCTION_DURATION);
    }

    function testPlaceBidRequiresCompetitiveHigherBid() public {
        uint256 auctionId = _createAuction();

        _mintStableCoinAndApprove(BIDDER_ONE, MIN_OPENING_BID);
        vm.prank(BIDDER_ONE);
        s_auction.placeBid(auctionId, MIN_OPENING_BID);

        _mintStableCoinAndApprove(BIDDER_TWO, TARGET_DEBT);
        vm.prank(BIDDER_TWO);
        vm.expectRevert(
            abi.encodeWithSelector(LiquidationAuction.LiquidationAuction__BidTooLow.selector, 840e18, 820e18)
        );
        s_auction.placeBid(auctionId, 820e18);

        vm.prank(BIDDER_TWO);
        s_auction.placeBid(auctionId, 840e18);

        LiquidationAuction.Auction memory auction = s_auction.getAuction(auctionId);
        assertEq(auction.highestBid, 840e18);
        assertEq(auction.highestBidder, BIDDER_TWO);
    }

    function testFinalizeAuctionFullFillBurnsTargetDebtAndTransfersAllCollateral() public {
        uint256 auctionId = _createAuction();

        _mintStableCoinAndApprove(BIDDER_ONE, TARGET_DEBT);
        vm.prank(BIDDER_ONE);
        s_auction.placeBid(auctionId, TARGET_DEBT);

        s_auction.finalizeAuction(auctionId);

        assertEq(s_collateral.balanceOf(BIDDER_ONE), COLLATERAL_AMOUNT);
        assertEq(s_collateral.balanceOf(address(s_engine)), 0);
        assertEq(s_stableCoin.balanceOf(address(s_engine)), 0);
        assertEq(s_engine.getTotalBurned(), TARGET_DEBT);

        (uint256 settledAuctionId, uint256 stableCoinToBurn, uint256 collateralToReturn) = s_engine.getLastSettlement();
        assertEq(settledAuctionId, auctionId);
        assertEq(stableCoinToBurn, TARGET_DEBT);
        assertEq(collateralToReturn, 0);
    }

    function testFinalizeAuctionPartialFillBurnsWinningBidAndReturnsRemainder() public {
        uint256 auctionId = _createAuction();
        uint256 partialBid = 900e18;

        _mintStableCoinAndApprove(BIDDER_ONE, partialBid);
        vm.prank(BIDDER_ONE);
        s_auction.placeBid(auctionId, partialBid);

        vm.warp(block.timestamp + AUCTION_DURATION + 1);
        s_auction.finalizeAuction(auctionId);

        uint256 expectedCollateralAwarded = (COLLATERAL_AMOUNT * partialBid) / TARGET_DEBT;
        uint256 expectedCollateralReturned = COLLATERAL_AMOUNT - expectedCollateralAwarded;

        assertEq(s_collateral.balanceOf(BIDDER_ONE), expectedCollateralAwarded);
        assertEq(s_collateral.balanceOf(address(s_engine)), expectedCollateralReturned);
        assertEq(s_engine.getTotalBurned(), partialBid);

        (uint256 settledAuctionId, uint256 stableCoinToBurn, uint256 collateralToReturn) = s_engine.getLastSettlement();
        assertEq(settledAuctionId, auctionId);
        assertEq(stableCoinToBurn, partialBid);
        assertEq(collateralToReturn, expectedCollateralReturned);
    }

    function testFinalizeAuctionNoBiddersReturnsCollateralAndBurnsNothing() public {
        uint256 auctionId = _createAuction();

        vm.warp(block.timestamp + AUCTION_DURATION + 1);
        s_auction.finalizeAuction(auctionId);

        assertEq(s_collateral.balanceOf(address(s_engine)), COLLATERAL_AMOUNT);
        assertEq(s_engine.getTotalBurned(), 0);

        (uint256 settledAuctionId, uint256 stableCoinToBurn, uint256 collateralToReturn) = s_engine.getLastSettlement();
        assertEq(settledAuctionId, auctionId);
        assertEq(stableCoinToBurn, 0);
        assertEq(collateralToReturn, COLLATERAL_AMOUNT);
    }

    function _createAuction() internal returns (uint256 auctionId) {
        s_collateral.mint(address(s_engine), COLLATERAL_AMOUNT);
        auctionId = s_engine.startAuction(
            USER, address(s_collateral), COLLATERAL_AMOUNT, TARGET_DEBT, MIN_OPENING_BID, AUCTION_DURATION
        );
    }

    function _mintStableCoinAndApprove(address bidder, uint256 amount) internal {
        s_stableCoin.mint(bidder, amount);
        vm.prank(bidder);
        s_stableCoin.approve(address(s_auction), amount);
    }
}
