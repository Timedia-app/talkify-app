import { CONFIG, DEMO } from "./config.js";
import { SEED } from "./seed.js";

export const COLS = ["groups", "students", "payments", "prospects", "attendance", "expenses", "contacts", "settings", "events"];
export const data = Object.fromEntries(COLS.map(c => [c, []]));
let listeners = [];
export const onData = fn => listeners.push(fn);
const emit = () => listeners.forEach(fn => fn());

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------------- MODE DÉMO (localStorage) ---------------- */
const KEY = "talkify_demo_v2";
function demoLoad() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) {}
  const src = saved || clone(SEED);
  COLS.forEach(c => (data[c] = src[c] || []));
}
function demoSave() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
}

/* ---------------- MODE FIREBASE ---------------- */
let fb = null; // { db, auth, fs, au, msg }
async function loadFirebase() {
  const v = "10.12.2", base = `https://www.gstatic.com/firebasejs/${v}`;
  const [app, fs, au] = await Promise.all([
    import(`${base}/firebase-app.js`), import(`${base}/firebase-firestore.js`), import(`${base}/firebase-auth.js`)
  ]);
  const a = app.initializeApp(CONFIG.firebase);
  const db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  fb = { app: a, db, auth: au.getAuth(a), fs, au, base };
}

/* ---------------- AUTH ---------------- */
export const session = { user: null }; // { uid, name, role: 'admin'|'assistant' }

export async function initAuth(onUser) {
  if (DEMO) {
    try { session.user = JSON.parse(localStorage.getItem(KEY + "_user") || "null"); } catch (e) {}
    if (session.user) demoLoad();
    onUser(session.user);
    return;
  }
  await loadFirebase();
  fb.au.onAuthStateChanged(fb.auth, async u => {
    if (!u) { session.user = null; onUser(null); return; }
    const ref = fb.fs.doc(fb.db, "users", u.uid);
    let snap = await fb.fs.getDoc(ref);
    if (!snap.exists()) {
      // premier login : on crée la fiche avec le rôle de ce compte
      await fb.fs.setDoc(ref, { role: u.email.startsWith("admin@") ? "admin" : "assistant", email: u.email, tokens: [] });
      snap = await fb.fs.getDoc(ref);
    }
    const prof = snap.data();
    session.user = { uid: u.uid, role: prof.role || "assistant", name: ROLE_NAMES[prof.role || "assistant"] };
    subscribeAll();
    onUser(session.user);
  });
}

export const ROLE_NAMES = { admin: "Administrateur", assistant: "Responsable classe" };
export async function login(role, code) {
  if (DEMO) {
    if (code !== CONFIG.demoCodes[role]) throw new Error("BAD_CODE");
    session.user = { uid: role, name: ROLE_NAMES[role], role };
    localStorage.setItem(KEY + "_user", JSON.stringify(session.user));
    demoLoad();
    return session.user;
  }
  // chaque rôle a un compte Firebase : admin@<domaine> / classe@<domaine>, mot de passe = "talkify-" + code
  const email = (role === "admin" ? "admin" : "classe") + "@" + CONFIG.phoneDomain;
  await fb.au.signInWithEmailAndPassword(fb.auth, email, "talkify-" + code);
}

export async function logout() {
  if (DEMO) { localStorage.removeItem(KEY + "_user"); session.user = null; location.reload(); return; }
  await fb.au.signOut(fb.auth); location.reload();
}

function subscribeAll() {
  COLS.forEach(c => {
    if (["expenses", "settings", "events"].includes(c) && session.user.role !== "admin") return;
    fb.fs.onSnapshot(fb.fs.collection(fb.db, c), snap => {
      data[c] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    });
  });
}

