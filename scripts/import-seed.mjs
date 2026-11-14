// Import unique des données du Google Sheet vers Firestore : node scripts/import-seed.mjs
import admin from "firebase-admin";
// Le fichier des vraies données est gardé hors de GitHub : node scripts/import-seed.mjs chemin/vers/seed-real.js
const { SEED } = await import(new URL(process.argv[2] || "../js/seed.js", import.meta.url).href.startsWith("file:") && process.argv[2] ? "file://" + (await import("node:path")).resolve(process.argv[2]) : "../js/seed.js");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
for (const [col, rows] of Object.entries(SEED)) {
  for (const { id, ...r } of rows) await db.collection(col).doc(id).set({ ...r, createdAt: new Date().toISOString(), updatedBy: "Import Google Sheet" });
  console.log(col, rows.length);
}
