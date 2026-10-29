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
  const url = thumbnails[thumbnails.length - 1].url || null;
  return url && url.startsWith('//') ? `https:${url}` : url;
}

/** Channel/video "lockup" nodes store text as plain {text, runs} objects rather than youtubei.js's Text class. */
function plainText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.text === 'string') return value.text;
  return '';
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

// A playlist longer than one page (~100 items) continues on further pages; reading only
// the first one silently cut long lists short.
const MAX_PLAYLIST_PAGES = 30;

async function readMusicPlaylist(client, playlistId) {
  let page = await client.music.getPlaylist(playlistId);
  const title = page.header ? textOf(page.header.title) : '';
  let items = page.contents || [];
  for (let pages = 1; page.has_continuation && pages < MAX_PLAYLIST_PAGES; pages++) {
    page = await page.getContinuation();
    items = items.concat(page.contents || []);
  }
  return { title, items };
}

/**
 * The YouTube Music view of a playlist silently drops plain YouTube videos that have no
 * catalog (music) equivalent — a video saved to the list shows up on youtube.com but never
 * in YT Music, and so never here. The regular YouTube view of the same list has them all,
 * so it's read as well and used to fill the gaps. Best effort: any failure just means the
 * list is shown the way YT Music reports it.
 */
async function readWebPlaylist(client, playlistId) {
  try {
    // Library ids carry a browse prefix ("VLPL…"); the regular playlist id is without it.
    let page = await client.getPlaylist(playlistId.replace(/^VL/, ''));
    let items = page.items || [];
    for (let pages = 1; page.has_continuation && pages < MAX_PLAYLIST_PAGES; pages++) {
      page = await page.getContinuation();
      items = items.concat(page.items || []);
    }
    return items.filter((item) => item && item.id && item.set_video_id && item.title);
  } catch (err) {
    console.error('Web playlist read failed, using YT Music view only:', err.message);
    return [];
  }
}

/**
 * YT Music swaps a saved video for its official audio track (different video id, often a
 * different title), so the two views can't be paired by id or title. Each *entry* in a
 * playlist does carry one id that both views share (setVideoId), but youtubei.js doesn't
 * expose it on the parsed YT Music items — so it's read from the raw responses, pairing
 * each video id with its entry id. Returns a Map(videoId -> [setVideoId, …]).
 */
async function readMusicEntryIds(client, playlistId) {
  const entryIds = new Map();
  try {
    let response = await client.actions.execute('/browse', { browseId: playlistId, client: 'YTMUSIC' });
    for (let pages = 0; response && pages < MAX_PLAYLIST_PAGES; pages++) {
      let nextToken = null;
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        const data = node.musicResponsiveListItemRenderer && node.musicResponsiveListItemRenderer.playlistItemData;
        if (data && data.videoId && data.playlistSetVideoId) {
          if (!entryIds.has(data.videoId)) entryIds.set(data.videoId, []);
          entryIds.get(data.videoId).push(data.playlistSetVideoId);
        }
        const continuation = node.continuationItemRenderer;
        if (continuation && !nextToken) {
          const command = continuation.continuationEndpoint && continuation.continuationEndpoint.continuationCommand;
          if (command && command.token) nextToken = command.token;
        }
        for (const key of Object.keys(node)) walk(node[key]);
      };
      walk(response.data);
      if (!nextToken) break;
      response = await client.actions.execute('/browse', { continuation: nextToken, client: 'YTMUSIC' });
    }
  } catch (err) {
    console.error('Could not read playlist entry ids:', err.message);
    return new Map();
  }
  return entryIds;
}

/**
 * Keeps the YT Music list as the base (its order is what the user is used to) and slips in
 * the entries only the regular YouTube view has, right after whatever precedes them there.
 * An entry counts as "already there" when YT Music has one with the same entry id.
 */
function mergePlaylistTracks(musicTracks, entryIds, webItems) {
  if (!webItems.length || !entryIds.size) return musicTracks;

  const trackByEntry = new Map();
  const queues = new Map([...entryIds].map(([videoId, ids]) => [videoId, ids.slice()]));
  for (const track of musicTracks) {
    const queue = queues.get(track.id);
    if (queue && queue.length) trackByEntry.set(queue.shift(), track);
  }

  const merged = musicTracks.slice();
  let insertAt = 0; // just after the latest entry (YT Music's or an inserted one) seen so far
  for (const item of webItems) {
    const known = trackByEntry.get(item.set_video_id);
    if (known) {
      insertAt = merged.indexOf(known) + 1;
      continue;
    }
    merged.splice(insertAt++, 0, {
      id: item.id,
      title: textOf(item.title),
      artist: item.author ? textOf(item.author.name) : '',
      duration: item.duration ? textOf(item.duration.text) : '',
      thumbnail: firstThumbnailUrl(item.thumbnails),
    });
  }
  return merged;
}

async function getPlaylist(playlistId) {
  const client = await getInnertube();
  const [music, entryIds, webItems] = await Promise.all([
    readMusicPlaylist(client, playlistId),
    readMusicEntryIds(client, playlistId),
    readWebPlaylist(client, playlistId),
  ]);

  const musicTracks = music.items
    .filter((item) => item && item.id && item.title)
    .map((item) => ({
      id: item.id,
      title: textOf(item.title),
      artist: (item.artists || []).map((a) => a.name).join(', '),
      duration: item.duration ? item.duration.text : '',
      thumbnail: firstThumbnailUrl(item.thumbnails),
    }));

  return {
    title: music.title,
    tracks: mergePlaylistTracks(musicTracks, entryIds, webItems),
  };
}

