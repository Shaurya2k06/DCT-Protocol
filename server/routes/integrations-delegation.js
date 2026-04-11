/**
 * MetaMask Delegation Framework (ERC-7710) — addresses & encoding hints for client tooling.
 */

import express from "express";
import { loadAddresses } from "../lib/blockchain.js";
import { getPimlicoStatus } from "../lib/pimlico.js";

const router = express.Router();

/** Entry Point v0.7 (canonical) — Base Sepolia */
const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6F37da032";

router.get("/delegation-framework", (req, res) => {
  try {
    const addrs = loadAddresses();
    const dm =
      process.env.DELEGATION_MANAGER_ADDRESS?.trim() || addrs.delegationManager || null;
    const caveat =
      process.env.DCT_CAVEAT_ENFORCER_ADDRESS?.trim() || addrs.DCTCaveatEnforcer || null;

    res.json({
      chainId: addrs.chainId,
      network: addrs.network,
      entryPointV07: ENTRY_POINT_V07,
      delegationManager: dm,
      dctRegistry: addrs.DCTRegistry,
      dctEnforcer: addrs.DCTEnforcer,
      dctCaveatEnforcer: caveat,
      erc8004IdentityRegistry: addrs.ERC8004IdentityRegistry,
      caveatTermsEncoding:
        "abi.encode(bytes32 revocationId) — DCTCaveatEnforcer.beforeHook reverts if DCTRegistry.isRevoked(revocationId)",
      delegationManagerNote:
        "Deploy MetaMask delegation-framework to your chain or set DELEGATION_MANAGER_ADDRESS. Caveat contract: script/DeployDCTCaveat.s.sol then DCT_CAVEAT_ENFORCER_ADDRESS.",
      directExecutionPath:
        "Biscuit authorize → DCTEnforcer.validateActionWithScope (EOA or POST /api/aa/execute-scope for 4337)",
      pimlico: getPimlicoStatus(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
