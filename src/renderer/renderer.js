const widgetEl = document.querySelector('.widget');
const listEl = document.getElementById('list');
const navEl = document.getElementById('nav');
const navLabelEl = document.getElementById('navLabel');
const backBtn = document.getElementById('backBtn');
const viewToggleEl = document.getElementById('viewToggle');
const tabPlaylistsBtn = document.getElementById('tabPlaylistsBtn');
const tabChannelsBtn = document.getElementById('tabChannelsBtn');
const refreshBtn = document.getElementById('refreshBtn');
const editBtn = document.getElementById('editBtn');
const searchRowEl = document.getElementById('searchRow');
const searchInput = document.getElementById('searchInput');
const pinBtn = document.getElementById('pinBtn');
const minimizeBtn = document.getElementById('minimizeBtn');
const closeBtn = document.getElementById('closeBtn');
const toastEl = document.getElementById('toast');

const audio = document.getElementById('audio');
const playerThumb = document.getElementById('playerThumb');
const playerTitle = document.getElementById('playerTitle');
const playerArtist = document.getElementById('playerArtist');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const volumeSlider = document.getElementById('volumeSlider');

const PLAY_ICON = '<path d="M8 5v14l11-7z"></path>';
const PAUSE_ICON = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"></path>';
const CHECK_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

let playlistItems = null;
let channelItems = null;
let favorites = { playlists: [], channels: [] };
let libraryTab = 'playlists'; // 'playlists' | 'channels'
let isEditMode = false;
let searchQuery = '';
let editPinned = { playlists: new Set(), channels: new Set() };

let currentView = 'library'; // 'library' | 'playlist' | 'channel'
let currentDetailItem = null;
let currentQueue = [];
let currentQueueKind = 'track'; // 'track' | 'video'
let currentIndex = -1;
let hasMoreVideos = false;
let isLoadingMore = false;
let isShuffleRepeat = false;

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function showToast(message, isDanger) {
  toastEl.textContent = message;
  toastEl.classList.toggle('is-danger', Boolean(isDanger));
  toastEl.classList.add('is-visible');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toastEl.classList.remove('is-visible'), 2500);
}

function renderRows(items, options) {
  listEl.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'widget__empty';
    empty.textContent = options.emptyText;
    listEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'row';
    if (options.isPlaying && options.isPlaying(item)) {
      row.classList.add('is-playing');
    }

    const thumb = document.createElement('img');
    thumb.className = 'row__thumb';
    thumb.src = item.thumbnail || '';
    thumb.alt = '';
    row.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'row__body';

    const title = document.createElement('div');
    title.className = 'row__title';
    title.textContent = item.title;
    body.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'row__subtitle';
    subtitle.textContent = options.subtitle(item);
    body.appendChild(subtitle);

    row.appendChild(body);

    if (options.checkable) {
      const checked = options.isChecked(item);
      const checkbox = document.createElement('div');
      checkbox.className = 'row__checkbox';
      checkbox.classList.toggle('is-checked', checked);
      checkbox.innerHTML = checked ? CHECK_ICON : '';
      row.appendChild(checkbox);
    } else {
      if (options.duration) {
        const duration = document.createElement('div');
        duration.className = 'row__duration';
        duration.textContent = options.duration(item);
        row.appendChild(duration);
      }

      if (options.onPlayClick) {
        const playRowBtn = document.createElement('button');
        playRowBtn.className = 'row__playBtn';
        playRowBtn.title = '섞어서 반복 재생';
        playRowBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';
        playRowBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          options.onPlayClick(item);
        });
        row.appendChild(playRowBtn);
      }
    }

    row.addEventListener('click', () => options.onClick(item));
    listEl.appendChild(row);
  }
}

async function ensurePlaylists(forceRefresh) {
  if (!forceRefresh && playlistItems) return playlistItems;
  playlistItems = await window.api.getLibrary();
  return playlistItems;
}

async function ensureChannels(forceRefresh) {
  if (!forceRefresh && channelItems) return channelItems;
  channelItems = await window.api.getSubscriptions();
  return channelItems;
}