async function getStreamUrl(videoId) {
  const client = await getInnertube();
  // getBasicInfo (vs. music.getInfo) skips an extra "up next" request we never use —
  // ~2-8x faster per click for identical streaming data.
  const info = await client.getBasicInfo(videoId, { client: 'YTMUSIC' });
  const format = info.chooseFormat({ type: 'audio', quality: 'best' });
  const url = await format.decipher(client.session.player);

  return {
    url,
    title: textOf(info.basic_info.title),
    artist: textOf(info.basic_info.author),
  };
}

async function getSubscriptions() {
  const client = await getInnertube();
  const feed = await client.getChannelsFeed();

  return (feed.channels || [])
    .filter((c) => c && c.id && c.author)
    .map((c) => ({
      id: c.id,
      title: plainText(c.author.name),
      subtitle: plainText(c.subscriber_count) || plainText(c.video_count),
      thumbnail: firstThumbnailUrl(c.author.thumbnails),
    }));
}

function mapVideoLockups(videos) {
  return (videos || [])
    .filter((item) => item && item.content_id)
    .map((item) => {
      const badges = (item.content_image?.overlays || []).flatMap((o) => o.badges || []);
      const durationBadge = badges.find((b) => /^\d+:\d+/.test(b.text || ''));
      const metadataRow = (item.metadata?.metadata?.metadata_rows || [])[0];
      const subtitle = (metadataRow?.metadata_parts || []).map((p) => plainText(p.text)).join(' · ');

      return {
        id: item.content_id,
        // Different lockup content types nest the title at different depths.
        title: plainText(item.metadata?.title) || plainText(item.metadata?.metadata?.title),
        subtitle,
        duration: durationBadge ? durationBadge.text : '',
        thumbnail: firstThumbnailUrl(item.content_image?.image),
      };
    });
}

// Holds the live (unserializable) feed object for whichever channel's video list was
// last opened, so "load more" can call its .getContinuation() where we left off.
let channelVideoFeed = null;

async function getChannelVideos(channelId) {
  const client = await getInnertube();
  const channel = await client.getChannel(channelId);
  const videosTab = await channel.getVideos();

  channelVideoFeed = videosTab;

  return {
    title: plainText(channel.metadata?.title) || plainText(channel.header?.title),
    videos: mapVideoLockups(videosTab.videos),
    hasMore: Boolean(videosTab.has_continuation),
  };
}

async function getMoreChannelVideos() {
  if (!channelVideoFeed || !channelVideoFeed.has_continuation) {
    return { videos: [], hasMore: false };
  }

  const nextPage = await channelVideoFeed.getContinuation();
  channelVideoFeed = nextPage;

  return {
    videos: mapVideoLockups(nextPage.videos),
    hasMore: Boolean(nextPage.has_continuation),
  };
}

// The default (WEB) client comes back without a playable URL for regular videos.
// YTMUSIC sidesteps that for most videos (same trick our own music playback already
// benefits from); MWEB is a second fallback for the videos YTMUSIC itself refuses.
const VIDEO_STREAM_CLIENTS = ['YTMUSIC', 'MWEB'];

// Remembering which client actually worked for a video lets a repeat play skip straight
// to it instead of re-failing YTMUSIC first every time. Long TTL by design — this is
// just "who worked last time", re-checked occasionally in case YouTube's behavior shifts.
const CLIENT_PREF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let clientPrefsCache = null;

function getClientPrefsPath() {
  return path.join(app.getPath('userData'), 'video-client-prefs.json');
}

function getClientPrefs() {
  if (!clientPrefsCache) {
    try {
      clientPrefsCache = JSON.parse(fs.readFileSync(getClientPrefsPath(), 'utf-8'));
    } catch (_) {
      clientPrefsCache = {};
    }
  }
  return clientPrefsCache;
}

function getPreferredClient(videoId) {
  const entry = getClientPrefs()[videoId];
  if (!entry || Date.now() - entry.timestamp > CLIENT_PREF_TTL_MS) return null;
  return entry.client;
}

/** Fire-and-forget persistence — never worth making the user wait on this. */
function rememberClient(videoId, clientType) {
  const prefs = getClientPrefs();
  prefs[videoId] = { client: clientType, timestamp: Date.now() };
  fs.promises
    .mkdir(app.getPath('userData'), { recursive: true })
    .then(() => fs.promises.writeFile(getClientPrefsPath(), JSON.stringify(prefs)))
    .catch(() => {});
}

async function getVideoStreamUrl(videoId) {
  const client = await getInnertube();
  const preferred = getPreferredClient(videoId);
  const clientOrder = preferred
    ? [preferred, ...VIDEO_STREAM_CLIENTS.filter((c) => c !== preferred)]
    : VIDEO_STREAM_CLIENTS;

  let lastError;

  for (const clientType of clientOrder) {
    try {
      // getBasicInfo skips the extra "up next" request getInfo() makes — same streaming
      // data, several times faster, and it fails fast too when a client type won't work.
      const info = await client.getBasicInfo(videoId, { client: clientType });
      const format = info.chooseFormat({ type: 'audio', quality: 'best' });
      const url = await format.decipher(client.session.player);

      rememberClient(videoId, clientType);

      return {
        url,
        title: textOf(info.basic_info.title),
        artist: textOf(info.basic_info.author),
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

module.exports = {
  hasCookie,
  setCookie,
  getLibrary,
  getPlaylist,
  getStreamUrl,
  getSubscriptions,
  getChannelVideos,
  getMoreChannelVideos,
  getVideoStreamUrl,
};
