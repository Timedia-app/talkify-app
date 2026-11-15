import { CONFIG, DEMO } from "./config.js";
import { ic } from "./icons.js";
import { data, onData, session, initAuth, login, logout, add, update, remove, resetDemo, enablePush, testNotification, ROLE_NAMES, autoPush } from "./store.js";
import { todayISO, addMonths, addDays, payStatus, isOut, dailySummary, waLink, fmtDate, fmtDH, absenceStreaks, monthEnd, toCollect, monthCharges, dayReport, DEFAULT_CHARGES, primeFor, inscriptionsOf, weekStart, periodReport } from "./logic.js";
const charges = () => ({ ...DEFAULT_CHARGES, ...(data.settings.find(x => x.id === "charges") || {}) });

const $ = s => document.querySelector(s);
/* ---------- Application Android (Capacitor) ---------- */
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const P = NATIVE ? window.Capacitor.Plugins : {};
// Enregistre un fichier sur le téléphone puis l'ouvre (lecteur PDF) ou propose de le partager
async function saveNativeFile(name, base64, mime) {
  const w = await P.Filesystem.writeFile({ path: name, data: base64, directory: "DOCUMENTS", recursive: true })
    .catch(() => P.Filesystem.writeFile({ path: name, data: base64, directory: "CACHE" }));
  try { await P.FileOpener.open({ filePath: w.uri, contentType: mime, openWithDefault: true }); }
  catch (e) { await P.Share.share({ title: name, url: w.uri, dialogTitle: "Ouvrir / partager" }); }
}
async function nativeNotify(title, body) {
  if (!NATIVE || !P.LocalNotifications) return;
  try {
    let perm = await P.LocalNotifications.checkPermissions();
    if (perm.display !== "granted") perm = await P.LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return;
    await P.LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title, body }] });
  } catch (e) {}
}
// Bouton / geste « retour » d'Android : ferme la fenêtre ouverte, sinon revient à l'accueil, sinon met l'app en arrière-plan
if (NATIVE && P.App) P.App.addListener("backButton", () => {
  const sheets = document.querySelectorAll(".sheet-bg");
  if (sheets.length) { sheets[sheets.length - 1].remove(); return; }
  if (typeof state !== "undefined" && state.tab !== "home") { go("home"); return; }
  P.App.minimizeApp();
});
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = n => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const isAdmin = () => session.user?.role === "admin";
const groupName = id => data.groups.find(g => g.id === id)?.name || "Sans groupe";
const studentById = id => data.students.find(s => s.id === id);
const TODAY = () => todayISO();

const state = { open: "", tab: "home", stuFilter: "tous", stuGroup: "", q: "", pq: "", pFilter: "actifs", attGroup: "", attDate: todayISO(), attDraft: null };

function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2300);
}

/* ======================= BOOT ======================= */

function showLogin() {
  let role = null, code = "";
  const draw = () => {
    $("#app").innerHTML = `
    <div class="login">
      <img src="icons/logo-header.png" alt="Talkify" class="lg-logo">
      <div class="card">
        ${DEMO ? `<span class="demo-badge">Version démo · code Admin ${CONFIG.demoCodes.admin} · code Classe ${CONFIG.demoCodes.assistant}</span>` : ""}
        ${!role ? `
          <h2>Connexion</h2><p class="sub">Choisis ton espace</p>
          <button class="rolebtn" data-r="admin"><span class="rb-ic">${ic("shield", 22)}</span><div><b>Administrateur</b><small>Tout le centre, finances et charges</small></div><span class="chev">${ic("chev", 18)}</span></button>
          <button class="rolebtn y" data-r="assistant"><span class="rb-ic">${ic("clipboard", 22)}</span><div><b>Responsable classe</b><small>Élèves, paiements, présence, Relances</small></div><span class="chev">${ic("chev", 18)}</span></button>`
        : `
          <button class="back" id="lgBack">← ${role === "admin" ? "Administrateur" : "Responsable classe"}</button>
          <p class="sub" style="text-align:center;margin-top:6px">Entre ton code à 4 chiffres</p>
          <div class="pin">${[0, 1, 2, 3].map(i => `<i class="${i < code.length ? "on" : ""}"></i>`).join("")}</div>
          <p id="lgErr" class="err"></p>
          <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map(k => k === "" ? "<span></span>" : `<button data-k="${k}">${k}</button>`).join("")}</div>`}
      </div>
    </div>`;
    document.querySelectorAll(".rolebtn").forEach(b => b.onclick = () => { role = b.dataset.r; code = ""; draw(); });
    const bk = $("#lgBack"); if (bk) bk.onclick = () => { role = null; draw(); };
    document.querySelectorAll(".pad button").forEach(b => b.onclick = async () => {
      const k = b.dataset.k;
      if (k === "⌫") code = code.slice(0, -1); else if (code.length < 4) code += k;
      draw();
      if (code.length === 4) {
        try { await login(role, code); if (DEMO) startApp(); }
        catch (e) { code = ""; draw(); $("#lgErr").textContent = "Code incorrect"; }
      }
    });
  };
  draw();
}

function startApp() {
  const tabs = [["home", "home", "Accueil"], ["students", "users", "Élèves"], ["groups", "book", "Groupes"], ["prospects", "phone", "Prospects"],
    isAdmin() ? ["finance", "chart", "Finances"] : ["attendance", "check", "Présence"]];
  $("#app").innerHTML = `
    <header class="top">
      <img src="icons/logo-header.png" alt="">
      <div class="t"><b id="hdTitle">Accueil</b><small>${ROLE_NAMES[session.user.role]}${DEMO ? " · démo" : ""}</small></div>
      ${isAdmin() ? `<button class="iconbtn bell" id="hdBell" aria-label="Activité">${ic("bell", 20)}<span class="bdot hidden" id="bellDot"></span></button>` : ""}
      <button class="iconbtn" id="hdMore" aria-label="Réglages">${ic("settings", 20)}</button>
    </header>
    <main id="view"></main>
    <button class="fab hidden" id="fab">${ic("plus", 26, 2.4)}</button>
    <nav class="tabs" id="tabs">
      ${tabs.map(([k, i, l], idx) => (idx === 2 ? `<button class="tab-plus" id="tabPlus"><span class="tp">${ic("plus", 28, 2.6)}</span>Inscription</button>` : "") + `<button data-tab="${k}">${ic(i, 22)}${l}<span class="dot hidden" id="dot-${k}"></span></button>`).join("")}
    </nav>`;
  $("#tabs").onclick = e => { const b = e.target.closest("button"); if (!b) return; if (b.id === "tabPlus") return studentForm(); go(b.dataset.tab); };
  $("#hdMore").onclick = () => go("more");
  if (isAdmin()) { $("#hdBell").onclick = activitySheet; watchEvents(); }
  onData(render);
  render();
  autoPush();
}

/* ---------- Activité de la responsable (admin) ---------- */
const SEEN_KEY = "talkify_seen_events";
const seenAt = () => { try { return localStorage.getItem(SEEN_KEY) || ""; } catch (e) { return ""; } };
let lastNotified = new Date().toISOString();
function watchEvents() {
  onData(() => {
    const evs = data.events || [], unread = evs.filter(e => e.at > seenAt()).length, dot = $("#bellDot");
    if (dot) { dot.textContent = unread; dot.classList.toggle("hidden", !unread); }
    // notification immédiate quand l'app est ouverte (en arrière-plan le serveur envoie le push)
    const fresh = evs.filter(e => e.at > lastNotified);
    if (fresh.length && NATIVE) fresh.forEach(e => nativeNotify("Talkify · " + e.by, e.text));
    else if (fresh.length && "Notification" in window && Notification.permission === "granted") {
      navigator.serviceWorker?.getRegistration().then(reg => fresh.forEach(e => (reg ? reg.showNotification("Talkify · " + e.by, { body: e.text, icon: "icons/icon-192.png", tag: e.at }) : new Notification("Talkify", { body: e.text }))));
    }
    if (fresh.length) lastNotified = fresh.map(e => e.at).sort().pop();
  });
}
function activitySheet() {
  const evs = (data.events || []).slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
  const days = [...new Set(evs.map(e => e.at.slice(0, 10)))];
  const seen = seenAt();
  sheet(`<h2>Activité de la responsable</h2><div class="sub">Tout ce qui est fait dans l'app, en direct</div>
    ${days.map(d => `<h3 class="sec">${d === TODAY() ? "Aujourd'hui" : fmtDate(d)} <span class="count">${evs.filter(e => e.at.startsWith(d)).length}</span></h3>
      <div class="list">${evs.filter(e => e.at.startsWith(d)).map(e => `<div class="item ev ${e.at > seen ? "new" : ""}" style="cursor:default"><div class="mid"><div class="nm" style="white-space:normal">${esc(e.text)}</div><div class="meta">${e.at.slice(11, 16)} · ${esc(e.by)}</div></div></div>`).join("")}</div>`).join("") || `<div class="empty">Rien pour le moment.<br>Chaque inscription, paiement, groupe ou modification de la responsable apparaîtra ici.</div>`}`);
  try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch (e) {}
  const dot = $("#bellDot"); if (dot) dot.classList.add("hidden");
}

function go(tab) { state.tab = tab; window.scrollTo(0, 0); render(); }