async function loadLibrary(forceRefresh) {
  navEl.hidden = true;
  viewToggleEl.hidden = false;
  currentView = 'library';
  hasMoreVideos = false;
  listEl.innerHTML = '<div class="widget__empty">불러오는 중…</div>';

  try {
    if (libraryTab === 'playlists') {
      await ensurePlaylists(forceRefresh);
    } else {
      await ensureChannels(forceRefresh);
    }
    renderLibraryTab();
  } catch (err) {
    console.error(err);
    listEl.innerHTML = '<div class="widget__empty">불러오지 못했어요.</div>';
  }
}

function foldForSearch(text) {
  // Lowercase and drop Latin accents, but keep Hangul syllables composed.
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
}

// Live "type-ahead" match. Every character except the last must match exactly; the last
// one may still be mid-composition (a lone "ㄷ", or "도" about to become "돌"), so it
// matches any character whose jamo begin with the same jamo. That way "ㅂ → 바 → 박 →
// 박ㄷ → 박도" narrows steadily instead of the list going empty on half-typed syllables.
function matchesSearch(title, query) {
  const q = Array.from(foldForSearch(query).trim());
  if (!q.length) return true;

  const tail = q.pop().normalize('NFKD');
  const head = q.join('');
  const t = foldForSearch(title);

  for (let i = 0; i + head.length < t.length; i++) {
    if (!t.startsWith(head, i)) continue;
    const next = String.fromCodePoint(t.codePointAt(i + head.length));
    if (next.normalize('NFKD').startsWith(tail)) return true;
  }
  return false;
}

function renderLibraryTab() {
  const isPlaylists = libraryTab === 'playlists';
  const allItems = (isPlaylists ? playlistItems : channelItems) || [];
  const favIds = favorites[libraryTab];
  const isSearching = isEditMode && searchQuery.trim() !== '';

  searchRowEl.hidden = !isEditMode;
  searchInput.placeholder = isPlaylists ? '재생목록 검색' : '채널 검색';

  let items = allItems;
  if (isEditMode) {
    if (isSearching) items = allItems.filter((item) => matchesSearch(item.title, searchQuery));
    // Favorites first, but judged by what was favorited when edit mode was opened — ticking
    // or unticking mid-session leaves rows where they are, so nothing slides out from under
    // the cursor (which made accidental mis-ticks easy).
    const pinned = editPinned[libraryTab];
    items = [...items.filter((item) => pinned.has(item.id)), ...items.filter((item) => !pinned.has(item.id))];
  } else if (favIds.length) {
    items = allItems.filter((item) => favIds.includes(item.id));
  }

  renderRows(items, {
    emptyText: isSearching ? '검색 결과가 없어요.' : isPlaylists ? '재생목록이 없어요.' : '구독한 채널이 없어요.',
    subtitle: (item) => item.subtitle || '',
    checkable: isEditMode,
    isChecked: (item) => favIds.includes(item.id),
    onToggle: (item) => toggleFavorite(item),
    onClick: isEditMode
      ? (item) => toggleFavorite(item)
      : isPlaylists
        ? (item) => openPlaylist(item)
        : (item) => openChannel(item),
    onPlayClick: !isEditMode && isPlaylists ? (item) => playShuffled(item) : undefined,
  });
}

async function toggleFavorite(item) {
  const list = favorites[libraryTab];
  const idx = list.indexOf(item.id);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    list.push(item.id);
  }
  renderLibraryTab();
  try {
    await window.api.setFavorites(favorites);
  } catch (err) {
    console.error(err);
  }
}

function clearSearch() {
  searchQuery = '';
  searchInput.value = '';
}

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  renderLibraryTab();
  listEl.scrollTop = 0;
});

function switchTab(tab) {
  if (libraryTab === tab) return;
  libraryTab = tab;
  clearSearch();
  tabPlaylistsBtn.classList.toggle('is-active', tab === 'playlists');
  tabChannelsBtn.classList.toggle('is-active', tab === 'channels');
  loadLibrary(false);
}

tabPlaylistsBtn.addEventListener('click', () => switchTab('playlists'));
tabChannelsBtn.addEventListener('click', () => switchTab('channels'));

