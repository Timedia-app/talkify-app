// Logique métier partagée (app + script de rappels quotidiens)
export const isOut = s => s.status === "arrêté" || s.status === "parti";
export const todayISO = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export function addMonths(iso, n = 1) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

/** Statut de paiement d'un élève : late | today | soon | ok | missing | off */
export function payStatus(s, today = todayISO(), before = 3) {
  if (isOut(s)) return { key: "off", label: s.status === "parti" ? "Inscrit puis parti" : "Arrêté" };
  if (!s.nextDue) return { key: "missing", label: s.startDate ? "Date à fixer" : "Date de début manquante" };
  const d = daysBetween(today, s.nextDue);
  if (d < 0) return { key: "late", label: `En retard de ${-d} j`, days: d };
  if (d === 0) return { key: "today", label: "À payer aujourd'hui", days: d };
  if (d <= before) return { key: "soon", label: `Dans ${d} j`, days: d };
  return { key: "ok", label: "Prochain paiement " + s.nextDue.slice(8, 10) + "/" + s.nextDue.slice(5, 7), days: d };
}

/** Élèves avec N absences de suite (sur les dernières séances enregistrées de leur groupe) */
export function absenceStreaks(students, attendance, n = 2) {
  const out = [];
  for (const s of students) {
    if (isOut(s) || !s.groupId) continue;
    const sessions = attendance.filter(a => a.groupId === s.groupId).sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    for (const a of sessions) { if ((a.absents || []).includes(s.id)) streak++; else break; }
    if (streak >= n) out.push({ student: s, streak });
  }
  return out;
}

/** Résumé du jour (utilisé pour l'accueil et la notification du matin) */
export function dailySummary(db, cfg, today = todayISO()) {
  const active = db.students.filter(s => !isOut(s));
  const withSt = active.map(s => ({ s, st: payStatus(s, today, cfg.remindDaysBefore) }));
  const late = withSt.filter(x => x.st.key === "late");
  const dueToday = withSt.filter(x => x.st.key === "today");
  const soon = withSt.filter(x => x.st.key === "soon");
  const missing = withSt.filter(x => x.st.key === "missing" && x.s.status !== "à vérifier");
  const balances = active.filter(s => Number(s.balance) > 0);
  const follow = db.prospects.filter(p => !["Inscrit", "Perdu"].includes(p.status) && p.nextFollow && p.nextFollow <= today);
  const absences = absenceStreaks(active, db.attendance, cfg.absenceAlert);
  const sum = arr => arr.reduce((t, x) => t + Number(x.s ? x.s.monthly : x.balance || 0), 0);
  return { late, dueToday, soon, missing, balances, follow, absences,
    lateAmount: sum(late), todayAmount: sum(dueToday), soonAmount: sum(soon),
    balanceAmount: balances.reduce((t, s) => t + Number(s.balance), 0) };
}

export const waLink = (phone, text) => {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "212" + p.slice(1);
  else if (p.length === 9) p = "212" + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
};
export const fmtDate = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "—";
export const fmtDH = n => (Number(n) || 0).toLocaleString("fr-FR") + " DH";

/* ---------------- Argent à récupérer (mois en cours) ---------------- */
export const monthEnd = (today = todayISO()) => { const [y, m] = today.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export function toCollect(db, today = todayISO()) {
  const end = monthEnd(today);
  const active = db.students.filter(s => !isOut(s));
  const monthly = active.filter(s => s.nextDue && s.nextDue <= end && Number(s.monthly) > 0);
  const regs = active.filter(s => Number(s.balance) > 0);
  const mAmt = monthly.reduce((t, s) => t + Number(s.monthly), 0);
  const rAmt = regs.reduce((t, s) => t + Number(s.balance), 0);
  return { monthly, regs, mAmt, rAmt, total: mAmt + rAmt, people: new Set([...monthly, ...regs].map(s => s.id)).size };
}

/* ---------------- Charges & rentabilité ---------------- */
export const DEFAULT_CHARGES = {
  loyer: 6200, syndic: 100, respSalary: 2400, primeLow: 50, primeHigh: 100, primeLimit: 10, primeAdsOnly: 1,
  profFull: 2400, profSmall: 500, profThreshold: 4,
  adsUsdPerDay: 7, usdToMad: 10, metaVat: 20
};
/* prime de la responsable : les X premières inscriptions du mois à primeLow, ensuite primeHigh */
export const primeFor = (n, c) => Math.min(n, c.primeLimit) * c.primeLow + Math.max(0, n - c.primeLimit) * c.primeHigh;
export function inscriptionsOf(db, c, from, to) {
  return db.students.filter(s => s.regDate && s.regDate >= from && s.regDate <= to && (!c.primeAdsOnly || (s.source === "Ads" && s.adsOwner === "resp")));
}
export function weekStart(today = todayISO()) { const d = new Date(today + "T00:00:00Z"); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); }
export function profCost(n, c) { return n >= c.profThreshold ? c.profFull : n > 0 ? c.profSmall : 0; }
/* Les charges suivent le vrai calendrier de paiement :
   - responsable + profs « groupe plein » : payés chaque vendredi (total du mois réparti sur les vendredis)
   - profs « petit groupe » : payés à la fin du mois
   - un groupe qui commence en cours de mois n'est payé qu'à partir du vendredi qui suit son début
   - loyer + syndic : payés au début du mois ; pub Meta : au jour le jour */
