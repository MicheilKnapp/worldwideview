"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
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

export default function SignupForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const next = searchParams.get("next");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => setHydrated(true), []);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError("");

        const formData = new FormData(e.currentTarget);
        const name = formData.get("name") as string;
        const email = formData.get("email") as string;
        const password = formData.get("password") as string;
        const confirm = formData.get("confirm") as string;

        if (password !== confirm) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);
        const { error: signUpError } = await authClient.signUp.email({
            name,
            email,
            password,
            callbackURL: getSafeRedirect(next),
        });

        if (signUpError) {
            setError(signUpError.message ?? "Sign up failed. Try again.");
            setLoading(false);
            return;
        }
        // On success, Better Auth redirects to callbackURL. Fall back to a
        // manual push in case the client doesn't navigate on its own.
        router.push(getSafeRedirect(next));
    }

    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.logo}>W</div>
          <h1 className={styles.title}>Create your account</h1>
          <p className={styles.subtitle}>Sign up to start using WorldWideView</p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="name">
              Display Name
              <input id="name" name="name" type="text" required className={styles.input} placeholder="Your name" />
            </label>

            <label className={styles.label} htmlFor="email">
              Email
              <input id="email" name="email" type="email" required className={styles.input} placeholder="you@example.com" />
            </label>

            <label className={styles.label} htmlFor="password">
              Password
              <input id="password" name="password" type="password" required minLength={8} className={styles.input} placeholder="Min. 8 characters" />
            </label>

            <label className={styles.label} htmlFor="confirm">
              Confirm Password
              <input id="confirm" name="confirm" type="password" required minLength={8} className={styles.input} />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" disabled={loading || !hydrated} className={styles.button}>
              {loading ? "Creating account..." : hydrated ? "Sign Up" : "Loading..."}
            </button>
          </form>

          <p style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </div>
    );
}
