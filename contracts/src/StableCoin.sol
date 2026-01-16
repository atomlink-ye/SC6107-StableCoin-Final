// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title StableCoin
 * @author SCP Team
 * @notice This is the ERC20 token for the StableCoin Protocol.
 * @dev Inherits from OpenZeppelin's ERC20 and AccessControl.
 */
contract StableCoin is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    error StableCoin__AmountMustBeMoreThanZero();
    error StableCoin__BurnAmountExceedsBalance();
    error StableCoin__NotZeroAddress();

    constructor() ERC20("StableCoin", "SC") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Mints new StableCoin tokens.
     * @param _to The address to receive the minted tokens.
     * @param _amount The amount of tokens to mint.
     */
    function mint(address _to, uint256 _amount) external onlyRole(MINTER_ROLE) returns (bool) {
        if (_to == address(0)) {
            revert StableCoin__NotZeroAddress();
        }
        if (_amount <= 0) {
            revert StableCoin__AmountMustBeMoreThanZero();
        }
        _mint(_to, _amount);
        return true;
    }

    /**
     * @notice Burns StableCoin tokens from a specific address.
     * @param _from The address to burn tokens from.
     * @param _amount The amount of tokens to burn.
     * @dev Only addresses with BURNER_ROLE can call this.
     */
    function burn(address _from, uint256 _amount) external onlyRole(BURNER_ROLE) {
        if (_amount <= 0) {
            revert StableCoin__AmountMustBeMoreThanZero();
        }
        if (balanceOf(_from) < _amount) {
            revert StableCoin__BurnAmountExceedsBalance();
        }
        _burn(_from, _amount);
    }
}
