const widgetEl = document.querySelector('.widget');
const listEl = document.getElementById('list');
const navEl = document.getElementById('nav');
const navLabelEl = document.getElementById('navLabel');
const backBtn = document.getElementById('backBtn');
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

const PLAY_ICON = '<path d="M8 5v14l11-7z"></path>';
const PAUSE_ICON = '<path d="M6 5h4v14H6zm8 0h4v14h-4z"></path>';

let libraryItems = null;
let currentQueue = [];
let currentIndex = -1;
let isShuffleRepeat = false;
let currentView = 'library';

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

    row.addEventListener('click', () => options.onClick(item));
    listEl.appendChild(row);
  }
}

async function loadLibrary(forceRefresh) {
  navEl.hidden = true;

  if (!forceRefresh && libraryItems) {
    renderLibrary();
    return;
  }

  listEl.innerHTML = '<div class="widget__empty">불러오는 중…</div>';

  try {
    libraryItems = await window.api.getLibrary();
    renderLibrary();
  } catch (err) {
    console.error(err);
    listEl.innerHTML = '<div class="widget__empty">보관함을 불러오지 못했어요.</div>';
  }
}

function renderLibrary() {
  currentView = 'library';
  renderRows(libraryItems, {
    emptyText: '보관함이 비어 있어요.',
    subtitle: (item) => item.subtitle || '',
    onClick: (item) => openPlaylist(item),
    onPlayClick: (item) => playShuffled(item),
  });
}

async function openPlaylist(item) {
  navEl.hidden = false;
  navLabelEl.textContent = item.title;
  listEl.innerHTML = '<div class="widget__empty">불러오는 중…</div>';

  try {
    const playlist = await window.api.getPlaylist(item.id);
    currentView = 'playlist';
    currentQueue = playlist.tracks;
    isShuffleRepeat = false;
    renderTracks();
  } catch (err) {
    console.error(err);
    listEl.innerHTML = '<div class="widget__empty">목록을 불러오지 못했어요.</div>';
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
    currentQueue = shuffle(playlist.tracks.slice());
    isShuffleRepeat = true;
    playTrack(0);
  } catch (err) {
    console.error(err);
    showToast('재생에 실패했어요.', true);
  }
}

function renderTracks() {
  renderRows(currentQueue, {
    emptyText: '트랙이 없어요.',
    subtitle: (item) => item.artist || '',
    duration: (item) => item.duration || '',
    isPlaying: (item) => currentQueue[currentIndex] && currentQueue[currentIndex].id === item.id,
    onClick: (item) => playTrack(currentQueue.indexOf(item)),
  });
}

async function playTrack(index) {
  const track = currentQueue[index];
  if (!track) return;

  currentIndex = index;
  if (currentView === 'playlist') {
    renderTracks();
  }

  playerTitle.textContent = track.title;
  playerArtist.textContent = track.artist || '';
  playerThumb.src = track.thumbnail || '';
  progressFill.style.width = '0%';

  try {
    const stream = await window.api.getStreamUrl(track.id);
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

backBtn.addEventListener('click', () => loadLibrary(false));

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
