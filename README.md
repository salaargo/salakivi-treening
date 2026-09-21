# Salakivi Treening

Mobiilile orienteeritud treeningäpp, arvutis laiem statistika- ja kava vaade. Ilma `.env` failita töötab kohaliku `localStorage`’iga; pilve jaoks on **Supabase** (vt `JUHEND.md`).

**Kasutusjuhend (PDF):** [docs/Salakivi-Treening-kasutusjuhend.pdf](./docs/Salakivi-Treening-kasutusjuhend.pdf) — äpis ka Seaded → Kasutusjuhend. Pärast GitHub Pages deploy’t: https://salaargo.github.io/salakivi-treening/Salakivi-Treening-kasutusjuhend.pdf

## Käivitamine

```bash
npm install
npm run dev
```

Ava `http://localhost:43173`.

## Treeninguvoog

- **Start** on all, **STOPP** üleval paremal (ainult treeningu ajal).
- **Segamini (kaks harjutust):** paus ainult pärast teist harjutust. Taimer käib kella järgi (`endsAt`) ja taastub ekraani avamisel.
- Järgmisel treeningul näitab valitud pink **eelmise korra viimast raskust**.
- Telefonis püstivaade (ei reageeri põõramisele); arvutis laiem paigutus ja **Ajalugu** tabel (ainult enda logid).
- **Nutikell:** Seaded → Galaxy Watch (ümar, `?kell=galaxy`) kella internetibrauseris. Apple Watchil ei ole Safari/Chrome’i; `?kell=apple` avaneb ainult sõnumi/meili lingist piiratud veebivaates ja tihti ei tööta.
- **Faasid** on vabalt muudetavad: Seaded → Faasid.
- **Admin (Argo):** Seaded → kasutajate nimekiri ja näidiskava andmine.

## Build

```bash
npm run build
```
