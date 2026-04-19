// ===== KJV Reader — search.js =====
"use strict";

// -------- Bible Data Loader --------
// Fetches the full KJV Bible JSON and caches it in IndexedDB for offline use.
// Format from thiagobodruk: array of books, each with .name, .abbrev, .chapters (array of arrays of verse strings)

const BIBLE_CDN_URLS = [
  "https://cdn.jsdelivr.net/gh/thiagobodruk/bible@master/json/en_kjv.json",
  "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json",
];

const IDB_NAME    = "kjv-search-db";
const IDB_VERSION = 1;
const IDB_STORE   = "bible-data";
const IDB_KEY     = "kjv-full";

let bibleData = null; // parsed flat array: [{ book, bookIndex, chapter, verse, text }, ...]
let bibleLoading = false;
let bibleLoadCallbacks = [];

// -------- IndexedDB helpers --------
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = e => reject(e.target.error);
    });
  } catch { return null; }
}

async function idbSet(key, value) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  } catch {}
}

// -------- Parse raw KJV JSON into flat verse array --------
// Input: array of { name, abbrev, chapters: [ ["verse1text","verse2text",...], [...] ] }
// Output: [{ book, bookIndex, bookAbbrev, chapter, verse, text }, ...]
function parseBibleJson(raw) {
  const verses = [];
  raw.forEach((bookObj, bookIdx) => {
    const bookName = bookObj.name;
    bookObj.chapters.forEach((chapterArr, chIdx) => {
      const chapterNum = chIdx + 1;
      chapterArr.forEach((verseText, vIdx) => {
        const verseNum = vIdx + 1;
        verses.push({
          book:      bookName,
          bookIndex: bookIdx,
          chapter:   chapterNum,
          verse:     verseNum,
          text:      verseText,
        });
      });
    });
  });
  return verses;
}

// -------- Load Bible data (fetch + cache) --------
async function loadBibleData(onProgress) {
  if (bibleData) return bibleData;

  // Check IndexedDB cache first
  if (onProgress) onProgress("Checking cache…");
  const cached = await idbGet(IDB_KEY);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    bibleData = cached;
    return bibleData;
  }

  // Fetch from CDN
  let raw = null;
  for (const url of BIBLE_CDN_URLS) {
    try {
      if (onProgress) onProgress("Downloading Bible data…");
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (Array.isArray(json) && json.length > 0) { raw = json; break; }
    } catch (err) {
      console.warn("Bible CDN failed:", url, err);
    }
  }

  if (!raw) throw new Error("Could not download Bible data. Check your connection and try again.");

  if (onProgress) onProgress("Processing…");
  const verses = parseBibleJson(raw);

  // Cache parsed data
  if (onProgress) onProgress("Caching…");
  await idbSet(IDB_KEY, verses);

  bibleData = verses;
  return bibleData;
}

// -------- Search --------
// Returns up to maxResults matches with highlighted HTML snippets.
function searchBible(query, maxResults = 100) {
  if (!bibleData) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results = [];
  const re = new RegExp(escapeRegExp(q), "gi");

  for (let i = 0; i < bibleData.length && results.length < maxResults; i++) {
    const v = bibleData[i];
    if (v.text.toLowerCase().includes(q)) {
      results.push({
        book:      v.book,
        bookIndex: v.bookIndex,
        chapter:   v.chapter,
        verse:     v.verse,
        reference: `${v.book} ${v.chapter}:${v.verse}`,
        text:      v.text,
        highlighted: v.text.replace(re, match => `<mark class="search-hit">${match}</mark>`),
      });
    }
  }

  return results;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -------- Count total matches --------
function countBibleMatches(query) {
  if (!bibleData) return 0;
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let count = 0;
  for (const v of bibleData) {
    if (v.text.toLowerCase().includes(q)) count++;
  }
  return count;
}

// -------- Public API --------
window.BibleSearch = {
  loadBibleData,
  searchBible,
  countBibleMatches,
  isLoaded: () => bibleData !== null,
};
