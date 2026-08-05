// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC8183} from "erc8183/ERC8183.sol";
import {MockUSDC} from "erc8183/mocks/MockUSDC.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Replays the exact scenario that succeeded against Arc's stale escrow deployment
/// in spike S8 (see docs/spike-results.md), against the current reference
/// implementation's guarded `fund`. Real S8 transactions for reference:
///   provider front-run setBudget: 0x1caff24388f1797ef3631c88f391bdd3bf0f79148abd232289f029c1ac63af9e
///   client fund (overcharged):    0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2
contract FrontRunGuardTest is Test {
    ERC8183 escrow;
    MockUSDC usdc;

    address admin = address(0xAD);
    address client = address(0xC1);
    address provider = address(0xB0);
    address evaluator = address(0xE7);

    uint256 constant QUOTED = 20_000; // 0.02 USDC, as in S8
    uint256 constant FRONT_RUN = 40_000; // 0.04 USDC, as in S8

    function setUp() public {
        usdc = new MockUSDC();
        ERC8183 impl = new ERC8183();
        bytes memory init = abi.encodeCall(ERC8183.initialize, (admin, admin));
        escrow = ERC8183(address(new ERC1967Proxy(address(impl), init)));

        vm.prank(admin);
        escrow.setPaymentTokenAllowed(address(usdc), true);

        usdc.mint(client, 1_000_000);
    }

    /// The exact S8 scenario. On Arc's stale build this SUCCEEDED and
    /// overcharged the client by 0.02 USDC. Here it must revert.
    function test_frontRunBudgetRaise_reverts() public {
        vm.prank(client);
        uint256 jobId = escrow.createJob(
            provider, evaluator, uint48(block.timestamp + 1 days), "guard proof", address(0), 0
        );

        // Provider quotes 0.02 USDC.
        vm.prank(provider);
        escrow.setBudget(jobId, address(usdc), QUOTED, "");

        // Client approves ONLY the quoted amount -- belt and braces (D-6).
        vm.prank(client);
        usdc.approve(address(escrow), QUOTED);

        // Provider front-runs, raising the budget while still Open.
        vm.prank(provider);
        escrow.setBudget(jobId, address(usdc), FRONT_RUN, "");

        // Client funds believing the price is still QUOTED.
        vm.prank(client);
        vm.expectRevert(ERC8183.BudgetMismatch.selector);
        escrow.fund(jobId, address(usdc), QUOTED, "");

        // And nothing moved.
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow must hold nothing");
        assertEq(usdc.balanceOf(client), 1_000_000, "client must be untouched");
    }

    /// Second line of defence: even funding AT the raised budget fails,
    /// because the client only ever approved the quoted amount.
    function test_exactAllowanceBlocksRaisedBudget() public {
        vm.prank(client);
        uint256 jobId = escrow.createJob(
            provider, evaluator, uint48(block.timestamp + 1 days), "allowance proof", address(0), 0
        );
        vm.prank(provider);
        escrow.setBudget(jobId, address(usdc), QUOTED, "");
        vm.prank(client);
        usdc.approve(address(escrow), QUOTED);

        vm.prank(provider);
        escrow.setBudget(jobId, address(usdc), FRONT_RUN, "");

        vm.prank(client);
        vm.expectRevert(); // ERC20 insufficient allowance
        escrow.fund(jobId, address(usdc), FRONT_RUN, "");
    }
}
