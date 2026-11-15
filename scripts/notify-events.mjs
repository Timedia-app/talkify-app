// Toutes les 5 minutes (GitHub Actions) : envoie à l'administrateur une notification
// pour chaque nouvelle action de la responsable (inscription, paiement, groupe, modification…).
import admin from "firebase-admin";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

const metaRef = db.collection("settings").doc("notify");
const meta = (await metaRef.get()).data() || {};
const since = meta.lastAt || new Date(Date.now() - 10 * 60 * 1000).toISOString();
const evs = (await db.collection("events").where("at", ">", since).orderBy("at").limit(50).get()).docs.map(d => d.data());
if (!evs.length) { console.log("Rien de nouveau"); process.exit(0); }

const admins = await db.collection("users").where("role", "==", "admin").get();
const tokens = admins.docs.flatMap(d => d.data().tokens || []);
let sent = 0;
if (tokens.length) {
  // regroupe si beaucoup d'actions d'un coup
  const msgs = evs.length > 3
    ? [{ title: `Talkify · ${evs.length} nouvelles actions`, body: evs.slice(-4).map(e => e.text).join("\n") }]
    : evs.map(e => ({ title: `Talkify · ${e.by || "Responsable"}`, body: e.text }));
  for (const m of msgs) {
    const res = await admin.messaging().sendEachForMulticast({ tokens, notification: m, data: { url: "./", tag: "event" }, android: { priority: "high" } });
    sent += res.successCount;
    const dead = res.responses.map((r, i) => (!r.success ? tokens[i] : null)).filter(Boolean);
    for (const d of admins.docs) {
      const bad = (d.data().tokens || []).filter(t => dead.includes(t));
      if (bad.length) await d.ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(...bad) });
    }
  }
}
await metaRef.set({ lastAt: evs[evs.length - 1].at }, { merge: true });
console.log(`${evs.length} action(s), ${sent} notification(s) envoyée(s)`);
