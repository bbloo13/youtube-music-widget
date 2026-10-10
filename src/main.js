const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// Electron derives app.getPath('userData') from the app name, which it normally reads
// from package.json — but only reliably when launched with the project folder as the
// working directory. Windows' "run at login" entry launches it with the project path
// as an *argument* instead (no matching cwd), which made Electron fall back to the
// generic "Electron" name and silently start from a different, empty userData folder
// each time — losing the saved login cookie, favorites, and window state. Setting the
// name explicitly makes userData consistent no matter how the process was started.
app.setName('youtube-music-widget');

const ytMusic = require('./ytMusicService');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const WIDTH = 280;
const HEIGHT = 480;
const MINI_HEIGHT = 104;

let mainWindow;
let tray;
let isQuitting = false;

// Launching a second instance (e.g. the Start Menu shortcut while the app is
// already running) used to leave both copies fighting over the same profile
// directory and neither one ever painting a window. Bail out of the second
// launch instead, and just surface the window the first instance already has.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

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

function getFavoritesFilePath() {
  return path.join(app.getPath('userData'), 'favorites.json');
}

function loadFavorites() {
  try {
    const data = JSON.parse(fs.readFileSync(getFavoritesFilePath(), 'utf-8'));
    return { playlists: data.playlists || [], channels: data.channels || [] };
  } catch (_) {
    return { playlists: [], channels: [] };
  }
}

function saveFavorites(favorites) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getFavoritesFilePath(), JSON.stringify(favorites));
}

/**
 * A saved position can point at a monitor that's no longer attached (e.g. an
 * unplugged second display), which leaves the widget running but invisible.
 * Keep the saved x/y only if a usable chunk of the window still overlaps a
 * currently attached display; otherwise drop them so Electron places the
 * window on the primary display.
 */
function positionIfOnScreen(state, height) {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return {};
  const MIN_VISIBLE = 120;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapW = Math.min(state.x + WIDTH, a.x + a.width) - Math.max(state.x, a.x);
    const overlapH = Math.min(state.y + height, a.y + a.height) - Math.max(state.y, a.y);
    return overlapW >= MIN_VISIBLE && overlapH >= MIN_VISIBLE;
  });
  return onScreen ? { x: state.x, y: state.y } : {};
}

function createWindow() {
  const state = loadState();
  const height = state.isMini ? MINI_HEIGHT : HEIGHT;

  mainWindow = new BrowserWindow({
    width: WIDTH,
    height,
    ...positionIfOnScreen(state, height),
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

  ipcMain.handle('subscriptions:get', () => ytMusic.getSubscriptions());
  ipcMain.handle('channel:videos', (_event, channelId) => ytMusic.getChannelVideos(channelId));
  ipcMain.handle('channel:videos:more', () => ytMusic.getMoreChannelVideos());
  ipcMain.handle('video:stream', (_event, videoId) => ytMusic.getVideoStreamUrl(videoId));

  ipcMain.handle('favorites:get', () => loadFavorites());
  ipcMain.handle('favorites:set', (_event, favorites) => {
    saveFavorites(favorites);
    return favorites;
  });

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

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    registerAutoLaunch();
    registerIpcHandlers();
    createWindow();
    createTray();
  });
}

app.on('window-all-closed', () => {
  // Tray keeps the app alive; do nothing here.
});

app.on('before-quit', () => {
  isQuitting = true;
});
