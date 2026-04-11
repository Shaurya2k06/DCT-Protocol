/**
 * Blockchain layer — provider, signer, contracts, DCT SDK context.
 */

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setDCTContext } from "@dct/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let provider;
let signer;
const contracts = {};

export function getProvider() {
  if (!provider) {
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (!alchemyKey) {
      throw new Error("ALCHEMY_API_KEY is required for RPC");
    }
    provider = new ethers.JsonRpcProvider(
      `https://base-sepolia.g.alchemy.com/v2/${alchemyKey}`
    );
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
    throw new Error(`ABI not found: ${abiPath}. Run: npx hardhat run scripts/deploy-dct.js --network baseSepolia`);
  }
  return JSON.parse(fs.readFileSync(abiPath, "utf-8"));
}

export function loadAddresses() {
  const addressPath = path.join(__dirname, "..", "addresses.json");
  if (!fs.existsSync(addressPath)) {
    throw new Error("addresses.json missing — deploy contracts first.");
  }
  return JSON.parse(fs.readFileSync(addressPath, "utf-8"));
}

function getContract(contractName) {
  if (!contracts[contractName]) {
    const { abi, address } = loadABI(contractName);
    if (!address) {
      throw new Error(`No address in abi file for ${contractName}`);
    }
    contracts[contractName] = new ethers.Contract(address, abi, getSigner());
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
  setDCTContext({
    registry: getRegistry(),
    enforcer: getEnforcer(),
    erc8004: getERC8004(),
    signer: getSigner(),
  });
}

export { ethers };
