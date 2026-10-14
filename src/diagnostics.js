const { app, powerMonitor, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const MAX_LOG_BYTES = 256 * 1024;
const HEARTBEAT_MS = 5 * 60 * 1000;

let win = null;

function getLogPath() {
  return path.join(app.getPath('userData'), 'diagnostics.log');
}

function log(event, detail) {
  try {
    const file = getLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });

    // Keep the newest half once it grows past the cap, so this never needs cleaning up.
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) {
        const buf = fs.readFileSync(file);
        fs.writeFileSync(file, buf.subarray(Math.floor(buf.length / 2)));
      }
    } catch (_) {
      // no file yet
    }

    fs.appendFileSync(file, `${new Date().toISOString()} ${event}${detail ? ` ${detail}` : ''}\n`);
  } catch (_) {
    // diagnostics must never be the thing that breaks the app
  }
}

function heartbeat() {
  try {
    const metrics = app
      .getAppMetrics()
      .map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}MB/${m.cpu.percentCPUUsage.toFixed(1)}%`)
      .join(' ');
    const visible = Boolean(win && !win.isDestroyed() && win.isVisible());
    log('heartbeat', `visible=${visible} ${metrics}`);
  } catch (err) {
    log('heartbeat-failed', String(err && err.message));
  }
}

/** Call once after app 'ready'. Records the events that tend to precede a "frozen widget": GPU/renderer crashes, sleep/lock, display changes. */
function init() {
  log('app-start', `version=${app.getVersion()} pid=${process.pid} argv=${JSON.stringify(process.argv.slice(1))}`);

  app.on('child-process-gone', (_e, d) => log('child-process-gone', `${d.type} reason=${d.reason} exit=${d.exitCode}`));
  app.on('before-quit', () => log('before-quit'));

  for (const evt of ['suspend', 'resume', 'lock-screen', 'unlock-screen']) {
    powerMonitor.on(evt, () => log(`power-${evt}`));
  }
  for (const evt of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(evt, () => log(evt));
  }

  setTimeout(heartbeat, 20 * 1000).unref(); // baseline right after startup
  setInterval(heartbeat, HEARTBEAT_MS).unref();
}

function attachWindow(browserWindow) {
  win = browserWindow;

  for (const evt of ['unresponsive', 'responsive', 'show', 'hide', 'minimize', 'restore']) {
    win.on(evt, () => log(`window-${evt}`));
  }

  win.webContents.on('render-process-gone', (_e, d) => log('render-process-gone', `reason=${d.reason} exit=${d.exitCode}`));
  win.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load', `${code} ${desc}`));
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level < 2 || String(message).includes('Electron Security Warning')) return;
    const oneLine = String(message).replace(/\s+/g, ' ').slice(0, 300);
    log(level >= 3 ? 'renderer-error' : 'renderer-warn', `${oneLine} (${path.basename(sourceId || '')}:${line})`);
  });
}

module.exports = { init, attachWindow, log };
