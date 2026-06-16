// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal interface to the live Cleanverse A-Pass registry (ERC-721).
/// A wallet "has an A-Pass" iff balanceOf(wallet) > 0.
interface IAPass {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title aUSDx - cx402 stand-in for aUSDC.
/// A minimal ERC-20 that enforces the REAL Cleanverse A-Pass registry on-chain:
/// it can only be minted to, or transferred between, wallets that hold an A-Pass.
/// This reproduces aUSDC's "clean funds by construction" property (the NoAPass
/// revert) against real A-Passes, so cx402 can demonstrate on-chain compliance
/// without depending on Cleanverse's (currently broken) aUSDC faucet.
///
/// The facilitator treats the settlement asset as config; swapping this for real
/// aUSDC is a one-line address change.
contract AUSDx {
    string public constant name = "Access USD (cx402 stand-in)";
    string public constant symbol = "aUSDx";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    address public immutable owner;
    IAPass public immutable apass;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// Raised when a party to a transfer/mint lacks a valid A-Pass.
    error NoAPass(address account);
    error NotOwner();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(address apass_) {
        owner = msg.sender;
        apass = IAPass(apass_);
    }

    function _requireAPass(address account) internal view {
        if (apass.balanceOf(account) == 0) revert NoAPass(account);
    }

    /// Owner-only issuance. Can only mint to an A-Pass'd wallet.
    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        _requireAPass(to);
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /// The compliance hook: both sender and receiver must hold a real A-Pass.
    function _transfer(address from, address to, uint256 amount) internal {
        _requireAPass(from);
        _requireAPass(to);
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
