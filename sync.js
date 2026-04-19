// ===== KJV Reader — sync.js =====
// Firebase Auth + Firestore highlight sync
"use strict";

const firebaseConfig = {
  apiKey: "AIzaSyB42Tkvezfl5Bgu6ZHgb6rdk0bEwzQVg-0",
  authDomain: "kjv-reader-app.firebaseapp.com",
  projectId: "kjv-reader-app",
  storageBucket: "kjv-reader-app.firebasestorage.app",
  messagingSenderId: "448473689710",
  appId: "1:448473689710:web:c6d1e42c2bc171214fc07f"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// Enable offline persistence (Firestore queues writes when offline)
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('[Sync] Persistence: multiple tabs open — disabled');
  } else if (err.code === 'unimplemented') {
    console.warn('[Sync] Persistence: not supported in this browser');
  }
});

// -------- Internal state --------
let currentUser          = null;
let unsubscribeSnapshot  = null;
let lastSyncedAt         = null;
let _syncStatusCb        = null;   // (status: string) => void
let _highlightsUpdateCb  = null;   // (highlights: array) => void
let _authChangeCb        = null;   // (user | null) => void

const LS_KEY = 'kjv-highlights';

// -------- Helpers --------
function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function hlRef(uid) {
  return db.collection('users').doc(uid).collection('highlights');
}

function setSyncStatus(s) {
  if (_syncStatusCb) _syncStatusCb(s);
}

function notifyHighlightsUpdate(arr) {
  if (_highlightsUpdateCb) _highlightsUpdateCb(arr);
}

function localHighlights() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch { return []; }
}

