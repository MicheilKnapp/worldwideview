import { execSync, spawn } from "child_process";
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// Make sure Docker's CLI and pnpm's global bin are on PATH even in a fresh
// shell where the permanent User PATH change hasn't been picked up yet.
const EXTRA_PATHS = [
    "C:\\Users\\Micheil Knapp\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin",
    "C:\\Users\\Micheil Knapp\\AppData\\Roaming\\npm",
];
process.env.PATH = [...EXTRA_PATHS, process.env.PATH].join(";");

const DOCKER_DESKTOP_EXE =
    "C:\\Users\\Micheil Knapp\\AppData\\Local\\Programs\\DockerDesktop\\Docker Desktop.exe";
const CLOUDFLARED_EXE =
    "C:\\Users\\Micheil Knapp\\AppData\\Local\\Programs\\cloudflared\\cloudflared.exe";
const TUNNEL_LOG = path.join(tmpdir(), "wwv-cloudflared.log");
const DEV_PORT = 3001; // must match the -p flag in scripts/dev.mjs

const ENV_LOCAL_PATH = path.join(process.cwd(), ".env.local");

// Rewrites ALLOWED_DEV_ORIGIN in .env.local to include the fresh tunnel
// hostname, keeping the existing LAN/Tailscale entries but dropping any
// previous tunnel hostname (it changes every run so it would just pile up).
// scripts/dev.mjs loads .env.local into process.env itself and would
// clobber anything set only via the spawned child's environment, so the
// file on disk has to be the source of truth here.
function updateAllowedDevOrigin(tunnelHostname) {
    if (!existsSync(ENV_LOCAL_PATH)) return;
    const contents = readFileSync(ENV_LOCAL_PATH, "utf8");
    const match = contents.match(/^ALLOWED_DEV_ORIGIN=(.*)$/m);
    const base = match
        ? match[1]
              .split(",")
              .map((o) => o.trim())
              .filter((o) => o && !o.endsWith(".trycloudflare.com"))
        : [];
    const merged = [...new Set([...base, tunnelHostname])].join(",");
    const newLine = `ALLOWED_DEV_ORIGIN=${merged}`;
    const updated = match
        ? contents.replace(/^ALLOWED_DEV_ORIGIN=.*$/m, newLine)
        : `${contents}\n${newLine}\n`;
    writeFileSync(ENV_LOCAL_PATH, updated);
}

// Starts a Cloudflare quick tunnel and returns its hostname (e.g.
// "foo-bar.trycloudflare.com"), or null if cloudflared isn't installed or
// the URL couldn't be captured in time. Never fatal -- LAN/Tailscale access
// still works without it.
async function startTunnel() {
    if (!existsSync(CLOUDFLARED_EXE)) {
        console.log("cloudflared not found -- skipping public tunnel.");
        return null;
    }

    try {
        execSync('Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue', {
            shell: "powershell.exe",
            stdio: "ignore",
        });
    } catch {
        // nothing was running
    }
    try {
        rmSync(TUNNEL_LOG, { force: true });
    } catch {
        // no previous log
    }

    console.log("Starting Cloudflare quick tunnel...");
    const logFd = openSync(TUNNEL_LOG, "w");
    spawn(CLOUDFLARED_EXE, ["tunnel", "--url", `http://localhost:${DEV_PORT}`], {
        detached: true,
        stdio: ["ignore", "ignore", logFd],
    }).unref();

    const start = Date.now();
    while (Date.now() - start < 30_000) {
        if (existsSync(TUNNEL_LOG)) {
            const match = readFileSync(TUNNEL_LOG, "utf8").match(
                /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/,
            );
            if (match) return match[1];
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    console.log("Timed out waiting for the Cloudflare tunnel URL -- continuing without it.");
    return null;
}

function dockerIsUp() {
    try {
        execSync("docker ps", { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

async function waitForDocker(timeoutMs = 180_000) {
    const start = Date.now();
    process.stdout.write("Waiting for Docker Desktop to start");
    while (!dockerIsUp()) {
        if (Date.now() - start > timeoutMs) {
            console.error(
                "\nDocker Desktop did not become ready in time. Is it installed at:\n  " +
                    DOCKER_DESKTOP_EXE,
            );
            process.exit(1);
        }
        process.stdout.write(".");
        await new Promise((r) => setTimeout(r, 3000));
    }
    console.log("\nDocker daemon is ready.");
}

async function main() {
    if (dockerIsUp()) {
        console.log("Docker Desktop is already running.");
    } else {
        if (!existsSync(DOCKER_DESKTOP_EXE)) {
            console.error(`Docker Desktop executable not found at:\n  ${DOCKER_DESKTOP_EXE}`);
            process.exit(1);
        }
        console.log("Starting Docker Desktop...");
        spawn(DOCKER_DESKTOP_EXE, [], { detached: true, stdio: "ignore" }).unref();
        await waitForDocker();
    }

    const tunnelHostname = await startTunnel();
    if (tunnelHostname) {
        updateAllowedDevOrigin(tunnelHostname);
        console.log(`\nPublic URL: https://${tunnelHostname}\n`);
    }

    console.log("Starting the dev server (pnpm run dev)...\n");
    const dev = spawn("pnpm", ["run", "dev"], {
        stdio: "inherit",
        shell: true,
        env: process.env,
    });
    dev.on("exit", (code) => process.exit(code ?? 0));
}

main();
