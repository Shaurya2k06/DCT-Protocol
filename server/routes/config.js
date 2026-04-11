/**
 * Public chain / integration metadata (no secrets).
 */

import express from "express";
import { loadAddresses } from "../lib/blockchain.js";
import { getPimlicoStatus } from "../lib/pimlico.js";
import { getPool } from "../lib/db.js";

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const addrs = loadAddresses();
    res.json({
      chainId: addrs.chainId,
      network: addrs.network,
      identityRegistryVariant: addrs.identityRegistryVariant || "official",
      contracts: {
        ERC8004IdentityRegistry: addrs.ERC8004IdentityRegistry,
        NotaryAttestationVerifier: addrs.NotaryAttestationVerifier,
        DCTRegistry: addrs.DCTRegistry,
        DCTEnforcer: addrs.DCTEnforcer,
      },
      pimlico: getPimlicoStatus(),
      database: {
        enabled: !!getPool(),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