/* ---------------- Journal d'activité (notifications de l'administrateur) ---------------- */
const nameOf = (col, id) => (data[col].find(x => x.id === id) || {}).name || "";
function describe(op, col, obj, prev) {
  const n = obj.name || (prev && prev.name) || obj.phone || "";
  if (op === "add") switch (col) {
    case "students": return ["inscription", `🎓 Nouvelle inscription : ${n}`];
    case "payments": return ["paiement", `💰 Paiement ${obj.amount} DH — ${nameOf("students", obj.studentId)} (${obj.label || obj.type})`];
    case "groups": return ["groupe", `👥 Nouveau groupe : ${n} · Prof ${obj.prof || ""}`];
    case "prospects": return ["prospect", `📞 Nouveau prospect : ${n}`];
    case "attendance": return ["presence", `✅ Appel fait : ${nameOf("groups", obj.groupId)} · ${(obj.absents || []).length} absent(s)`];
    case "contacts": return ["contact", `💬 ${obj.name} → ${obj.result}${obj.note ? " (" + obj.note + ")" : ""}`];
  }
  if (op === "update") switch (col) {
    case "students":
      if (obj.status === "parti") return ["modif", `🚪 ${n} : inscrit puis parti`];
      if (obj.groupId && prev && obj.groupId !== prev.groupId) return ["modif", `🔁 ${n} change de groupe → ${nameOf("groups", obj.groupId)}`];
      if (obj.nextDue && prev && obj.nextDue !== prev.nextDue && Object.keys(obj).length <= 3) return null; // déjà annoncé par le paiement
      if ("lastContact" in obj) return null; // déjà annoncé par le contact
      return ["modif", `✏️ Fiche modifiée : ${n}`];
    case "groups": return ["groupe", `✏️ Groupe modifié : ${n}`];
    case "prospects": return "status" in obj && prev && obj.status !== prev.status ? ["prospect", `📞 ${n} : ${prev.status} → ${obj.status}`] : null;
    case "attendance": return ["presence", `✅ Appel modifié : ${nameOf("groups", (prev || {}).groupId)}`];
  }
  if (op === "remove") return ["suppression", `🗑️ Supprimé (${col}) : ${(prev && (prev.name || prev.phone)) || ""}`];
  return null;
}
async function logEvent(op, col, obj, prev) {
  if (!session.user || session.user.role === "admin" || ["events", "settings", "expenses"].includes(col)) return;
  const d = describe(op, col, obj || {}, prev); if (!d) return;
  const ev = { type: d[0], text: d[1], by: session.user.name, at: new Date().toISOString() };
  if (DEMO) { data.events.push({ id: uid(), ...ev }); return; }
  await fb.fs.addDoc(fb.fs.collection(fb.db, "events"), ev);
}

/* ---------------- CRUD ---------------- */
const stamp = () => ({ updatedAt: new Date().toISOString(), updatedBy: session.user?.name || "" });

export async function add(col, obj) {
  const id = obj.id || uid();
  const doc = { ...obj, id, createdAt: new Date().toISOString(), ...stamp() };
  logEvent("add", col, doc);
  if (DEMO) { data[col].push(doc); demoSave(); emit(); return id; }
  const { id: _, ...rest } = doc;
  await fb.fs.setDoc(fb.fs.doc(fb.db, col, id), rest);
  return id;
}
export async function update(col, id, patch) {
  logEvent("update", col, patch, data[col].find(x => x.id === id));
  if (DEMO) {
    const it = data[col].find(x => x.id === id);
    if (it) Object.assign(it, patch, stamp());
    demoSave(); emit(); return;
  }
  await fb.fs.setDoc(fb.fs.doc(fb.db, col, id), { ...patch, ...stamp() }, { merge: true });
}
export async function remove(col, id) {
  logEvent("remove", col, null, data[col].find(x => x.id === id));
  if (DEMO) { data[col] = data[col].filter(x => x.id !== id); demoSave(); emit(); return; }
  await fb.fs.deleteDoc(fb.fs.doc(fb.db, col, id));
}
export function resetDemo() { localStorage.removeItem(KEY); demoLoad(); emit(); }

/* ---------------- NOTIFICATIONS PUSH ---------------- */
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
async function saveToken(token) {
  if (DEMO || !token) return;
  await fb.fs.setDoc(fb.fs.doc(fb.db, "users", session.user.uid), { tokens: fb.fs.arrayUnion(token) }, { merge: true });
}
export async function enablePush() {
  if (NATIVE) {
    // Application Android (APK) : notifications natives Firebase
    const { PushNotifications } = window.Capacitor.Plugins;
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== "granted") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") throw new Error("DENIED");
    return new Promise((ok, ko) => {
      PushNotifications.addListener("registration", t => saveToken(t.value).then(() => ok(t.value)));
      PushNotifications.addListener("registrationError", e => ko(new Error(e.error)));
      PushNotifications.register();
    });
  }
  if (!("Notification" in window)) throw new Error("NOT_SUPPORTED");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("DENIED");
  if (DEMO) return "demo";
  const msg = await import(`${fb.base}/firebase-messaging.js`);
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("sw.js"));
  const token = await msg.getToken(msg.getMessaging(fb.app), { vapidKey: CONFIG.vapidKey, serviceWorkerRegistration: reg });
  await saveToken(token);
  return token;
}
export async function testNotification() {
  if (NATIVE) return alertNative();
  const reg = await navigator.serviceWorker.getRegistration();
  const opts = { body: "Les notifications marchent ✅", icon: "icons/icon-192.png", badge: "icons/badge-96.png" };
  if (reg) return reg.showNotification("Talkify", opts);
  return new Notification("Talkify", opts);
}

function alertNative() { return Promise.resolve(); }
// sur Android, réactiver automatiquement les notifications à chaque ouverture
export function autoPush() { if (NATIVE && session.user) enablePush().catch(() => {}); }
