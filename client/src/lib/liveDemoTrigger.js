/**
 * Handoff from Layer console → Live demo: one-click runs full E2E on /live-demo.
 */

const KEY = "dct-live-auto-e2e";

export function setPendingLiveDemoE2E() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* private mode */
  }
}

/** @returns {boolean} whether a pending run was consumed */
export function consumePendingLiveDemoE2E() {
  try {
    if (sessionStorage.getItem(KEY) !== "1") return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
