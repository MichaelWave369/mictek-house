const audio = document.getElementById("audio");
const stage = document.getElementById("stage");
const playerEl = document.getElementById("player");
const modal = document.getElementById("modal");
const searchEl = document.getElementById("search");

const state = {
  catalog: [],
  local: [],
  view: "library",
  albumId: null,
  queue: [],
  index: -1,
  shuffle: false,
  repeat: "off",
  query: "",
  urls: new Map()
};

const SUNO_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function sunoId(value) {
  const m = String(value || "").match(SUNO_ID);
  return m ? m[0].toLowerCase() : "";
}

function sunoAudio(id) {
  return `https://d2lwuy8qc234o3.cloudfront.net/1/clip/${id}.m4a`;
}

function sunoCover(id) {
  return `https://cdn2.suno.ai/image_large_${id}.jpeg`;
}

function sunoEmbed(id) {
  return `https://suno.com/embed/${id}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("mictek-house", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("albums")) db.createObjectStore("albums", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbAll(store) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, value) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(store, id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(store, id) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ":" + String(s).padStart(2, "0");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&" + "amp;";
      case "<": return "&" + "lt;";
      case ">": return "&" + "gt;";
      case '"': return "&" + "quot;";
      default: return "&" + "#39;";
    }
  });
}

function allAlbums() {
  const map = new Map();
  for (const a of state.catalog) map.set(a.id, { ...a, source: "file" });
  for (const a of state.local) map.set(a.id, { ...a, source: "local" });
  return [...map.values()].sort((a, b) => (b.year || "").localeCompare(a.year || "") || a.title.localeCompare(b.title));
}

function findAlbum(id) {
  return allAlbums().find((a) => a.id === id) || null;
}

async function blobUrl(id) {
  if (!id) return "";
  if (state.urls.has(id)) return state.urls.get(id);
  const rec = await idbGet("blobs", id);
  if (!rec) return "";
  const url = URL.createObjectURL(rec.blob);
  state.urls.set(id, url);
  return url;
}

async function coverSrc(album) {
  if (album.coverBlob) return blobUrl(album.coverBlob);
  if (album.cover) return album.cover;
  const sid = (album.tracks || []).map((t) => t.sunoId || sunoId(t.src)).find(Boolean);
  return sid ? sunoCover(sid) : "";
}

function fileTitle(name) {
  return name.replace(/\.[^.]+$/, "").replace(/^\d+[\s._-]*/, "").replace(/[_]+/g, " ").trim() || name;
}

async function readDuration(file) {
  const url = URL.createObjectURL(file);
  try {
    const el = new Audio();
    el.preload = "metadata";
    const dur = await new Promise((resolve) => {
      el.onloadedmetadata = () => resolve(el.duration);
      el.onerror = () => resolve(0);
      el.src = url;
    });
    return Number.isFinite(dur) ? dur : 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function load() {
  try {
    const res = await fetch("albums.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      state.catalog = data.albums || [];
      if (data.tagline) document.getElementById("tagline").textContent = data.artist || data.tagline;
    }
  } catch (_) {
    state.catalog = [];
  }
  state.local = await idbAll("albums");
  render();
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  const albums = allAlbums();
  if (!q) return albums;
  return albums.filter((a) => {
    const hay = [a.title, a.artist, a.description, ...(a.tracks || []).map((t) => t.title)].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

async function render() {
  if (state.view === "album" && state.albumId) await renderAlbum();
  else await renderLibrary();
  renderPlayer();
}

async function renderLibrary() {
  const albums = filtered();
  const cards = [];
  for (const a of albums) {
    const src = await coverSrc(a);
    const n = (a.tracks || []).filter((t) => t.src || t.blob).length;
    const total = (a.tracks || []).length;
    cards.push(`
      <button class="ml-row" data-open="${esc(a.id)}">
        ${src ? `<img src="${esc(src)}" alt="" />` : `<span class="ph">${esc((a.title || "?").slice(0, 1))}</span>`}
        <span class="ml-title">${esc(a.title)}</span>
        <span>${n}/${total}</span>
        <span>${esc(a.type || "LP")}</span>
        <span>${esc(a.year || "")}</span>
      </button>`);
  }
  stage.innerHTML = `
    <div class="kicker">
      <h1>MEDIA LIBRARY</h1>
      <p>${albums.length} albums</p>
    </div>
    <div class="ml">
      <aside class="ml-tree">
        <div>Audio</div>
        <div class="on">Albums</div>
        <div>Now playing</div>
      </aside>
      <div class="ml-main">
        <div class="ml-head"><span></span><span>Album</span><span>Tracks</span><span>Type</span><span>Year</span></div>
        ${cards.join("") || `<div class="empty"><strong>No shelves yet.</strong></div>`}
      </div>
    </div>`;
  stage.querySelectorAll("[data-open]").forEach((btn) => {
    btn.onclick = () => openAlbum(btn.dataset.open);
  });
}

async function renderAlbum() {
  const album = findAlbum(state.albumId);
  if (!album) { state.view = "library"; return renderLibrary(); }
  const src = await coverSrc(album);
  const tracks = album.tracks || [];
  const rows = tracks.map((t, i) => {
    const on = state.queue[state.index] && state.queue[state.index].trackId === t.id;
    const playable = !!(t.src || t.blob || t.sunoId);
    return `
      <div class="track ${on ? "on" : ""}">
        <button class="icon-btn n" data-play="${esc(t.id)}" ${playable ? "" : "disabled"}>${String(i + 1).padStart(2, "0")}</button>
        <button class="icon-btn t" data-play="${esc(t.id)}" ${playable ? "" : "disabled"}>${esc(t.title)}${playable ? "" : " · needs audio"}</button>
        <span class="d">${t.duration ? fmt(t.duration) : "--"}</span>
        <span>
          <button class="icon-btn" data-up="${esc(t.id)}" title="Move up">↑</button>
          <button class="icon-btn" data-down="${esc(t.id)}" title="Move down">↓</button>
          <button class="icon-btn" data-del="${esc(t.id)}" title="Remove">×</button>
        </span>
      </div>`;
  }).join("");
  stage.innerHTML = `
    <div class="album">
      <div>
        ${src ? `<img class="album-cover" src="${esc(src)}" alt="" />` : `<div class="album-cover ph"></div>`}
      </div>
      <div>
        <div class="album-head">
          <div>
            <p class="eyebrow">${esc(album.type || "LP")} · ${esc(album.year || "2026")} · ${esc(album.artist || "Mikey More Bounce")}</p>
            <h1>${esc(album.title)}</h1>
            <p class="blurb">${esc(album.description || "Drop the tracks. Order is the release.")}</p>
          </div>
        </div>
        <div class="row-actions">
          <button class="btn hot" id="play-album" type="button">Play album</button>
          <button class="btn" id="back" type="button">All albums</button>
          <button class="btn" id="edit" type="button">Edit</button>
          <button class="btn" id="remove-album" type="button">Delete</button>
        </div>
        <div class="drop" id="drop">Drop MP3s here, or use From Suno and paste the song links. Public Suno tracks stream from here. Private ones will not.</div>
        <div class="tracks">${rows || `<div class="empty"><strong>Empty shelf.</strong>Export the songs from Suno, then drop them here.</div>`}</div>
      </div>
    </div>`;
  document.getElementById("back").onclick = () => { state.view = "library"; render(); };
  document.getElementById("play-album").onclick = () => playAlbum(album.id, 0);
  document.getElementById("edit").onclick = () => openEditor(album);
  document.getElementById("remove-album").onclick = () => removeAlbum(album.id);
  stage.querySelectorAll("[data-play]").forEach((btn) => {
    btn.onclick = () => playTrack(album.id, btn.dataset.play);
  });
  stage.querySelectorAll("[data-up]").forEach((btn) => btn.onclick = () => moveTrack(album.id, btn.dataset.up, -1));
  stage.querySelectorAll("[data-down]").forEach((btn) => btn.onclick = () => moveTrack(album.id, btn.dataset.down, 1));
  stage.querySelectorAll("[data-del]").forEach((btn) => btn.onclick = () => deleteTrack(album.id, btn.dataset.del));
  const drop = document.getElementById("drop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = async (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const files = [...e.dataTransfer.files].filter((f) => /audio|mpeg|wav|flac|mp3|m4a|ogg/i.test(f.type + f.name));
    if (files.length) await addFiles(album.id, files);
  };
}

function renderPlayer() {
  const cur = state.queue[state.index];
  const embed = state.useEmbed && cur && cur.sunoId
    ? `<iframe class="embed-fallback" title="Suno player" src="${esc(sunoEmbed(cur.sunoId))}" allow="autoplay; encrypted-media; fullscreen"></iframe>`
    : "";
  playerEl.className = audio.paused || !cur ? "player idle" : "player";
  playerEl.innerHTML = `
    <div class="now">
      ${cur && cur.cover ? `<img src="${esc(cur.cover)}" alt="" />` : `<div class="ph"></div>`}
      <div class="who">
        <strong>${esc(cur ? cur.title : "MORE BOUNCE LABS")}</strong>
        <span>${esc(cur ? cur.album : "playlist editor")}</span>
      </div>
    </div>
    <div class="transport">
      <div class="lcd">
        <span>${fmt(audio.currentTime)} / ${fmt(audio.duration)}</span>
        <span class="bars">${[8, 14, 6, 18, 10, 16, 7, 12].map((h) => `<i style="height:${h}px"></i>`).join("")}</span>
      </div>
      ${embed}
      <div class="controls">
        <button type="button" id="shuffle" title="Shuffle">${state.shuffle ? "SH" : "sh"}</button>
        <button type="button" id="prev" title="Previous">|<</button>
        <button class="play" type="button" id="toggle" title="Play or pause">${audio.paused ? ">" : "||"}</button>
        <button type="button" id="next" title="Next">>|</button>
        <button type="button" id="repeat" title="Repeat">${state.repeat === "one" ? "R1" : state.repeat === "all" ? "RA" : "rp"}</button>
      </div>
      <div class="scrub">
        <span id="cur">${fmt(audio.currentTime)}</span>
        <input id="seek" type="range" min="0" max="${audio.duration || 0}" step="0.1" value="${audio.currentTime || 0}" />
        <span id="dur">${fmt(audio.duration)}</span>
      </div>
    </div>
    <div class="vol">
      <span>VOL</span>
      <input id="vol" type="range" min="0" max="1" step="0.01" value="${audio.volume}" />
    </div>`;
  document.getElementById("toggle").onclick = toggle;
  document.getElementById("prev").onclick = () => step(-1);
  document.getElementById("next").onclick = () => step(1);
  document.getElementById("shuffle").onclick = () => { state.shuffle = !state.shuffle; renderPlayer(); };
  document.getElementById("repeat").onclick = () => {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    renderPlayer();
  };
  document.getElementById("seek").oninput = (e) => { audio.currentTime = Number(e.target.value); };
  document.getElementById("vol").oninput = (e) => { audio.volume = Number(e.target.value); }
}

async function ensureLocalCopy(album) {
  if (album.source === "local") return album;
  const copy = {
    id: album.id,
    title: album.title,
    artist: album.artist,
    type: album.type,
    year: album.year,
    description: album.description,
    cover: album.cover || "",
    coverBlob: album.coverBlob || "",
    tracks: (album.tracks || []).map((t) => ({ ...t }))
  };
  await idbPut("albums", copy);
  state.local = await idbAll("albums");
  return findAlbum(album.id);
}

async function addFiles(albumId, files) {
  const album = await ensureLocalCopy(findAlbum(albumId));
  for (const file of files) {
    const id = uid();
    await idbPut("blobs", { id, blob: file, mime: file.type, name: file.name });
    const duration = await readDuration(file);
    album.tracks.push({ id: uid(), title: fileTitle(file.name), blob: id, duration });
  }
  await idbPut("albums", strip(album));
  state.local = await idbAll("albums");
  render();
}

function strip(album) {
  const { source, ...rest } = album;
  return rest;
}

async function moveTrack(albumId, trackId, dir) {
  const album = await ensureLocalCopy(findAlbum(albumId));
  const i = album.tracks.findIndex((t) => t.id === trackId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= album.tracks.length) return;
  const [t] = album.tracks.splice(i, 1);
  album.tracks.splice(j, 0, t);
  await idbPut("albums", strip(album));
  state.local = await idbAll("albums");
  render();
}

async function deleteTrack(albumId, trackId) {
  const album = await ensureLocalCopy(findAlbum(albumId));
  const t = album.tracks.find((x) => x.id === trackId);
  album.tracks = album.tracks.filter((x) => x.id !== trackId);
  if (t && t.blob) await idbDel("blobs", t.blob);
  await idbPut("albums", strip(album));
  state.local = await idbAll("albums");
  render();
}

async function removeAlbum(id) {
  if (!confirm("Delete this album from this browser? Hosted albums.json shelves come back on refresh unless you edit that file.")) return;
  const album = state.local.find((a) => a.id === id);
  if (album) {
    for (const t of album.tracks || []) if (t.blob) await idbDel("blobs", t.blob);
    if (album.coverBlob) await idbDel("blobs", album.coverBlob);
    await idbDel("albums", id);
    state.local = await idbAll("albums");
  }
  state.catalog = state.catalog.filter((a) => a.id !== id);
  state.view = "library";
  render();
}

function openAlbum(id) {
  state.albumId = id;
  state.view = "album";
  render();
}

async function playTrack(albumId, trackId) {
  const album = findAlbum(albumId);
  if (!album) return;
  const playable = (album.tracks || []).filter((t) => t.src || t.blob || t.sunoId);
  const cover = await coverSrc(album);
  state.queue = [];
  for (const t of playable) {
    const sid = t.sunoId || sunoId(t.src);
    state.queue.push({
      albumId: album.id,
      trackId: t.id,
      title: t.title,
      album: album.title,
      cover: cover || (sid ? sunoCover(sid) : ""),
      src: t.src || (sid ? sunoAudio(sid) : ""),
      blob: t.blob || "",
      sunoId: sid
    });
  }
  const idx = state.queue.findIndex((t) => t.trackId === trackId);
  if (idx < 0) return;
  state.index = idx;
  state.useEmbed = false;
  await startCurrent();
}

async function playAlbum(albumId, start) {
  const album = findAlbum(albumId);
  if (!album) return;
  const playable = (album.tracks || []).filter((t) => t.src || t.blob || t.sunoId);
  if (!playable.length) {
    alert("This shelf has no audio yet. Export the songs from Suno and drop the files on the album.");
    return;
  }
  await playTrack(albumId, playable[start || 0].id);
}

async function startCurrent() {
  const cur = state.queue[state.index];
  if (!cur) return;
  state.useEmbed = false;
  audio.crossOrigin = "anonymous";
  const src = cur.blob ? await blobUrl(cur.blob) : (cur.src || (cur.sunoId ? sunoAudio(cur.sunoId) : ""));
  if (!src) {
    if (cur.sunoId) { state.useEmbed = true; render(); }
    return;
  }
  audio.src = src;
  try {
    await audio.play();
  } catch (_) {
    if (cur.sunoId) state.useEmbed = true;
  }
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cur.title,
      artist: "Mikey More Bounce",
      album: cur.album,
      artwork: cur.cover ? [{ src: cur.cover }] : []
    });
  }
  render();
}

function toggle() {
  if (!audio.src) {
    const album = findAlbum(state.albumId) || allAlbums().find((a) => (a.tracks || []).some((t) => t.src || t.blob));
    if (album) playAlbum(album.id, 0);
    return;
  }
  if (audio.paused) audio.play();
  else audio.pause();
}

function step(dir) {
  if (!state.queue.length) return;
  if (state.shuffle && dir > 0) {
    state.index = Math.floor(Math.random() * state.queue.length);
  } else {
    state.index += dir;
    if (state.index < 0) state.index = 0;
    if (state.index >= state.queue.length) {
      if (state.repeat === "all") state.index = 0;
      else { state.index = state.queue.length - 1; audio.pause(); renderPlayer(); return; }
    }
  }
  startCurrent();
}

audio.addEventListener("ended", () => {
  if (state.repeat === "one") { audio.currentTime = 0; audio.play(); return; }
  step(1);
});
audio.addEventListener("timeupdate", () => {
  const cur = document.getElementById("cur");
  const seek = document.getElementById("seek");
  const tog = document.getElementById("toggle");
  if (cur) cur.textContent = fmt(audio.currentTime);
  if (seek && document.activeElement !== seek) {
    seek.max = audio.duration || 0;
    seek.value = audio.currentTime || 0;
  }
  if (tog) tog.textContent = audio.paused ? "▶" : "❚❚";
});
audio.addEventListener("error", () => {
  const cur = state.queue[state.index];
  if (cur && cur.sunoId) {
    state.useEmbed = true;
    renderPlayer();
  }
});
audio.addEventListener("pause", renderPlayer);

function openEditor(album) {
  const a = album || {
    id: uid(), title: "", artist: "Mikey More Bounce", type: "LP", year: "2026", description: "", tracks: [], fresh: true
  };
  modal.className = "modal";
  modal.innerHTML = `
    <form class="sheet" id="form">
      <h3>${a.fresh ? "NEW ALBUM" : "EDIT ALBUM"}</h3>
      <div class="fields">
        <label>Title<input name="title" required value="${esc(a.title)}" /></label>
        <label>Artist<input name="artist" value="${esc(a.artist || "Mikey More Bounce")}" /></label>
        <label>Type
          <select name="type">
            <option ${a.type === "LP" ? "selected" : ""}>LP</option>
            <option ${a.type === "EP" ? "selected" : ""}>EP</option>
            <option ${a.type === "Single" ? "selected" : ""}>Single</option>
          </select>
        </label>
        <label>Year<input name="year" value="${esc(a.year || "2026")}" /></label>
        <label class="wide">Description<textarea name="description">${esc(a.description || "")}</textarea></label>
        <label class="wide">Cover image<input name="cover" type="file" accept="image/*" /></label>
        <label class="wide">Tracks<input name="tracks" type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg" multiple /></label>
      </div>
      <p class="note">Audio is stored in this browser, not uploaded. Export saves the track list. To put it on the internet, host the folder and point tracks at files in albums.json.</p>
      <div class="sheet-actions">
        <button class="btn" type="button" id="cancel">Cancel</button>
        <button class="btn solid" type="submit">Save</button>
      </div>
    </form>`;
  document.getElementById("cancel").onclick = closeModal;
  document.getElementById("form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const next = {
      id: a.id,
      title: fd.get("title").trim(),
      artist: fd.get("artist").trim() || "Mikey More Bounce",
      type: fd.get("type"),
      year: fd.get("year").trim(),
      description: fd.get("description").trim(),
      cover: a.cover || "",
      coverBlob: a.coverBlob || "",
      tracks: [...(a.tracks || [])]
    };
    const cover = e.target.cover.files[0];
    if (cover) {
      const id = uid();
      await idbPut("blobs", { id, blob: cover, mime: cover.type, name: cover.name });
      next.coverBlob = id;
      next.cover = "";
    }
    await idbPut("albums", next);
    state.local = await idbAll("albums");
    closeModal();
    const files = [...e.target.tracks.files];
    state.albumId = next.id;
    state.view = "album";
    if (files.length) await addFiles(next.id, files);
    else render();
  };
}

function closeModal() {
  modal.className = "hidden";
  modal.innerHTML = "";
}

function exportCatalog() {
  const albums = state.local.map((a) => ({
    id: a.id,
    title: a.title,
    artist: a.artist,
    type: a.type,
    year: a.year,
    description: a.description,
    cover: a.cover || "",
    tracks: (a.tracks || []).map((t, i) => ({
      title: t.title,
      duration: t.duration || 0,
      src: t.src || `audio/${a.id}/${String(i + 1).padStart(2, "0")}.mp3`
    }))
  }));
  const blob = new Blob([JSON.stringify({ artist: "Mikey More Bounce", albums }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "albums.json";
  a.click();
}

searchEl.oninput = () => { state.query = searchEl.value; if (state.view === "library") renderLibrary(); };
function openSuno() {
  modal.className = "modal";
  modal.innerHTML = `
    <form class="sheet" id="suno-form">
      <h3>FROM SUNO</h3>
      <p class="suno-help">Open the album on Suno. Press F12, open Console, paste the line below, and hit Enter. Chrome copies the song links. Paste them in the box. Do not put this in the address bar. Suno blocks that, and that is the error in your screenshot.</p>
      <p class="suno-help"><code id="grabber">copy([...new Set([...document.querySelectorAll("a[href*='/song/']")].map(a => a.href.split("?")[0]))].join("\\n"))</code></p>
      <div class="fields">
        <label>Album title<input name="title" required placeholder="West Coast" /></label>
        <label>Type
          <select name="type"><option>LP</option><option>EP</option><option>Single</option></select>
        </label>
        <label class="wide">Song links<textarea name="links" required placeholder="https://suno.com/song/...."></textarea></label>
      </div>
      <div class="sheet-actions">
        <button class="btn" type="button" id="cancel">Cancel</button>
        <button class="btn solid" type="submit">Stream this album</button>
      </div>
    </form>`;
  document.getElementById("cancel").onclick = closeModal;
  document.getElementById("suno-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const lines = String(fd.get("links") || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const tracks = [];
    const seen = new Set();
    lines.forEach((line, i) => {
      const id = sunoId(line);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const named = line.replace(SUNO_ID, "").replace(/https?:\/\/\S+/g, "").replace(/[|–-]+/g, " ").trim();
      tracks.push({
        id: uid(),
        title: named || `Track ${i + 1}`,
        sunoId: id,
        src: sunoAudio(id),
        duration: 0
      });
    });
    if (!tracks.length) {
      alert("No song links in there. Paste https://suno.com/song/... lines, not just the album page.");
      return;
    }
    const album = {
      id: uid(),
      title: String(fd.get("title") || "Untitled").trim(),
      artist: "Mikey More Bounce",
      type: fd.get("type") || "LP",
      year: "2026",
      description: "Streaming from Suno.",
      cover: sunoCover(tracks[0].sunoId),
      tracks
    };
    await idbPut("albums", album);
    state.local = await idbAll("albums");
    closeModal();
    state.albumId = album.id;
    state.view = "album";
    render();
  };
}

document.getElementById("add-btn").onclick = () => openEditor(null);
document.getElementById("suno-btn").onclick = openSuno;
document.getElementById("export-btn").onclick = exportCatalog;
document.getElementById("import-btn").onclick = () => document.getElementById("import-file").click();
document.getElementById("import-file").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  for (const album of data.albums || []) {
    await idbPut("albums", {
      id: album.id || uid(),
      title: album.title,
      artist: album.artist || "Mikey More Bounce",
      type: album.type || "LP",
      year: album.year || "",
      description: album.description || "",
      cover: album.cover || "",
      tracks: (album.tracks || []).map((t) => ({
        id: uid(),
        title: t.title,
        src: t.src || "",
        duration: t.duration || 0
      }))
    });
  }
  state.local = await idbAll("albums");
  e.target.value = "";
  render();
};

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.code === "Space") { e.preventDefault(); toggle(); }
  if (e.code === "ArrowRight") audio.currentTime += 5;
  if (e.code === "ArrowLeft") audio.currentTime -= 5;
});

load();

const viz = document.getElementById("viz");
const vctx = viz.getContext("2d");
let actx, analyser, freq, wave;
function armViz() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  const node = actx.createMediaElementSource(audio);
  analyser = actx.createAnalyser();
  analyser.fftSize = 256;
  node.connect(analyser);
  analyser.connect(actx.destination);
  freq = new Uint8Array(analyser.frequencyBinCount);
  wave = new Uint8Array(analyser.fftSize);
}
audio.addEventListener("play", () => { armViz(); actx && actx.resume(); });

function drawViz(t) {
  const w = viz.width, h = viz.height;
  const g = vctx;
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.fillRect(0, 0, w, h);
  let bass = 40;
  if (analyser) {
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);
    bass = freq.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
  }
  const pulse = bass / 255;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    const y = h * 0.5 + Math.sin(t / 700 + i) * (20 + pulse * 40);
    g.strokeStyle = `hsla(${(t / 20 + i * 40) % 360}, 100%, ${50 + pulse * 20}%, 0.55)`;
    g.lineWidth = 2 + pulse * 4;
    for (let x = 0; x <= w; x += 8) {
      const yy = y + Math.sin(x / 40 + t / 300 + i) * (12 + pulse * 36);
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  const bars = 48;
  for (let i = 0; i < bars; i++) {
    const v = analyser ? freq[i] / 255 : (0.25 + 0.2 * Math.sin(t / 200 + i));
    g.fillStyle = `hsl(${120 + i * 3 + t / 30}, 100%, 55%)`;
    g.fillRect(i * (w / bars), h - v * h * 0.8, (w / bars) - 2, v * h * 0.8);
  }
  g.beginPath();
  g.strokeStyle = "#b6ff4a";
  g.lineWidth = 1.5;
  for (let i = 0; i < (wave ? wave.length : 64); i++) {
    const x = (i / (wave ? wave.length : 64)) * w;
    const y = wave ? (wave[i] / 255) * h : h / 2;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  requestAnimationFrame(drawViz);
}
requestAnimationFrame(drawViz);