editBtn.addEventListener('click', () => {
  isEditMode = !isEditMode;
  editBtn.classList.toggle('is-active', isEditMode);
  clearSearch();
  if (isEditMode) {
    editPinned = { playlists: new Set(favorites.playlists), channels: new Set(favorites.channels) };
  }
  if (currentView === 'library') {
    renderLibraryTab();
  } else {
    loadLibrary(false);
  }
});

async function openPlaylist(item) {
  navEl.hidden = false;
  viewToggleEl.hidden = true;
  searchRowEl.hidden = true;
  navLabelEl.textContent = item.title;
  listEl.innerHTML = '<div class="widget__empty">불러오는 중…</div>';

  try {
    const playlist = await window.api.getPlaylist(item.id);
    currentView = 'playlist';
    currentDetailItem = item;
    currentQueueKind = 'track';
    currentQueue = playlist.tracks;
    isShuffleRepeat = false;
    hasMoreVideos = false;
    renderQueue();
  } catch (err) {
    console.error(err);
    listEl.innerHTML = '<div class="widget__empty">목록을 불러오지 못했어요.</div>';
  }
}

// channelId -> { videos, hasMore }. Opening a channel we've already viewed this
// session paints instantly from here while a fresh fetch runs behind it — the fetch
// always happens (so new uploads still show up), it just no longer blocks the paint.
const channelVideoCache = new Map();

async function openChannel(item) {
  navEl.hidden = false;
  viewToggleEl.hidden = true;
  searchRowEl.hidden = true;
  navLabelEl.textContent = item.title;
  currentView = 'channel';
  currentDetailItem = item;
  currentQueueKind = 'video';
  isShuffleRepeat = false;

  const cached = channelVideoCache.get(item.id);
  if (cached) {
    currentQueue = cached.videos;
    hasMoreVideos = cached.hasMore;
    renderQueue();
  } else {
    currentQueue = [];
    hasMoreVideos = false;
    listEl.innerHTML = '<div class="widget__empty">불러오는 중…</div>';
  }

  try {
    const channel = await window.api.getChannelVideos(item.id);
    channelVideoCache.set(item.id, { videos: channel.videos, hasMore: Boolean(channel.hasMore) });

    if (currentDetailItem === item) {
      currentQueue = channel.videos;
      hasMoreVideos = Boolean(channel.hasMore);
      renderQueue();
    }
  } catch (err) {
    console.error(err);
    if (!cached) {
      listEl.innerHTML = '<div class="widget__empty">영상을 불러오지 못했어요.</div>';
    }
  }
}

/** Library row's play button: shuffle-repeat the playlist in the background, without navigating into it. */
async function playShuffled(item) {
  try {
    const playlist = await window.api.getPlaylist(item.id);
    if (!playlist.tracks.length) {
      showToast('재생할 트랙이 없어요.', true);
      return;
    }
    currentQueueKind = 'track';
    currentQueue = shuffle(playlist.tracks.slice());
    isShuffleRepeat = true;
    playTrack(0);
  } catch (err) {
    console.error(err);
    showToast('재생에 실패했어요.', true);
  }
}

function renderQueue() {
  renderRows(currentQueue, {
    emptyText: currentQueueKind === 'video' ? '영상이 없어요.' : '트랙이 없어요.',
    subtitle: (item) => item.artist || item.subtitle || '',
    duration: (item) => item.duration || '',
    isPlaying: (item) => currentQueue[currentIndex] && currentQueue[currentIndex].id === item.id,
    onClick: (item) => playTrack(currentQueue.indexOf(item)),
  });
}

async function loadMoreVideos() {
  if (isLoadingMore || !hasMoreVideos || currentView !== 'channel') return;
  isLoadingMore = true;

  try {
    const more = await window.api.getMoreChannelVideos();
    hasMoreVideos = more.hasMore;
    if (more.videos.length) {
      currentQueue = currentQueue.concat(more.videos);
      const scrollTop = listEl.scrollTop;
      renderQueue();
      listEl.scrollTop = scrollTop;
    }
  } catch (err) {
    console.error(err);
  } finally {
    isLoadingMore = false;
  }
}

listEl.addEventListener('scroll', () => {
  if (currentView !== 'channel' || !hasMoreVideos || isLoadingMore) return;
  const { scrollTop, scrollHeight, clientHeight } = listEl;
  if (scrollHeight - (scrollTop + clientHeight) < 80) {
    loadMoreVideos();
  }
});

