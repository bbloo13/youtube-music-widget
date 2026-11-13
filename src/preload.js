const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startAuth: () => ipcRenderer.invoke('auth:start'),
  onAuthPending: (callback) => {
    ipcRenderer.on('auth:pending', () => callback());
  },

  getLibrary: () => ipcRenderer.invoke('library:get'),
  getPlaylist: (playlistId) => ipcRenderer.invoke('playlist:get', playlistId),
  getStreamUrl: (videoId) => ipcRenderer.invoke('track:stream', videoId),

  getSubscriptions: () => ipcRenderer.invoke('subscriptions:get'),
  getChannelVideos: (channelId) => ipcRenderer.invoke('channel:videos', channelId),
  getMoreChannelVideos: () => ipcRenderer.invoke('channel:videos:more'),
  getVideoStreamUrl: (videoId) => ipcRenderer.invoke('video:stream', videoId),

  getFavorites: () => ipcRenderer.invoke('favorites:get'),
  setFavorites: (favorites) => ipcRenderer.invoke('favorites:set', favorites),

  hideWindow: () => ipcRenderer.send('window:hide'),
  togglePin: (pinned) => ipcRenderer.invoke('window:togglePin', pinned),
  getPinState: () => ipcRenderer.invoke('window:getPinState'),
  toggleMini: (isMini) => ipcRenderer.invoke('window:toggleMini', isMini),
  getMiniState: () => ipcRenderer.invoke('window:getMiniState'),
});
