// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC8183} from "erc8183/ERC8183.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Deploys the ERC-8183 reference implementation as a UUPS proxy and allow-lists
/// the chain's USDC as a payment token. Admin/upgrade authority (DEFAULT_ADMIN_ROLE)
/// is kept on the deployer key -- testnet only. A real deployment would move it.
/// See packages/onchain/README.md.
contract DeployEscrow is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external returns (address proxy, address impl) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address usdc = _paymentTokenForChain();

        vm.startBroadcast(deployerKey);

        ERC8183 implementation = new ERC8183();
        bytes memory init = abi.encodeCall(ERC8183.initialize, (deployer, deployer));
        ERC1967Proxy proxyContract = new ERC1967Proxy(address(implementation), init);
        ERC8183(address(proxyContract)).setPaymentTokenAllowed(usdc, true);

        vm.stopBroadcast();

        proxy = address(proxyContract);
        impl = address(implementation);

        console.log("chainId       :", block.chainid);
        console.log("deployer      :", deployer);
        console.log("implementation:", impl);
        console.log("proxy         :", proxy);
        console.log("usdc allowed  :", usdc);
    }

    function _paymentTokenForChain() internal view returns (address) {
        if (block.chainid == 5042002) return ARC_USDC;
        if (block.chainid == 84532) return BASE_SEPOLIA_USDC;
        revert("DeployEscrow: unsupported chain");
    }
}
