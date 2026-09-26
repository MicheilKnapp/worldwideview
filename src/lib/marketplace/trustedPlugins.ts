const STORAGE_KEY = "wwv_approved_unverified_plugins";

/** Get the set of plugin IDs the user has approved despite being unverified. */
export function getApprovedUnverifiedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set<string>(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

/** Mark a plugin as user-approved (won't show the warning again). */
export function approveUnverifiedPlugin(pluginId: string): void {
  const approved = getApprovedUnverifiedIds();
  approved.add(pluginId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...approved]));
}

/**
 * True when a plugin's bundle is served from this deployment's own origin.
 *
 * The unverified-plugin gate exists to stop third-party code — typically a CDN
 * bundle — running with access to the visitor's session. That risk does not
 * apply to a bundle the operator committed to their own deployment: it is
 * already as trusted as the application serving it, and no one else can put a
 * file there. Such plugins therefore skip the approval dialog, while genuinely
 * third-party entries (unpkg, jsDelivr) stay gated.
 *
 * Resolved through `new URL(...)` rather than a prefix test on purpose. A
 * protocol-relative entry like "//evil.example/x.mjs" begins with "/" but
 * resolves to a different origin, so `entry.startsWith("/")` would wave through
 * exactly the case the gate is meant to catch.
 *
 * @param entry The manifest's entry, relative or absolute.
 * @param origin The current origin, e.g. window.location.origin.
 */
export function isSameOriginEntry(
    entry: string | undefined | null,
    origin: string | undefined | null,
): boolean {
    if (!entry || !origin) return false;
    try {
        return new URL(entry, origin).origin === new URL(origin).origin;
    } catch {
        // Unparseable entry or origin: treat as untrusted.
        return false;
    }
}

/**
 * Sentinel origin used to decide whether an entry is origin-relative.
 *
 * Only a genuinely relative path ("/plugins/x.mjs", "./x.mjs") resolves back to
 * whatever base it is given. An absolute or protocol-relative entry resolves to
 * its own host, so it will never match this.
 */
const RELATIVE_BASE = "https://self-hosted.invalid";

/**
 * True when a plugin's bundle is served by the instance itself.
 *
 * The server-side counterpart to isSameOriginEntry, for code that has no
 * browser origin to compare against. An origin-relative entry is resolved by
 * the browser against the app's own origin by definition, so relative means
 * self-hosted, and self-hosted means the operator put the file there.
 */
export function isSelfHostedEntry(entry: string | undefined | null): boolean {
    return isSameOriginEntry(entry, RELATIVE_BASE);
}
