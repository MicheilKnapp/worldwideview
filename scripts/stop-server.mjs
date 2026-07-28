import { execSync } from "child_process";

const PROJECT_DIR = "World Wide View";

function run(cmd) {
    try {
        return execSync(cmd, { shell: "powershell.exe", stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
    } catch {
        return "";
    }
}

function stopDevServer() {
    const psCmd = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*${PROJECT_DIR}*' } | Select-Object -ExpandProperty ProcessId`;
    const pids = run(psCmd).split(/\s+/).filter(Boolean);

    if (pids.length === 0) {
        console.log("No running dev server processes found.");
        return;
    }

    for (const pid of pids) {
        run(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
    }
    console.log(`Stopped ${pids.length} dev server process(es).`);
}

function stopTunnel() {
    const wasRunning = run('Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue');
    if (!wasRunning) {
        console.log("Cloudflare tunnel is not running.");
        return;
    }

    console.log("Stopping Cloudflare tunnel...");
    run('Stop-Process -Name "cloudflared" -Force -ErrorAction SilentlyContinue');
    console.log("Cloudflare tunnel stopped.");
}

function stopDocker() {
    const wasRunning = run('Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue');
    if (!wasRunning) {
        console.log("Docker Desktop is not running.");
        return;
    }

    console.log("Quitting Docker Desktop...");
    run('Stop-Process -Name "Docker Desktop" -Force -ErrorAction SilentlyContinue');
    run('Stop-Process -Name "com.docker.backend" -Force -ErrorAction SilentlyContinue');
    run("wsl --shutdown");
    console.log("Docker Desktop and its backend have been shut down.");
}

console.log("Shutting down WorldWideView dev server...");
stopDevServer();
stopTunnel();
stopDocker();
console.log("Done.");
