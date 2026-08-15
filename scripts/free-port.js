const { execSync } = require('child_process');

const port = Number(process.env.PORT || 3000);

function killWithKillPort() {
  try {
    execSync(`npx kill-port ${port}`, { stdio: 'pipe', shell: true });
    return true;
  } catch {
    return false;
  }
}

function killWindowsListeners() {
  try {
    const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set();

    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe', shell: true });
        console.log(`[free-port] Stopped process ${pid} on port ${port}`);
      } catch {
        // Process may already be gone.
      }
    }

    return pids.size > 0;
  } catch {
    return false;
  }
}

if (process.platform === 'win32') {
  killWindowsListeners();
} else {
  killWithKillPort();
}

// Fallback if something is still listening.
killWithKillPort();
