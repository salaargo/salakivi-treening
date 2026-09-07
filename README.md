# Salakivi Treening

Mobiilile orienteeritud treeningäpp. Ilma `.env` failita töötab kohaliku `localStorage`’iga; pilve jaoks on **Supabase** (vt `JUHEND.md`).

## Käivitamine

```bash
npm install
npm run dev
```

Ava `http://localhost:43173`.

## Treeninguvoog

- **Segamini (kaks harjutust):** paus ainult pärast teist harjutust, enne esimese järgmist seeriat. Taimeril on kirjas, mitu seeriat veel jäänud on.
- Kui harjutuse seeriad on läbi, avaneb kohe järgmiste harjutuste valik (ilma taimerita).
- Esimesel seerial valitud pink ja raskus kanduvad järgmistesse seeriatesse.
- **Lõpeta harjutus** — lõpetab varem (nt 3 seeriat 4 asemel).
- **Tehtud** on suur nupp ekraani allosas.
- Telefon lukustatakse püstiasendisse (PWA / Android). Põikivaates palutakse telefon pöörata.
- **Nutikell:** Seaded → Ava kellavaade (`?kell=1`). Wear OS / Samsungi kellas ava link brauseris. Kui oled samasse kontosse sisse logitud, saab kell juhtida telefoni treeningut.
- **Uus kasutaja** saab Argo praegused treeningkavad näidiseks (ilma logideta). Konto loomisel küsitakse nime; avalehel on nt „Tere, Argo“.
- **Admin (Argo):** Seaded → kasutajate nimekiri (nimi, e-post, viimane kasutus) ja nupp olemasolevale kasutajale näidiskava andmiseks.

## Build

```bash
npm run build
```
