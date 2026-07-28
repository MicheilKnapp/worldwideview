"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { isDemo } from "@/core/edition";
import { authClient } from "@/lib/auth-client";
import { migrateLegacyUserIfNeeded } from "@/lib/auth/migrate-legacy-user";
import styles from "../setup/setup.module.css";

/** Allow relative paths or same-origin URLs only (local edition is self-contained). */
function getSafeRedirect(url: string | null): string {
    if (!url) return "/";
    if (url.startsWith("/") && url[1] !== "/" && url[1] !== "\\") return url;
    try {
        const parsed = new URL(url);
        if (parsed.origin === window.location.origin) return url;
    } catch { /* invalid URL — fall through */ }
    return "/";
}

export default function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const next = searchParams.get("next");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [guestLoading, setGuestLoading] = useState(false);
    // Guards against the browser's native form POST firing (submitting
    // credentials to /login as a plain page request, silently discarded)
    // if the user taps submit before React has hydrated and attached
    // handleSubmit — a real race on slower mobile devices/networks.
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => setHydrated(true), []);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError("");
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const email = formData.get("email") as string;
        const password = formData.get("password") as string;

        const { error: signInError } = await authClient.signIn.email({
            email,
            password,
            callbackURL: getSafeRedirect(next),
        });

        if (signInError) {
            console.warn('[login] sign-in failed', { code: signInError.code, message: signInError.message });

            // Try migrating legacy NextAuth user to Better Auth
            const migrated = await migrateLegacyUserIfNeeded(email, password);
            if (migrated) {
                // Retry sign-in — the BetterAuthUser + account now exist
                const { error: retryError } = await authClient.signIn.email({
                    email,
                    password,
                    callbackURL: getSafeRedirect(next),
                });
                if (retryError) {
                    console.warn('[login] sign-in retry failed', { code: retryError.code, message: retryError.message });
                    setError("Sign in failed after migration. Try again.");
                }
                // On retry success, Better Auth redirects
            } else {
                setError("Sign in failed. Check your credentials and try again.");
            }
            setLoading(false);
        }
        // On success, Better Auth redirects to callbackURL
    }

    async function handleGuest() {
        setError("");
        setGuestLoading(true);
        const { error: guestError } = await authClient.signIn.anonymous();
        if (guestError) {
            console.warn('[login] guest sign-in failed', { code: guestError.code, message: guestError.message });
            setError("Couldn't start a guest session. Try again.");
            setGuestLoading(false);
            return;
        }
        router.push(getSafeRedirect(next));
    }

    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.logo}>W</div>
          <h1 className={styles.title}>Sign in to WorldWideView</h1>
          <p style={{ margin: "-0.5rem 0 0.75rem", fontSize: "0.85rem", opacity: 0.7 }}>Knapp Electric Questioner Fork</p>
          <p className={styles.subtitle}>Enter your credentials to continue</p>

          <form onSubmit={handleSubmit} method="post" className={styles.form}>
            <label className={styles.label} htmlFor="email">
              Email
              <input
                id="email"
                name="email"
                type="email"
                required
                className={styles.input}
                placeholder={isDemo ? "user@worldwideview.local" : "user@example.com"}
              />
            </label>

            <label className={styles.label} htmlFor="password">
              Password
              <input
                id="password"
                name="password"
                type="password"
                required
                className={styles.input}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" disabled={loading || !hydrated} className={styles.button}>
              {loading ? "Signing in..." : hydrated ? "Sign In" : "Loading..."}
            </button>
          </form>

          <p style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            Don&apos;t have an account? <Link href="/signup">Sign up</Link>
          </p>

          <button
            type="button"
            onClick={handleGuest}
            disabled={guestLoading || !hydrated}
            className={styles.button}
            style={{ marginTop: "0.75rem", background: "transparent", border: "1px solid currentColor" }}
          >
            {guestLoading ? "Starting guest session..." : "Continue as Guest"}
          </button>
        </div>
      </div>
    );
}