function render() {
  if (!$("#view")) return;
  document.querySelectorAll("#tabs button[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === state.tab));
  const titles = { home: "Accueil", students: "Élèves", attendance: "Présence", prospects: "Prospects", more: "Réglages", finance: "Finances", groups: "Groupes" };
  $("#hdTitle").textContent = titles[state.tab];
  const sum = dailySummary(data, CONFIG);
  setDot("home", sum.late.length + sum.dueToday.length); setDot("prospects", sum.follow.length);
  const fab = $("#fab");
  fab.classList.toggle("hidden", state.tab !== "prospects");
  fab.onclick = () => state.tab === "students" ? studentForm() : prospectForm();
  ({ home: viewHome, students: viewStudents, attendance: viewAttendance, prospects: viewProspects, more: viewMore, finance: viewFinance, groups: viewGroups })[state.tab](sum);
}
function setDot(tab, n) { const d = $("#dot-" + tab); if (!d) return; d.textContent = n; d.classList.toggle("hidden", !n); }

/* ======================= ACCUEIL ======================= */
const doneToday = s => s.lastContact === TODAY() || data.payments.some(p => p.studentId === s.id && p.date === TODAY());
function mission(n, icon, title, sub, badge, rows, total, key, hot) {
  const shown = state.open === key ? rows : rows.slice(0, 4);
  return `<div class="mission ${hot ? "hot" : ""}">
    <div class="mh"><span class="num">${n}</span><div class="t"><b>${title}</b><small>${sub}</small></div>${badge ? `<span class="badge">${badge}</span>` : ""}</div>
    ${rows.length ? shown.join("") : `<div class="none">✓ Rien à faire ici aujourd'hui</div>`}
    ${rows.length > 4 ? `<button class="more" data-open="${key}">${state.open === key ? "Réduire" : `Voir les ${rows.length}`}</button>` : ""}
  </div>`;
}
function dayTasks(sum) {
  const listed = [...sum.late, ...sum.dueToday, ...sum.soon];
  // élèves qui ont payé aujourd'hui (ils sortent de la liste, mais la tâche compte comme faite)
  const paidIds = new Set(data.payments.filter(p => p.date === TODAY() && p.type === "mensuel").map(p => p.studentId));
  const extraPaid = data.students.filter(s => paidIds.has(s.id) && !listed.some(x => x.s.id === s.id)).map(s => ({ s, st: { key: "ok", label: "Payé aujourd'hui" } }));
  const pay = [...listed, ...extraPaid].sort((a, b) => doneToday(a.s) - doneToday(b.s));
  const regIds = new Set(data.payments.filter(p => p.date === TODAY() && p.type === "reste").map(p => p.studentId));
  const regs = [...sum.balances, ...data.students.filter(s => regIds.has(s.id) && !sum.balances.includes(s))].sort((a, b) => doneToday(a) - doneToday(b));
  const pros = [...sum.follow, ...data.prospects.filter(p => p.lastContact === TODAY() && !sum.follow.includes(p))];
  const abs = sum.absences;
  const d = {
    pay: pay.filter(x => doneToday(x.s)).length, regs: regs.filter(doneToday).length,
    pros: pros.filter(p => p.lastContact === TODAY()).length, abs: abs.filter(a => doneToday(a.student)).length
  };
  const total = pay.length + regs.length + pros.length + abs.length, done = d.pay + d.regs + d.pros + d.abs;
  return { pay, regs, pros, abs, d, total, done, pct: total ? Math.round(done / total * 100) : 100 };
}
function viewHome(sum) {
  if (isAdmin()) return viewAdminHome(sum);
  const h = new Date().getHours();
  const hello = h < 12 ? "Sbah lkhir" : h < 18 ? "Salam" : "Mssa lkhir";
  const col = toCollect(data), r = dayReport(data), T = dayTasks(sum);
  const missing = [...sum.missing.map(x => x.s), ...data.students.filter(s => s.status === "à vérifier")];
  const free = data.groups.reduce((t, g) => t + Math.max(0, (Number(g.capacity) || 12) - data.students.filter(s => s.groupId === g.id && s.status === "actif").length), 0);
  const box = (key, cls, icon, title, n, amount, sub, done, tot) => `
    <button class="case ${cls} ${tot && done === tot ? "ok" : ""}" data-case="${key}">
      <span class="c-row"><span class="c-ic">${ic(icon, 18)}</span><span class="c-n">${n}</span></span>
      <span class="c-t">${title}</span>
      ${amount ? `<span class="c-a">${amount}</span>` : `<span class="c-s">${sub}</span>`}
      <span class="c-foot"><span>${tot ? (done === tot ? "✓ Terminé" : done + "/" + tot + " faits") : "&nbsp;"}</span><span class="c-go">Voir ${ic("chev", 14, 2.6)}</span></span>
    </button>`;
  // du plus urgent au moins urgent ; les cases vides passent à la fin
  const cases = [
    { n: T.pay.length, html: box("pay", sum.late.length ? "k-red" : "k-teal", "wallet", "Paiements à encaisser", T.pay.length, T.pay.length ? fmtDH(sum.lateAmount + sum.todayAmount + sum.soonAmount) : "", "Rien à encaisser", T.d.pay, T.pay.length) },
    { n: T.abs.length, html: box("abs", T.abs.length ? "k-orange" : "k-soft", "userX", "Absences à suivre", T.abs.length, "", `${CONFIG.absenceAlert} absences de suite`, T.d.abs, T.abs.length) },
    { n: T.regs.length, html: box("regs", "k-dark", "file", "Restes d'inscription", T.regs.length, T.regs.length ? fmtDH(sum.balanceAmount) : "", "Tout est payé", T.d.regs, T.regs.length) },
    { n: T.pros.length, html: box("pros", "k-yel", "msg", "Prospects à relancer", T.pros.length, "", "Message WhatsApp", T.d.pros, T.pros.length) },
    { n: missing.length, html: box("missing", missing.length ? "k-rsoft" : "k-soft", "edit", "Infos à compléter", missing.length, "", "dates, à vérifier", 0, 0) },
    { n: free, html: box("groups", "k-ysoft", "users", "Places libres", free, "", "dans les groupes", 0, 0) }
  ];
  const casesHtml = [...cases.filter(c => c.n), ...cases.filter(c => !c.n)].map(c => c.html).join("");

  $("#view").innerHTML = `
    <div class="day">
      <div class="hi">${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div>
      <h2>${hello} 👋</h2>
      <div class="prog"><span>Tâches du jour</span><span><b>${T.done}/${T.total}</b> faites</span></div>
      <div class="bar"><i style="width:${T.pct}%"></i></div>
      <div class="money m2">
        <div data-jump="month" class="wide"><small>À récupérer ce mois</small><b>${fmtDH(col.total)}</b></div>
        <div data-jump="month"><small>Mensualités</small><b>${fmtDH(col.mAmt)}</b></div>
        <div data-jump="reste"><small>Restes d'inscription</small><b>${fmtDH(col.rAmt)}</b></div>
      </div>
    </div>

    <button class="bigplus" id="homePlus"><span class="bp-ic">${ic("userPlus", 24)}</span><span class="mid"><b>Nouvelle inscription</b><small>Remplir la fiche d'un nouvel élève</small></span>${ic("plus", 22, 2.6)}</button>

    <button class="reportbtn" id="openReport"><span class="c-ic">${ic("file", 20)}</span><span class="mid"><b>Mon rapport</b><small>Jour, semaine ou mois · à télécharger en PDF</small></span>${ic("chev", 18)}</button>

    <h3 class="sec">Mes tâches <span class="count">touche une case</span></h3>
    <div class="cases">
      ${casesHtml}
    </div>

    <h3 class="sec">📝 Rapport du jour <button class="link" id="openJournal">Journal ${ic("chev", 16)}</button></h3>
    <div class="rep">
      <div><b>${r.ins.length}</b><small>Inscriptions</small></div>
      <div><b>${r.pays.length}</b><small>Paiements</small></div>
      <div><b>${r.contacts.length}</b><small>Contacts</small></div>
      <div><b>${r.answered}</b><small>Ont répondu</small></div>
      <div><b>${r.noAnswer}</b><small>Sans réponse</small></div>
      <div><b>${r.newProspects}</b><small>Nouveaux prospects</small></div>
    </div>
  `;
  $("#openJournal").onclick = journalSheet;
  $("#view").querySelectorAll("[data-case]").forEach(c => c.onclick = () => caseSheet(c.dataset.case));
  $("#openReport").onclick = () => reportSheet("day");
  $("#homePlus").onclick = () => studentForm();
  $("#view").querySelectorAll("[data-jump]").forEach(k => k.onclick = () => { state.stuFilter = k.dataset.jump; state.stuGroup = ""; go("students"); });
}

function primeSheet() {
  const c = charges(), m0 = TODAY().slice(0, 7) + "-01";
  const ins = inscriptionsOf(data, c, m0, TODAY()).sort((a, b) => a.regDate.localeCompare(b.regDate) || (a.createdAt || "").localeCompare(b.createdAt || ""));
  const n = ins.length, wk = weekStart();
  const days = [...new Set(ins.map(s => s.regDate))].sort().reverse();
  sheet(`<h2>Mes inscriptions</h2><div class="sub">${new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}${c.primeAdsOnly ? " · inscriptions venues des Ads" : ""}</div>
    <div class="rep" style="margin-top:14px;box-shadow:none;border:1px solid var(--line)">
      <div><b>${inscriptionsOf(data, c, TODAY(), TODAY()).length}</b><small>Aujourd'hui</small></div>
      <div><b>${inscriptionsOf(data, c, wk, TODAY()).length}</b><small>Cette semaine</small></div>
      <div><b>${n}</b><small>Ce mois</small></div>
    </div>
    <div class="how"><b>Comment est calculée ma prime</b><ol>
      <li>Les ${c.primeLimit} premières inscriptions du mois : <b>${c.primeLow} DH</b> chacune → ${Math.min(n, c.primeLimit)} × ${c.primeLow} = <b>${fmtDH(Math.min(n, c.primeLimit) * c.primeLow)}</b></li>
      <li>À partir de la ${c.primeLimit + 1}e : <b>${c.primeHigh} DH</b> chacune → ${Math.max(0, n - c.primeLimit)} × ${c.primeHigh} = <b>${fmtDH(Math.max(0, n - c.primeLimit) * c.primeHigh)}</b></li>
      <li>Total prime : <b>${fmtDH(primeFor(n, c))}</b>${isAdmin() ? "" : ` + salaire ${fmtDH(c.respSalary)} = <b>${fmtDH(c.respSalary + primeFor(n, c))}</b>`}</li></ol></div>
    ${days.map(d => { const l = ins.filter(s => s.regDate === d); return `<h3 class="sec">${d === TODAY() ? "Aujourd'hui" : new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}${d >= wk ? "" : ""} <span class="count">${l.length}</span></h3>
      <div class="list">${l.map(s => { const rank = ins.indexOf(s) + 1; return `<div class="item" data-stu="${s.id}"><div class="av">${rank}</div><div class="mid"><div class="nm">${esc(s.name)}</div><div class="meta">${esc(groupName(s.groupId))} · ${esc(s.source)}</div></div><span class="chip ${rank > c.primeLimit ? "st-late" : "st-ok"}">+${rank > c.primeLimit ? c.primeHigh : c.primeLow} DH</span></div>`; }).join("")}</div>`; }).join("") || `<div class="empty">Pas encore d'inscription ce mois</div>`}`,
    (root, close) => bindRows(root, close));
}

/* ---------- Rapport jour / semaine / mois + PDF ---------- */
function periodRange(kind) {
  const t = TODAY();
  if (kind === "week") return [weekStart(t), t];
  if (kind === "month") return [t.slice(0, 7) + "-01", t];
  return [t, t];
}
const ownerLabel = s => s.source === "Ads" ? (s.adsOwner === "resp" ? "Ads " + CONFIG.respName : s.adsOwner === "admin" ? "Ads " + CONFIG.adminName : "Ads (?)") : (s.source || "—");
function reportSheet(kind) {
  const c = charges(), [from, to] = periodRange(kind), R = periodReport(data, c, from, to);
  const label = { day: "du jour", week: "de la semaine", month: "du mois" }[kind];
  const per = from === to ? fmtDate(from) + "/" + from.slice(0, 4) : `du ${fmtDate(from)} au ${fmtDate(to)}`;
  const tbl = (head, rows) => rows.length ? `<div class="tbl"><div class="th">${head.map(h => `<span>${h}</span>`).join("")}</div>${rows.map(r => `<div class="tr">${r.map(x => `<span>${x}</span>`).join("")}</div>`).join("")}</div>` : `<div class="empty">Rien sur cette période</div>`;
  sheet(`<h2>Rapport ${label}</h2><div class="sub">${esc(CONFIG.respName)} · ${per}</div>
    <div class="filters" id="rpK" style="margin-top:12px">${[["day", "Jour"], ["week", "Semaine"], ["month", "Mois"]].map(([k, l]) => `<button data-k="${k}" class="${k === kind ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="rep" style="box-shadow:none;border:1px solid var(--line)">
      <div><b>${R.ins.length}</b><small>Inscriptions</small></div>
      <div><b>${R.insResp.length}</b><small>Ads ${esc(CONFIG.respName)}</small></div>
      <div><b>${R.pays.length}</b><small>Paiements</small></div>
      <div><b>${R.contacts.length}</b><small>Contacts</small></div>
      <div><b>${R.answered}</b><small>Ont répondu</small></div>
      <div><b>${R.prosContacted}</b><small>Prospects relancés</small></div>
    </div>
    <div class="how"><b>Prime du mois (${R.monthResp} inscription(s) Ads ${esc(CONFIG.respName)})</b><div style="margin-top:4px">${Math.min(R.monthResp, c.primeLimit)} × ${c.primeLow} DH${R.monthResp > c.primeLimit ? ` + ${R.monthResp - c.primeLimit} × ${c.primeHigh} DH` : ""} = <b>${fmtDH(R.prime)}</b></div></div>
    <h3 class="sec">Inscriptions <span class="count">${R.ins.length}</span></h3>
    ${tbl(["Date", "Élève", "Source"], R.ins.map(s => [fmtDate(s.regDate), esc(s.name), esc(ownerLabel(s))]))}
    <h3 class="sec">Paiements encaissés <span class="count">${fmtDH(R.payAmount)}</span></h3>
    ${tbl(["Date", "Élève", "Montant"], R.pays.map(p => [fmtDate(p.date), esc(studentById(p.studentId)?.name || "?"), fmtDH(p.amount)]))}
    <h3 class="sec">Contacts (Message / Appel) <span class="count">${R.contacts.length}</span></h3>
    ${tbl(["Date", "Personne", "Résultat"], R.contacts.map(x => [fmtDate(x.date), esc(x.name), esc(x.result) + (x.note ? " — " + esc(x.note) : "")]))}
    <h3 class="sec">Pas encore fait <span class="count">aujourd'hui</span></h3>
    ${tbl(["À faire", "Personne"], [...R.notDone.late.map(s => ["Paiement en retard", esc(s.name)]), ...R.notDone.regs.map(s => ["Reste d'inscription", esc(s.name)]), ...R.notDone.pros.map(p => ["Relance prospect", esc(p.name || p.phone)])])}
    <button class="btn pri block" id="rpPdf" style="margin-top:16px">${ic("download", 18)} Télécharger en PDF</button>`,
    (root, close) => {
      root.querySelector("#rpK").onclick = e => { const b = e.target.closest("button"); if (!b) return; close(); reportSheet(b.dataset.k); };
      root.querySelector("#rpPdf").onclick = async () => { try { await reportPDF(kind, R, label, per); toast("PDF téléchargé ✅"); } catch (err) { toast("Le PDF se télécharge depuis l'app installée"); } };
    });
}
function loadScript(src) { return new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); }
async function reportPDF(kind, R, label, per) {
  if (!window.jspdf) { await loadScript("js/vendor/jspdf.umd.min.js"); await loadScript("js/vendor/jspdf.plugin.autotable.min.js"); }
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: "pt", format: "a4" });
  const TEAL = [0, 171, 167], DH = n => (Number(n) || 0).toLocaleString("fr-FR").replace(/ | /g, " ") + " DH";
  doc.setFillColor(...TEAL); doc.rect(0, 0, 595, 86, "F");
  try { const img = await fetch("icons/logo-header.png").then(r => r.blob()).then(b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); })); doc.addImage(img, "PNG", 36, 14, 56, 57); } catch (e) {}
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text(`Rapport ${label}`, 108, 42);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(`${CONFIG.respName} · Responsable classe · ${per}`, 108, 62);
  doc.setTextColor(18, 51, 50);
  const kp = [["Inscriptions", R.ins.length], ["Ads " + CONFIG.respName, R.insResp.length], ["Paiements", R.pays.length + " · " + DH(R.payAmount)], ["Contacts", R.contacts.length], ["Ont répondu", R.answered], ["Prospects relancés", R.prosContacted]];
  doc.autoTable({ startY: 104, head: [kp.map(k => k[0])], body: [kp.map(k => String(k[1]))], theme: "grid", headStyles: { fillColor: TEAL, fontSize: 8 }, bodyStyles: { fontSize: 12, fontStyle: "bold", halign: "center" } });
  let y = doc.lastAutoTable.finalY + 14;
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text(`Prime du mois : ${DH(R.prime)} (${R.monthResp} inscription(s) Ads ${CONFIG.respName})`, 40, y + 4);
  const sec = (title, head, body) => { doc.autoTable({ startY: doc.lastAutoTable.finalY + 34, head: [[{ content: title, colSpan: head.length, styles: { fillColor: [253, 215, 35], textColor: [18, 51, 50], fontStyle: "bold" } }], head], body: body.length ? body : [[{ content: "Rien sur cette période", colSpan: head.length, styles: { textColor: 140 } }]], theme: "striped", headStyles: { fillColor: TEAL }, styles: { fontSize: 9 } }); };
  sec("Inscriptions", ["Date", "Élève", "Groupe", "Source"], R.ins.map(s => [fmtDate(s.regDate), s.name, groupName(s.groupId), ownerLabel(s)]));
  sec("Paiements encaissés", ["Date", "Élève", "Type", "Montant"], R.pays.map(p => [fmtDate(p.date), studentById(p.studentId)?.name || "?", p.label || p.type, DH(p.amount)]));
  sec("Contacts (Message / Appel)", ["Date", "Personne", "Motif", "Résultat"], R.contacts.map(x => [fmtDate(x.date), x.name, x.reason, x.result + (x.note ? " — " + x.note : "")]));
  sec("Pas encore fait (aujourd'hui)", ["À faire", "Personne"], [...R.notDone.late.map(s => ["Paiement en retard", s.name]), ...R.notDone.regs.map(s => ["Reste d'inscription", s.name]), ...R.notDone.pros.map(p => ["Relance prospect", p.name || p.phone])]);
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Talkify · généré le ${new Date().toLocaleString("fr-FR")} · page ${i}/${n}`, 40, 820); }
  const fname = `talkify-rapport-${kind}-${R.from}.pdf`;
  if (NATIVE) await saveNativeFile(fname, doc.output("datauristring").split(",")[1], "application/pdf");
  else doc.save(fname);
}

/* ---------- Une case = une tâche, avec ce qu'il faut faire ---------- */
const CASES = {
  pay: { title: "Encaisser les paiements", icon: "wallet", how: ["Envoie le Message de rappel 💬", "Note la réponse (Va payer, Pas de réponse…)", "Quand l'élève paie, touche 💰 et confirme"] },
  regs: { title: "Restes d'inscription", icon: "file", how: ["Rappelle le reste à payer 💬", "Note la réponse", "S'il/elle ne revient plus : ouvre la fiche → « Inscrit puis parti »"] },
  pros: { title: "Relancer les prospects", icon: "msg", how: ["Envoie le Message WhatsApp 💬", "Note la réponse (RDV pris, Inscrit…)", "Prochaine relance : choisis la date"] },
  abs: { title: "Suivre les absences", icon: "userX", how: ["Envoie un Message pour prendre des nouvelles 💬", "Note la raison de l'absence", "Si l'élève arrête : ouvre la fiche → Modifier"] },
  groups: { title: "Remplir les groupes", icon: "users", how: ["Regarde les places libres", "Propose ces horaires aux prospects", "Touche un groupe pour voir ses élèves"] },
  missing: { title: "Infos à compléter", icon: "edit", how: ["Ouvre la fiche de l'élève", "Ajoute la date de début des cours", "Vérifie la situation des élèves « À vérifier »"] }
};
function caseSheet(key) {
  state.case = key;
  const sum = dailySummary(data, CONFIG), T = dayTasks(sum), c = CASES[key];
  let rows = [], head = "";
  if (key === "pay") rows = T.pay.map(x => payRow(x.s, x.st));
  if (key === "regs") rows = T.regs.map(balanceRow);
  if (key === "pros") rows = T.pros.map(prospectRow);
  if (key === "abs") rows = T.abs.map(absRow);
  if (key === "missing") rows = [...sum.missing.map(x => x.s), ...data.students.filter(s => s.status === "à vérifier")].map(stuRow);
  if (key === "groups") rows = data.groups.map(g => {
    const n = data.students.filter(s => s.groupId === g.id && s.status === "actif").length, cap = Number(g.capacity) || 12, free = Math.max(0, cap - n);
    return `<div class="seat ${free ? "" : "full"}" data-gopen="${g.id}"><div class="mid"><b>${esc(g.schedule || g.name)} · Prof ${esc(g.prof)}</b><small>${n} élève(s) sur ${cap}</small><div class="cap"><i style="width:${Math.min(100, n / cap * 100)}%"></i></div></div><div class="free"><b>${free}</b><small>${free ? "places libres" : "complet"}</small></div></div>`;
  });
  sheet(`
    <div class="case-head"><span class="c-ic">${ic(c.icon, 22)}</span><div><h2>${c.title}</h2><div class="sub">${rows.length} ${key === "groups" ? "groupes" : "personne(s)"}</div></div></div>
    <div class="how"><b>Ce qu'il faut faire</b><ol>${c.how.map(x => `<li>${x}</li>`).join("")}</ol></div>
    <div class="list">${rows.join("") || `<div class="empty">✓ Rien à faire ici aujourd'hui</div>`}</div>
    ${key === "groups" ? `<button class="btn ghost block" id="cgAdd" style="margin-top:12px">${ic("plus", 18)} Nouveau groupe</button>` : ""}
  `, (root, close) => {
    bindRows(root, close);
    root.querySelectorAll("[data-gopen]").forEach(g => g.onclick = () => { close(); state.case = ""; state.stuGroup = g.dataset.gopen; state.stuFilter = "tous"; go("students"); });
    const ga = root.querySelector("#cgAdd"); if (ga) ga.onclick = () => { close(); state.case = ""; groupForm(); };
    root.addEventListener("click", e => { if (e.target === root) state.case = ""; });
  });
}

function viewAdminHome(sum) {
  const col = toCollect(data), r = dayReport(data), ch = monthCharges(data, charges()), T = dayTasks(sum);
  const contacts = (data.contacts || []).filter(c => c.date === TODAY()).sort((a, b) => b.at.localeCompare(a.at));
  const paysToday = data.payments.filter(p => p.date === TODAY());
  const actives = data.students.filter(s => s.status === "actif");
  const att = data.groups.map(g => {
    const rec = data.attendance.find(a => a.groupId === g.id && a.date === TODAY());
    const n = actives.filter(s => s.groupId === g.id).length;
    return { g, rec, n };
  }).filter(x => x.n || x.rec);
  const presTot = att.reduce((t, x) => t + (x.rec ? (x.rec.presents || []).length : 0), 0);
  const absTot = att.reduce((t, x) => t + (x.rec ? (x.rec.absents || []).length : 0), 0);
  const line = (l, d, t) => `<div class="line-row"><div>${l}</div><b>${d}/${t}${t && d === t ? " ✓" : ""}</b></div>`;

  const month = TODAY().slice(0, 7);
  const proContacts = (data.contacts || []).filter(c => c.type === "prospect");
  const proToday = new Set(proContacts.filter(c => c.date === TODAY()).map(c => c.targetId)).size;
  const proMonth = new Set(proContacts.filter(c => (c.date || "").startsWith(month)).map(c => c.targetId)).size;
  const interested = data.prospects.filter(p => ["Intéressé", "RDV", "Test de niveau"].includes(p.status)).length;
  const insMonth = data.students.filter(s => (s.regDate || "").startsWith(month)).length;
  const plus = ch.resultNow >= 0, cover = ch.totalMonth ? Math.min(100, Math.round(ch.cashed / ch.totalMonth * 100)) : 100;
  const missingCash = Math.max(0, ch.totalMonth - ch.cashed);
  const R = n => fmtDH(Math.round(Math.abs(n)));
  const attPending = att.filter(x => !x.rec && x.n).length, gone = data.students.filter(s => s.status === "parti");
  const freeTot = data.groups.reduce((t, g) => t + Math.max(0, (Number(g.capacity) || 12) - actives.filter(s => s.groupId === g.id).length), 0);
  const aBox = (key, cls, icon, title, n, amount, sub) => `<button class="case ${cls}" data-a="${key}"><span class="c-row"><span class="c-ic">${ic(icon, 18)}</span><span class="c-n">${n}</span></span><span class="c-t">${title}</span>${amount ? `<span class="c-a">${amount}</span>` : `<span class="c-s">${sub}</span>`}<span class="c-foot"><span>${amount && sub ? sub : "&nbsp;"}</span><span class="c-go">Voir ${ic("chev", 14, 2.6)}</span></span></button>`;

  $("#view").innerHTML = `
    <div class="result ${plus ? "plus" : "moins"}" data-jump="finance">
      <div class="r-top"><span>${new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} · jour ${ch.dayNow}/${ch.daysInMonth}</span><span class="tag">${plus ? "▲ EN PLUS" : "▼ EN MOINS"}</span></div>
      <div class="r-lbl">Résultat du mois à ce jour</div>
      <div class="r-big">${plus ? "+" : "−"}${R(ch.resultNow)}</div>
      <div class="r-bar"><i style="width:${cover}%"></i></div>
      <div class="r-cap"><span>Encaissé ${fmtDH(ch.cashed)}</span><span>Charges payées ${fmtDH(Math.round(ch.toDate))} / ${fmtDH(Math.round(ch.totalMonth))}</span></div>
      <div class="r-grid">
        <div><small>Manque pour couvrir les charges</small><b>${missingCash ? R(missingCash) : "Couvert ✓"}</b></div>
        <div><small>Inscriptions à faire pour passer en plus</small><b>${ch.studentsToBreakEven ? ch.studentsToBreakEven + " élève(s)" : "0 ✓"}</b></div>
        <div><small>Prévu fin du mois (si tout le monde paie)</small><b>${ch.resultForecast >= 0 ? "+" : "−"}${R(ch.resultForecast)}</b></div>
        <div><small>Chaque nouvel élève rapporte</small><b>≈ +${R(ch.avg)}/mois</b></div>
      </div>
    </div>

    <h3 class="sec">Vue d'ensemble <span class="count">touche une case</span></h3>
    <div class="cases">
      ${aBox("paytoday", "k-teal", "wallet", "Encaissé aujourd'hui", paysToday.length, fmtDH(r.payAmount), "")}
      ${aBox("owe", sum.late.length ? "k-red" : "k-dark", "alert", "Reste à récupérer", col.people, fmtDH(col.total), "")}
      ${aBox("att", attPending ? "k-orange" : "k-dark", "check", "Présence aujourd'hui", presTot, "", `${absTot} absent(s)${attPending ? " · " + attPending + " appel(s) en attente" : ""}`)}
      ${aBox("resp", "k-yel", "clipboard", "Travail de la responsable", T.pct + "%", "", `${T.done}/${T.total} tâches · ${contacts.length} contact(s)`)}
      ${aBox("pros", "k-teal", "phone", "Prospects", proToday, "", `contactés aujourd'hui · ${interested} intéressé(s)`)}
      ${aBox("ins", "k-ysoft", "userPlus", "Inscriptions du mois", insMonth, "", `${data.students.filter(s => (s.regDate || "").startsWith(month) && s.source === "Ads" && s.adsOwner === "resp").length} via Ads ${esc(CONFIG.respName)}`)}
      ${aBox("groups", "k-soft", "book", "Places libres", freeTot, "", `${actives.length} élèves dans ${data.groups.length} groupes`)}
      ${aBox("gone", gone.length ? "k-rsoft" : "k-soft", "userX", "Inscrits puis partis", gone.length, gone.length ? fmtDH(gone.reduce((t, s) => t + Number(s.lostBalance || 0), 0)) + " perdus" : "", "aucun")}
    </div>

    <h3 class="sec">📝 Rapport du jour <button class="link" id="openReportA">PDF ${ic("chev", 16)}</button></h3>
    <div class="rep">
      <div><b>${r.ins.length}</b><small>Inscriptions</small></div>
      <div><b>${r.pays.length}</b><small>Paiements</small></div>
      <div><b>${r.contacts.length}</b><small>Contacts</small></div>
      <div><b>${r.answered}</b><small>Ont répondu</small></div>
      <div><b>${r.noAnswer}</b><small>Sans réponse</small></div>
      <div><b>${r.newProspects}</b><small>Nouveaux prospects</small></div>
    </div>
  `;
  $("#openReportA").onclick = () => reportSheet("day");
  $("#view").querySelectorAll("[data-a]").forEach(b => b.onclick = () => adminCase(b.dataset.a, sum));
  $("#view").querySelectorAll("[data-jump]").forEach(k => k.onclick = () => go("finance"));
}
function adminCase(k, sum) {
  const col = toCollect(data), T = dayTasks(sum), r = dayReport(data);
  const contacts = (data.contacts || []).filter(c => c.date === TODAY()).sort((a, b) => b.at.localeCompare(a.at));
  const actives = data.students.filter(s => s.status === "actif");
  const head = (icon, t, sub) => `<div class="case-head"><span class="c-ic">${ic(icon, 22)}</span><div><h2>${t}</h2><div class="sub">${sub}</div></div></div><div style="height:12px"></div>`;
  let html = "";
  if (k === "paytoday") { const ps = data.payments.filter(p => p.date === TODAY());
    html = head("wallet", "Encaissé aujourd'hui", `${ps.length} paiement(s) · ${fmtDH(r.payAmount)}`) + `<div class="list">${ps.map(p => { const st = studentById(p.studentId); return `<div class="item" data-stu="${p.studentId}"><div class="av">${initials(st?.name)}</div><div class="mid"><div class="nm">${esc(st?.name || "?")}</div><div class="meta">${esc(p.label || p.type)} · ${esc(p.mode || "")} · par ${esc(p.updatedBy || "")}</div></div><b>${fmtDH(p.amount)}</b></div>`; }).join("") || `<div class="empty">Aucun paiement aujourd'hui</div>`}</div>`; }
  if (k === "owe") html = head("alert", "Reste à récupérer", `${col.people} personnes · ${fmtDH(col.total)}`) + `<div class="gs-grid" style="grid-template-columns:1fr 1fr;margin:0 0 12px"><div class="warn"><b>${fmtDH(col.mAmt)}</b><small>Mensualités (${col.monthly.length})</small></div><div class="warn"><b>${fmtDH(col.rAmt)}</b><small>Restes d'inscription (${col.regs.length})</small></div></div><div class="list">${[...col.monthly.map(s => payRow(s, payStatus(s, TODAY(), CONFIG.remindDaysBefore))), ...col.regs.filter(s => !col.monthly.includes(s)).map(balanceRow)].join("") || `<div class="empty">Tout le monde a payé ✓</div>`}</div>`;
  if (k === "att") html = head("check", "Présence aujourd'hui", "Appel de chaque groupe") + `<div class="list">${data.groups.map(g => { const rec = data.attendance.find(a => a.groupId === g.id && a.date === TODAY()), n = actives.filter(s => s.groupId === g.id).length; if (!n && !rec) return "";
    return `<div class="seat" data-attg="${g.id}"><div class="mid"><b>${esc(g.schedule || g.name)} · Prof ${esc(g.prof)}</b><small>${rec ? `${(rec.presents || []).length} présent(s) sur ${n}${(rec.absents || []).length ? " · absents : " + rec.absents.map(id => esc(studentById(id)?.name.split(" ")[0] || "?") + ((rec.notes || {})[id] ? " (" + esc(rec.notes[id]) + ")" : "")).join(", ") : " · tout le monde est là"}` : "Appel pas encore fait"}</small></div><div class="free">${rec ? `<b>${(rec.absents || []).length}</b><small>absent(s)</small>` : `<span class="chip st-soon">En attente</span>`}</div></div>`; }).join("")}</div>`;
  if (k === "resp") { const line = (l, d, t) => `<div class="line-row"><div>${l}</div><b>${d}/${t}${t && d === t ? " ✓" : ""}</b></div>`;
    html = head("clipboard", "Travail de la responsable", `${T.done}/${T.total} tâches faites aujourd'hui`) + `<div class="card" style="box-shadow:none;border:1px solid var(--line)"><div class="cap2"><i style="width:${T.pct}%"></i></div>${line("Paiements relancés / encaissés", T.d.pay, T.pay.length)}${line("Restes d'inscription suivis", T.d.regs, T.regs.length)}${line("Prospects relancés", T.d.pros, T.pros.length)}${line("Absences suivies", T.d.abs, T.abs.length)}</div>
      <h3 class="sec">Contacts du jour <span class="count">${contacts.length}</span></h3><div class="list">${contacts.map(c => `<div class="item" style="cursor:default"><div class="av">${initials(c.name)}</div><div class="mid"><div class="nm">${esc(c.name)}</div><div class="meta">${esc(c.reason)} · ${c.at.slice(11, 16)}${c.note ? " · " + esc(c.note) : ""}</div></div><span class="chip ${["Pas de réponse", "Refus / arrête", "Pas intéressé"].includes(c.result) ? "st-soon" : "st-ok"}">${esc(c.result)}</span></div>`).join("") || `<div class="empty">Aucun contact noté aujourd'hui</div>`}</div>
      <div class="row-btns"><button class="btn line" id="acJ">Journal complet</button><button class="btn pri" id="acR">${ic("download", 18)} Rapport PDF</button></div>`; }
  if (k === "pros") { go("prospects"); return; }
  if (k === "groups") { go("groups"); return; }
  if (k === "ins") { reportSheet("month"); return; }
  if (k === "gone") { state.stuFilter = "parti"; state.stuGroup = ""; go("students"); return; }
  sheet(html, (root, close) => {
    bindRows(root, close);
    root.querySelectorAll("[data-attg]").forEach(g => g.onclick = () => { close(); state.attGroup = g.dataset.attg; state.attDate = TODAY(); go("attendance"); });
    const j = root.querySelector("#acJ"); if (j) j.onclick = () => { close(); journalSheet(); };
    const rp = root.querySelector("#acR"); if (rp) rp.onclick = () => { close(); reportSheet("day"); };
  });
}

function pickStudent() {
  const list = data.students.filter(s => !isOut(s)).sort((a, b) => a.name.localeCompare(b.name));
  sheet(`<h2>Encaisser</h2><div class="sub">Choisis l'élève</div>
    <div class="search" style="margin-top:12px">${ic("search", 18)}<input id="pk" placeholder="Nom ou numéro"></div>
    <div class="list" id="pkList"></div>`, (root, close) => {
      const draw = q => { root.querySelector("#pkList").innerHTML = list.filter(s => (s.name + s.phone).toLowerCase().includes(q)).map(s =>
        `<div class="item" data-id="${s.id}"><div class="av">${initials(s.name)}</div><div class="mid"><div class="nm">${esc(s.name)}</div><div class="meta">${esc(groupName(s.groupId))} · ${fmtDH(s.monthly)}</div></div></div>`).join("");
        root.querySelectorAll("[data-id]").forEach(x => x.onclick = () => { close(); paymentForm(studentById(x.dataset.id)); }); };
      root.querySelector("#pk").oninput = e => draw(e.target.value.toLowerCase()); draw("");
    });
}
function absencesSheet(list) {
  sheet(`<h2>Absences répétées</h2><div class="sub">${CONFIG.absenceAlert} absences de suite ou plus</div><div style="height:12px"></div>
    <div class="list">${list.map(a => absRow(a)).join("")}</div>`, root => {
      root.querySelectorAll("[data-stu]").forEach(x => x.onclick = () => studentSheet(studentById(x.dataset.stu)));
    });
}
function block(title, rows, hint) {
  const id = title.includes("Absences") ? 'id="sec-abs"' : "";
  return `<h3 class="sec" ${id}>${title} <span class="count">${rows.length}</span></h3>
    ${hint && rows.length ? `<p class="sub" style="margin:-4px 4px 8px;font-size:12px;color:var(--mute)">${hint}</p>` : ""}
    <div class="list">${rows.join("") || `<div class="empty">Rien pour le moment ✨</div>`}</div>`;
}
const chip = st => `<span class="chip st-${st.key}">${esc(st.label)}</span>`;

function reminderText(s) {
  return `السلام عليكم ${s.name.split(" ")[0]}، كنفكروك بلي الخلاص ديال الشهر فـ ${CONFIG.centerName} كان نهار ${fmtDate(s.nextDue)} (${fmtDH(s.monthly)}). شكرا بزاف 🙏`;
}
// lien WhatsApp + journal du contact après l'envoi
const waBtn = (phone, text, type, id, reason, cls = "wa", label = ic("msg", 18)) =>
  phone ? `<a class="${cls}" href="${waLink(phone, text)}" target="_blank" data-stop data-log="${type}|${id}|${reason}">${label}</a>` : "";
function payRow(s, st) {
  return `<div class="item ${doneToday(s) ? "done" : ""}" data-stu="${s.id}">
    <div class="av">${initials(s.name)}</div>
    <div class="mid"><div class="nm">${esc(s.name)}</div><div class="meta">${esc(groupName(s.groupId))}${s.nextDue ? " · " + fmtDate(s.nextDue) : ""}${s.monthly ? " · " + fmtDH(s.monthly) : ""}</div><div style="margin-top:4px">${chip(st)}${doneToday(s) ? ` <span class="donechip">✓ ${esc(s.lastContactResult || "Payé")}</span>` : ""}</div></div>
    <div class="end">${waBtn(s.phone, reminderText(s), "student", s.id, "Paiement")}<button class="wa y" data-pay="${s.id}" title="Encaisser">${ic("wallet", 18)}</button></div>
  </div>`;
}
function balanceRow(s) {
  const txt = `السلام عليكم ${s.name.split(" ")[0]}، كنفكروك بلي باقي ${fmtDH(s.balance)} ديال التسجيل فـ ${CONFIG.centerName}. شكرا 🙏`;
  return `<div class="item ${doneToday(s) ? "done" : ""}" data-stu="${s.id}"><div class="av">${initials(s.name)}</div>
    <div class="mid"><div class="nm">${esc(s.name)}</div><div class="meta">${esc(groupName(s.groupId))}</div><div style="margin-top:4px"><span class="chip st-soon">Reste ${fmtDH(s.balance)}</span>${doneToday(s) ? ` <span class="donechip">✓ ${esc(s.lastContactResult || "Payé")}</span>` : ""}</div></div>
    <div class="end">${waBtn(s.phone, txt, "student", s.id, "Reste inscription")}<button class="wa y" data-pay="${s.id}" data-kind="reste">${ic("wallet", 18)}</button></div></div>`;
}
function absRow({ student: s, streak }) {
  const txt = `السلام عليكم ${s.name.split(" ")[0]}، لاحظنا بلي غبتي ${streak} د الحصص. كلشي مزيان؟ كنتسناوك فالحصة الجاية 🙏 — ${CONFIG.centerName}`;
  return `<div class="item" data-stu="${s.id}"><div class="av">${initials(s.name)}</div>
    <div class="mid"><div class="nm">${esc(s.name)}</div><div class="meta">${esc(groupName(s.groupId))}</div><div style="margin-top:4px"><span class="chip st-late">${streak} absences de suite</span></div></div>
    <div class="end">${waBtn(s.phone, txt, "student", s.id, "Absence")}</div></div>`;
}
function bindRows(v = $("#view"), inSheet = false) {
  v.querySelectorAll("[data-stop]").forEach(a => a.addEventListener("click", e => e.stopPropagation()));
  if (!inSheet) v.querySelectorAll("[data-log]").forEach(a => a.addEventListener("click", () => {
    const [type, id, reason] = a.dataset.log.split("|");
    setTimeout(() => contactLogSheet(type, id, reason), 400);
  }));
  const shut = () => { if (typeof inSheet === "function") inSheet(); };
  v.querySelectorAll("[data-offer]").forEach(b => b.onclick = e => { e.stopPropagation(); shut(); offerSheet(data.prospects.find(p => p.id === b.dataset.offer)); });
  v.querySelectorAll("[data-pay]").forEach(b => b.onclick = e => { e.stopPropagation(); shut(); paymentForm(studentById(b.dataset.pay), b.dataset.kind); });
  v.querySelectorAll("[data-stu]").forEach(r => r.onclick = () => { shut(); state.case = ""; studentSheet(studentById(r.dataset.stu)); });
  v.querySelectorAll("[data-pro]").forEach(r => r.onclick = () => { shut(); state.case = ""; prospectSheet(data.prospects.find(p => p.id === r.dataset.pro)); });
}

/* ---------- Journal des contacts ---------- */
const RESULTS = { student: ["Répondu", "Va payer", "Payé", "Pas de réponse", "À rappeler", "Refus / arrête"], prospect: ["Répondu", "RDV pris", "Inscrit", "Pas de réponse", "À rappeler", "Pas intéressé"] };
function contactLogSheet(type, id, reason) {
  const t = type === "student" ? studentById(id) : data.prospects.find(p => p.id === id);
  if (!t) return;
  let result = "";
  sheet(`<h2>Résultat du contact</h2><div class="sub">${esc(t.name || t.phone)} · ${esc(reason)}</div>
    <div class="opts" id="cRes">${RESULTS[type].map(r => `<button data-r="${r}">${r}</button>`).join("")}</div>
    <label class="f">Ce qu'il/elle a dit (facultatif)</label><textarea id="cNote" rows="2" placeholder="ex : va payer samedi"></textarea>
    <div class="grid2"><div><label class="f">Rappeler le</label><input type="date" id="cNext" value="${addDays(TODAY(), CONFIG.followUpDays)}"></div><div></div></div>
    <div class="row-btns"><button class="btn line" id="cSkip">Plus tard</button><button class="btn pri" id="cSave">Enregistrer</button></div>`,
    (root, close) => {
      root.querySelector("#cRes").onclick = e => { const b = e.target.closest("button"); if (!b) return; result = b.dataset.r; root.querySelectorAll("#cRes button").forEach(x => x.classList.toggle("on", x === b)); };
      root.querySelector("#cSkip").onclick = () => { close(); if (state.case) setTimeout(() => caseSheet(state.case), 250); };
      root.querySelector("#cSave").onclick = async () => {
        if (!result) return toast("Choisis le résultat");
        const note = val(root, "cNote"), next = val(root, "cNext");
        await add("contacts", { type, targetId: id, name: t.name || t.phone, reason, result, note, date: TODAY(), at: new Date().toISOString(), by: session.user.name, nextFollow: next });
        if (type === "prospect") {
          const st = result === "Inscrit" ? "Inscrit" : result === "RDV pris" ? "RDV" : result === "Pas intéressé" ? "Perdu" : t.status;
          await update("prospects", id, { status: st, lastContact: TODAY(), nextFollow: next, history: [...(t.history || []), { date: TODAY(), by: session.user.name, note: `${reason} → ${result}${note ? " : " + note : ""}` }] });
        } else {
          await update("students", id, { lastContact: TODAY(), lastContactResult: result, contactNote: note });
        }
        close(); toast("Contact enregistré ✅");
        if (state.case) setTimeout(() => caseSheet(state.case), 250);
      };
    });
}
function journalSheet() {
  const days = [...new Set((data.contacts || []).map(c => c.date))].sort().reverse().slice(0, 7);
  sheet(`<h2>Journal des contacts</h2><div class="sub">Tous les messages et appels notés par la responsable</div>
    ${days.map(d => {
      const list = data.contacts.filter(c => c.date === d).sort((a, b) => b.at.localeCompare(a.at));
      return `<h3 class="sec">${d === TODAY() ? "Aujourd'hui" : fmtDate(d)} <span class="count">${list.length}</span></h3>
        ${list.map(c => `<div class="hist"><div><b>${esc(c.name)}</b> · ${esc(c.reason)}<small>${esc(c.result)}${c.note ? " — " + esc(c.note) : ""} · ${c.at.slice(11, 16)} · ${esc(c.by)}</small></div></div>`).join("")}`;
    }).join("") || `<div class="empty">Aucun contact noté pour le moment.<br>Après chaque message WhatsApp, l'app demande le résultat.</div>`}`);
}

/* ======================= ÉLÈVES ======================= */
function stuRow(s) {
  const st = s.status === "à vérifier" ? { key: "check", label: "À vérifier" } : payStatus(s, TODAY(), CONFIG.remindDaysBefore);
  return `<div class="item" data-stu="${s.id}">
    <div class="av">${initials(s.name)}</div>
    <div class="mid"><div class="nm">${esc(s.name)}</div><div class="meta">${esc(groupName(s.groupId))}${s.phone ? " · " + esc(s.phone) : ""}${s.lastContact ? " · 💬 " + fmtDate(s.lastContact) + " " + esc(s.lastContactResult || "") : ""}</div><div style="margin-top:4px">${chip(st)}${Number(s.balance) > 0 ? ` <span class="chip st-soon">Reste ${fmtDH(s.balance)}</span>` : ""}</div></div>
    <div class="end">${waBtn(s.phone, "السلام عليكم " + s.name.split(" ")[0] + " 👋", "student", s.id, "Message")}</div>
  </div>`;
}
function viewStudents() {
  const F = [["tous", "Tous"], ["month", "À payer ce mois"], ["late", "En retard"], ["soon", "Bientôt"], ["reste", "Reste inscription"], ["missing", "Infos manquantes"], ["check", "À vérifier"], ["parti", "Inscrits partis"], ["off", "Arrêtés"]];
  let list = data.students.slice();
  const q = state.q.toLowerCase();
  if (q) list = list.filter(s => (s.name + " " + s.phone).toLowerCase().includes(q));
  if (state.stuGroup) list = list.filter(s => s.groupId === state.stuGroup);
  list = list.filter(s => {
    const st = payStatus(s, TODAY(), CONFIG.remindDaysBefore).key;
    switch (state.stuFilter) {
      case "month": return !isOut(s) && s.nextDue && s.nextDue <= monthEnd(TODAY()) && Number(s.monthly) > 0;
      case "late": return st === "late";
      case "soon": return st === "soon" || st === "today";
      case "reste": return Number(s.balance) > 0 && !isOut(s);
      case "missing": return st === "missing";
      case "check": return s.status === "à vérifier";
      case "off": return s.status === "arrêté";
      case "parti": return s.status === "parti";
      default: return !isOut(s);
    }
  }).sort((a, b) => (a.nextDue || "9999").localeCompare(b.nextDue || "9999"));

  $("#view").innerHTML = `
    <div class="search">${ic("search", 18)}<input id="q" placeholder="Chercher un nom ou un numéro" value="${esc(state.q)}"></div>
    <div class="filters" id="flt">${F.map(([k, l]) => `<button data-f="${k}" class="${state.stuFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="filters" id="fltG"><button data-g="" class="${!state.stuGroup ? "on" : ""}">Tous les groupes</button>${data.groups.map(g => `<button data-g="${g.id}" class="${state.stuGroup === g.id ? "on" : ""}">${esc(g.name)}</button>`).join("")}</div>
    <h3 class="sec">Résultats <span class="count">${list.length}</span></h3>
    <div class="list">${list.map(stuRow).join("") || `<div class="empty">Aucun élève ici</div>`}</div>`;
  const qi = $("#q"); qi.oninput = () => { state.q = qi.value; const pos = qi.selectionStart; viewStudents(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  $("#flt").onclick = e => { const b = e.target.closest("button"); if (b) { state.stuFilter = b.dataset.f; viewStudents(); } };
  $("#fltG").onclick = e => { const b = e.target.closest("button"); if (b) { state.stuGroup = b.dataset.g; viewStudents(); } };
  bindRows();
}

/* ---------- Sheet helper ---------- */
function sheet(html, onMount) {
  const bg = document.createElement("div"); bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet"><div class="grab"></div>${html}</div>`;
  bg.onclick = e => { if (e.target === bg) bg.remove(); };
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelectorAll("[data-log]").forEach(a => a.addEventListener("click", () => { const [t, i, r] = a.dataset.log.split("|"); close(); setTimeout(() => contactLogSheet(t, i, r), 400); }));
  onMount && onMount(bg, close);
  return close;
}
const askConfirm = msg => new Promise(res => sheet(`<h2>${esc(msg)}</h2><div class="row-btns"><button class="btn line" id="cNo">Annuler</button><button class="btn yel" id="cYes">Oui</button></div>`,
  (root, close) => { root.querySelector("#cNo").onclick = () => { close(); res(false); }; root.querySelector("#cYes").onclick = () => { close(); res(true); }; }));
const val = (root, id) => root.querySelector("#" + id)?.value.trim() ?? "";
const groupOptions = sel => `<option value="">— Aucun —</option>` + data.groups.map(g => `<option value="${g.id}" ${g.id === sel ? "selected" : ""}>${esc(g.name)} · ${esc(g.prof)}</option>`).join("");

function studentSheet(s) {
  if (!s) return;
  const st = payStatus(s, TODAY(), CONFIG.remindDaysBefore);
  const pays = data.payments.filter(p => p.studentId === s.id).sort((a, b) => b.date.localeCompare(a.date));
  const sessions = data.attendance.filter(a => a.groupId === s.groupId);
  const abs = sessions.filter(a => (a.absents || []).includes(s.id)).length;
  const rate = sessions.length ? Math.round((sessions.length - abs) / sessions.length * 100) : null;
  sheet(`
    <div style="display:flex;gap:12px;align-items:center"><div class="av" style="width:52px;height:52px;font-size:18px">${initials(s.name)}</div>
      <div><h2>${esc(s.name)}</h2><div class="sub">${esc(groupName(s.groupId))}</div></div></div>
    <div style="margin-top:8px">${chip(s.status === "à vérifier" ? { key: "check", label: "À vérifier" } : st)}</div>
    <div class="kv">
      <span>Téléphone</span><b>${esc(s.phone || "—")}${s.phone2 ? " / " + esc(s.phone2) : ""}</b>
      <span>Source</span><b>${esc(s.source || "—")}${s.source === "Ads" ? " · " + (s.adsOwner === "resp" ? "Ads de " + esc(CONFIG.respName) : s.adsOwner === "admin" ? "Ads de " + esc(CONFIG.adminName) : "à préciser") : ""}${s.sourceNote ? " (" + esc(s.sourceNote) + ")" : ""}</b>
      <span>Début des cours</span><b>${s.startDate ? fmtDate(s.startDate) + "/" + s.startDate.slice(0, 4) : "—"}</b>
      <span>Prochain paiement</span><b>${s.nextDue ? fmtDate(s.nextDue) : "—"}</b>
      <span>Mensualité</span><b>${fmtDH(s.monthly)}</b>
      ${Number(s.balance) > 0 ? `<span>Reste</span><b>${fmtDH(s.balance)}</b>` : ""}
      <span>Présence</span><b>${rate === null ? "—" : rate + "% (" + abs + " abs.)"}</b>
      ${s.notes ? `<span>Note</span><b style="font-weight:500">${esc(s.notes)}</b>` : ""}
      ${s.status === "parti" ? `<span>Parti le</span><b>${fmtDate(s.leftDate)}${s.lostBalance ? " · reste non payé " + fmtDH(s.lostBalance) : ""}</b>` : ""}
    </div>
    <button class="btn pri block" id="sPay" style="margin-top:4px">${ic("wallet", 18)} Encaisser un paiement</button>
    <div class="row-btns" style="margin-top:8px">${waBtn(s.phone, reminderText(s), "student", s.id, "Paiement", "btn ghost", ic("msg", 18) + " Message")}${s.phone ? `<a class="btn ghost" href="tel:${esc(s.phone)}">${ic("phone", 18)} Appel</a>` : ""}</div>
    <div class="row-btns" style="margin-top:8px"><button class="btn line" id="sMove">${ic("swap", 18)} Groupe</button><button class="btn line" id="sEdit">${ic("edit", 18)} Modifier</button></div>
    ${isOut(s) ? `<button class="btn ghost block" id="sBack" style="margin-top:8px">${ic("userPlus", 18)} Réactiver l'élève</button>`
      : `<button class="btn line block" id="sLeft" style="margin-top:8px;color:var(--mute)">${ic("userX", 18)} Inscrit puis parti (ne revient plus)</button>`}
    ${(() => { const cs = (data.contacts || []).filter(c => c.targetId === s.id).sort((a, b) => b.at.localeCompare(a.at)); return `<h3 class="sec">Contacts <span class="count">${cs.length}</span></h3>` + (cs.map(c => `<div class="hist"><div>${esc(c.reason)} → <b>${esc(c.result)}</b><small>${fmtDate(c.date)} · ${esc(c.by)}${c.note ? " · " + esc(c.note) : ""}</small></div></div>`).join("") || `<div class="empty">Aucun contact noté</div>`); })()}
    ${(s.groupHistory || []).length ? `<h3 class="sec">Changements de groupe <span class="count">${s.groupHistory.length}</span></h3>` + s.groupHistory.slice().reverse().map(g => `<div class="hist"><div>${esc(groupName(g.from))} → <b>${esc(groupName(g.to))}</b><small>${fmtDate(g.date)} · ${esc(g.by || "")}${g.reason ? " · " + esc(g.reason) : ""}</small></div></div>`).join("") : ""}
    ${(() => { const ab = data.attendance.filter(a => (a.absents || []).includes(s.id)).sort((a, b) => b.date.localeCompare(a.date)); return ab.length ? `<h3 class="sec">Absences <span class="count">${ab.length}</span></h3>` + ab.map(a => `<div class="hist"><div>${fmtDate(a.date)}<small>${esc((a.notes || {})[s.id] || "Pas de remarque")}</small></div></div>`).join("") : ""; })()}
    <h3 class="sec">Historique des paiements <span class="count">${pays.length}</span></h3>
    ${pays.map(p => `<div class="hist"><div>${esc(p.label || p.type)}<small>${fmtDate(p.date)} · ${esc(p.mode || "")}${p.updatedBy ? " · par " + esc(p.updatedBy) : ""}</small></div><b>${fmtDH(p.amount)}</b></div>`).join("") || `<div class="empty">Aucun paiement</div>`}
  `, (root, close) => {
    root.querySelector("#sPay").onclick = () => { close(); paymentForm(s); };
    root.querySelector("#sEdit").onclick = () => { close(); studentForm(s); };
    root.querySelector("#sMove").onclick = () => { close(); moveForm(s); };
    const left = root.querySelector("#sLeft");
    if (left) left.onclick = async () => {
      close();
      if (!(await askConfirm(`${s.name} est parti(e) ? Il/elle sort des listes à payer et des calculs.`))) return;
      await update("students", s.id, { status: "parti", leftDate: TODAY(), lostBalance: Number(s.balance || 0), prevStatus: s.status });
      toast("Déplacé dans « Inscrits partis »");
    };
    const back = root.querySelector("#sBack");
    if (back) back.onclick = async () => { close(); await update("students", s.id, { status: "actif" }); toast("Élève réactivé ✅"); };
  });
}

function studentForm(s = null, prefill = {}) {
  const v = s || { status: "actif", source: "Ads", monthly: CONFIG.offer.price, ...prefill };
  sheet(`
    <h2>${s ? "Modifier l'élève" : "Nouvel élève"}</h2>
    <label class="f">Nom complet</label><input id="fName" value="${esc(v.name)}">
    <div class="grid2"><div><label class="f">Téléphone</label><input id="fPhone" inputmode="tel" value="${esc(v.phone)}"></div>
    <div><label class="f">2e numéro (parent)</label><input id="fPhone2" inputmode="tel" value="${esc(v.phone2)}"></div></div>
    <div class="grid2"><div><label class="f">Source</label><select id="fSource">${["Ads", "Direct", "Recommandation", "WhatsApp", "Instagram", "Autre"].map(o => `<option ${v.source === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>
    <div><label class="f">Recommandé par / détail</label><input id="fSourceNote" value="${esc(v.sourceNote)}"></div></div>
    <div id="fAdsBox" class="${v.source === "Ads" ? "" : "hidden"}"><label class="f">Ads de qui ?</label>
      <div class="opts" id="fAds"><button type="button" data-o="resp" class="${v.adsOwner === "resp" ? "on" : ""}">Ads de ${esc(CONFIG.respName)}</button><button type="button" data-o="admin" class="${v.adsOwner === "admin" ? "on" : ""}">Ads de ${esc(CONFIG.adminName)}</button></div></div>
    <label class="f">Groupe</label><select id="fGroup">${groupOptions(v.groupId)}</select>
    <div class="grid2"><div><label class="f">Date de début des cours</label><input id="fStart" type="date" value="${esc(v.startDate)}"></div>
    <div><label class="f">Mensualité (DH)</label><input id="fMonthly" type="number" inputmode="numeric" value="${esc(v.monthly)}"></div></div>
    ${s ? `<div class="grid2"><div><label class="f">Prochain paiement</label><input id="fNext" type="date" value="${esc(v.nextDue)}"></div>
    <div><label class="f">Reste à payer (DH)</label><input id="fBal" type="number" value="${esc(v.balance || 0)}"></div></div>
    <label class="f">Statut</label><select id="fStatus">${["actif", "à vérifier", "arrêté", "parti"].map(o => `<option ${v.status === o ? "selected" : ""}>${o}</option>`).join("")}</select>`
    : `<label class="f">Formule</label>
      <div class="opts" id="fPack"><button type="button" data-k="m1" class="on">1 mois<br><small>inscription + 1er mois</small></button><button type="button" data-k="m3">${CONFIG.offer.prepayMonths} mois d'avance<br><small>inscription offerte 🎁</small></button></div>
      <div class="alert t" id="fCalc" style="margin-top:10px"></div>
      <label class="f">Payé aujourd'hui (DH)</label><input id="fPaid" type="number" inputmode="numeric">`}
    <label class="f">Note</label><textarea id="fNotes" rows="2">${esc(v.notes)}</textarea>
    <div class="row-btns">${s && isAdmin() ? `<button class="btn line" id="fDel">🗑️</button>` : ""}<button class="btn pri" id="fSave">Enregistrer</button></div>
  `, (root, close) => {
    let adsOwner = v.adsOwner || "";
    root.querySelector("#fSource").onchange = e => root.querySelector("#fAdsBox").classList.toggle("hidden", e.target.value !== "Ads");
    root.querySelector("#fAds").onclick = e => { const b = e.target.closest("button"); if (!b) return; adsOwner = b.dataset.o; root.querySelectorAll("#fAds button").forEach(x => x.classList.toggle("on", x === b)); };
    const mon = root.querySelector("#fMonthly"), paid = root.querySelector("#fPaid");
    let pack = "m1";
    const O = CONFIG.offer;
    const calc = () => {
      const m = Number(mon.value || 0), book = m < O.price ? O.bookPrice : 0;
      const months = pack === "m3" ? O.prepayMonths : 1, reg = pack === "m3" ? 0 : CONFIG.regFee;
      const total = reg + m * months + book;
      const box = root.querySelector("#fCalc");
      if (box) box.innerHTML = `${ic("info", 18)}<div>${reg ? `Inscription ${reg} + ` : "Inscription offerte + "}${months} × ${m} DH${book ? ` + livre & cahier ${book} DH <small>(offerts seulement à ${O.price} DH)</small>` : " · livre & cahier offerts ✓"}<br><b>Total : ${fmtDH(total)}</b>${m && m < O.floor ? `<br>⚠️ En dessous du prix minimum (${O.floor} DH)` : ""}</div>`;
      return total;
    };
    if (paid) {
      paid.value = calc();
      mon.oninput = () => (paid.value = calc());
      root.querySelector("#fPack").onclick = e => { const b = e.target.closest("button"); if (!b) return; pack = b.dataset.k; root.querySelectorAll("#fPack button").forEach(x => x.classList.toggle("on", x === b)); paid.value = calc(); };
    }
    root.querySelector("#fSave").onclick = async () => {
      const o = {
        name: val(root, "fName"), phone: val(root, "fPhone"), phone2: val(root, "fPhone2"), source: val(root, "fSource"), sourceNote: val(root, "fSourceNote"),
        groupId: val(root, "fGroup"), startDate: val(root, "fStart"), monthly: Number(val(root, "fMonthly")) || 0, notes: val(root, "fNotes")
      };
      if (!o.name) return toast("Ajoute le nom");
      if (o.source === "Ads" && !adsOwner) return toast(`Choisis : Ads de ${CONFIG.respName} ou de ${CONFIG.adminName}`);
      o.adsOwner = o.source === "Ads" ? adsOwner : "";
      if (s) {
        o.nextDue = val(root, "fNext"); o.balance = Number(val(root, "fBal")) || 0; o.status = val(root, "fStatus");
        if (!o.nextDue && o.startDate) o.nextDue = addMonths(o.startDate, 1);
        await update("students", s.id, o);
      } else {
        if (o.monthly && o.monthly < CONFIG.offer.floor && !(await askConfirm(`Mensualité ${o.monthly} DH : en dessous du minimum (${CONFIG.offer.floor} DH). Continuer ?`))) return;
        const p = Number(val(root, "fPaid")) || 0, due = calc(), months = pack === "m3" ? CONFIG.offer.prepayMonths : 1;
        o.status = "actif"; o.regDate = TODAY(); o.balance = Math.max(0, due - p); o.pack = pack; o.bookPaid = o.monthly < CONFIG.offer.price;
        o.nextDue = o.startDate ? addMonths(o.startDate, months) : "";
        const id = await add("students", o);
        if (p) await add("payments", { studentId: id, amount: p, date: TODAY(), label: o.balance ? "Inscription + avance" : pack === "m3" ? `${months} mois d'avance (inscription offerte)` : "Inscription + 1er mois", type: "inscription", mode: "Espèces" });
        if (prefill.prospectId) await update("prospects", prefill.prospectId, { status: "Inscrit", studentId: id });
      }
      close(); toast("Enregistré ✅");
    };
    const del = root.querySelector("#fDel");
    if (del) del.onclick = async () => { if (await askConfirm("Supprimer cet élève ?")) { await remove("students", s.id); close(); toast("Supprimé"); } };
  });
}

function moveForm(s) {
  sheet(`<h2>Changer de groupe</h2><div class="sub">${esc(s.name)} · actuellement : ${esc(groupName(s.groupId))}</div>
    <label class="f">Nouveau groupe</label><select id="mGroup">${data.groups.filter(g => g.id !== s.groupId).map(g => {
      const n = data.students.filter(x => x.groupId === g.id && x.status === "actif").length;
      return `<option value="${g.id}">${esc(g.name)} · Prof ${esc(g.prof)} · ${n}/${g.capacity || 12}</option>`; }).join("")}</select>
    <div class="grid2"><div><label class="f">À partir du</label><input type="date" id="mDate" value="${TODAY()}"></div><div></div></div>
    <label class="f">Raison (facultatif)</label><input id="mReason" placeholder="ex : horaire du travail">
    <div class="alert" style="margin-top:14px">ℹ️ La date de paiement ne change pas. Les absences restent dans l'historique.</div>
    <div class="row-btns"><button class="btn pri" id="mSave">Confirmer le changement</button></div>`,
    (root, close) => root.querySelector("#mSave").onclick = async () => {
      const to = val(root, "mGroup"); if (!to) return toast("Choisis un groupe");
      await update("students", s.id, { groupId: to, groupHistory: [...(s.groupHistory || []), { from: s.groupId || "", to, date: val(root, "mDate"), by: session.user.name, reason: val(root, "mReason") }] });
      close(); toast("Groupe changé ✅");
    });
}

function paymentForm(s, kind) {
  if (!s) return;
  const isReste = kind === "reste" || (Number(s.balance) > 0 && !s.nextDue);
  sheet(`
    <h2>Encaisser — ${esc(s.name)}</h2>
    <div class="sub">${s.nextDue ? "Mensualité prévue le " + fmtDate(s.nextDue) : "Pas de date de paiement"}${Number(s.balance) > 0 ? " · reste " + fmtDH(s.balance) : ""}</div>
    <label class="f">Type</label>
    <select id="pType"><option value="mensuel" ${!isReste ? "selected" : ""}>Mensualité (passe au mois suivant)</option><option value="reste" ${isReste ? "selected" : ""}>Reste / avance</option><option value="inscription">Inscription</option><option value="autre">Autre</option></select>
    <div class="grid2"><div><label class="f">Montant (DH)</label><input id="pAmt" type="number" inputmode="numeric" value="${isReste ? s.balance : s.monthly}"></div>
    <div><label class="f">Date</label><input id="pDate" type="date" value="${TODAY()}"></div></div>
    <label class="f">Mode</label><select id="pMode"><option>Espèces</option><option>Virement</option><option>Cash Plus</option><option>Chèque</option></select>
    <label class="f">Note</label><input id="pNote" placeholder="facultatif">
    <div class="alert" id="pInfo" style="margin-top:14px"></div>
    <div class="row-btns"><button class="btn pri" id="pSave">Confirmer le paiement</button></div>
  `, (root, close) => {
    const t = root.querySelector("#pType"), a = root.querySelector("#pAmt"), info = root.querySelector("#pInfo");
    const upd = () => {
      if (t.value === "mensuel") { const base = s.nextDue || (s.startDate ? addMonths(s.startDate, 1) : TODAY()); info.innerHTML = `📅 Prochain paiement : <b>${fmtDate(addMonths(base, 1))}</b>`; }
      else if (t.value === "reste") info.innerHTML = `💸 Nouveau reste : <b>${fmtDH(Math.max(0, Number(s.balance || 0) - Number(a.value || 0)))}</b>`;
      else info.innerHTML = "ℹ️ Enregistré dans l'historique.";
    };
    t.onchange = () => { a.value = t.value === "mensuel" ? s.monthly : t.value === "reste" ? s.balance : t.value === "inscription" ? CONFIG.regFee : ""; upd(); };
    a.oninput = upd; upd();
    root.querySelector("#pSave").onclick = async () => {
      const amount = Number(a.value) || 0; if (!amount) return toast("Montant ?");
      const type = t.value, labels = { mensuel: "Mensualité", reste: "Reste", inscription: "Inscription", autre: "Autre" };
      await add("payments", { studentId: s.id, amount, date: val(root, "pDate"), type, label: labels[type] + (val(root, "pNote") ? " — " + val(root, "pNote") : ""), mode: val(root, "pMode") });
      const patch = {};
      if (type === "mensuel") patch.nextDue = addMonths(s.nextDue || (s.startDate ? addMonths(s.startDate, 1) : TODAY()), 1);
      if (type === "reste") patch.balance = Math.max(0, Number(s.balance || 0) - amount);
      if (Object.keys(patch).length) await update("students", s.id, patch);
      close(); toast("Paiement enregistré 💰");
      receiptSheet(s, amount, labels[type], val(root, "pDate"));
    };
  });
}

function receiptSheet(s, amount, label, date) {
  const txt = `✅ ${CONFIG.centerName} — Reçu de paiement\nÉlève : ${s.name}\n${label} : ${fmtDH(amount)}\nDate : ${fmtDate(date)}/${date.slice(0, 4)}\nMerci pour votre confiance 🙏`;
  const back = () => { if (state.case) setTimeout(() => caseSheet(state.case), 250); };
  if (!s.phone) return back();
  sheet(`<h2>Envoyer le reçu ?</h2><div class="sub">Le reçu part sur WhatsApp de l'élève.</div>
    <pre style="white-space:pre-wrap;background:var(--teal-ll);border-radius:14px;padding:12px;font-family:inherit;font-size:14px">${esc(txt)}</pre>
    <div class="row-btns"><button class="btn line" id="rNo">Plus tard</button><a class="btn yel" target="_blank" href="${waLink(s.phone, txt)}" id="rGo">💬 Envoyer</a></div>`,
    (root, close) => { root.querySelector("#rNo").onclick = () => { close(); back(); }; root.querySelector("#rGo").addEventListener("click", () => setTimeout(() => { close(); back(); }, 300)); });
}

/* ======================= PRÉSENCE ======================= */
function viewAttendance() {
  if (!state.attGroup) state.attGroup = data.groups[0]?.id || "";
  const g = data.groups.find(x => x.id === state.attGroup);
  const studs = data.students.filter(s => s.groupId === state.attGroup && !isOut(s)).sort((a, b) => a.name.localeCompare(b.name));
  const docId = `${state.attGroup}_${state.attDate}`;
  const existing = data.attendance.find(a => a.id === docId);
  if (!state.attDraft || state.attDraft.id !== docId) state.attDraft = { id: docId, absents: new Set(existing?.absents || []), notes: { ...(existing?.notes || {}) } };
  const absN = state.attDraft.absents.size;
  const history = data.attendance.filter(a => a.groupId === state.attGroup).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  $("#view").innerHTML = `
    <div class="filters" id="attG">${data.groups.map(x => `<button data-g="${x.id}" class="${x.id === state.attGroup ? "on" : ""}">${esc(x.name)}</button>`).join("")}</div>
    <div class="card" style="display:flex;gap:10px;align-items:center">
      <div style="flex:1"><b>${esc(g?.name || "")}</b><div class="sub" style="font-size:12px;color:var(--mute)">Prof ${esc(g?.prof || "")} · ${studs.length} élèves</div></div>
      <input type="date" id="attDate" value="${state.attDate}" style="width:auto">
    </div>
    ${existing ? `<p class="sub" style="font-size:12px;color:var(--mute);margin:8px 4px">✓ Déjà enregistrée par ${esc(existing.updatedBy || "")} — tu peux modifier.</p>` : ""}
    <h3 class="sec">Appel <span class="count">${studs.length - absN} présents · ${absN} absents</span></h3>
    <div class="list">${studs.map(s => {
      const ab = state.attDraft.absents.has(s.id);
      const txt = ab ? `السلام عليكم ${s.name.split(" ")[0]}، لاحظنا بلي غبتي اليوم على الحصة ديال ${CONFIG.centerName}. كلشي مزيان؟ 🙏` : `السلام عليكم ${s.name.split(" ")[0]} 👋`;
      return `<div class="att" style="flex-wrap:wrap"><div class="av">${initials(s.name)}</div><div class="mid"><b style="font-size:14px">${esc(s.name)}</b></div>
        ${waBtn(s.phone, txt, "student", s.id, ab ? "Absence" : "Message")}
        <div class="toggle" data-s="${s.id}"><button class="p ${!ab ? "on" : ""}">Présent</button><button class="a ${ab ? "on" : ""}">Absent</button></div>
        ${ab ? `<input class="absnote" data-note="${s.id}" placeholder="Remarque (raison de l'absence, prévenu ?…)" value="${esc(state.attDraft.notes[s.id] || "")}">` : ""}</div>`;
    }).join("") || `<div class="empty">Aucun élève dans ce groupe</div>`}</div>
    ${studs.length ? `<div style="height:14px"></div><button class="btn pri block" id="attSave">${ic("check", 18)} Enregistrer la présence</button>` : ""}
    <h3 class="sec">Dernières séances <span class="count">${history.length}</span></h3>
    <div class="list">${history.map(h => `<div class="item"><div class="mid"><div class="nm">${fmtDate(h.date)}</div><div class="meta" style="white-space:normal">${(h.absents || []).length ? "Absents : " + h.absents.map(id => esc(studentById(id)?.name || "?") + ((h.notes || {})[id] ? " (" + esc(h.notes[id]) + ")" : "")).join(", ") : "Tout le monde présent 🎉"}</div></div></div>`).join("") || `<div class="empty">Pas encore de séance enregistrée</div>`}</div>`;

  $("#attG").onclick = e => { const b = e.target.closest("button"); if (b) { state.attGroup = b.dataset.g; viewAttendance(); } };
  $("#attDate").onchange = e => { state.attDate = e.target.value; viewAttendance(); };
  $("#view").querySelectorAll(".toggle").forEach(t => t.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const set = state.attDraft.absents; b.classList.contains("a") ? set.add(t.dataset.s) : set.delete(t.dataset.s); viewAttendance();
  });
  $("#view").querySelectorAll("[data-note]").forEach(i => i.oninput = () => (state.attDraft.notes[i.dataset.note] = i.value));
  const sv = $("#attSave");
  if (sv) sv.onclick = async () => {
    const absents = [...state.attDraft.absents], presents = studs.map(s => s.id).filter(id => !absents.includes(id));
    const notes = Object.fromEntries(Object.entries(state.attDraft.notes).filter(([k, v]) => absents.includes(k) && v));
    if (existing) await update("attendance", docId, { absents, presents, notes });
    else await add("attendance", { id: docId, groupId: state.attGroup, date: state.attDate, absents, presents, notes });
    toast("Présence enregistrée ✅");
  };
}

/* ======================= PROSPECTS ======================= */
const PSTAT = ["Nouveau", "Intéressé", "RDV", "Test de niveau", "Inscrit", "Perdu"];
/* ======================= ASSISTANT D'OFFRES (méthode Hormozi : valeur > prix) ======================= */
const GOALS = {
  ausbildung: { label: "Ausbildung en Allemagne", hook: "باش توصل للـ Ausbildung فألمانيا، اللغة هي المفتاح الأول", focus: "غادي نوجدوك للنيفو اللي كيطلبو (A2/B1) وحتى للـ entretien" },
  travail: { label: "Travailler en Allemagne (métier)", hook: "الحرفة ديالك مطلوبة فألمانيا، واللغة هي اللي باقية ليك", focus: "كنقريو بطريقة عملية: الهضرة ديال الخدمة والحياة اليومية" },
  carriere: { label: "Changer de carrière (travaille déjà)", hook: "تقدر تكمل خدمتك وتوجد مستقبلك فنفس الوقت", focus: "عندنا گروپ العشية، وكتراجع فالدار مع التمارين ديال كل نهار" },
  examen: { label: "Réussir l'examen (Goethe / ÖSD)", hook: "باش تنجح فالامتحان، خاصك أستاذ يتبعك خطوة بخطوة", focus: "تمارين كل نهار وتصحيح الـ vocaux، وضمانة النجاح ديالنا" },
  famille: { label: "Rejoindre famille / conjoint", hook: "باش تعيش مرتاح من النهار الأول فألمانيا مع العائلة ديالك", focus: "كنركزو على الهضرة ديال كل نهار، ومن A2 كتهضر كل سيمانة مع الألمان" },
  autre: { label: "Autre", hook: "اللغة الألمانية كتحل ليك بزاف ديال الأبواب", focus: "غادي نتبعوك من الصفر حتى تهضر" }
};
const SITUATIONS = [
  ["premier", "Premier contact"], ["cher", "Trouve ça cher"], ["reflechit", "Réfléchit encore"],
  ["silence", "Ne répond plus"], ["pret", "Prêt à s'inscrire"]
];
/* 3 propositions de prix à chaque fois : Premium / Recommandé / Économique (avec 2 variantes chacune, qui tournent) */
function offerCatalog() {
  const O = CONFIG.offer, R = CONFIG.regFee, P = O.price, k = O.prepayMonths;
  return {
    premium: [
      { name: `Pack ${k} mois`, lines: [`${k} × ${P} = ${P * k} DH`, "Inscription offerte (−" + R + " DH)", "Livre & cahier offerts"], day1: P * k, ar: `${k} شهور مرة وحدة: ${P * k} DH، والتسجيل فابور (كتربح ${R} DH) والكتاب والدفتر فابور` },
      { name: "Pack 2 mois", lines: [`2 × ${P} = ${P * 2} DH`, `Inscription ${R} DH`, "Livre & cahier offerts + place réservée"], day1: P * 2 + R, ar: `جوج شهور مرة وحدة: ${P * 2} DH + التسجيل ${R} DH، والكتاب والدفتر فابور، والبلاصة ديالك محجوزة` }
    ],
    reco: [
      { name: "Pack Complet", lines: [`${P} DH / mois`, `Inscription ${R} DH`, "Livre & cahier offerts · tous les bonus"], day1: P + R, ar: `${P} DH فالشهر + التسجيل ${R} DH، والكتاب والدفتر فابور مع كاع الـ bonus` },
      { name: "Pack Complet en 2 fois", lines: [`${P} DH / mois payés en 2 fois (${P / 2} + ${P / 2})`, `Inscription ${R} DH`, "Livre & cahier offerts"], day1: P / 2 + R, ar: `${P} DH فالشهر ولكن كتخلصها على جوج مرات (${P / 2} + ${P / 2})، والكتاب والدفتر فابور` }
    ],
    eco: [
      { name: "Pack Essentiel", lines: [`${O.floor + 50} DH / mois`, `Inscription ${R} DH`, `Livre & cahier ${O.bookPrice} DH`], day1: O.floor + 50 + R + O.bookPrice, ar: `${O.floor + 50} DH فالشهر + التسجيل ${R} DH، والكتاب والدفتر بـ ${O.bookPrice} DH` },
      { name: "Pack Mini", lines: [`${O.floor} DH / mois · 2 mois payés d'avance (${O.floor * 2} DH)`, `Inscription ${R} DH`, `Livre & cahier ${O.bookPrice} DH`], day1: O.floor * 2 + R + O.bookPrice, ar: `${O.floor} DH فالشهر إلا خلصتي جوج شهور مرة وحدة (${O.floor * 2} DH) + التسجيل ${R} DH، والكتاب والدفتر بـ ${O.bookPrice} DH` }
    ]
  };
}
function pick3(p, shift = 0) {
  const C = offerCatalog(), h = [...(p.id || "x")].reduce((t, c) => t + c.charCodeAt(0), 0) + Number(TODAY().slice(8)) + shift;
  return [["premium", "Premium", C.premium[h % 2]], ["reco", "Recommandé", C.reco[(h + 1) % 2]], ["eco", "Économique", C.eco[h % 2]]];
}
function bestGroup() {
  return data.groups.map(g => ({ g, free: (Number(g.capacity) || 12) - data.students.filter(s => s.groupId === g.id && s.status === "actif").length }))
    .filter(x => x.free > 0).sort((a, b) => a.free - b.free)[0];
}
function offerText(p, sit, shift = 0) {
  const three = pick3(p, shift).map(([, , o], i) => `${["1️⃣", "2️⃣", "3️⃣"][i]} ${o.ar}`).join("\n");
  const O = CONFIG.offer, G = GOALS[p.goal] || GOALS.autre, n = p.name ? " " + p.name.split(" ")[0] : "";
  const bg = bestGroup(), grp = bg ? `${bg.g.schedule || bg.g.name}` : "", places = bg ? bg.free : "";
  const stack = `📘 كتاب ودفتر خاصين بـ Talkify (قيمتهم 250 DH) فابور
💬 گروپ واتساب مع الأستاذ: تمارين كل نهار، تصحيح الـ vocaux، وجواب على أسئلتك
🗣️ من A2: حصة أونلاين كل سيمانة مع ألماني (ساعتين)
💻 الپلاتفورم ديال المراجعة فالدار فابور نهار تتلانسا
🛡️ ضمانة النجاح: إلا حضرتي لكاع الحصص وما نجحتيش فالامتحان، كنزيدوك شهر ديال التحضير فابور`;
  switch (sit) {
    case "premier": return `السلام عليكم${n} 👋 معاك ${CONFIG.centerName}.
${G.hook}. ${G.focus}.

مع Talkify كتاخد:
${stack}

✅ الحصة اللولة فابور باش تجرب قبل ما تخلص.
واش نحجز ليك الحصة اللولة${grp ? ` فگروپ ${grp}` : ""}؟`;
    case "cher": return `فاهمك${n} 🙏 الثمن مهم، وحنا بغيناك تقرا مرتاح.
بـ ${O.price} DH فالشهر، ماشي غير الدروس اللي كتاخد:
${stack}

يعني كتخلص على حاجة كتوصلك للهدف ديالك، ماشي غير على ساعات.
وباش يكون ساهل عليك، عندنا 3 د الحلول:
${three}
${grp ? `باقيين ${places} بلايص فگروپ ${grp}. ` : ""}شمن حل كيناسبك؟`;
    case "reflechit": return `السلام عليكم${n} 👋 غير بغيت نقولك بلي ${grp ? `گروپ ${grp} باقيين فيه غير ${places} بلايص` : "البلايص ديال الگروپ الجاي قلال"}، وكل گروپ فيه ${O.groupSize} بلاصة بالضبط باش الأستاذ يتبع مع كل واحد.
${G.hook}، وكل سيمانة كتمشي كتأخر عليك الهدف.
الحصة اللولة فابور، جرب وعاد قرر. واش نحجزها ليك هاد السيمانة؟`;
    case "silence": return `السلام عليكم${n} 👋 معاك ${CONFIG.centerName}. واش مازال باغي تقرا الألمانية؟
جاوبني غير بـ "إيه" ولا "لا" باش نعرف واش نخلي ليك البلاصة 🙏`;
    case "pret": return `مرحبا بيك فـ ${CONFIG.centerName}${n} 🎉
ختار الطريقة اللي كتناسبك للخلاص:
${three}
${grp ? `البلاصة ديالك فگروپ ${grp}. ` : ""}شوقتاش تقدر تدوز للمركز؟`;
  }
}
function offerSheet(p, sit = "", shift = 0) {
  if (!sit) sit = { "Nouveau": "premier", "Intéressé": "reflechit", "RDV": "pret", "Test de niveau": "pret", "Perdu": "silence" }[p.status] || "premier";
  sheet(`<div class="case-head"><span class="c-ic">✨</span><div><h2>Offre pour ${esc(p.name || p.phone)}</h2><div class="sub">${p.goal ? GOALS[p.goal].label : "Objectif pas encore demandé"}</div></div></div>
    ${!p.goal ? `<div class="alert" style="margin-top:12px">${ic("info", 18)}<div>Demande-lui <b>pourquoi il/elle veut apprendre l'allemand</b> (Ausbildung, travail, examen…) puis ouvre « Modifier » : le Message sera plus convaincant.</div></div>` : ""}
    <label class="f">Situation</label>
    <div class="filters" id="ofS">${SITUATIONS.map(([k, l]) => `<button data-k="${k}" class="${k === sit ? "on" : ""}">${l}</button>`).join("")}</div>
    <h3 class="sec">3 propositions de prix <button class="link" id="ofRot">↻ Autres propositions</button></h3>
    <div class="offers3">${pick3(p, shift).map(([k, l, o]) => `<div class="of3 ${k}"><span class="tier">${l}</span><b>${esc(o.name)}</b>${o.lines.map(x => `<small>${esc(x)}</small>`).join("")}<em>Jour 1 : ${fmtDH(o.day1)}</em></div>`).join("")}</div>
    <label class="f">Message ${["cher", "pret"].includes(sit) ? "(avec les 3 propositions)" : ""}</label>
    <textarea id="ofT" rows="12" style="font-size:14px;line-height:1.5" dir="auto">${esc(offerText(p, sit, shift))}</textarea>
    <div class="how" style="margin-top:12px"><b>Règles de l'offre</b><ol>
      <li>Prix officiel ${CONFIG.offer.price} DH + inscription ${CONFIG.regFee} DH → livre & cahier offerts</li>
      <li>Jamais en dessous de ${CONFIG.offer.floor} DH · si moins de ${CONFIG.offer.price}, livre & cahier = ${CONFIG.offer.bookPrice} DH</li>
      <li>${CONFIG.offer.prepayMonths} mois payés d'avance → inscription offerte</li>
      <li>Les 3 propositions changent d'un client à l'autre : propose toujours le Premium en premier</li>
      <li>1re séance gratuite · garantie : 1 mois de préparation offert si échec malgré 100 % de présence</li></ol></div>
    <div class="row-btns"><button class="btn line" id="ofCopy">Copier</button>${p.phone ? `<a class="btn pri" id="ofSend" target="_blank" href="#">${ic("msg", 18)} Envoyer sur WhatsApp</a>` : ""}</div>`,
    (root, close) => {
      root.querySelector("#ofS").onclick = e => { const b = e.target.closest("button"); if (!b) return; close(); offerSheet(p, b.dataset.k, shift); };
      root.querySelector("#ofRot").onclick = () => { close(); offerSheet(p, sit, shift + 1); };
      const t = root.querySelector("#ofT");
      root.querySelector("#ofCopy").onclick = async () => { try { await navigator.clipboard.writeText(t.value); toast("Copié ✅"); } catch (e) { t.select(); toast("Sélectionné : copie-le"); } };
      const sd = root.querySelector("#ofSend");
      if (sd) sd.addEventListener("click", () => { sd.href = waLink(p.phone, t.value); const lbl = SITUATIONS.find(x => x[0] === sit)[1]; setTimeout(() => { close(); contactLogSheet("prospect", p.id, "Offre · " + lbl); }, 400); });
    });
}

// Messages rapides par étape

function proMsg(p) {
  const n = p.name ? " " + p.name : "";
  const M = {
    "Nouveau": `السلام عليكم${n} 👋 معاك ${CONFIG.centerName}. شكرا على الاهتمام ديالك! باش نعاونوك، شنو هي اللغة اللي بغيتي تقرا، وشمن وقت كيناسبك: الصباح، 12h ولا العشية؟`,
    "Intéressé": `السلام عليكم${n} 👋 معاك ${CONFIG.centerName}. عندنا بلايص باقية فالگروپ اللي كيناسبك. واش نحجزو ليك موعد تجي تشوف المركز وتدير test de niveau فابور؟`,
    "RDV": `السلام عليكم${n} 👋 كنفكروك بالموعد ديالك فـ ${CONFIG.centerName}. كنتسناوك! إلا كان شي تغيير قول لينا 🙏`,
    "Test de niveau": `السلام عليكم${n} 👋 شكرا على الـ test de niveau. الگروپ اللي مناسب ليك عندو بلايص قليلة باقية، واش نسجلوك هاد السيمانة؟`,
    "Perdu": `السلام عليكم${n} 👋 معاك ${CONFIG.centerName}. عندنا گروپ جديد غادي يبدا قريب، واش مازال مهتم؟`
  };
  return M[p.status] || M["Nouveau"];
}
const isRelance = p => p.nextFollow && p.nextFollow <= TODAY() && !["Inscrit", "Perdu"].includes(p.status);
function prospectRow(p) {
  const late = isRelance(p);
  return `<div class="item" data-pro="${p.id}"><div class="av">${initials(p.name || "?")}</div>
    <div class="mid"><div class="nm">${esc(p.name || "Sans nom")}</div><div class="meta">${esc(p.phone || "Pas de numéro")} · ${esc(p.level || "")} · ${esc(p.source || "")}</div>
    <div style="margin-top:4px"><span class="chip ${p.status === "Inscrit" ? "st-ok" : p.status === "Perdu" ? "st-off" : "st-soon"}">${esc(p.status)}</span>${late ? ` <span class="chip st-late">Relance ${p.nextFollow < TODAY() ? "en retard" : "aujourd'hui"}</span>` : p.nextFollow && !["Inscrit", "Perdu"].includes(p.status) ? ` <span class="chip st-missing">Relance ${fmtDate(p.nextFollow)}</span>` : ""}</div></div>
    <div class="end"><button class="wa y" data-offer="${p.id}" title="Proposer une offre">✨</button>${waBtn(p.phone, proMsg(p), "prospect", p.id, "Relance · " + p.status)}</div></div>`;
}
const PCASES = [
  { k: "relance", t: "À relancer aujourd'hui", icon: "alert", cls: n => n ? "k-red" : "k-soft", f: isRelance,
    how: ["Envoie le Message 💬 (il est déjà écrit selon l'étape)", "Note la réponse", "Choisis la date de la prochaine relance"] },
  { k: "Nouveau", t: "Nouveaux", icon: "userPlus", cls: () => "k-teal", f: p => p.status === "Nouveau",
    how: ["Premier contact : présente Talkify", "Demande la langue et l'horaire qui lui convient", "S'il/elle est intéressé(e) → statut « Intéressé »"] },
  { k: "Intéressé", t: "Intéressés", icon: "target", cls: () => "k-yel", f: p => p.status === "Intéressé",
    how: ["Propose un groupe qui a des places libres", "Propose un RDV au centre ou un test de niveau", "Note la date du RDV"] },
  { k: "RDV", t: "RDV pris", icon: "calendar", cls: () => "k-dark", f: p => p.status === "RDV",
    how: ["Envoie un rappel la veille du RDV", "Accueille la personne au centre", "Après le RDV → « Test de niveau » ou « Inscrire »"] },
  { k: "Test de niveau", t: "Test de niveau", icon: "file", cls: () => "k-orange", f: p => p.status === "Test de niveau",
    how: ["Donne le résultat du test", "Propose le groupe adapté", "Touche « Inscrire » pour remplir la fiche"] },
  { k: "Inscrit", t: "Inscrits", icon: "check", cls: () => "k-soft", f: p => p.status === "Inscrit",
    how: ["Bravo 🎉 ces prospects sont devenus élèves", "Leur fiche est dans « Élèves »"] },
  { k: "Perdu", t: "Perdus", icon: "userX", cls: () => "k-rsoft", f: p => p.status === "Perdu",
    how: ["Relance dans 1 mois avec un nouveau groupe", "Note pourquoi (prix, horaire, distance…)"] }
];
function viewProspects() {
  const total = data.prospects.length, conv = data.prospects.filter(p => p.status === "Inscrit").length;
  const enCours = data.prospects.filter(p => !["Inscrit", "Perdu"].includes(p.status)).length;
  const month = TODAY().slice(0, 7);
  const contactedMonth = new Set((data.contacts || []).filter(c => c.type === "prospect" && (c.date || "").startsWith(month)).map(c => c.targetId)).size;
  const q = state.pq.toLowerCase();
  const found = q ? data.prospects.filter(p => ((p.name || "") + (p.phone || "")).toLowerCase().includes(q)) : [];
  const box = c => { const list = data.prospects.filter(c.f), n = list.length;
    return { n, html: `<button class="case ${c.cls(n)}" data-pc="${c.k}"><span class="c-row"><span class="c-ic">${ic(c.icon, 18)}</span><span class="c-n">${n}</span></span><span class="c-t">${c.t}</span><span class="c-s">${n ? list.slice(0, 2).map(p => esc(p.name || p.phone)).join(", ") + (n > 2 ? "…" : "") : "Personne"}</span><span class="c-foot"><span>&nbsp;</span><span class="c-go">Voir ${ic("chev", 14, 2.6)}</span></span></button>` }; };
  const boxes = PCASES.map(box);
  $("#view").innerHTML = `
    <div class="day">
      <div class="hi">Suivi des prospects</div>
      <h2>${enCours} en cours</h2>
      <div class="prog"><span>Taux de conversion</span><span><b>${total ? Math.round(conv / total * 100) : 0}%</b> (${conv}/${total} inscrits)</span></div>
      <div class="bar"><i style="width:${total ? conv / total * 100 : 0}%"></i></div>
      <div class="money m2">
        <div class="wide" data-pc="relance"><small>À relancer aujourd'hui</small><b>${boxes[0].n}</b></div>
        <div><small>Contactés ce mois</small><b>${contactedMonth}</b></div>
        <div><small>Total prospects</small><b>${total}</b></div>
      </div>
    </div>
    <div class="search" style="margin-top:14px">${ic("search", 18)}<input id="pq" placeholder="Chercher un prospect (nom ou numéro)" value="${esc(state.pq)}"></div>
    ${q ? `<div class="list">${found.map(prospectRow).join("") || `<div class="empty">Aucun prospect trouvé</div>`}</div>` : `
    <h3 class="sec">Étapes <span class="count">touche une case</span></h3>
    <div class="cases">${[...boxes.filter((b, i) => i === 0 || b.n), ...boxes.filter((b, i) => i !== 0 && !b.n)].map(b => b.html).join("")}</div>`}`;
  $("#view").querySelectorAll("[data-pc]").forEach(b => b.onclick = () => prospectCase(b.dataset.pc));
  const qi = $("#pq"); qi.oninput = () => { state.pq = qi.value; const pos = qi.selectionStart; viewProspects(); const n = $("#pq"); n.focus(); n.setSelectionRange(pos, pos); };
  bindRows();
}
function prospectCase(k) {
  state.case = "";
  const c = PCASES.find(x => x.k === k), list = data.prospects.filter(c.f).sort((a, b) => (a.nextFollow || "9").localeCompare(b.nextFollow || "9"));
  sheet(`<div class="case-head"><span class="c-ic">${ic(c.icon, 22)}</span><div><h2>${c.t}</h2><div class="sub">${list.length} prospect(s)</div></div></div>
    <div class="how"><b>Ce qu'il faut faire</b><ol>${c.how.map(x => `<li>${x}</li>`).join("")}</ol></div>
    <div class="list">${list.map(prospectRow).join("") || `<div class="empty">Personne à cette étape</div>`}</div>
    <button class="btn yel block" id="pcAdd" style="margin-top:12px">${ic("plus", 18)} Nouveau prospect</button>`,
    (root, close) => { bindRows(root, close); root.querySelector("#pcAdd").onclick = () => { close(); prospectForm(); }; });
}
function prospectSheet(p) {
  if (!p) return;
  sheet(`<h2>${esc(p.name || "Sans nom")}</h2><div class="sub">${esc(p.phone || "Pas de numéro")}</div>
    <div class="kv"><span>Statut</span><b>${esc(p.status)}</b><span>Source</span><b>${esc(p.source || "—")}</b><span>Niveau</span><b>${esc(p.level || "—")}</b>
    <span>Mode</span><b>${esc(p.mode || "—")}</b><span>Objectif</span><b>${p.goal ? GOALS[p.goal].label : "— à demander"}</b><span>Prochaine relance</span><b>${fmtDate(p.nextFollow)}</b>${p.notes ? `<span>Note</span><b style="font-weight:500">${esc(p.notes)}</b>` : ""}</div>
    <label class="f">Changer le statut</label><div class="filters" id="pst">${PSTAT.map(s => `<button data-s="${s}" class="${p.status === s ? "on" : ""}">${s}</button>`).join("")}</div>
    <button class="btn yel block" id="pOffer" style="margin-top:12px">✨ Proposer une offre (Message prêt)</button>
    <div class="row-btns" style="margin-top:8px"><button class="btn pri" id="pConv">${ic("userPlus", 18)} Inscrire</button><button class="btn line" id="pEdit">${ic("edit", 18)} Modifier</button></div>
    <h3 class="sec">Historique <span class="count">${(p.history || []).length}</span></h3>
    ${(p.history || []).slice().reverse().map(h => `<div class="hist"><div>${esc(h.note)}<small>${fmtDate(h.date)} · ${esc(h.by || "")}</small></div></div>`).join("") || `<div class="empty">Pas encore de suivi</div>`}`,
    (root, close) => {
      root.querySelector("#pst").onclick = async e => {
        const b = e.target.closest("button"); if (!b) return;
        await update("prospects", p.id, { status: b.dataset.s, history: [...(p.history || []), { date: TODAY(), by: session.user.name, note: "Statut → " + b.dataset.s }] });
        close(); toast("Statut mis à jour");
      };
      root.querySelector("#pConv").onclick = () => { close(); studentForm(null, { name: p.name, phone: p.phone, source: p.source, notes: p.notes, prospectId: p.id }); };
      root.querySelector("#pEdit").onclick = () => { close(); prospectForm(p); };
      root.querySelector("#pOffer").onclick = () => { close(); offerSheet(p); };
    });
}
function prospectForm(p = null) {
  const v = p || { status: "Nouveau", source: "Ads", level: "A1", mode: "Présentiel", nextFollow: TODAY() };
  sheet(`<h2>${p ? "Modifier" : "Nouveau prospect"}</h2>
    <div class="grid2"><div><label class="f">Nom</label><input id="qName" value="${esc(v.name)}"></div><div><label class="f">Téléphone</label><input id="qPhone" inputmode="tel" value="${esc(v.phone)}"></div></div>
    <div class="grid2"><div><label class="f">Source</label><select id="qSource">${["Ads", "WhatsApp", "Direct", "Recommandation", "Instagram", "Autre"].map(o => `<option ${v.source === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>
    <div><label class="f">Niveau</label><select id="qLevel">${["A1", "A2", "B1", "B2", "C1", "Accéléré", "Soutien scolaire"].map(o => `<option ${v.level === o ? "selected" : ""}>${o}</option>`).join("")}</select></div></div>
    <div class="grid2"><div><label class="f">Mode</label><select id="qMode">${["Présentiel", "En ligne"].map(o => `<option ${v.mode === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>
    <div><label class="f">Prochaine relance</label><input id="qNext" type="date" value="${esc(v.nextFollow)}"></div></div>
    <label class="f">Pourquoi il/elle veut apprendre l'allemand ?</label><select id="qGoal"><option value="">— Pas encore demandé —</option>${Object.entries(GOALS).map(([k, g]) => `<option value="${k}" ${v.goal === k ? "selected" : ""}>${g.label}</option>`).join("")}</select>
    <label class="f">Statut</label><select id="qStatus">${PSTAT.map(o => `<option ${v.status === o ? "selected" : ""}>${o}</option>`).join("")}</select>
    <label class="f">Note</label><textarea id="qNotes" rows="2">${esc(v.notes)}</textarea>
    <div class="row-btns">${p ? `<button class="btn line" id="qDel">🗑️</button>` : ""}<button class="btn pri" id="qSave">Enregistrer</button></div>`,
    (root, close) => {
      root.querySelector("#qSave").onclick = async () => {
        const o = { name: val(root, "qName"), phone: val(root, "qPhone"), source: val(root, "qSource"), level: val(root, "qLevel"), mode: val(root, "qMode"), nextFollow: val(root, "qNext"), status: val(root, "qStatus"), notes: val(root, "qNotes"), goal: val(root, "qGoal") };
        if (!o.name && !o.phone) return toast("Nom ou numéro ?");
        p ? await update("prospects", p.id, o) : await add("prospects", { ...o, history: [{ date: TODAY(), by: session.user.name, note: "Ajouté" }] });
        close(); toast("Enregistré ✅");
      };
      const d = root.querySelector("#qDel"); if (d) d.onclick = async () => { if (await askConfirm("Supprimer ce prospect ?")) { await remove("prospects", p.id); close(); } };
    });
}

/* ======================= PLUS ======================= */
function viewMore() {
  const groupsHtml = data.groups.map(g => {
    const n = data.students.filter(s => s.groupId === g.id && s.status === "actif").length, cap = Number(g.capacity) || 12;
    return `<div class="groupcard" data-g="${g.id}"><div style="display:flex;justify-content:space-between"><b>${esc(g.name)}</b><span class="chip ${n >= cap ? "st-late" : "st-ok"}">${n}/${cap}</span></div>
      <div class="sub" style="font-size:12px;color:var(--mute)">Prof <b>${esc(g.prof)}</b> · ${esc(g.schedule || "")} · ${esc(g.level || "")} · ${cap - n > 0 ? cap - n + " places libres" : "Complet"}</div>
      <div class="cap"><i class="${n >= cap ? "full" : ""}" style="width:${Math.min(100, n / cap * 100)}%"></i></div></div>`;
  }).join("");
  $("#view").innerHTML = `
    <h3 class="sec">Notifications</h3>
    <div class="card">
      <div class="sub" style="font-size:13px;color:var(--mute)">${isAdmin() ? "Toi : une notification à chaque action de la responsable (paiement, inscription, groupe, modification) + le rapport du soir." : "Chaque matin : prospects à relancer, élèves qui doivent payer ce mois, retards et absences."}</div>
      <div class="row-btns"><button class="btn pri sm" id="pushOn">Activer les notifications</button><button class="btn line sm" id="pushTest">Tester</button></div>
      <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600;font-size:14px">📱 Comment installer l'app</summary>
        <b style="display:block;margin-top:10px">Android</b><ol class="steps"><li>Ouvrir le lien dans <b>Chrome</b></li><li>Menu ⋮ → <b>Installer l'application</b></li><li>Ouvrir l'app → <b>Activer les notifications</b> → Autoriser</li></ol>
        <b style="display:block;margin-top:10px">iPhone</b><ol class="steps"><li>Ouvrir le lien dans <b>Safari</b> (pas Chrome)</li><li>Bouton Partager ⬆️ → <b>Sur l'écran d'accueil</b></li><li>Ouvrir l'app <b>depuis l'icône</b> → Activer les notifications → Autoriser</li></ol>
      </details>
    </div>
    <h3 class="sec">Groupes & profs <span class="count">${data.groups.length}</span></h3>
    <div class="list">${groupsHtml}</div>
    <div style="height:10px"></div><button class="btn ghost block" id="addGroup">${ic("plus", 18)} Nouveau groupe</button>
    <h3 class="sec">Suivi</h3>
    <button class="btn line block" id="journal">Journal des contacts</button>
    <h3 class="sec">Compte</h3>
    <div class="list">
      ${DEMO ? `<button class="btn line block" id="reset">↺ Remettre les données de démo</button>` : ""}
      <button class="btn line block" id="logout">Se déconnecter</button>
    </div>`;
  $("#pushOn").onclick = async () => {
    try { await enablePush(); toast(DEMO ? "Autorisé ✅ (en démo, seul le test marche)" : "Notifications activées ✅"); }
    catch (e) { toast(e.message === "DENIED" ? "Refusé — active-les dans les réglages du téléphone" : "Installe d'abord l'app sur l'écran d'accueil"); }
  };
  $("#pushTest").onclick = async () => { try { if (Notification.permission !== "granted") await enablePush(); await testNotification(); } catch (e) { toast("Active d'abord les notifications"); } };
  $("#logout").onclick = logout;
  $("#journal").onclick = journalSheet;
  const r = $("#reset"); if (r) r.onclick = async () => { if (await askConfirm("Remettre les données de démo ?")) { resetDemo(); toast("Données remises"); } };
  $("#view").querySelectorAll("[data-g]").forEach(c => c.onclick = () => groupForm(data.groups.find(g => g.id === c.dataset.g)));
  $("#addGroup").onclick = () => groupForm();
}

/* ======================= GROUPES (contrôle) ======================= */
const GCOLORS = ["g-teal", "g-dark", "g-yel", "g-orange", "g-soft", "g-red"];
function groupStats(g) {
  const end = monthEnd(TODAY()), month = TODAY().slice(0, 7);
  const st = data.students.filter(s => s.groupId === g.id && s.status === "actif");
  const cap = Number(g.capacity) || 12;
  const paid = st.filter(s => s.nextDue && s.nextDue > end);
  const late = st.filter(s => s.nextDue && s.nextDue < TODAY());
  const toPay = st.filter(s => s.nextDue && s.nextDue >= TODAY() && s.nextDue <= end);
  const noDate = st.filter(s => !s.nextDue);
  const regs = st.filter(s => Number(s.balance) > 0);
  const sessions = data.attendance.filter(a => a.groupId === g.id && (a.date || "").startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const pres = sessions.reduce((t, a) => t + (a.presents || []).length, 0), abs = sessions.reduce((t, a) => t + (a.absents || []).length, 0);
  const rate = pres + abs ? Math.round(pres / (pres + abs) * 100) : null;
  const today = data.attendance.find(a => a.groupId === g.id && a.date === TODAY());
  return { st, n: st.length, cap, free: Math.max(0, cap - st.length), paid, late, toPay, noDate, regs, sessions, abs, rate, today,
    lateAmt: late.reduce((t, s) => t + Number(s.monthly || 0), 0), toPayAmt: [...late, ...toPay].reduce((t, s) => t + Number(s.monthly || 0), 0) };
}
function viewGroups() {
  const all = data.groups.map(g => ({ g, S: groupStats(g) }));
  const tot = all.reduce((t, x) => t + x.S.n, 0), free = all.reduce((t, x) => t + x.S.free, 0);
  const paidN = all.reduce((t, x) => t + x.S.paid.length, 0), lateN = all.reduce((t, x) => t + x.S.late.length, 0);
  $("#view").innerHTML = `
    <div class="gsum">
      <div><b>${data.groups.length}</b><small>Groupes</small></div>
      <div><b>${tot}</b><small>Élèves</small></div>
      <div><b>${free}</b><small>Places libres</small></div>
      <div class="${lateN ? "hot" : ""}"><b>${paidN}/${tot}</b><small>Payé ce mois</small></div>
    </div>
    <div class="gcards">
      ${all.map(({ g, S }, i) => `
        <button class="gcase ${GCOLORS[i % GCOLORS.length]}" data-g="${g.id}">
          <span class="gc-top"><span><b>${esc(g.schedule || g.name)}</b><small>Prof ${esc(g.prof)}${g.level ? " · " + esc(g.level) : ""}</small></span><span class="gc-go">${ic("chev", 18, 2.6)}</span></span>
          <span class="gc-mid"><span class="gc-n">${S.n}<small>/${S.cap}</small></span><span class="gc-free">${S.free ? S.free + " places libres" : "Complet"}</span></span>
          <span class="gc-bar"><i style="width:${Math.min(100, S.n / S.cap * 100)}%"></i></span>
          <span class="gc-stats">
            <span><b>${S.paid.length}</b>payés</span>
            <span><b>${S.toPay.length + S.late.length}</b>à payer</span>
            <span class="${S.late.length ? "red" : ""}"><b>${S.late.length}</b>en retard</span>
            <span><b>${S.rate === null ? "—" : S.rate + "%"}</b>présence</span>
          </span>
          <span class="gc-foot">${S.today ? `✓ Appel fait · ${(S.today.absents || []).length} absent(s)` : "Appel du jour pas encore fait"}${S.noDate.length ? ` · ⚠️ ${S.noDate.length} sans date de début` : ""}</span>
        </button>`).join("")}
      <button class="gcase g-add" id="gNew"><span class="ga-ic">${ic("plus", 26, 2.6)}</span><b>Nouveau groupe</b><small>Horaire, prof, places</small></button>
    </div>`;
  $("#view").querySelectorAll("[data-g]").forEach(b => b.onclick = () => groupSheet(b.dataset.g));
  $("#gNew").onclick = () => groupForm();
}
function groupSheet(id) {
  const g = data.groups.find(x => x.id === id); if (!g) return;
  const S = groupStats(g), i = data.groups.indexOf(g), last = S.sessions[0];
  const st = S.st.slice().sort((a, b) => (a.nextDue || "9").localeCompare(b.nextDue || "9"));
  const absCount = sid => S.sessions.filter(a => (a.absents || []).includes(sid)).length;
  sheet(`
    <div class="gs-head ${GCOLORS[i % GCOLORS.length]}"><div><b>${esc(g.schedule || g.name)}</b><small>${esc(g.name)} · Prof ${esc(g.prof)}${g.level ? " · " + esc(g.level) : ""}</small></div><span class="gc-n">${S.n}<small>/${S.cap}</small></span></div>
    <div class="gs-grid">
      <div><b>${S.free}</b><small>Places libres</small></div>
      <div class="ok"><b>${S.paid.length}</b><small>Payés ce mois</small></div>
      <div class="warn"><b>${S.toPay.length}</b><small>À payer ce mois</small></div>
      <div class="${S.late.length ? "bad" : ""}"><b>${S.late.length}</b><small>En retard${S.late.length ? "<br>" + fmtDH(S.lateAmt) : ""}</small></div>
      <div class="${S.regs.length ? "warn" : ""}"><b>${S.regs.length}</b><small>Restes inscription</small></div>
      <div><b>${S.rate === null ? "—" : S.rate + "%"}</b><small>Présence du mois</small></div>
    </div>
    <div class="how" style="margin-top:12px"><b>Dernier appel</b><div style="margin-top:4px">${last ? `${fmtDate(last.date)} · ${(last.presents || []).length} présent(s), ${(last.absents || []).length} absent(s)${(last.absents || []).length ? " : " + last.absents.map(x => esc(studentById(x)?.name || "?") + ((last.notes || {})[x] ? " (" + esc(last.notes[x]) + ")" : "")).join(", ") : ""}` : "Pas encore d'appel ce mois"}</div></div>
    <div class="row-btns"><button class="btn pri" id="gsAtt">${ic("check", 18)} Faire l'appel</button><button class="btn yel" id="gsAdd">${ic("userPlus", 18)} Ajouter un élève</button></div>
    <h3 class="sec">Élèves du groupe <span class="count">${S.n}</span></h3>
    <div class="list">${st.map(s => { const ps = payStatus(s, TODAY(), CONFIG.remindDaysBefore), ab = absCount(s.id);
      return `<div class="item" data-stu="${s.id}"><div class="av">${initials(s.name)}</div><div class="mid"><div class="nm">${esc(s.name)}</div>
        <div style="margin-top:4px">${chip(ps)}${Number(s.balance) > 0 ? ` <span class="chip st-soon">Reste ${fmtDH(s.balance)}</span>` : ""}${ab ? ` <span class="chip ${ab >= 2 ? "st-late" : "st-missing"}">${ab} abs.</span>` : ""}</div></div>
        ${waBtn(s.phone, "السلام عليكم " + s.name.split(" ")[0] + " 👋", "student", s.id, "Message")}</div>`; }).join("") || `<div class="empty">Pas encore d'élève dans ce groupe</div>`}</div>
    <div class="row-btns"><button class="btn line" id="gsEdit">${ic("edit", 18)} Modifier le groupe</button><button class="btn line" id="gsDel" style="color:#C62828">${ic("trash", 18)} Supprimer</button></div>
  `, (root, close) => {
    bindRows(root, close);
    root.querySelector("#gsAtt").onclick = () => { close(); state.attGroup = g.id; state.attDate = TODAY(); go("attendance"); };
    root.querySelector("#gsAdd").onclick = () => { close(); studentForm(null, { groupId: g.id }); };
    root.querySelector("#gsEdit").onclick = () => { close(); groupForm(g); };
    root.querySelector("#gsDel").onclick = async () => {
      close();
      if (S.n) return sheet(`<h2>Impossible de supprimer</h2><div class="sub" style="margin:8px 0 14px">Ce groupe a encore ${S.n} élève(s) actif(s). Change-les de groupe d'abord (fiche de l'élève → Groupe).</div><button class="btn pri block" id="okx">Compris</button>`, (r, c) => r.querySelector("#okx").onclick = c);
      if (!(await askConfirm(`Supprimer le groupe « ${g.name} » ?`))) return;
      for (const s of data.students.filter(x => x.groupId === g.id)) await update("students", s.id, { groupId: "" });
      await remove("groups", g.id); toast("Groupe supprimé");
    };
  });
}

/* ======================= FINANCES (admin) ======================= */
function viewFinance() {
  if (!isAdmin()) return go("home");
  const c = charges(), m = monthCharges(data, c), col = toCollect(data);
  const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5 + i); return d.toISOString().slice(0, 7); });
  const inc = months.map(mo => data.payments.filter(p => (p.date || "").startsWith(mo)).reduce((t, p) => t + Number(p.amount), 0));
  const max = Math.max(1, ...inc), cur = TODAY().slice(0, 7);
  const MN = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
  const R = n => fmtDH(Math.round(n));
  const bySrc = {}; data.students.filter(s => !isOut(s)).forEach(s => bySrc[s.source || "Autre"] = (bySrc[s.source || "Autre"] || 0) + 1);
  const ext = data.expenses.filter(e => (e.date || "").startsWith(cur));

  $("#view").innerHTML = `
    <div class="results">
      <div class="res ${m.resultNow >= 0 ? "pos" : "neg"}"><small>Résultat à ce jour</small><b>${m.resultNow >= 0 ? "+" : ""}${R(m.resultNow)}</b><small>jour ${m.dayNow}/${m.daysInMonth}</small></div>
      <div class="res ${m.resultForecast >= 0 ? "pos" : "neg"}"><small>Prévu fin du mois</small><b>${m.resultForecast >= 0 ? "+" : ""}${R(m.resultForecast)}</b><small>si tout le monde paie</small></div>
    </div>
    <div class="alert" style="margin-top:12px">${ic("target", 18)}<div>${m.studentsToBreakEven ? `Il manque <b>${m.studentsToBreakEven} élève(s)</b> (≈ ${R(m.avg)}/mois chacun) pour couvrir toutes les charges du mois.` : `Les charges du mois sont couvertes. Chaque nouvel élève ≈ <b>+${R(m.avg)}/mois</b> de bénéfice.`}</div></div>

    <h3 class="sec">Revenus du mois</h3>
    <div class="card">
      <div class="line-row"><div>Déjà encaissé</div><b>${R(m.cashed)}</b></div>
      <div class="line-row"><div>Mensualités pas encore payées<small>${col.monthly.length} personnes</small></div><b>${R(col.mAmt)}</b></div>
      <div class="line-row"><div>Restes d'inscription<small>${col.regs.length} personnes</small></div><b>${R(col.rAmt)}</b></div>
      <div class="line-row tot"><div>Total possible ce mois</div><b>${R(m.expected)}</b></div>
    </div>

    <h3 class="sec">Charges du mois <button class="link" id="editCh">${ic("edit", 15)} Modifier</button></h3>
    <div class="card">
      <div class="line-row" style="font-size:12px;color:var(--mute)"><div>Charge</div><div style="text-align:right">Payé à ce jour / total du mois</div></div>
      ${m.lines.map(l => `<div class="line-row"><div>${esc(l.label)}<small>${esc(l.detail)} · ${esc(l.when)}</small></div><b style="text-align:right">${R(l.paid)}<small style="font-weight:500">/ ${R(l.total)}</small></b></div>`).join("")}
      <div class="line-row tot"><div>Total</div><b style="text-align:right">${R(m.toDate)}<small style="font-weight:500">/ ${R(m.totalMonth)}</small></b></div>
      ${m.nextFri ? `<div class="alert t" style="margin-top:10px">${ic("calendar", 18)}<div>Vendredi ${fmtDate(m.nextFri)} : à payer environ <b>${R(m.nextFriAmount)}</b> (responsable + profs payés chaque semaine)</div></div>` : ""}
      <div class="row-btns"><button class="btn ghost sm" id="addExp">${ic("plus", 16)} Autre dépense</button><button class="btn line sm" id="csv">${ic("download", 16)} Export CSV</button></div>
    </div>

    <h3 class="sec">Encaissements (6 mois)</h3>
    <div class="card">
      <div class="chart">${months.map((mo, i) => `<div class="${mo === cur ? "cur" : ""}"><span style="font-weight:600;color:var(--ink)">${inc[i] ? Math.round(inc[i] / 100) / 10 + "k" : ""}</span><i style="height:${inc[i] / max * 100}px"></i>${MN[Number(mo.slice(5)) - 1]}</div>`).join("")}</div>
      <div class="sub" style="font-size:12px;color:var(--mute);margin-top:8px">Élèves par source : ${Object.entries(bySrc).map(([k, n]) => `<b>${esc(k)}</b> ${n}`).join(" · ")}</div>
    </div>

    <h3 class="sec">Qui doit encore payer <span class="count">${col.people}</span></h3>
    <div class="list">${[...col.regs.map(s => balanceRow(s)), ...col.monthly.filter(s => !col.regs.includes(s)).map(s => payRow(s, payStatus(s, TODAY(), CONFIG.remindDaysBefore)))].join("") || `<div class="empty">Tout le monde a payé 🎉</div>`}</div>`;
  bindRows();
  $("#editCh").onclick = chargesForm;
  $("#addExp").onclick = expenseForm;
  $("#csv").onclick = exportCSV;
}
function chargesForm() {
  const c = charges();
  const F = [["loyer", "Loyer"], ["syndic", "Syndic"], ["respSalary", "Salaire responsable classe"], ["primeLow", "Prime : DH par inscription (début)"], ["primeLimit", "… pour les X premières"], ["primeHigh", "Prime : DH après X inscriptions"], ["primeAdsOnly", "Prime seulement inscriptions Ads (1=oui, 0=non)"],
    ["profFull", "Prof : groupe plein"], ["profSmall", "Prof : petit groupe"], ["profThreshold", "Groupe plein à partir de (élèves)"],
    ["adsUsdPerDay", "Pub : $ par jour"], ["usdToMad", "1 $ = ? DH"], ["metaVat", "TVA Meta (%)"]];
  sheet(`<h2>Charges fixes</h2><div class="sub">Utilisées pour calculer le bénéfice chaque jour</div>
    <div class="grid2">${F.map(([k, l]) => `<div><label class="f">${l}</label><input type="number" step="any" id="ch_${k}" value="${c[k]}"></div>`).join("")}</div>
    <div class="row-btns"><button class="btn pri" id="chSave">Enregistrer</button></div>`,
    (root, close) => root.querySelector("#chSave").onclick = async () => {
      const o = Object.fromEntries(F.map(([k]) => [k, Number(root.querySelector("#ch_" + k).value) || 0]));
      data.settings.find(x => x.id === "charges") ? await update("settings", "charges", o) : await add("settings", { id: "charges", ...o });
      close(); toast("Charges enregistrées");
    });
}
function groupForm(g = null) {
  const v = g || { capacity: 12, level: "A1" };
  sheet(`<h2>${g ? "Modifier le groupe" : "Nouveau groupe"}</h2>
    <label class="f">Nom</label><input id="gName" value="${esc(v.name)}" placeholder="Soir 19:00–21:00">
    <div class="grid2"><div><label class="f">Prof</label><input id="gProf" value="${esc(v.prof)}"></div><div><label class="f">Horaire</label><input id="gSch" value="${esc(v.schedule)}"></div></div>
    <div class="grid2"><div><label class="f">Niveau</label><input id="gLvl" value="${esc(v.level)}"></div><div><label class="f">Places</label><input id="gCap" type="number" value="${esc(v.capacity)}"></div></div>
    <div class="grid2"><div><label class="f">Date de début du groupe</label><input id="gStart" type="date" value="${esc(v.startDate || TODAY())}"></div><div></div></div>
    <div class="row-btns"><button class="btn line" id="gSee">👀 Voir les élèves</button><button class="btn pri" id="gSave">Enregistrer</button></div>`,
    (root, close) => {
      root.querySelector("#gSave").onclick = async () => {
        const o = { name: val(root, "gName"), prof: val(root, "gProf"), schedule: val(root, "gSch"), level: val(root, "gLvl"), capacity: Number(val(root, "gCap")) || 12, startDate: val(root, "gStart") };
        if (!o.name) return toast("Nom ?");
        g ? await update("groups", g.id, o) : await add("groups", o); close(); toast("Enregistré ✅");
      };
      root.querySelector("#gSee").onclick = () => { close(); if (g) { state.stuGroup = g.id; state.stuFilter = "tous"; go("students"); } };
    });
}
function expenseForm() {
  sheet(`<h2>Nouvelle dépense</h2>
    <label class="f">Catégorie</label><select id="eCat">${["Loyer", "Prof", "Publicité", "Électricité / eau", "Internet", "Fournitures", "Autre"].map(o => `<option>${o}</option>`).join("")}</select>
    <div class="grid2"><div><label class="f">Montant (DH)</label><input id="eAmt" type="number" inputmode="numeric"></div><div><label class="f">Date</label><input id="eDate" type="date" value="${TODAY()}"></div></div>
    <label class="f">Note</label><input id="eNote">
    <div class="row-btns"><button class="btn pri" id="eSave">Enregistrer</button></div>`,
    (root, close) => root.querySelector("#eSave").onclick = async () => {
      const amount = Number(val(root, "eAmt")); if (!amount) return toast("Montant ?");
      await add("expenses", { category: val(root, "eCat"), amount, date: val(root, "eDate"), note: val(root, "eNote") }); close(); toast("Dépense ajoutée");
    });
}
function exportCSV() {
  const rows = [["Nom", "Téléphone", "Groupe", "Source", "Début", "Mensualité", "Prochain paiement", "Reste", "Statut"],
    ...data.students.map(s => [s.name, s.phone, groupName(s.groupId), s.source, s.startDate, s.monthly, s.nextDue, s.balance, s.status])];
  const csv = "﻿" + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  if (NATIVE) return saveNativeFile(`talkify-eleves-${TODAY()}.csv`, btoa(unescape(encodeURIComponent(csv))), "text/csv");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `talkify-eleves-${TODAY()}.csv`; a.click();
}

if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) && "serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

/* boot (à la fin du module pour que toutes les fonctions soient prêtes) */
initAuth(user => user ? startApp() : showLogin());