export function fridaysOf(month) {
  const [y, m] = month.split("-").map(Number), out = [];
  for (let d = 1; d <= 31; d++) { const t = new Date(Date.UTC(y, m - 1, d)); if (t.getUTCMonth() !== m - 1) break; if (t.getUTCDay() === 5) out.push(t.toISOString().slice(0, 10)); }
  return out;
}
export function monthCharges(db, c, today = todayISO()) {
  const month = today.slice(0, 7), end = monthEnd(today);
  const daysInMonth = Number(end.slice(8)), dayNow = Number(today.slice(8));
  const fr = fridaysOf(month), frPassed = fr.filter(f => f <= today);
  const actives = db.students.filter(s => s.status === "actif");
  const lines = [];
  const add = (label, detail, total, paid, when) => lines.push({ label, detail, total, paid, when });
  add("Loyer", "payé", c.loyer, c.loyer, "début du mois");
  add("Syndic", "payé", c.syndic, c.syndic, "début du mois");
  // responsable : salaire + prime, chaque vendredi
  const adsIns = inscriptionsOf(db, c, month + "-01", end).length;
  const prime = primeFor(adsIns, c);
  const lastFri = frPassed[frPassed.length - 1];
  const insPaid = lastFri ? inscriptionsOf(db, c, month + "-01", lastFri).length : 0;
  const perFri = c.respSalary / fr.length;
  add("Responsable classe", `${Math.round(perFri)} DH chaque vendredi + prime (${adsIns} inscription(s))`, c.respSalary + prime, perFri * frPassed.length + primeFor(insPaid, c), "chaque vendredi");
  // profs par groupe
  const groups = db.groups.map(g => {
    const n = actives.filter(s => s.groupId === g.id).length, full = n >= c.profThreshold;
    const base = profCost(n, c);
    const start = g.startDate || "";
    const payFr = fr.filter(f => !start || f > start); // payé à partir du vendredi qui suit le début
    let total, paid, when;
    if (!base) { total = 0; paid = 0; when = "—"; }
    else if (full) { total = base * payFr.length / fr.length; paid = base / fr.length * payFr.filter(f => f <= today).length; when = "chaque vendredi"; }
    else { const started = !start || start <= end; total = started ? base : 0; paid = today >= end ? total : 0; when = "fin du mois"; }
    const startedLate = start && start.slice(0, 7) === month;
    lines.push({ label: `Prof ${g.prof} — ${g.schedule || g.name}`, detail: `${n} élève(s) → ${full ? "groupe plein" : n ? "petit groupe" : "pas d'élève"}${startedLate ? " · a commencé le " + start.slice(8, 10) + "/" + start.slice(5, 7) : ""}`, total, paid, when, group: g });
    return { g, n, cost: total };
  });
  const adsDay = c.adsUsdPerDay * c.usdToMad * (1 + c.metaVat / 100);
  add("Publicité Meta", `${c.adsUsdPerDay} $/jour × ${c.usdToMad} DH${c.metaVat ? " + TVA " + c.metaVat + "%" : ""} = ${Math.round(adsDay)} DH/jour`, adsDay * daysInMonth, adsDay * dayNow, "chaque jour");
  (db.expenses || []).filter(e => (e.date || "").startsWith(month)).forEach(e => add(e.category, (e.note || "") + " · " + e.date.slice(8, 10) + "/" + e.date.slice(5, 7), Number(e.amount), e.date <= today ? Number(e.amount) : 0, "le " + e.date.slice(8, 10)));
  const totalMonth = lines.reduce((t, l) => t + l.total, 0), toDate = lines.reduce((t, l) => t + l.paid, 0);
  const nextFri = fr.find(f => f > today);
  const nextFriAmount = nextFri ? perFri + groups.reduce((t, x) => { const n = x.n; if (n < c.profThreshold) return t; const st = x.g.startDate; return t + (!st || nextFri > st ? c.profFull / fr.length : 0); }, 0) : 0;
  const cashed = db.payments.filter(p => (p.date || "").startsWith(month)).reduce((t, p) => t + Number(p.amount), 0);
  const expected = cashed + toCollect(db, today).mAmt + db.students.filter(s => !isOut(s)).reduce((t, s) => t + Number(s.balance || 0), 0);
  const avg = actives.length ? actives.reduce((t, s) => t + Number(s.monthly || 0), 0) / actives.length : 850;
  const gap = totalMonth - expected;
  const extra = (db.expenses || []).filter(e => (e.date || "").startsWith(month)).reduce((t, e) => t + Number(e.amount), 0);
  return { lines, groups, adsIns, prime, adsDay, adsToDate: adsDay * dayNow, adsMonth: adsDay * daysInMonth, extra, totalMonth, toDate,
    cashed, expected, resultNow: cashed - toDate, resultForecast: expected - totalMonth, nextFri, nextFriAmount,
    studentsToBreakEven: gap > 0 ? Math.ceil(gap / avg) : 0, avg, daysInMonth, dayNow, fridays: fr };
}

