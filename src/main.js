const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const ytMusic = require('./ytMusicService');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const WIDTH = 280;
const HEIGHT = 480;
const MINI_HEIGHT = 104;

let mainWindow;
let tray;
let isQuitting = false;

function getStateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(getStateFilePath(), 'utf-8'));
  } catch (_) {
    return {};
  }
}

function saveState(partial) {
  try {
    const state = { ...loadState(), ...partial };
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(getStateFilePath(), JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

function createWindow() {
  const state = loadState();

  mainWindow = new BrowserWindow({
    width: WIDTH,
    height: state.isMini ? MINI_HEIGHT : HEIGHT,
    x: state.x,
    y: state.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    movable: true,
    alwaysOnTop: Boolean(state.alwaysOnTop),
    skipTaskbar: true,
    hasShadow: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('move', () => saveState(mainWindow.getBounds()));

  // Close hides to tray instead of quitting, so playback keeps running in the background.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('YouTube Music');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '보이기/숨기기',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
        }
      },
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
}

let loginPromise = null;

/** Extracts the cookie header youtubei.js needs from a real, logged-in music.youtube.com session. */
async function checkLoginCookies(ses) {
  const cookies = await ses.cookies.get({ url: 'https://music.youtube.com' });
  const hasAuth = cookies.some((c) => c.name === 'SAPISID' && c.value);
  if (!hasAuth) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/** Opens a real YouTube Music login window and resolves once a logged-in cookie jar is captured. */
function openLoginWindow() {
  if (loginPromise) return loginPromise;

  loginPromise = new Promise((resolve, reject) => {
    let resolved = false;

    const win = new BrowserWindow({
      width: 480,
      height: 760,
      title: 'YouTube Music 로그인',
      webPreferences: {
        partition: 'persist:ytmusic-login',
      },
    });

    win.loadURL('https://music.youtube.com');

    const tryDetectLogin = async () => {
      if (resolved) return;
      try {
        const cookieHeader = await checkLoginCookies(win.webContents.session);
        if (cookieHeader) {
          resolved = true;
          ytMusic.setCookie(cookieHeader);
          win.close();
          resolve();
        }
      } catch (_) {
        // transient errors while the page is still navigating; next event will retry
      }
    };

    win.webContents.on('did-navigate', tryDetectLogin);
    win.webContents.on('did-navigate-in-page', tryDetectLogin);
    win.webContents.on('did-finish-load', tryDetectLogin);

    win.on('closed', () => {
      if (!resolved) reject(new Error('LOGIN_CANCELLED'));
    });
  }).finally(() => {
    loginPromise = null;
  });

  return loginPromise;
}

function registerIpcHandlers() {
  ipcMain.handle('auth:start', async () => {
    if (!ytMusic.hasCookie()) {
      mainWindow.webContents.send('auth:pending');
      await openLoginWindow();
    }
    return { ok: true };
  });

  ipcMain.handle('library:get', () => ytMusic.getLibrary());
  ipcMain.handle('playlist:get', (_event, playlistId) => ytMusic.getPlaylist(playlistId));
  ipcMain.handle('track:stream', (_event, videoId) => ytMusic.getStreamUrl(videoId));

  ipcMain.on('window:hide', () => mainWindow.hide());

  ipcMain.handle('window:togglePin', (_event, pinned) => {
    mainWindow.setAlwaysOnTop(pinned);
    saveState({ alwaysOnTop: pinned });
    return pinned;
  });

  ipcMain.handle('window:getPinState', () => Boolean(loadState().alwaysOnTop));

  ipcMain.handle('window:toggleMini', (_event, isMini) => {
    mainWindow.setSize(WIDTH, isMini ? MINI_HEIGHT : HEIGHT);
    saveState({ isMini });
    return isMini;
  });

  ipcMain.handle('window:getMiniState', () => Boolean(loadState().isMini));
}

function registerAutoLaunch() {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
  } else {
    // Running via `electron .` in dev — point the startup entry at this project folder.
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: [path.resolve(__dirname, '..')],
    });
  }
}

app.whenReady().then(() => {
  registerAutoLaunch();
  registerIpcHandlers();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Tray keeps the app alive; do nothing here.
});

app.on('before-quit', () => {
  isQuitting = true;
});
