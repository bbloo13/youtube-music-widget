const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let innertube = null;
let youtubeiModule = null;
let cookie = null;

function getCookieFilePath() {
  return path.join(app.getPath('userData'), 'ytmusic-cookie.json');
}

function loadCookieFromDisk() {
  try {
    const data = JSON.parse(fs.readFileSync(getCookieFilePath(), 'utf-8'));
    return data.cookie || null;
  } catch (_) {
    return null;
  }
}

function saveCookieToDisk(cookieString) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getCookieFilePath(), JSON.stringify({ cookie: cookieString }));
}

/** Called once a login window has captured a fresh cookie jar; forces the next call to rebuild the session with it. */
function setCookie(cookieString) {
  cookie = cookieString;
  saveCookieToDisk(cookieString);
  innertube = null;
}

function hasCookie() {
  if (cookie) return true;
  cookie = loadCookieFromDisk();
  return Boolean(cookie);
}

async function loadYoutubei() {
  if (!youtubeiModule) {
    youtubeiModule = await import('youtubei.js');
    // Node has no bundled JS sandbox for youtubei.js to decipher stream URLs with,
    // so we provide one ourselves (this is the pattern the library's own docs recommend for Node).
    youtubeiModule.Platform.shim.eval = async (data) => new Function(data.output)();
  }
  return youtubeiModule;
}

async function getInnertube() {
  if (innertube) return innertube;
  if (!hasCookie()) {
    throw new Error('NEEDS_LOGIN');
  }

  const { Innertube } = await loadYoutubei();
  innertube = await Innertube.create({ cookie, generate_session_locally: true });
  return innertube;
}

function textOf(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : value.toString();
}

function firstThumbnailUrl(thumbnails) {
  if (!thumbnails || !thumbnails.length) return null;
  return thumbnails[thumbnails.length - 1].url || null;
}

/** Library tiles mix playlists in with artists, albums, profiles, and auto playlists (Liked Music etc.); we only want user playlists. */
function isPlaylistItem(node) {
  const subtitleText = textOf(node.subtitle);
  if (/auto playlist|자동 재생목록/i.test(subtitleText)) return false;
  if (node.item_type === 'playlist') return true;
  return /playlist|재생목록/i.test(subtitleText);
}

async function getLibrary() {
  const client = await getInnertube();
  const library = await client.music.getLibrary();
  const items = [];

  for (const section of library.contents || []) {
    for (const node of section.contents || []) {
      if (!node || !node.id || !isPlaylistItem(node)) continue;
      items.push({
        id: node.id,
        title: textOf(node.title),
        subtitle: textOf(node.subtitle) || textOf(node.item_count),
        thumbnail: firstThumbnailUrl(node.thumbnail),
        type: node.item_type || 'playlist',
      });
    }
  }

  return items;
}

async function getPlaylist(playlistId) {
  const client = await getInnertube();
  const playlist = await client.music.getPlaylist(playlistId);

  const tracks = (playlist.contents || [])
    .filter((item) => item && item.id && item.title)
    .map((item) => ({
      id: item.id,
      title: textOf(item.title),
      artist: (item.artists || []).map((a) => a.name).join(', '),
      duration: item.duration ? item.duration.text : '',
      thumbnail: firstThumbnailUrl(item.thumbnails),
    }));

  return {
    title: playlist.header ? textOf(playlist.header.title) : '',
    tracks,
  };
}

async function getStreamUrl(videoId) {
  const client = await getInnertube();
  const info = await client.music.getInfo(videoId);
  const format = info.chooseFormat({ type: 'audio', quality: 'best' });
  const url = await format.decipher(client.session.player);

  return {
    url,
    title: textOf(info.basic_info.title),
    artist: textOf(info.basic_info.author),
  };
}

module.exports = {
  hasCookie,
  setCookie,
  getLibrary,
  getPlaylist,
  getStreamUrl,
};
