import admin from "firebase-admin"; import fs from "fs";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore(); const out = {};
for (const c of ["groups","students","payments","expenses"]) out[c] = (await db.collection(c).get()).docs.map(d => ({ id: d.id, ...d.data() }));
fs.writeFileSync("/tmp/data.json", JSON.stringify(out, (k, v) => (v && v._seconds !== undefined ? new Date(v._seconds * 1000).toISOString() : v)));
console.log("ok", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