async function playTrack(index) {
  const media = currentQueue[index];
  if (!media) return;

  currentIndex = index;
  if (currentView === 'playlist' || currentView === 'channel') {
    renderQueue();
  }

  playerTitle.textContent = media.title;
  playerArtist.textContent = media.artist || media.subtitle || '';
  playerThumb.src = media.thumbnail || '';
  progressFill.style.width = '0%';

  try {
    const getStream = currentQueueKind === 'video' ? window.api.getVideoStreamUrl : window.api.getStreamUrl;
    const stream = await getStream(media.id);
    audio.src = stream.url;
    await audio.play();
    playIcon.innerHTML = PAUSE_ICON;
  } catch (err) {
    console.error(err);
    showToast('재생에 실패했어요.', true);
  }
}

function advance(delta) {
  if (!currentQueue.length) return;
  let nextIndex = currentIndex + delta;

  if (isShuffleRepeat) {
    if (nextIndex >= currentQueue.length) {
      currentQueue = shuffle(currentQueue.slice());
      nextIndex = 0;
    } else if (nextIndex < 0) {
      nextIndex = 0;
    }
    playTrack(nextIndex);
    return;
  }

  if (nextIndex < 0 || nextIndex >= currentQueue.length) return;
  playTrack(nextIndex);
}

playBtn.addEventListener('click', () => {
  if (!audio.src) return;
  if (audio.paused) {
    audio.play();
    playIcon.innerHTML = PAUSE_ICON;
  } else {
    audio.pause();
    playIcon.innerHTML = PLAY_ICON;
  }
});

prevBtn.addEventListener('click', () => advance(-1));
nextBtn.addEventListener('click', () => advance(1));

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  progressFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
});

audio.addEventListener('ended', () => advance(1));

progressBar.addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = progressBar.getBoundingClientRect();
  const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
  audio.currentTime = ratio * audio.duration;
});

function updateVolumeFill(value) {
  volumeSlider.style.background = `linear-gradient(to right, #7fb5ff ${value}%, rgba(255,255,255,0.12) ${value}%)`;
}

volumeSlider.addEventListener('input', () => {
  audio.volume = Number(volumeSlider.value) / 100;
  updateVolumeFill(volumeSlider.value);
});

audio.volume = Number(volumeSlider.value) / 100;
updateVolumeFill(volumeSlider.value);

backBtn.addEventListener('click', () => loadLibrary(false));

refreshBtn.addEventListener('click', () => {
  refreshBtn.classList.add('is-spinning');
  setTimeout(() => refreshBtn.classList.remove('is-spinning'), 400);

  if (currentView === 'playlist' && currentDetailItem) {
    openPlaylist(currentDetailItem);
  } else if (currentView === 'channel' && currentDetailItem) {
    openChannel(currentDetailItem);
  } else {
    loadLibrary(true);
  }
});

closeBtn.addEventListener('click', () => window.api.hideWindow());

pinBtn.addEventListener('click', async () => {
  const isPinned = pinBtn.classList.contains('is-active');
  const newState = await window.api.togglePin(!isPinned);
  pinBtn.classList.toggle('is-active', newState);
});

minimizeBtn.addEventListener('click', async () => {
  const isMini = !widgetEl.classList.contains('is-mini');
  widgetEl.classList.toggle('is-mini', isMini);
  await window.api.toggleMini(isMini);
});

window.api.onAuthPending(() => {
  listEl.innerHTML = '<div class="widget__empty">로그인 창에서 로그인해 주세요…</div>';
});

async function init() {
  const pinned = await window.api.getPinState();
  pinBtn.classList.toggle('is-active', pinned);

  const isMini = await window.api.getMiniState();
  widgetEl.classList.toggle('is-mini', isMini);

  try {
    favorites = await window.api.getFavorites();
  } catch (err) {
    console.error(err);
  }

  try {
    await window.api.startAuth();
    loadLibrary(true);
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `
      <div class="widget__empty">
        로그인이 취소됐어요.
        <button class="widget__retryBtn" id="retryAuthBtn">다시 시도</button>
      </div>`;
    document.getElementById('retryAuthBtn').addEventListener('click', init);
  }
}

init();
