/**
 * Injected by the host (Node server, tests, or CLI) after loading deployment addresses.
 */
let _registry;
let _enforcer;
let _erc8004;
let _signer;

export function setDCTContext(ctx) {
  _registry = ctx.registry;
  _enforcer = ctx.enforcer;
  _erc8004 = ctx.erc8004;
  _signer = ctx.signer;
}

export function getRegistry() {
  return _registry;
}

export function getEnforcer() {
  return _enforcer;
}

export function getERC8004() {
  return _erc8004;
}

export function getSigner() {
  return _signer;
}
