/**
 * Mizanora IPTV — Firebase client (fresh rebuild)
 * 🔒 HARDCODED in repo — project "mizanoranet". Vercel env vars ki zaroorat NAHI
 * (env sirf override karta hai).
 */
import { initializeApp } from "../vendor/firebase-sdk.js?v=2";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "../vendor/firebase-sdk.js?v=2";
import { getDatabase, ref, get, set, remove, onValue } from "../vendor/firebase-sdk.js?v=2";

export const ADMIN_EMAIL = "muaaziqbal.vip@gmail.com";

const firebaseConfig = {
  apiKey: "AIzaSyA4PWELrMHQrRA29EZzfRx1iZkXtJkKh9M",
  authDomain: "mizanoranet.firebaseapp.com",
  databaseURL: "https://mizanoranet-default-rtdb.firebaseio.com",
  projectId: "mizanoranet",
  storageBucket: "mizanoranet.firebasestorage.app",
  messagingSenderId: "1047231858393",
  appId: "1:1047231858393:web:7e9fa18b59172f806da0c8",
  measurementId: "G-8R6RGY3RLV"
};

let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);
} catch (e) {
  console.warn("Firebase init skipped:", e?.message || e);
}

export function isAdminEmail(email) {
  return String(email || "").toLowerCase() === ADMIN_EMAIL;
}

export function subscribeAuth(cb) {
  if (!auth) { setTimeout(() => cb(null), 0); return () => {}; }
  return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified, displayName: u.displayName || "" } : null));
}
export function getCurrentUserSnapshot() {
  const u = auth?.currentUser;
  return u ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified, displayName: u.displayName || "" } : null;
}
const provider = () => new GoogleAuthProvider();

export async function loginWithGoogle() {
  try {
    const r = await signInWithPopup(auth, provider());
    return { ok: true, user: { uid: r.user.uid, email: r.user.email } };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), code: e?.code || "" };
  }
}
export async function loginWithGoogleRedirect() {
  try { await signInWithRedirect(auth, provider()); return { ok: true }; }
  catch (e) { return { ok: false, error: e?.message || String(e), code: e?.code || "" }; }
}
export async function finishRedirect() {
  try {
    const r = await getRedirectResult(auth);
    return r?.user ? { ok: true, user: { uid: r.user.uid, email: r.user.email } } : { ok: false, error: "no redirect result" };
  } catch (e) { return { ok: false, error: e?.message || String(e), code: e?.code || "" }; }
}
export async function loginWithEmailPassword(email, password) {
  try {
    const r = await signInWithEmailAndPassword(auth, email, password);
    return { ok: true, user: { uid: r.user.uid, email: r.user.email } };
  } catch (e) { return { ok: false, error: e?.message || String(e), code: e?.code || "" }; }
}
export async function logoutUser() { try { await signOut(auth); } catch {} }
export async function getFirebaseIdToken() {
  const u = auth?.currentUser;
  return u ? u.getIdToken() : null;
}

/* ---------- RTDB helpers with localStorage mirror fallback ---------- */
const MIRROR_KEY = "mz_rtdb_mirror";
function mirrorRead(path) {
  try {
    const all = JSON.parse(localStorage.getItem(MIRROR_KEY) || "{}");
    return path.split("/").filter(Boolean).reduce((o, k) => (o ? o[k] : undefined), all) ?? null;
  } catch { return null; }
}
function mirrorWrite(path, value) {
  try {
    const all = JSON.parse(localStorage.getItem(MIRROR_KEY) || "{}");
    const keys = path.split("/").filter(Boolean);
    let cur = all;
    for (let i = 0; i < keys.length - 1; i++) { if (!cur[keys[i]] || typeof cur[keys[i]] !== "object") cur[keys[i]] = {}; cur = cur[keys[i]]; }
    if (value === null || value === undefined) delete cur[keys[keys.length - 1]]; else cur[keys[keys.length - 1]] = value;
    localStorage.setItem(MIRROR_KEY, JSON.stringify(all));
  } catch {}
}
export async function dbRead(path, fallback = null) {
  if (db) { try { const s = await get(ref(db, path)); return s.exists() ? s.val() : fallback; } catch { /* fall through */ } }
  return mirrorRead(path) ?? fallback;
}
export function dbWatch(path, cb) {
  if (db) { try { return onValue(ref(db, path), (s) => cb(s.exists() ? s.val() : null)); } catch {} }
  cb(mirrorRead(path));
  return () => {};
}
export async function dbWrite(path, value) {
  if (db) { try { await set(ref(db, path), value); return true; } catch {} }
  mirrorWrite(path, value);
  return true;
}
export async function dbDelete(path) {
  if (db) { try { await remove(ref(db, path)); return true; } catch {} }
  mirrorWrite(path, null);
  return true;
}
