const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startAuth: () => ipcRenderer.invoke('auth:start'),
  onAuthPending: (callback) => {
    ipcRenderer.on('auth:pending', () => callback());
  },

  getLibrary: () => ipcRenderer.invoke('library:get'),
  getPlaylist: (playlistId) => ipcRenderer.invoke('playlist:get', playlistId),
  getStreamUrl: (videoId) => ipcRenderer.invoke('track:stream', videoId),

  hideWindow: () => ipcRenderer.send('window:hide'),
  togglePin: (pinned) => ipcRenderer.invoke('window:togglePin', pinned),
  getPinState: () => ipcRenderer.invoke('window:getPinState'),
  toggleMini: (isMini) => ipcRenderer.invoke('window:toggleMini', isMini),
  getMiniState: () => ipcRenderer.invoke('window:getMiniState'),
});