function saveLocal(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

// Normalise an updatedAt field to an ISO string for comparison
function toISO(val) {
  if (!val) return null;
  if (val && typeof val.toDate === 'function') return val.toDate().toISOString();
  return val;
}

// -------- Sync operations --------

/** Push all localStorage highlights up to Firestore. */
async function syncUpload(uid) {
  setSyncStatus('syncing');
  const local = localHighlights();
  const batch = db.batch();
  local.forEach(h => {
    batch.set(hlRef(uid).doc(h.id), {
      ...h,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
  lastSyncedAt = new Date();
  setSyncStatus('synced');
}

/** Pull all Firestore highlights down, replacing localStorage. */
async function syncDownload(uid) {
  setSyncStatus('syncing');
  const snap = await hlRef(uid).get();
  const remote = [];
  snap.forEach(doc => {
    const d = doc.data();
    remote.push({ ...d, id: doc.id, updatedAt: toISO(d.updatedAt) || d.date });
  });
  saveLocal(remote);
  lastSyncedAt = new Date();
  setSyncStatus('synced');
  notifyHighlightsUpdate(remote);
  return remote;
}

/**
 * Bidirectional merge: keep highlights from both sources,
 * deduplicate by ID, newest updatedAt wins.
 */
async function syncMerge(uid) {
  setSyncStatus('syncing');
  try {
    const local  = localHighlights();
    const snap   = await hlRef(uid).get();
    const remote = [];
    snap.forEach(doc => {
      const d = doc.data();
      remote.push({ ...d, id: doc.id, updatedAt: toISO(d.updatedAt) || d.date });
    });

    // Build merged map — newest updatedAt wins
    const merged = {};
    local.forEach(h => {
      merged[h.id] = { ...h, updatedAt: h.updatedAt || h.date };
    });
    remote.forEach(h => {
      const existing  = merged[h.id];
      const remoteTs  = new Date(h.updatedAt  || h.date || 0).getTime();
      const localTs   = existing ? new Date(existing.updatedAt || existing.date || 0).getTime() : 0;
      if (!existing || remoteTs >= localTs) {
        merged[h.id] = h;
      }
    });

    const mergedArr = Object.values(merged);
    saveLocal(mergedArr);

    // Push merged set back to Firestore
    const batch = db.batch();
    mergedArr.forEach(h => {
      batch.set(hlRef(uid).doc(h.id), {
        ...h,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    lastSyncedAt = new Date();
    setSyncStatus('synced');
    notifyHighlightsUpdate(mergedArr);
    return mergedArr;
  } catch (err) {
    console.error('[Sync] Merge error:', err);
    setSyncStatus('error');
    throw err;
  }
}

// -------- Real-time listener --------
function startRealtimeSync(uid) {
  if (unsubscribeSnapshot) unsubscribeSnapshot();

  unsubscribeSnapshot = hlRef(uid).onSnapshot(snap => {
    // Ignore purely local (pending) writes to avoid feedback loops
    if (snap.metadata.hasPendingWrites) return;

    const remote = [];
    snap.forEach(doc => {
      const d = doc.data();
      remote.push({ ...d, id: doc.id, updatedAt: toISO(d.updatedAt) || d.date });
    });

    // Merge incoming remote changes with current local state
    const local  = localHighlights();
    const merged = {};
    local.forEach(h  => merged[h.id]  = h);
    remote.forEach(h => {
      const existing = merged[h.id];
      const remoteTs = new Date(h.updatedAt || h.date || 0).getTime();
      const localTs  = existing ? new Date(existing.updatedAt || existing.date || 0).getTime() : 0;
      if (!existing || remoteTs >= localTs) merged[h.id] = h;
    });

    const mergedArr = Object.values(merged);
    saveLocal(mergedArr);
    lastSyncedAt = new Date();
    setSyncStatus('synced');
    notifyHighlightsUpdate(mergedArr);
  }, err => {
    console.error('[Sync] Snapshot error:', err);
  });
}

// -------- Per-highlight write-through --------

/** Called when a highlight is added or updated locally. Writes to Firestore. */
async function onHighlightChange(highlight) {
  if (!currentUser) return;
  try {
    await hlRef(currentUser.uid).doc(highlight.id).set({
      ...highlight,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Firestore offline persistence will queue and retry automatically
    console.warn('[Sync] onHighlightChange queued (offline?):', err.code);
  }
}

/** Called when a single highlight is removed locally. Deletes from Firestore. */
async function onHighlightRemove(highlightId) {
  if (!currentUser) return;
  try {
    await hlRef(currentUser.uid).doc(highlightId).delete();
  } catch (err) {
    console.warn('[Sync] onHighlightRemove queued (offline?):', err.code);
  }
}

/** Called when all highlights are cleared locally. Deletes entire collection. */
async function onAllHighlightsCleared() {
  if (!currentUser) return;
  try {
    const snap  = await hlRef(currentUser.uid).get();
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (err) {
    console.warn('[Sync] onAllHighlightsCleared queued (offline?):', err.code);
  }
}

// -------- Auth --------
async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  if (isMobile()) {
    await auth.signInWithRedirect(provider);
    // Page will reload; redirect result handled on next load below
  } else {
    await auth.signInWithPopup(provider);
  }
}

async function signOut() {
  if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  await auth.signOut();
}

// Handle mobile redirect sign-in result
auth.getRedirectResult().catch(err => {
  if (err.code && err.code !== 'auth/no-redirect-operation') {
    console.error('[Sync] Redirect result error:', err);
  }
});

// Auth state listener — runs on every page load
auth.onAuthStateChanged(async user => {
  currentUser = user;

  if (user) {
    startRealtimeSync(user.uid);
    try {
      await syncMerge(user.uid);
    } catch (err) {
      console.warn('[Sync] Initial merge failed:', err);
      setSyncStatus('error');
    }
  } else {
    if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
    setSyncStatus('signed-out');
  }

  if (_authChangeCb) _authChangeCb(user);
});

// -------- Sync status text helper --------
function getLastSyncedText() {
  if (!currentUser)   return '';
  if (!lastSyncedAt)  return 'Not synced yet';
  const diff = Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000);
  if (diff < 10)   return 'Synced just now';
  if (diff < 60)   return `Synced ${diff}s ago`;
  if (diff < 3600) return `Synced ${Math.floor(diff / 60)}m ago`;
  return `Synced ${Math.floor(diff / 3600)}h ago`;
}

// -------- Public API --------
window.Sync = {
  signInWithGoogle,
  signOut,
  syncMerge,
  syncUpload,
  syncDownload,
  onHighlightChange,
  onHighlightRemove,
  onAllHighlightsCleared,
  getLastSyncedText,
  getCurrentUser: () => currentUser,
  // Register callbacks
  onAuthStateChange:    cb => { _authChangeCb        = cb; },
  onSyncStatus:         cb => { _syncStatusCb        = cb; },
  onHighlightsUpdate:   cb => { _highlightsUpdateCb  = cb; },
};
