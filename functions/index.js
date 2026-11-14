// Notification instantanée à l'administrateur à chaque action de la responsable.
// Déploiement : firebase deploy --only functions  (plan Blaze requis, l'usage reste dans le quota gratuit)
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
admin.initializeApp();

exports.notifyAdmin = onDocumentCreated({ document: "events/{id}", region: "europe-west1" }, async event => {
  const ev = event.data && event.data.data();
  if (!ev) return;
  const users = await admin.firestore().collection("users").where("role", "==", "admin").get();
  const tokens = users.docs.flatMap(d => d.data().tokens || []);
  if (!tokens.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: `Talkify · ${ev.by || "Responsable"}`, body: ev.text },
    webpush: { notification: { icon: "icons/icon-192.png", tag: ev.at } },
    data: { url: "./", tag: ev.at || "event" }
  });
  const dead = res.responses.map((r, i) => (!r.success ? tokens[i] : null)).filter(Boolean);
  for (const d of users.docs) {
    const bad = (d.data().tokens || []).filter(t => dead.includes(t));
    if (bad.length) await d.ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(...bad) });
  }
});
