#!/usr/bin/env node
/**
 * Copies ABIs from Foundry `out/` to client and server for the Node stack.
 * Run after: forge build
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const out = path.join(root, "out");

const artifacts = [
  { solPath: "DCTRegistry.sol", name: "DCTRegistry", outName: "DCTRegistry.json" },
  { solPath: "DCTEnforcer.sol", name: "DCTEnforcer", outName: "DCTEnforcer.json" },
  { solPath: "NotaryAttestationVerifier.sol", name: "NotaryAttestationVerifier", outName: "NotaryAttestationVerifier.json" },
  { solPath: "TestAgentRegistry.sol", name: "TestAgentRegistry", outName: "TestAgentRegistry.json" },
];

function readArtifact(solPath, contractName) {
  const p = path.join(out, solPath, `${contractName}.json`);
  if (!fs.existsSync(p)) {
    console.warn("skip (not built):", p);
    return null;
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeAbi(targetDir, fileName, abi, address = null) {
  fs.mkdirSync(targetDir, { recursive: true });
  const payload = address != null ? { abi, address } : { abi };
  fs.writeFileSync(path.join(targetDir, fileName), JSON.stringify(payload, null, 2));
  console.log("wrote", path.join(targetDir, fileName));
}

const clientAbi = path.join(root, "..", "client", "src", "abi");
const serverAbi = path.join(root, "..", "server", "abi");

for (const a of artifacts) {
  const art = readArtifact(a.solPath, a.name);
  if (!art?.abi) continue;
  writeAbi(clientAbi, a.outName, art.abi);
  writeAbi(serverAbi, a.outName, art.abi);
}

const idMin = path.join(root, "abi", "IdentityRegistry.min.json");
if (fs.existsSync(idMin)) {
  const idAbi = JSON.parse(fs.readFileSync(idMin, "utf8"));
  writeAbi(clientAbi, "IdentityRegistry.json", idAbi);
  writeAbi(serverAbi, "IdentityRegistry.json", idAbi);
}

console.log("Done. Set addresses in client/src/addresses.json and server/addresses.json after deploy.");
