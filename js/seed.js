// Données de démonstration (fictives). Les vraies données des élèves sont importées
// directement dans Firebase et ne sont jamais publiées sur GitHub.
export const SEED = {
  groups: [
    { id: "g-matin", startDate: "2026-10-12", name: "Matin 09:30–11:30", prof: "Amine", schedule: "09:30–11:30", capacity: 12, level: "A1" },
    { id: "g-midi", startDate: "2026-10-27", name: "Midi 12:00–14:00", prof: "Amine", schedule: "12:00–14:00", capacity: 12, level: "A1" },
    { id: "g-soir", startDate: "2026-11-13", name: "Soir 19:00–21:00", prof: "Hicham", schedule: "19:00–21:00", capacity: 12, level: "A1" }
  ],
  students: [
    { id: "d1", regDate: "2026-10-01", name: "Élève Démo 1", phone: "0600000001", source: "Direct", groupId: "g-matin", startDate: "2026-10-12", monthly: 950, nextDue: "2026-11-12", balance: 0, status: "actif" },
    { id: "d2", regDate: "2026-10-02", name: "Élève Démo 2", phone: "0600000002", source: "Ads", adsOwner: "resp", groupId: "g-matin", startDate: "2026-10-12", monthly: 850, nextDue: "2026-12-12", balance: 0, status: "actif" },
    { id: "d3", regDate: "2026-11-03", name: "Élève Démo 3", phone: "0600000003", source: "Ads", adsOwner: "admin", groupId: "g-soir", startDate: "", monthly: 950, nextDue: "", balance: 500, status: "actif" }
  ],
  payments: [
    { id: "p1", studentId: "d1", amount: 1100, date: "2026-10-01", label: "Inscription + 1er mois", type: "inscription", mode: "Espèces" },
    { id: "p2", studentId: "d2", amount: 850, date: "2026-11-12", label: "Mensualité", type: "mensuel", mode: "Espèces" }
  ],
  prospects: [
    { id: "q1", name: "Prospect Démo", phone: "0600000009", source: "Ads", level: "A1", mode: "Présentiel", status: "Nouveau", notes: "", nextFollow: "2026-11-14" }
  ],
  attendance: [], expenses: [], contacts: [], settings: [], events: []
};
