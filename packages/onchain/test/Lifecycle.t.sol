// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC8183} from "erc8183/ERC8183.sol";
import {MockUSDC} from "erc8183/mocks/MockUSDC.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Happy path: Open -> Funded -> Submitted -> Completed, with no front-running.
contract LifecycleTest is Test {
    ERC8183 escrow;
    MockUSDC usdc;

    address admin = address(0xAD);
    address client = address(0xC1);
    address provider = address(0xB0);
    address evaluator = address(0xE7);

    uint256 constant BUDGET = 20_000; // 0.02 USDC

    function setUp() public {
        usdc = new MockUSDC();
        ERC8183 impl = new ERC8183();
        bytes memory init = abi.encodeCall(ERC8183.initialize, (admin, admin));
        escrow = ERC8183(address(new ERC1967Proxy(address(impl), init)));

        vm.prank(admin);
        escrow.setPaymentTokenAllowed(address(usdc), true);

        usdc.mint(client, 1_000_000);
    }

    function test_happyPath_openToCompleted() public {
        vm.prank(client);
        uint256 jobId = escrow.createJob(
            provider, evaluator, uint48(block.timestamp + 1 days), "lifecycle proof", address(0), 0
        );

        ERC8183.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(ERC8183.JobStatus.Open), "starts Open");

        vm.prank(provider);
        escrow.setBudget(jobId, address(usdc), BUDGET, "");

        vm.prank(client);
        usdc.approve(address(escrow), BUDGET);

        vm.prank(client);
        escrow.fund(jobId, address(usdc), BUDGET, "");

        assertEq(usdc.balanceOf(address(escrow)), BUDGET, "escrow holds the budget after fund");
        job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(ERC8183.JobStatus.Funded), "Funded after fund()");

        vm.prank(provider);
        escrow.submit(jobId, keccak256("deliverable"), "");

        job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(ERC8183.JobStatus.Submitted), "Submitted after submit()");

        vm.prank(evaluator);
        escrow.complete(jobId, bytes32("approved"), "");

        job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(ERC8183.JobStatus.Completed), "Completed after complete()");
        assertEq(usdc.balanceOf(provider), BUDGET, "provider receives the full budget (0% fees by default)");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow holds nothing after payout");
    }
}
