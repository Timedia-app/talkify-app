// Envoie chaque matin une notification au directeur et à l'assistante.
// Lancé par GitHub Actions (.github/workflows/reminders.yml) — gratuit.
import admin from "firebase-admin";
if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log("Secret FIREBASE_SERVICE_ACCOUNT pas encore ajouté — rien à faire"); process.exit(0); }
import { dailySummary, todayISO, dayReport, toCollect, fmtDH } from "../js/logic.js";
const MODE = process.env.MODE || (new Date().getUTCHours() >= 15 ? "evening" : "morning");

const CFG = { remindDaysBefore: 3, absenceAlert: 2 };
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const load = async c => (await db.collection(c).get()).docs.map(d => ({ id: d.id, ...d.data() }));

const data = Object.fromEntries(await Promise.all(["students", "prospects", "attendance", "payments", "contacts", "groups"].map(async c => [c, await load(c)])));
const today = todayISO(new Date(Date.now() + 60 * 60 * 1000)); // heure du Maroc
const s = dailySummary(data, CFG, today);

const names = arr => arr.slice(0, 3).map(x => (x.s || x.student || x).name || "?").join(", ") + (arr.length > 3 ? "…" : "");
function body(isAdmin) {
  const L = [];
  if (!isAdmin && MODE === "morning") {
    // Responsable : ce qu'elle doit faire aujourd'hui
    const c = toCollect(data, today);
    if (s.follow.length) L.push(`📞 ${s.follow.length} prospect(s) à relancer aujourd'hui : ${names(s.follow)}`);
    L.push(`💰 ${c.monthly.length} élève(s) doivent encore payer ce mois (${fmtDH(c.mAmt)})`);
    if (s.late.length) L.push(`⚠️ ${s.late.length} en retard : ${names(s.late)}`);
    if (c.regs.length) L.push(`💸 ${c.regs.length} reste(s) d'inscription : ${fmtDH(c.rAmt)}`);
    if (s.absences.length) L.push(`🚨 Absences à suivre : ${names(s.absences)}`);
    return L.join("\n");
  }
  if (isAdmin && MODE === "morning") return ""; // l'admin reçoit les actions en direct + le rapport du soir
  if (MODE === "evening") {
    const r = dayReport(data, today), c = toCollect(data, today);
    L.push(`📝 ${r.ins.length} inscription(s) · ${r.pays.length} paiement(s)${isAdmin ? ` (${r.payAmount} DH)` : ""}`);
    L.push(`💬 ${r.contacts.length} contacts : ${r.answered} ont répondu, ${r.noAnswer} sans réponse`);
    L.push(`📞 ${s.follow.length} prospects à relancer demain · 💰 reste à récupérer ${c.total} DH`);
    return L.join("\n");
  }
  if (s.late.length) L.push(`⚠️ ${s.late.length} en retard${isAdmin ? ` (${s.lateAmount} DH)` : ""} : ${names(s.late)}`);
  if (s.dueToday.length) L.push(`💰 ${s.dueToday.length} à payer aujourd'hui : ${names(s.dueToday)}`);
  if (s.soon.length) L.push(`📅 ${s.soon.length} dans ${CFG.remindDaysBefore} jours`);
  if (s.follow.length) L.push(`📞 ${s.follow.length} prospects à relancer`);
  if (s.absences.length) L.push(`🚨 Absences répétées : ${names(s.absences)}`);
  if (s.missing.length) L.push(`🧩 ${s.missing.length} élèves sans date de début`);
  return L.join("\n");
}

const users = await load("users");
let sent = 0;
for (const u of users) {
  const tokens = (u.tokens || []).filter(Boolean);
  const text = body(u.role === "admin");
  if (!tokens.length || !text) continue;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: MODE === "evening" ? "Talkify — rapport du jour 🌙" : "Talkify — le point du jour ☀️", body: text },
    webpush: { notification: { icon: "icons/icon-192.png" }, fcmOptions: { link: process.env.APP_URL || "/" } },
    data: { url: process.env.APP_URL || "./", tag: "daily" }
  });
  sent += res.successCount;
  // nettoyer les jetons morts
  const dead = res.responses.map((r, i) => (!r.success ? tokens[i] : null)).filter(Boolean);
  if (dead.length) await db.collection("users").doc(u.id).update({ tokens: admin.firestore.FieldValue.arrayRemove(...dead) });
}
console.log(`Résumé ${today} envoyé — ${sent} notification(s)`);