/* ---------------- Rapport du jour ---------------- */
export function dayReport(db, today = todayISO()) {
  const isToday = d => (d || "").slice(0, 10) === today;
  const ins = db.students.filter(s => isToday(s.regDate));
  const pays = db.payments.filter(p => isToday(p.date));
  const contacts = (db.contacts || []).filter(c => isToday(c.date));
  const by = r => contacts.filter(c => c.result === r).length;
  return { ins, pays, payAmount: pays.reduce((t, p) => t + Number(p.amount), 0), contacts,
    answered: contacts.filter(c => ["Répondu", "Va payer", "Payé", "Inscrit", "RDV pris"].includes(c.result)).length,
    noAnswer: by("Pas de réponse"), newProspects: db.prospects.filter(p => isToday(p.createdAt)).length,
    attendance: db.attendance.filter(a => a.date === today).length };
}

/* ---------------- Rapport d'une période (jour / semaine / mois) ---------------- */
export function periodReport(db, c, from, to, today = todayISO()) {
  const inP = d => d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
  const ins = db.students.filter(s => inP(s.regDate)).sort((a, b) => a.regDate.localeCompare(b.regDate));
  const insResp = ins.filter(s => s.source === "Ads" && s.adsOwner === "resp");
  const pays = db.payments.filter(p => inP(p.date)).sort((a, b) => a.date.localeCompare(b.date));
  const contacts = (db.contacts || []).filter(x => inP(x.date)).sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  const byResult = {}; contacts.forEach(x => byResult[x.result] = (byResult[x.result] || 0) + 1);
  const prosNew = db.prospects.filter(p => inP(p.createdAt));
  const sessions = db.attendance.filter(a => inP(a.date));
  const month = from.slice(0, 7), monthEnd_ = monthEnd(from);
  const monthResp = inscriptionsOf(db, c, month + "-01", monthEnd_ < today ? monthEnd_ : today).length;
  // ce qui reste à faire aujourd'hui (non fait)
  const sum = dailySummary(db, c, today);
  const contactedToday = new Set((db.contacts || []).filter(x => x.date === today).map(x => x.targetId));
  const paidToday = new Set(db.payments.filter(p => p.date === today).map(p => p.studentId));
  const notDone = {
    late: sum.late.filter(x => !contactedToday.has(x.s.id) && !paidToday.has(x.s.id)).map(x => x.s),
    regs: sum.balances.filter(s => !contactedToday.has(s.id) && !paidToday.has(s.id)),
    pros: sum.follow.filter(p => !contactedToday.has(p.id))
  };
  return { from, to, ins, insResp, pays, payAmount: pays.reduce((t, p) => t + Number(p.amount), 0), contacts, byResult,
    answered: contacts.filter(x => ["Répondu", "Va payer", "Payé", "Inscrit", "RDV pris"].includes(x.result)).length,
    prosNew, prosContacted: new Set(contacts.filter(x => x.type === "prospect").map(x => x.targetId)).size,
    sessions, monthResp, prime: primeFor(monthResp, c), notDone };
}
