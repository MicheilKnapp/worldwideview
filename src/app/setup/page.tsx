"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createAdminAccount } from "./actions";
import { ensureAdminSeeded } from "@/lib/ensureAdminSeeded";
import styles from "./setup.module.css";

export default function SetupPage() {
    const router = useRouter();
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [autoSeed, setAutoSeed] = useState<{
        loading: boolean;
        email?: string;
        error?: string;
    }>({ loading: true });

    useEffect(() => {
        ensureAdminSeeded()
            .then((result) => {
                if (result.seeded) {
                    setAutoSeed({ loading: false, email: result.email });
                } else if (result.error) {
                    setAutoSeed({ loading: false, error: result.error });
                } else {
                    // skipped -- no auto-seed, show manual form
                    setAutoSeed({ loading: false });
                }
            })
            .catch((err: unknown) => {
                const message =
                    err instanceof Error ? err.message : "Auto-seed check failed";
                setAutoSeed({ loading: false, error: message });
            });
    }, []);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError("");
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const result = await createAdminAccount(formData);

        if (result.success) {
            router.push("/login");
        } else {
            setError(result.error ?? "Setup failed.");
            setLoading(false);
        }
    }

    if (autoSeed.loading) {
        return (
          <div className={styles.container}>
            <div className={styles.card}>
              <div className={styles.logo}>W</div>
              <h1 className={styles.title}>Welcome to WorldWideView</h1>
              <p className={styles.subtitle}>Checking setup state...</p>
            </div>
          </div>
        );
    }

    if (autoSeed.email) {
        return (
          <div className={styles.container}>
            <div className={styles.card}>
              <div className={styles.logo}>W</div>
              <h1 className={styles.title}>Admin Account Ready</h1>
              <p className={styles.subtitle}>
                An admin account was auto-seeded successfully.
              </p>
              <p style={{ color: "var(--text-secondary, #888)", fontSize: "0.85rem", margin: "0 0 1.5rem" }}>
                Sign in with <strong>{autoSeed.email}</strong> and the configured
                admin password.
              </p>
              <Link href="/login" className={styles.button} style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
                Go to Login
              </Link>
            </div>
          </div>
        );
    }

    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.logo}>W</div>
          <h1 className={styles.title}>Welcome to WorldWideView</h1>
          <p className={styles.subtitle}>Create your admin account to get started</p>

          {autoSeed.error && <p className={styles.error}>{autoSeed.error}</p>}

          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.label} htmlFor="name">
              Display Name
              <input
                id="name"
                name="name"
                type="text"
                required
                className={styles.input}
                placeholder="Admin"
              />
            </label>

            <label className={styles.label} htmlFor="email">
              Email
              <input
                id="email"
                name="email"
                type="email"
                required
                className={styles.input}
                placeholder="admin@example.com"
              />
            </label>

            <label className={styles.label} htmlFor="password">
              Password
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                className={styles.input}
                placeholder="Min. 8 characters"
              />
            </label>

            <label className={styles.label} htmlFor="confirm">
              Confirm Password
              <input
                id="confirm"
                name="confirm"
                type="password"
                required
                minLength={8}
                className={styles.input}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" disabled={loading} className={styles.button}>
              {loading ? "Creating..." : "Create Admin Account"}
            </button>
          </form>
        </div>
      </div>
    );
}
