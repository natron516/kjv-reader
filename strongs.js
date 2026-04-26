// ===== KJV Reader — strongs.js =====
// Strong's Concordance integration: fetch KJV+Strong's text and dictionary definitions
"use strict";

const StrongsDB = (() => {
  // ---- State ----
  let greekDict = null;
  let hebrewDict = null;
  let dictLoadState = 'idle'; // idle | loading | loaded | failed
  let dictLoadPromise = null;

  // In-memory chapter cache: "BookName:chapter" -> Map(verseNum -> tokens[])
  const chapterCache = new Map();

  // ---- IndexedDB helpers ----
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('kjv-strongs-v1', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('dicts'))    db.createObjectStore('dicts');
        if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters');
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  function idbGet(db, store, key) {
    return new Promise(resolve => {
      try {
        const tx  = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  function idbPut(db, store, key, value) {
    return new Promise(resolve => {
      try {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror    = () => resolve(false);
      } catch { resolve(false); }
    });
  }

  // ---- Dictionary loading ----
  async function loadDicts() {
    if (dictLoadState === 'loaded')  return true;
    if (dictLoadState === 'loading') return dictLoadPromise;
    if (dictLoadState === 'failed')  return false;

    dictLoadState   = 'loading';
    dictLoadPromise = _doLoadDicts().then(ok => {
      dictLoadState = ok ? 'loaded' : 'failed';
      return ok;
    });
    return dictLoadPromise;
  }

  async function _doLoadDicts() {
    // 1. Try IndexedDB cache
    try {
      const db     = await openDB();
      const cached = await idbGet(db, 'dicts', 'strongs-dicts');
      if (cached && cached.greek && cached.hebrew) {
        greekDict  = cached.greek;
        hebrewDict = cached.hebrew;
        return true;
      }
    } catch {}

    // 2. Fetch from openscriptures via raw GitHub
    const [greek, hebrew] = await Promise.all([
      fetchDictJS('greek'),
      fetchDictJS('hebrew'),
    ]);

    if (!greek || !hebrew) return false;

    greekDict  = greek;
    hebrewDict = hebrew;

    try {
      const db = await openDB();
      await idbPut(db, 'dicts', 'strongs-dicts', { greek, hebrew });
    } catch {}

    return true;
  }

  async function fetchDictJS(lang) {
    const url = `https://raw.githubusercontent.com/openscriptures/strongs/master/${lang}/strongs-${lang}-dictionary.js`;
    try {
      const ctrl    = new AbortController();
      const timer   = setTimeout(() => ctrl.abort(), 20000);
      const resp    = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return null;

      const text  = await resp.text();
      // File starts with a comment block then: var strongsXxxDictionary = {...};
      // Extract the JSON object
      // File may end with: }; module.exports = ...; — strip that first
      const cleaned = text.replace(/module\.exports\s*=\s*[^;]*;?\s*$/, '');
      const match = cleaned.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (!match) return null;
      return JSON.parse(match[1]);
    } catch { return null; }
  }

  // ---- Definition lookup ----
  function getDefinition(strongsNum) {
    if (!strongsNum || strongsNum.length < 2) return null;
    const prefix = strongsNum[0]; // 'G' or 'H'
    const num    = parseInt(strongsNum.slice(1), 10);
    if (isNaN(num)) return null;

    const dict = prefix === 'G' ? greekDict : (prefix === 'H' ? hebrewDict : null);
    if (!dict) return null;

    // Keys in openscriptures dicts are like "G25", "H430" etc.
    const candidates = [
      strongsNum,                                        // G25
      `${prefix}${num}`,                                 // G25 (normalized)
      `${prefix}${String(num).padStart(4, '0')}`,        // G0025
      `${prefix}${String(num).padStart(5, '0')}`,        // G00025
      String(num),                                       // 25
    ];

    for (const k of candidates) {
      if (dict[k]) return { ...dict[k], strongsNum };
    }
    return null;
  }

  // ---- Chapter fetching with Strong's ----
  async function fetchChapterWithStrongs(bookName, bookIndex, chapter) {
    const cacheKey = `${bookName}:${chapter}`;

    // Memory cache
    if (chapterCache.has(cacheKey)) return chapterCache.get(cacheKey);

    // IDB cache
    try {
      const db     = await openDB();
      const cached = await idbGet(db, 'chapters', cacheKey);
      if (cached) {
        chapterCache.set(cacheKey, cached);
        return cached;
      }
    } catch {}

    // bolls.life API: book number is 1-based (bookIndex + 1)
    const bollsBook = bookIndex + 1;
    const url       = `https://bolls.life/get-chapter/KJV/${bollsBook}/${chapter}/`;

    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const resp  = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);

      if (!resp.ok) return null;
      const data = await resp.json();
      if (!Array.isArray(data) || data.length === 0) return null;

      // Determine testament for Strong's prefix
      const testament = (typeof BIBLE_BOOKS !== 'undefined' && BIBLE_BOOKS[bookIndex])
        ? BIBLE_BOOKS[bookIndex].testament
        : (bookIndex < 39 ? 'OT' : 'NT');

      const verseMap = new Map();
      data.forEach(v => {
        if (!v.verse || !v.text) return;
        const tokens = parseVerseBolls(v.text, testament);
        if (tokens.length > 0) verseMap.set(v.verse, tokens);
      });

      if (verseMap.size === 0) return null;

      chapterCache.set(cacheKey, verseMap);
      try {
        const db = await openDB();
        // Store as array for IDB serialization
        const arr = [...verseMap.entries()];
        await idbPut(db, 'chapters', cacheKey, arr);
      } catch {}

      return verseMap;
    } catch (e) {
      console.warn('[StrongsDB] fetch failed:', e.message);
      return null;
    }
  }

  // Load verse map from IDB (converts array back to Map)
  async function _loadFromIDB(cacheKey) {
    try {
      const db  = await openDB();
      const arr = await idbGet(db, 'chapters', cacheKey);
      if (arr && Array.isArray(arr)) return new Map(arr);
    } catch {}
    return null;
  }

  // ---- Text parsing (bolls.life format) ----
  // bolls.life text: "In the beginning<S>7225</S> God<S>430</S>..."
  // Text BEFORE each <S>number</S> is the English translation of that Strong's number
  function parseVerseBolls(rawText, testament) {
    const prefix = testament === 'NT' ? 'G' : 'H';
    // Split on <S>digits</S> keeping the digit captures
    const parts  = rawText.split(/<S>(\d+)<\/S>/);
    // parts = [text, num, text, num, ..., trailing]

    const tokens = [];

    for (let i = 0; i < parts.length; i += 2) {
      const textSeg   = parts[i];          // English text for this Strong's
      const strongsRaw = parts[i + 1];    // Strong's number (may be undefined for last)
      const strongsNum = strongsRaw ? prefix + strongsRaw : null;

      if (!textSeg && !strongsNum) continue;

      // Split text segment into word + whitespace tokens
      const wordRe = /(\s+)|([^\s]+)/g;
      let m;
      while ((m = wordRe.exec(textSeg)) !== null) {
        if (m[1]) {
          // Whitespace — no Strong's
          tokens.push({ text: m[1], strongs: null });
        } else {
          // Word (may include attached punctuation like commas, periods)
          tokens.push({ text: m[2], strongs: strongsNum });
        }
      }
    }

    return tokens;
  }

  // ---- Blue Letter Bible URL ----
  function blbUrl(strongsNum) {
    if (!strongsNum) return null;
    const prefix = strongsNum[0].toLowerCase();
    const num    = parseInt(strongsNum.slice(1), 10);
    return `https://www.blueletterbible.org/lexicon/${prefix}${String(num).padStart(4, '0')}/kjv/`;
  }

  // ---- Public API ----
  return {
    loadDicts,
    getDefinition,
    fetchChapterWithStrongs,
    blbUrl,
    isDictLoaded:  () => dictLoadState === 'loaded',
    getDictState:  () => dictLoadState,
  };
})();
