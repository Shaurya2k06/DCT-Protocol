/**
 * Blockchain layer — provider, signer, contracts, DCT SDK context.
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setDCTContext } from "@shaurya2k06/dctsdk";
import { resolveHttpRpcUrl, missingRpcHelp } from "./rpc-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

let provider;
let signer;
const contracts = {};

export function getProvider() {
  if (!provider) {
    const rpcUrl = resolveHttpRpcUrl();
    if (!rpcUrl) {
      throw new Error(missingRpcHelp());
    }
    provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return provider;
}

export function getSigner() {
  if (!signer) {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("PRIVATE_KEY is required");
    }
    signer = new ethers.Wallet(`0x${privateKey.replace(/^0x/, "")}`, getProvider());
  }
  return signer;
}

function loadABI(contractName) {
  const abiPath = path.join(__dirname, "..", "abi", `${contractName}.json`);
  if (!fs.existsSync(abiPath)) {
    throw new Error(
      `ABI not found: ${abiPath}. Run: cd contracts && forge build && node scripts/export-abis.mjs`
    );
  }
  return JSON.parse(fs.readFileSync(abiPath, "utf-8"));
}

const ADDRESS_KEY = {
  DCTRegistry: "DCTRegistry",
  DCTEnforcer: "DCTEnforcer",
  IdentityRegistry: "ERC8004IdentityRegistry",
  NotaryAttestationVerifier: "NotaryAttestationVerifier",
};

/** Env overrides (non-empty wins over addresses file) — Base Sepolia deploy + CI */
const ENV_ADDR = {
  DCTRegistry: "DCT_REGISTRY_ADDRESS",
  DCTEnforcer: "DCT_ENFORCER_ADDRESS",
  IdentityRegistry: "ERC8004_IDENTITY_REGISTRY",
  NotaryAttestationVerifier: "NOTARY_ATTESTATION_VERIFIER_ADDRESS",
};

function resolveAddressesPath() {
  const envFile = process.env.ADDRESSES_FILE?.trim();
  if (!envFile) {
    return path.join(SERVER_ROOT, "addresses.json");
  }
  return path.isAbsolute(envFile)
    ? envFile
    : path.join(SERVER_ROOT, envFile);
}

export function loadAddresses() {
  const addressPath = resolveAddressesPath();
  if (!fs.existsSync(addressPath)) {
    throw new Error(
      `Addresses file missing: ${addressPath}. Deploy contracts and copy addresses, or set ADDRESSES_FILE.`
    );
  }
  return JSON.parse(fs.readFileSync(addressPath, "utf-8"));
}

function resolveContractAddress(contractName) {
  const j = loadABI(contractName);
  const addrs = loadAddresses();
  const key = ADDRESS_KEY[contractName] || contractName;
  const envKey = ENV_ADDR[contractName];
  const fromEnv = envKey ? process.env[envKey]?.trim() : "";
  const raw = fromEnv || j.address || addrs[key];
  if (!raw || raw === ethers.ZeroAddress) {
    const hint =
      "Deploy DCT to Base Sepolia (see contracts/README), set env overrides, " +
      "or use ADDRESSES_FILE=addresses.local-anvil.json with local Anvil.";
    throw new Error(
      `No address for ${contractName} — set ${key} in addresses.json, or ${envKey || "N/A"} in .env. ${hint}`
    );
  }
  return ethers.getAddress(raw);
}

/** Signer for txs; without PRIVATE_KEY use read-only provider (view calls only). */
function getContractRunner() {
  const pk = process.env.PRIVATE_KEY?.trim();
  if (pk) return getSigner();
  return getProvider();
}

function getContract(contractName) {
  if (!contracts[contractName]) {
    const j = loadABI(contractName);
    const abi = j.abi ?? j;
    const address = resolveContractAddress(contractName);
    contracts[contractName] = new ethers.Contract(address, abi, getContractRunner());
  }
  return contracts[contractName];
}

export function getRegistry() {
  return getContract("DCTRegistry");
}

export function getEnforcer() {
  return getContract("DCTEnforcer");
}

/** ERC-8004 Identity Registry (official or local test — ABI matches deployment) */
export function getERC8004() {
  return getContract("IdentityRegistry");
}

export function wireDCTSdk() {
  const pk = process.env.PRIVATE_KEY?.trim();
  setDCTContext({
    registry: getRegistry(),
    enforcer: getEnforcer(),
    erc8004: getERC8004(),
    signer: pk ? getSigner() : null,
  });
}

export { ethers };
