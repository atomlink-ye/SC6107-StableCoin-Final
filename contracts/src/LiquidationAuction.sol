// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILiquidationAuctionEngine {
    function onAuctionSettled(uint256 auctionId, uint256 stableCoinToBurn, uint256 collateralToReturn) external;
}

/**
 * @title LiquidationAuction
 * @author SCP Team
 * @notice English auction module used by StableCoinEngine liquidations.
 * @dev Bidders compete by bidding StableCoin; the winner receives seized collateral.
 */
contract LiquidationAuction is ReentrancyGuard {
    error LiquidationAuction__ZeroAddress();
    error LiquidationAuction__NotEngine();
    error LiquidationAuction__AmountMustBeMoreThanZero();
    error LiquidationAuction__InvalidDuration(uint256 duration);
    error LiquidationAuction__AuctionNotFound(uint256 auctionId);
    error LiquidationAuction__AuctionAlreadySettled(uint256 auctionId);
    error LiquidationAuction__AuctionStillRunning(uint256 auctionId, uint256 endTime);
    error LiquidationAuction__BiddingClosed(uint256 auctionId);
    error LiquidationAuction__BidTooLow(uint256 minimumBid, uint256 providedBid);
    error LiquidationAuction__BidExceedsTargetDebt(uint256 bidAmount, uint256 targetDebt);
    error LiquidationAuction__TransferFailed();

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed user,
        address indexed collateralToken,
        uint256 collateralAmount,
        uint256 targetDebt,
        uint256 minimumBid,
        uint256 endTime
    );
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 bidAmount);
    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 winningBid,
        uint256 collateralAwarded,
        uint256 collateralReturned
    );

    struct Auction {
        address user;
        address collateralToken;
        uint256 collateralAmount;
        uint256 targetDebt;
        uint256 minimumBid;
        uint256 highestBid;
        address highestBidder;
        uint64 endTime;
        bool settled;
    }

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MIN_BID_INCREMENT_BPS = 500; // 5%
    uint256 private constant MIN_AUCTION_DURATION = 15 minutes;
    uint256 private constant MAX_AUCTION_DURATION = 3 days;

    IERC20 private immutable i_stableCoin;
    address private immutable i_engine;

    uint256 private s_nextAuctionId;
    mapping(uint256 => Auction) private s_auctions;

    modifier onlyEngine() {
        if (msg.sender != i_engine) {
            revert LiquidationAuction__NotEngine();
        }
        _;
    }

    modifier moreThanZero(uint256 amount) {
        if (amount == 0) {
            revert LiquidationAuction__AmountMustBeMoreThanZero();
        }
        _;
    }

    constructor(address stableCoinAddress, address engineAddress) {
        if (stableCoinAddress == address(0) || engineAddress == address(0)) {
            revert LiquidationAuction__ZeroAddress();
        }

        i_stableCoin = IERC20(stableCoinAddress);
        i_engine = engineAddress;
    }

    function createAuction(
        address user,
        address collateralToken,
        uint256 collateralAmount,
        uint256 targetDebt,
        uint256 minimumBid,
        uint256 duration
    ) external onlyEngine moreThanZero(collateralAmount) moreThanZero(targetDebt) returns (uint256 auctionId) {
        if (user == address(0) || collateralToken == address(0)) {
            revert LiquidationAuction__ZeroAddress();
        }
        if (minimumBid == 0 || minimumBid > targetDebt) {
            revert LiquidationAuction__BidExceedsTargetDebt(minimumBid, targetDebt);
        }
        if (duration < MIN_AUCTION_DURATION || duration > MAX_AUCTION_DURATION) {
            revert LiquidationAuction__InvalidDuration(duration);
        }

        auctionId = s_nextAuctionId;
        s_nextAuctionId++;

        uint64 endTime = uint64(block.timestamp + duration);
        s_auctions[auctionId] = Auction({
            user: user,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            targetDebt: targetDebt,
            minimumBid: minimumBid,
            highestBid: 0,
            highestBidder: address(0),
            endTime: endTime,
            settled: false
        });

        emit AuctionCreated(auctionId, user, collateralToken, collateralAmount, targetDebt, minimumBid, endTime);
    }

    function placeBid(uint256 auctionId, uint256 bidAmount) external nonReentrant moreThanZero(bidAmount) {
        Auction storage auction = s_auctions[auctionId];
        if (auction.endTime == 0) {
            revert LiquidationAuction__AuctionNotFound(auctionId);
        }
        if (auction.settled) {
            revert LiquidationAuction__AuctionAlreadySettled(auctionId);
        }
        if (block.timestamp >= auction.endTime) {
            revert LiquidationAuction__BiddingClosed(auctionId);
        }
        if (bidAmount > auction.targetDebt) {
            revert LiquidationAuction__BidExceedsTargetDebt(bidAmount, auction.targetDebt);
        }

        uint256 minimumBid = _getMinimumBid(auction);
        if (bidAmount < minimumBid) {
            revert LiquidationAuction__BidTooLow(minimumBid, bidAmount);
        }

        bool transferSuccess = i_stableCoin.transferFrom(msg.sender, address(this), bidAmount);
        if (!transferSuccess) {
            revert LiquidationAuction__TransferFailed();
        }

        address previousBidder = auction.highestBidder;
        uint256 previousBid = auction.highestBid;
        if (previousBidder != address(0)) {
            transferSuccess = i_stableCoin.transfer(previousBidder, previousBid);
            if (!transferSuccess) {
                revert LiquidationAuction__TransferFailed();
            }
        }

        auction.highestBidder = msg.sender;
        auction.highestBid = bidAmount;

        emit BidPlaced(auctionId, msg.sender, bidAmount);
    }

    function finalizeAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = s_auctions[auctionId];
        if (auction.endTime == 0) {
            revert LiquidationAuction__AuctionNotFound(auctionId);
        }
        if (auction.settled) {
            revert LiquidationAuction__AuctionAlreadySettled(auctionId);
        }

        bool canFinalizeEarly = auction.highestBid == auction.targetDebt;
        if (block.timestamp < auction.endTime && !canFinalizeEarly) {
            revert LiquidationAuction__AuctionStillRunning(auctionId, auction.endTime);
        }

        auction.settled = true;

        address winner = auction.highestBidder;
        uint256 winningBid = auction.highestBid;
        uint256 collateralAwarded = 0;
        uint256 collateralReturned = auction.collateralAmount;
        bool transferSuccess;

        if (winner == address(0)) {
            transferSuccess = IERC20(auction.collateralToken).transfer(i_engine, collateralReturned);
            if (!transferSuccess) {
                revert LiquidationAuction__TransferFailed();
            }

            ILiquidationAuctionEngine(i_engine).onAuctionSettled(auctionId, 0, collateralReturned);
            emit AuctionSettled(auctionId, address(0), 0, 0, collateralReturned);
            return;
        }

        collateralAwarded = (auction.collateralAmount * winningBid) / auction.targetDebt;
        if (collateralAwarded == 0) {
            collateralAwarded = 1;
        }
        collateralReturned = auction.collateralAmount - collateralAwarded;

        transferSuccess = i_stableCoin.transfer(i_engine, winningBid);
        if (!transferSuccess) {
            revert LiquidationAuction__TransferFailed();
        }

        transferSuccess = IERC20(auction.collateralToken).transfer(winner, collateralAwarded);
        if (!transferSuccess) {
            revert LiquidationAuction__TransferFailed();
        }

        if (collateralReturned > 0) {
            transferSuccess = IERC20(auction.collateralToken).transfer(i_engine, collateralReturned);
            if (!transferSuccess) {
                revert LiquidationAuction__TransferFailed();
            }
        }

        ILiquidationAuctionEngine(i_engine).onAuctionSettled(auctionId, winningBid, collateralReturned);
        emit AuctionSettled(auctionId, winner, winningBid, collateralAwarded, collateralReturned);
    }

    function getAuction(uint256 auctionId) external view returns (Auction memory) {
        return s_auctions[auctionId];
    }

    function getStableCoinAddress() external view returns (address) {
        return address(i_stableCoin);
    }

    function getEngineAddress() external view returns (address) {
        return i_engine;
    }

    function getNextAuctionId() external view returns (uint256) {
        return s_nextAuctionId;
    }

    function getMinBidIncrementBps() external pure returns (uint256) {
        return MIN_BID_INCREMENT_BPS;
    }

    function getMinAuctionDuration() external pure returns (uint256) {
        return MIN_AUCTION_DURATION;
    }

    function getMaxAuctionDuration() external pure returns (uint256) {
        return MAX_AUCTION_DURATION;
    }

    function _getMinimumBid(Auction storage auction) private view returns (uint256 minimumBid) {
        if (auction.highestBid == 0) {
            return auction.minimumBid;
        }

        uint256 increment = (auction.highestBid * MIN_BID_INCREMENT_BPS) / BPS_DENOMINATOR;
        if (increment == 0) {
            increment = 1;
        }

        minimumBid = auction.highestBid + increment;
        if (minimumBid > auction.targetDebt) {
            return auction.targetDebt;
        }
    }
}
