/**
 * @file cleanup-guest-accounts.mjs
 * @description Deletes guest ("Continue as Guest") accounts whose sessions
 * have all expired. Guest accounts (isAnonymous: true) are never converted
 * to real accounts unless the user signs up while the guest session is
 * active, so once every session on one has expired it's abandoned and safe
 * to remove. Related rows (favorites, API keys, workspace memberships,
 * sessions) cascade-delete with the user via onDelete: Cascade.
 *
 * Intended to run on a schedule (e.g. Coolify scheduled task) inside the
 * app container, where DATABASE_URL is already set.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../src/generated/prisma/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error("[cleanup-guest-accounts] DATABASE_URL is not set.");
    process.exit(1);
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
    const staleGuests = await prisma.betterAuthUser.findMany({
        where: {
            isAnonymous: true,
            sessions: { every: { expiresAt: { lt: new Date() } } },
        },
        select: { id: true },
    });

    if (staleGuests.length === 0) {
        console.log("[cleanup-guest-accounts] No stale guest accounts to remove.");
        return;
    }

    const { count } = await prisma.betterAuthUser.deleteMany({
        where: { id: { in: staleGuests.map((u) => u.id) } },
    });
    console.log(`[cleanup-guest-accounts] Removed ${count} stale guest account(s).`);
}

main()
    .catch((err) => {
        console.error("[cleanup-guest-accounts] Failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
