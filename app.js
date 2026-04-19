// ===== KJV Reader — app.js =====
"use strict";

// -------- Constants --------
const HIGHLIGHT_COLORS = [
  { name: "Yellow", hex: "#FFEB3B" },
  { name: "Green",  hex: "#4CAF50" },
  { name: "Blue",   hex: "#2196F3" },
  { name: "Pink",   hex: "#E91E63" },
  { name: "Orange", hex: "#FF9800" },
];

const API_BASE      = "https://bible-api.com";
const LS_HIGHLIGHTS = "kjv-highlights";
const LS_POSITION   = "kjv-position";
const LS_SETTINGS   = "kjv-settings";
const LS_CACHE_PFX  = "kjv-cache-";

// -------- State --------
let state = {
  bookIndex: 42,   // John (0-based)
  chapter:   3,
  view:      "reading", // reading | highlights | settings
  highlights: [],
  settings: {
    fontSize: 19,
    darkMode: true,
  },
  // Selection state
  selectedVerse:   null,
  rangeStartVerse: null,
  // Sort / filter
  hlSort:       "date",   // "date" | "book"
  hlFilter:     null,     // color hex or null
  hlSearch:     "",
  hlTypeFilter: "all",    // "all" | "highlight" | "note"
  // Split panel (iPad only)
  splitOpen:    false,
  // Note context
  noteContext:  null,
};

// -------- Persistence --------
function loadHighlights() {
  try { state.highlights = JSON.parse(localStorage.getItem(LS_HIGHLIGHTS)) || []; }
  catch { state.highlights = []; }
}
function saveHighlights() {
  localStorage.setItem(LS_HIGHLIGHTS, JSON.stringify(state.highlights));
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
    if (s) state.settings = { ...state.settings, ...s };
  } catch {}
}
function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings));
}
function loadPosition() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_POSITION));
    if (p) { state.bookIndex = p.bookIndex; state.chapter = p.chapter; }
  } catch {}
}
function savePosition() {
  localStorage.setItem(LS_POSITION, JSON.stringify({ bookIndex: state.bookIndex, chapter: state.chapter }));
}

