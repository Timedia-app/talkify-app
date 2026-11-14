// ⚙️ Talkify — configuration
// Tant que firebase.apiKey est vide, l'app tourne en MODE DÉMO (données gardées sur le téléphone).
export const CONFIG = {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },
  // Clé publique Web Push (Firebase > Paramètres du projet > Cloud Messaging > Certificats Web Push)
  vapidKey: "",

  centerName: "Talkify",
  respName: "Houda",    // responsable classe (propriétaire des « Ads de Houda »)
  adminName: "Maddah",
  regFee: 150,          // frais d'inscription (DH)
  // Offre Talkify (règles utilisées par l'assistant d'offres)
  offer: {
    price: 950,          // mensualité officielle
    floor: 800,          // jamais en dessous
    bookPrice: 70,       // livre + cahier payants si la mensualité < prix officiel
    prepayMonths: 3,     // payer 3 mois d'avance → inscription offerte
    groupSize: 12
  },
  remindDaysBefore: 3,  // rappel X jours avant la date de paiement
  absenceAlert: 2,      // alerte après X absences de suite
  followUpDays: 2,      // prochaine relance prospect après X jours
  phoneDomain: "talkify.app", // comptes Firebase : admin@… et classe@…
  demoCodes: { admin: "0000", assistant: "1111" } // codes à 4 chiffres en mode démo
};

export const DEMO = !CONFIG.firebase.apiKey;