function getCachedChapter(book, chapter) {
  try {
    const raw = localStorage.getItem(`${LS_CACHE_PFX}${book}-${chapter}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.verses || null;
  } catch { return null; }
}
function setCachedChapter(book, chapter, verses) {
  try {
    localStorage.setItem(
      `${LS_CACHE_PFX}${book}-${chapter}`,
      JSON.stringify({ verses, cachedAt: new Date().toISOString() })
    );
  } catch {}
}

// -------- DOM references --------
const $ = id => document.getElementById(id);

let dom = {};

function initDom() {
  dom = {
    app:           $("app"),
    mainArea:      $("main-area"),
    topNav:        $("top-nav"),
    navPrev:       $("nav-prev"),
    navNext:       $("nav-next"),
    navBookBtn:    $("nav-book-btn"),
    navChapterBtn: $("nav-chapter-btn"),
    jumpInput:     $("jump-input"),

    readingView:   $("reading-view"),
    searchView:    $("search-view"),
    hlView:        $("highlights-view"),
    settingsView:  $("settings-view"),

    // Search
    searchInput:    $("search-input"),
    searchClearBtn: $("search-clear-btn"),
    searchStatus:   $("search-status"),
    searchResults:  $("search-results"),
    hlPanelHeader: $("hl-panel-header"),
    hlPanelClose:  $("hl-panel-close"),

    chapterTitle:  $("chapter-title"),
    verseContainer:$("verse-container"),

    colorPicker:   $("color-picker"),
    cpDots:        document.querySelectorAll(".cp-dot"),
    cpRemove:      $("cp-remove"),

    botRead:       $("bot-read"),
    botSearch:     $("bot-search"),
    botHighlights: $("bot-highlights"),
    botSettings:   $("bot-settings"),

    // Highlights view
    hlTabDate:      $("hl-tab-date"),
    hlTabBook:      $("hl-tab-book"),
    hlSearch:       $("hl-search"),
    hlList:         $("hl-list"),
    newNoteBtn:     $("new-note-btn"),
    hlColorFilters: document.querySelectorAll(".hl-color-filter"),
    hlColorFiltersRow: $("hl-color-filters-row"),
    hlSigninPrompt: $("hl-signin-prompt"),
    hlGoogleSignin: $("hl-google-signin-btn"),

    // Settings — account
    accountSignedOut:  $("account-signed-out"),
    accountSignedIn:   $("account-signed-in"),
    googleSigninBtn:   $("google-signin-btn"),
    googleSignoutBtn:  $("google-signout-btn"),
    accountPhoto:      $("account-photo"),
    accountName:       $("account-name"),
    accountEmail:      $("account-email"),
    syncStatusText:    $("sync-status-text"),

    // Settings
    fontSlider:    $("font-size-slider"),
    fontValue:     $("font-size-value"),
    darkToggle:    $("dark-mode-toggle"),
    clearBtn:      $("clear-highlights-btn"),

    // Modals
    bookModal:     $("book-modal"),
    chapterModal:  $("chapter-modal"),

    // Note modal
    noteModal:          $("note-modal"),
    noteModalTitle:     $("note-modal-title"),
    // noteTitleInput removed
    noteTextarea:       $("note-textarea"),
    noteBtnSave:        $("note-btn-save"),
    noteBtnCancel:      $("note-btn-cancel"),
    noteBtnDelete:      $("note-btn-delete"),
    noteModalClose:     $("note-modal-close"),

    toast:         $("toast"),
  };
}

// -------- API --------
async function fetchChapter(bookName, chapter) {
  const cached = getCachedChapter(bookName, chapter);
  if (cached) return cached;

  const url = `${API_BASE}/${encodeURIComponent(bookName.replace(/ /g, "+"))}+${chapter}?translation=kjv`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const verses = data.verses || [];
  setCachedChapter(bookName, chapter, verses);
  return verses;
}

// -------- Rendering --------
function applySettings() {
  document.documentElement.style.setProperty("--font-size", state.settings.fontSize + "px");
  document.body.classList.toggle("light", !state.settings.darkMode);
  if (dom.fontSlider) {
    dom.fontSlider.value = state.settings.fontSize;
    dom.fontValue.textContent = state.settings.fontSize + "px";
  }
  if (dom.darkToggle) dom.darkToggle.checked = state.settings.darkMode;
}

function updateNavButtons() {
  const book = BIBLE_BOOKS[state.bookIndex];
  dom.navBookBtn.textContent = book.name;
  dom.navChapterBtn.textContent = "Ch " + state.chapter;
  dom.navPrev.disabled = state.bookIndex === 0 && state.chapter === 1;
  dom.navNext.disabled = state.bookIndex === BIBLE_BOOKS.length - 1 && state.chapter === BIBLE_BOOKS[state.bookIndex].chapters;
}

async function loadAndRenderChapter(scrollToVerse) {
  const book = BIBLE_BOOKS[state.bookIndex];
  updateNavButtons();
  dom.chapterTitle.textContent = `${book.name} ${state.chapter}`;
  dom.verseContainer.innerHTML = `<div id="loading-indicator"><div class="spinner"></div>Loading…</div>`;
  closeColorPicker();
  state.selectedVerse = null;
  state.rangeStartVerse = null;

  try {
    const verses = await fetchChapter(book.name, state.chapter);
    renderVerses(verses, scrollToVerse);
  } catch (e) {
    dom.verseContainer.innerHTML = `<div id="loading-indicator" style="color:#e74c3c">
      Failed to load chapter.<br><small>${e.message}</small><br><br>
      <button onclick="loadAndRenderChapter()" style="background:var(--accent);color:#1a1a2e;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-size:14px;">Retry</button>
    </div>`;
  }
}

function getHighlightForVerse(bookIndex, chapter, verse) {
  return state.highlights.find(h => h.type !== 'note' && h.bookIndex === bookIndex && h.chapter === chapter && h.verse === verse) || null;
}

function getNoteById(id) {
  return state.highlights.find(h => h.id === id) || null;
}

function renderVerses(verses, scrollToVerse) {
  dom.verseContainer.innerHTML = "";
  verses.forEach(v => {
    const hl   = getHighlightForVerse(state.bookIndex, state.chapter, v.verse);
    const verseText = v.text.replace(/\n/g, " ").trim();

    const block = document.createElement("div");
    block.className = "verse-block";
    block.dataset.verse = v.verse;
    if (hl) {
      block.dataset.highlight = hl.color;
      block.style.setProperty("--hl-color", hl.color);
    }

    const numEl = document.createElement("span");
    numEl.className = "verse-num";
    numEl.textContent = v.verse;

    block.appendChild(numEl);

    const textEl = document.createElement("span");
    textEl.className = "verse-text";
    textEl.textContent = verseText;

    block.appendChild(textEl);
    block.addEventListener("click", e => handleVerseClick(e, v));
    dom.verseContainer.appendChild(block);
  });

  if (scrollToVerse) {
    setTimeout(() => {
      const target = dom.verseContainer.querySelector(`[data-verse="${scrollToVerse}"]`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }
}

// -------- Verse click & highlighting --------
function handleVerseClick(e, verse) {
  e.stopPropagation();
  const block = e.currentTarget;
  const verseNum = verse.verse;
  const verseText = block.querySelector(".verse-text").textContent;
  const book = BIBLE_BOOKS[state.bookIndex];

  // If color picker is open and rangeStart is set → range select
  if (!dom.colorPicker.classList.contains("hidden") && state.rangeStartVerse !== null && state.rangeStartVerse !== verseNum) {
    const start = Math.min(state.rangeStartVerse, verseNum);
    const end   = Math.max(state.rangeStartVerse, verseNum);
    document.querySelectorAll(".verse-block").forEach(b => b.classList.remove("selected", "range-start", "range-end"));
    for (let v = start; v <= end; v++) {
      const vb = dom.verseContainer.querySelector(`[data-verse="${v}"]`);
      if (vb) {
        vb.classList.add("selected");
        if (v === start) vb.classList.add("range-start");
        if (v === end)   vb.classList.add("range-end");
      }
    }
    state.selectedVerse = { bookIndex: state.bookIndex, chapter: state.chapter, verseRange: [start, end], text: verseText };
    positionColorPicker(block);
    return;
  }

  // Close picker if clicking same verse
  if (state.selectedVerse && !dom.colorPicker.classList.contains("hidden")) {
    const sv = state.selectedVerse;
    const isSame = sv.verse === verseNum || (sv.verseRange && sv.verseRange[0] <= verseNum && sv.verseRange[1] >= verseNum);
    if (isSame) {
      closeColorPicker();
      return;
    }
  }

  const existing = getHighlightForVerse(state.bookIndex, state.chapter, verseNum);

  document.querySelectorAll(".verse-block").forEach(b => b.classList.remove("selected", "range-start", "range-end"));
  block.classList.add("selected");
  state.selectedVerse = { bookIndex: state.bookIndex, chapter: state.chapter, verse: verseNum, text: verseText, book: book.name };
  state.rangeStartVerse = verseNum;

  dom.cpRemove.style.display = existing ? "flex" : "none";
  dom.cpDots.forEach(dot => {
    dot.classList.toggle("active", existing && dot.dataset.color === existing.color);
  });
  positionColorPicker(block);
}

function positionColorPicker(block) {
  dom.colorPicker.classList.remove("hidden");
  const rect = block.getBoundingClientRect();
  const pickerW = dom.colorPicker.offsetWidth || 280;
  const pickerH = dom.colorPicker.offsetHeight || 52;
  const viewW = window.innerWidth;

  let top = rect.top - pickerH - 8;
  if (top < 60) top = rect.bottom + 8;

  let left = rect.left + rect.width / 2 - pickerW / 2;
  left = Math.max(8, Math.min(left, viewW - pickerW - 8));

  dom.colorPicker.style.top  = top + "px";
  dom.colorPicker.style.left = left + "px";
}

function closeColorPicker() {
  dom.colorPicker.classList.add("hidden");
  document.querySelectorAll(".verse-block").forEach(b => b.classList.remove("selected", "range-start", "range-end"));
  state.selectedVerse = null;
  state.rangeStartVerse = null;
}

function applyHighlightColor(color) {
  if (!state.selectedVerse) return;
  const sv = state.selectedVerse;
  const book = BIBLE_BOOKS[state.bookIndex];
  const changed = [];

  if (sv.verseRange) {
    const [start, end] = sv.verseRange;
    for (let v = start; v <= end; v++) {
      const vb = dom.verseContainer.querySelector(`[data-verse="${v}"]`);
      const text = vb ? vb.querySelector(".verse-text").textContent : "";
      const entry = upsertHighlight({ bookIndex: state.bookIndex, chapter: state.chapter, verse: v, book: book.name, text, color });
      changed.push(entry);
    }
  } else {
    const entry = upsertHighlight({ bookIndex: state.bookIndex, chapter: state.chapter, verse: sv.verse, book: book.name, text: sv.text, color });
    changed.push(entry);
  }

  saveHighlights();
  refreshVerseHighlights();
  if (isSplitMode()) renderHighlights();
  closeColorPicker();
  showToast("Highlighted ✓");

  if (window.Sync) {
    changed.forEach(h => Sync.onHighlightChange(h));
  }
}

function upsertHighlight({ bookIndex, chapter, verse, book, text, color }) {
  const id = `${book.toLowerCase().replace(/\s+/g, "-")}-${chapter}-${verse}`;
  const existing = state.highlights.findIndex(h => h.id === id);
  const now = new Date().toISOString();
  const entry = {
    id,
    type: "highlight",
    reference: `${book} ${chapter}:${verse}`,
    text,
    color,
    date:      existing >= 0 ? state.highlights[existing].date : now,
    updatedAt: now,
    bookIndex,
    book,
    chapter,
    verse,
  };
  if (existing >= 0) state.highlights[existing] = entry;
  else state.highlights.push(entry);
  return entry;
}

function removeHighlight() {
  if (!state.selectedVerse) return;
  const sv = state.selectedVerse;
  const removedIds = [];

  if (sv.verseRange) {
    const [start, end] = sv.verseRange;
    state.highlights.forEach(h => {
      if (h.type !== 'note' && h.bookIndex === state.bookIndex && h.chapter === state.chapter && h.verse >= start && h.verse <= end) {
        removedIds.push(h.id);
      }
    });
    state.highlights = state.highlights.filter(h =>
      !(h.type !== 'note' && h.bookIndex === state.bookIndex && h.chapter === state.chapter && h.verse >= start && h.verse <= end)
    );
  } else {
    const target = state.highlights.find(h =>
      h.type !== 'note' && h.bookIndex === state.bookIndex && h.chapter === state.chapter && h.verse === sv.verse
    );
    if (target) removedIds.push(target.id);
    state.highlights = state.highlights.filter(h =>
      !(h.type !== 'note' && h.bookIndex === state.bookIndex && h.chapter === state.chapter && h.verse === sv.verse)
    );
  }

  saveHighlights();
  refreshVerseHighlights();
  if (isSplitMode()) renderHighlights();
  closeColorPicker();
  showToast("Highlight removed");

  if (window.Sync) {
    removedIds.forEach(id => Sync.onHighlightRemove(id));
  }
}

function refreshVerseHighlights() {
  document.querySelectorAll(".verse-block").forEach(block => {
    const verseNum = parseInt(block.dataset.verse, 10);

    // Highlight styling
    const hl = getHighlightForVerse(state.bookIndex, state.chapter, verseNum);
    if (hl) {
      block.dataset.highlight = hl.color;
      block.style.setProperty("--hl-color", hl.color);
    } else {
      delete block.dataset.highlight;
      block.style.removeProperty("--hl-color");
    }
  });
}

// -------- Notes --------
function openNoteModal(existingNote) {
  const isNew = !existingNote;
  dom.noteModalTitle.textContent = isNew ? 'New Note' : 'Edit Note';
  // title input removed
  dom.noteTextarea.value = existingNote ? existingNote.note : '';
  dom.noteBtnDelete.classList.toggle('hidden', isNew);

  state.noteContext = existingNote ? { id: existingNote.id } : null;

  dom.noteModal.classList.remove('hidden');
  setTimeout(() => dom.noteTextarea.focus(), 150);
}

function closeNoteModal() {
  dom.noteModal.classList.add('hidden');
  state.noteContext = null;
}

function saveNote() {
  const noteText = dom.noteTextarea.value.trim();
  const titleText = '';
  if (!noteText) {
    showToast('Note is empty');
    return;
  }

  const now = new Date().toISOString();
  let entry;

  if (state.noteContext && state.noteContext.id) {
    // Editing existing note
    const idx = state.highlights.findIndex(h => h.id === state.noteContext.id);
    if (idx >= 0) {
      entry = { ...state.highlights[idx], title: titleText, note: noteText, updatedAt: now };
      state.highlights[idx] = entry;
    }
  } else {
    // New note
    entry = {
      id: `note-${Date.now()}`,
      type: 'note',
      title: titleText,
      note: noteText,
      date: now,
      updatedAt: now,
    };
    state.highlights.push(entry);
  }

  saveHighlights();
  if (isSplitMode() || state.view === 'highlights') renderHighlights();
  closeNoteModal();
  showToast('Note saved ✓');
  if (entry && window.Sync) Sync.onHighlightChange(entry);
}

function deleteNote() {
  if (!state.noteContext || !state.noteContext.id) return;
  const id = state.noteContext.id;
  state.highlights = state.highlights.filter(h => h.id !== id);

  saveHighlights();
  if (isSplitMode() || state.view === 'highlights') renderHighlights();
  closeNoteModal();
  showToast('Note deleted');
  if (window.Sync) Sync.onHighlightRemove(id);
}

// -------- Navigation --------
function prevChapter() {
  if (state.chapter > 1) {
    state.chapter--;
  } else if (state.bookIndex > 0) {
    state.bookIndex--;
    state.chapter = BIBLE_BOOKS[state.bookIndex].chapters;
  } else return;
  savePosition();
  loadAndRenderChapter();
}

function nextChapter() {
  const book = BIBLE_BOOKS[state.bookIndex];
  if (state.chapter < book.chapters) {
    state.chapter++;
  } else if (state.bookIndex < BIBLE_BOOKS.length - 1) {
    state.bookIndex++;
    state.chapter = 1;
  } else return;
  savePosition();
  loadAndRenderChapter();
}

// -------- Swipe support --------
let touchStartX = 0, touchStartY = 0;

function initSwipe() {
  dom.readingView.addEventListener("touchstart", e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  dom.readingView.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
      if (dx < 0) nextChapter();
      else prevChapter();
    }
  }, { passive: true });
}

// -------- Book / Chapter modals --------
function openBookModal() {
  dom.bookModal.classList.remove("hidden");
  renderBookList();
}
function closeBookModal() { dom.bookModal.classList.add("hidden"); }

function renderBookList() {
  const body = dom.bookModal.querySelector(".modal-body");
  body.innerHTML = "";

  ["OT", "NT"].forEach(t => {
    const group = document.createElement("div");
    group.className = "testament-group";

    const label = document.createElement("div");
    label.className = "testament-label";
    label.textContent = t === "OT" ? "Old Testament" : "New Testament";
    group.appendChild(label);

    const list = document.createElement("div");
    list.className = "book-list";

    BIBLE_BOOKS.forEach((b, i) => {
      if (b.testament !== t) return;
      const item = document.createElement("div");
      item.className = "book-item" + (i === state.bookIndex ? " active" : "");
      item.textContent = b.name;
      item.addEventListener("click", () => {
        state.bookIndex = i;
        closeBookModal();
        setTimeout(() => openChapterModal(), 50);
      });
      list.appendChild(item);
    });

    group.appendChild(list);
    body.appendChild(group);
  });

  setTimeout(() => {
    const active = body.querySelector(".book-item.active");
    if (active) active.scrollIntoView({ block: "center" });
  }, 50);
}

function openChapterModal() {
  dom.chapterModal.classList.remove("hidden");
  renderChapterGrid();
}
function closeChapterModal() { dom.chapterModal.classList.add("hidden"); }

function renderChapterGrid() {
  const book = BIBLE_BOOKS[state.bookIndex];
  dom.chapterModal.querySelector(".modal-title").textContent = book.name;
  const grid = dom.chapterModal.querySelector(".chapter-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= book.chapters; i++) {
    const item = document.createElement("div");
    item.className = "ch-item" + (i === state.chapter ? " active" : "");
    item.textContent = i;
    item.addEventListener("click", () => {
      state.chapter = i;
      closeChapterModal();
      savePosition();
      loadAndRenderChapter();
    });
    grid.appendChild(item);
  }
}

// -------- Jump-to search --------
let jumpDebounce;
function handleJumpInput(e) {
  clearTimeout(jumpDebounce);
  jumpDebounce = setTimeout(() => {
    const ref = parseReference(dom.jumpInput.value);
    if (ref) {
      state.bookIndex = ref.bookIndex;
      state.chapter = ref.chapter;
      dom.jumpInput.value = "";
      dom.jumpInput.blur();
      savePosition();
      loadAndRenderChapter();
    }
  }, 400);
}

function handleJumpKeydown(e) {
  if (e.key === "Enter") {
    clearTimeout(jumpDebounce);
    const ref = parseReference(dom.jumpInput.value);
    if (ref) {
      state.bookIndex = ref.bookIndex;
      state.chapter = ref.chapter;
      dom.jumpInput.value = "";
      dom.jumpInput.blur();
      savePosition();
      loadAndRenderChapter();
    } else {
      showToast("Reference not found");
    }
  }
}

// -------- Split-mode detection --------
// Returns true only when split panel is actually open on iPad
function isSplitMode() {
  return window.innerWidth >= 768 && state.splitOpen;
}

function isIPad() {
  return window.innerWidth >= 768;
}

// -------- Split panel (iPad) --------
function toggleHighlightsPanel() {
  if (state.splitOpen) closeSplitPanel();
  else openSplitPanel();
}

function openSplitPanel() {
  state.splitOpen = true;
  state.view = 'highlights';
  dom.mainArea.classList.add('split-active');
  dom.hlView.classList.remove('hidden');
  dom.readingView.classList.remove('hidden');
  dom.botHighlights.classList.add('active');
  dom.botRead.classList.remove('active');
  dom.botSettings.classList.remove('active');
  renderHighlights();
}

function closeSplitPanel() {
  state.splitOpen = false;
  state.view = 'reading';
  dom.mainArea.classList.remove('split-active');
  dom.hlView.classList.add('hidden');
  dom.botHighlights.classList.remove('active');
  dom.botRead.classList.add('active');
}

// -------- View switching --------
function showView(name) {
  state.view = name;

  if (isIPad()) {
    // iPad mode
    if (name === 'highlights') {
      toggleHighlightsPanel();
      return;
    }

    if (name === 'settings') {
      dom.settingsView.classList.remove('hidden');
      dom.botSettings.classList.add('active');
      // Leave split state as-is
    } else {
      // reading
      dom.settingsView.classList.add('hidden');
      // Close split panel if open
      if (state.splitOpen) closeSplitPanel();
      else {
        dom.botRead.classList.add('active');
        dom.botHighlights.classList.remove('active');
        dom.botSettings.classList.remove('active');
      }
      closeColorPicker();
    }

    // Keep highlights panel current if open
    if (state.splitOpen) renderHighlights();
  } else {
    // Mobile: tab-switching behaviour
    // Ensure no lingering split-active class
    dom.mainArea.classList.remove('split-active');

    ["reading", "highlights", "settings"].forEach(v => {
      const el = $(`${v}-view`);
      if (el) el.classList.toggle("hidden", v !== name);
    });
    dom.botRead.classList.toggle("active", name === "reading");
    dom.botHighlights.classList.toggle("active", name === "highlights");
    dom.botSettings.classList.toggle("active", name === "settings");

    if (name === "highlights") renderHighlights();
    if (name === "reading") closeColorPicker();
  }
}

// -------- Highlights view --------
let hlSearchDebounce;

function renderHighlights() {
  // Show/hide sign-in prompt
  if (dom.hlSigninPrompt) {
    const signedIn = window.Sync && Sync.getCurrentUser();
    dom.hlSigninPrompt.classList.toggle("hidden", !!signedIn);
  }

  // Show/hide color filters based on type filter
  if (dom.hlColorFiltersRow) {
    dom.hlColorFiltersRow.style.display = state.hlTypeFilter === 'note' ? 'none' : 'flex';
  }

  const search = state.hlSearch.toLowerCase();
  let list = [...state.highlights];

  // Type filter
  if (state.hlTypeFilter === 'highlight') {
    list = list.filter(h => h.type !== 'note');
  } else if (state.hlTypeFilter === 'note') {
    list = list.filter(h => h.type === 'note');
  }

  // Color filter (only for highlights)
  if (state.hlFilter && state.hlTypeFilter !== 'note') {
    list = list.filter(h => h.type === 'note' || h.color === state.hlFilter);
  }

  // Search filter
  if (search) {
    list = list.filter(h =>
      (h.text      && h.text.toLowerCase().includes(search)) ||
      (h.note      && h.note.toLowerCase().includes(search)) ||
      (h.title     && h.title.toLowerCase().includes(search)) ||
      (h.reference && h.reference.toLowerCase().includes(search))
    );
  }

  dom.hlList.innerHTML = "";

  if (list.length === 0) {
    const emptyMsg = state.hlTypeFilter === 'note'
      ? "No notes yet.<br>Tap \"+ New Note\" to write your first journal entry."
      : state.hlTypeFilter === 'highlight'
      ? "No highlights yet.<br>Tap any verse to highlight it."
      : "No highlights or notes yet.<br>Tap any verse to highlight, or tap \"+ New Note\" to journal.";
    dom.hlList.innerHTML = `<div class="hl-empty"><div class="hl-empty-icon">${state.hlTypeFilter === 'note' ? '📝' : '✏️'}</div><p>${emptyMsg}</p></div>`;
    return;
  }

  if (state.hlSort === "date") renderHighlightsByDate(list);
  else renderHighlightsByBook(list);
}

function renderHighlightsByDate(list) {
  list.sort((a, b) => new Date(b.date) - new Date(a.date));
  let lastGroup = null;
  list.forEach(h => {
    const group = formatDateGroup(h.date);
    if (group !== lastGroup) {
      const header = document.createElement("div");
      header.className = "hl-date-header";
      header.textContent = group;
      dom.hlList.appendChild(header);
      lastGroup = group;
    }
    dom.hlList.appendChild(createHlCard(h));
  });
}

function renderHighlightsByBook(list) {
  list.sort((a, b) => {
    const aIsNote = a.type === 'note' && !a.bookIndex;
    const bIsNote = b.type === 'note' && !b.bookIndex;
    if (aIsNote && bIsNote) return new Date(b.date) - new Date(a.date);
    if (aIsNote) return 1;
    if (bIsNote) return -1;
    if (a.bookIndex !== b.bookIndex) return (a.bookIndex || 0) - (b.bookIndex || 0);
    if (a.chapter !== b.chapter) return (a.chapter || 0) - (b.chapter || 0);
    return (a.verse || 0) - (b.verse || 0);
  });
  let lastGroup = null;
  list.forEach(h => {
    const group = (h.type === 'note' && !h.book) ? 'Notes' : h.book;
    if (group !== lastGroup) {
      const header = document.createElement("div");
      header.className = "hl-date-header";
      header.textContent = group;
      dom.hlList.appendChild(header);
      lastGroup = group;
    }
    dom.hlList.appendChild(createHlCard(h));
  });
}

function createHlCard(h) {
  const card = document.createElement("div");
  card.className = "hl-card";

  if (h.type === 'note') {
    card.classList.add('hl-card--note');
    card.style.setProperty("--hl-color", "#64B5F6");

    const header = document.createElement("div");
    header.className = "hl-card-header";

    const icon = document.createElement("span");
    icon.className = "hl-card-icon";
    icon.textContent = "📝";

    const titleEl = document.createElement("span");
    titleEl.className = "hl-card-note-title";
    // Show first line of note text as preview, or "Note" if empty
    const firstLine = (h.note || "").split("\n")[0].substring(0, 60);
    titleEl.textContent = firstLine || "Note";

    header.appendChild(icon);
    header.appendChild(titleEl);

    const noteText = document.createElement("div");
    noteText.className = "hl-card-text hl-card-note-text";
    noteText.textContent = h.note;

    const date = document.createElement("div");
    date.className = "hl-card-date";
    date.textContent = formatDate(h.date);

    card.appendChild(header);
    card.appendChild(noteText);
    card.appendChild(date);

    card.addEventListener("click", () => {
      openNoteModal(h);
    });
  } else {
    card.style.setProperty("--hl-color", h.color);

    const ref  = document.createElement("div"); ref.className = "hl-card-ref";  ref.textContent = h.reference;
    const text = document.createElement("div"); text.className = "hl-card-text"; text.textContent = h.text;
    const date = document.createElement("div"); date.className = "hl-card-date"; date.textContent = formatDate(h.date);

    card.appendChild(ref);
    card.appendChild(text);
    card.appendChild(date);

    card.addEventListener("click", () => {
      state.bookIndex = h.bookIndex;
      state.chapter   = h.chapter;
      savePosition();
      if (isSplitMode()) {
        state.view = "reading";
        dom.botRead.classList.add("active");
        dom.botSettings.classList.remove("active");
        if (dom.settingsView) dom.settingsView.classList.add("hidden");
        loadAndRenderChapter(h.verse);
      } else {
        showView("reading");
        loadAndRenderChapter(h.verse);
      }
    });
  }

  return card;
}

function formatDateGroup(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);

  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// -------- Settings --------
function initSettings() {
  dom.fontSlider.min = 14;
  dom.fontSlider.max = 28;
  dom.fontSlider.value = state.settings.fontSize;
  dom.fontValue.textContent = state.settings.fontSize + "px";
  dom.darkToggle.checked = state.settings.darkMode;

  dom.fontSlider.addEventListener("input", () => {
    state.settings.fontSize = parseInt(dom.fontSlider.value, 10);
    dom.fontValue.textContent = state.settings.fontSize + "px";
    document.documentElement.style.setProperty("--font-size", state.settings.fontSize + "px");
    saveSettings();
  });

  dom.darkToggle.addEventListener("change", () => {
    state.settings.darkMode = dom.darkToggle.checked;
    applySettings();
    saveSettings();
  });

  dom.clearBtn.addEventListener("click", () => {
    if (confirm("Clear ALL highlights and notes? This cannot be undone.")) {
      state.highlights = [];
      saveHighlights();
      showToast("All highlights cleared");
      if (state.view === "highlights" || isSplitMode()) renderHighlights();
      if (isSplitMode()) refreshVerseHighlights();
      if (window.Sync) Sync.onAllHighlightsCleared();
    }
  });
}

// -------- Auth UI --------
function updateAuthUI(user) {
  if (!dom.accountSignedOut) return;

  if (user) {
    dom.accountSignedOut.classList.add("hidden");
    dom.accountSignedIn.classList.remove("hidden");
    dom.accountName.textContent  = user.displayName || "Signed In";
    dom.accountEmail.textContent = user.email || "";
    if (user.photoURL) {
      dom.accountPhoto.src = user.photoURL;
      dom.accountPhoto.style.display = "block";
    } else {
      dom.accountPhoto.style.display = "none";
    }
    updateSyncStatusText();
  } else {
    dom.accountSignedOut.classList.remove("hidden");
    dom.accountSignedIn.classList.add("hidden");
  }

  if (dom.hlSigninPrompt) {
    dom.hlSigninPrompt.classList.toggle("hidden", !!user);
  }
}

function updateSyncStatusText() {
  if (!dom.syncStatusText || !window.Sync) return;
  dom.syncStatusText.textContent = Sync.getLastSyncedText() || "—";
}

function initAuthUI() {
  const handleSignIn = async () => {
    try {
      await Sync.signInWithGoogle();
    } catch (err) {
      showToast("Sign-in failed: " + (err.message || err.code || "unknown error"));
    }
  };

  dom.googleSigninBtn.addEventListener("click", handleSignIn);
  if (dom.hlGoogleSignin) dom.hlGoogleSignin.addEventListener("click", handleSignIn);

  dom.googleSignoutBtn.addEventListener("click", async () => {
    await Sync.signOut();
    showToast("Signed out");
  });

  Sync.onAuthStateChange(user => {
    updateAuthUI(user);
    loadHighlights();
    if (state.view === "highlights" || isSplitMode()) renderHighlights();
    if (state.view === "reading" || isSplitMode()) refreshVerseHighlights();
  });

  Sync.onHighlightsUpdate(highlights => {
    state.highlights = highlights;
    if (state.view === "highlights" || isSplitMode()) renderHighlights();
    if (state.view === "reading" || isSplitMode()) refreshVerseHighlights();
  });

  Sync.onSyncStatus(status => {
    if (!dom.syncStatusText) return;
    if (status === 'syncing') {
      dom.syncStatusText.textContent = "Syncing…";
      dom.syncStatusText.classList.add("syncing");
    } else if (status === 'synced') {
      dom.syncStatusText.classList.remove("syncing");
      updateSyncStatusText();
    } else if (status === 'error') {
      dom.syncStatusText.classList.remove("syncing");
      dom.syncStatusText.textContent = "Sync error";
    }
  });

  setInterval(updateSyncStatusText, 30_000);
}

// -------- Toast --------
let toastTimeout;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => dom.toast.classList.remove("show"), 2000);
}

// -------- Color picker setup --------
function initColorPicker() {
  HIGHLIGHT_COLORS.forEach((c, i) => {
    const dot = dom.cpDots[i];
    if (!dot) return;
    dot.style.background = c.hex;
    dot.dataset.color = c.hex;
    dot.title = c.name;
    dot.addEventListener("click", e => { e.stopPropagation(); applyHighlightColor(c.hex); });
  });
  dom.cpRemove.addEventListener("click", e => { e.stopPropagation(); removeHighlight(); });
}

// -------- Highlight color filters --------
function initHlFilters() {
  dom.hlColorFilters.forEach(f => {
    f.addEventListener("click", () => {
      const color = f.dataset.color || null;
      if (state.hlFilter === color) { state.hlFilter = null; dom.hlColorFilters.forEach(x => x.classList.remove("active")); }
      else {
        state.hlFilter = color;
        dom.hlColorFilters.forEach(x => x.classList.remove("active"));
        f.classList.add("active");
      }
      renderHighlights();
    });
  });

  dom.hlTabDate.addEventListener("click", () => {
    state.hlSort = "date";
    dom.hlTabDate.classList.add("active");
    dom.hlTabBook.classList.remove("active");
    renderHighlights();
  });

  dom.hlTabBook.addEventListener("click", () => {
    state.hlSort = "book";
    dom.hlTabBook.classList.add("active");
    dom.hlTabDate.classList.remove("active");
    renderHighlights();
  });

  dom.hlSearch.addEventListener("input", () => {
    clearTimeout(hlSearchDebounce);
    state.hlSearch = dom.hlSearch.value;
    hlSearchDebounce = setTimeout(renderHighlights, 300);
  });

  // Type filter tabs
  document.querySelectorAll('.hl-type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.hlTypeFilter = btn.dataset.type;
      document.querySelectorAll('.hl-type-tab').forEach(b => b.classList.toggle('active', b === btn));
      // Clear color filter when switching to notes-only
      if (state.hlTypeFilter === 'note') {
        state.hlFilter = null;
        dom.hlColorFilters.forEach(x => x.classList.remove('active'));
      }
      renderHighlights();
    });
  });
}

// -------- Keyboard --------
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "ArrowLeft")  prevChapter();
  if (e.key === "ArrowRight") nextChapter();
  if (e.key === "Escape")     closeColorPicker();
});

// Close color picker on outside click
document.addEventListener("click", e => {
  if (!dom.colorPicker.classList.contains("hidden") && !dom.colorPicker.contains(e.target) && !e.target.closest(".verse-block")) {
    closeColorPicker();
  }
});

// Close modals on backdrop click
function initModalClose() {
  dom.bookModal.addEventListener("click", e => { if (e.target === dom.bookModal) closeBookModal(); });
  dom.chapterModal.addEventListener("click", e => { if (e.target === dom.chapterModal) closeChapterModal(); });
  $("book-modal-close").addEventListener("click", closeBookModal);
  $("chapter-modal-close").addEventListener("click", closeChapterModal);

  // Note modal
  dom.noteModal.addEventListener("click", e => { if (e.target === dom.noteModal) closeNoteModal(); });
  dom.noteModalClose.addEventListener("click", closeNoteModal);
  dom.noteBtnCancel.addEventListener("click", closeNoteModal);
  dom.noteBtnSave.addEventListener("click", saveNote);
  dom.noteBtnDelete.addEventListener("click", deleteNote);
}

// -------- Init --------
function init() {
  loadHighlights();
  loadSettings();
  loadPosition();
  initDom();
  applySettings();
  initColorPicker();
  initHlFilters();
  initSettings();
  initSwipe();
  initModalClose();
  initAuthUI();

  // Nav buttons
  dom.navPrev.addEventListener("click", prevChapter);
  dom.navNext.addEventListener("click", nextChapter);
  dom.navBookBtn.addEventListener("click", openBookModal);
  dom.navChapterBtn.addEventListener("click", openChapterModal);
  dom.jumpInput.addEventListener("input", handleJumpInput);
  dom.jumpInput.addEventListener("keydown", handleJumpKeydown);

  // Bottom nav
  dom.botRead.addEventListener("click", () => showView("reading"));
  dom.botHighlights.addEventListener("click", () => showView("highlights"));
  dom.botSettings.addEventListener("click", () => showView("settings"));

  // New Note buttons (panel + floating)
  if (dom.newNoteBtn) dom.newNoteBtn.addEventListener("click", () => openNoteModal(null));
  const fabNote = document.getElementById("fab-note");
  if (fabNote) fabNote.addEventListener("click", () => openNoteModal(null));

  // Split panel close button
  if (dom.hlPanelClose) dom.hlPanelClose.addEventListener("click", closeSplitPanel);

  // Build color filter dots in highlights view
  document.querySelectorAll(".hl-color-filter:not(.all-filter)").forEach((el, i) => {
    if (HIGHLIGHT_COLORS[i]) {
      el.style.background = HIGHLIGHT_COLORS[i].hex;
      el.dataset.color = HIGHLIGHT_COLORS[i].hex;
      el.title = HIGHLIGHT_COLORS[i].name;
    }
  });

  // Resize handler: re-apply view state; clean up split if resizing to mobile
  window.addEventListener("resize", () => {
    if (window.innerWidth < 768 && state.splitOpen) {
      state.splitOpen = false;
      dom.mainArea.classList.remove('split-active');
    }
    showView(state.view);
  });

  showView("reading");
  loadAndRenderChapter();
}

document.addEventListener("DOMContentLoaded", init);
