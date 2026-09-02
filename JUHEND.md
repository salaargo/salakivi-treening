# Salakivi Treening — kasutus- ja paigaldusjuhend

> **Staatus:** kood on GitHubis (`salaargo/salakivi-treening`). Supabase + Render vajavad sinu kontole sisselogimist — vt **[PAIGALDUS.md](./PAIGALDUS.md)** (5–10 min).

Treeningäpp telefonis ja arvutis. Iga kasutaja logib sisse oma kontoga — logid ja statistika salvestuvad **Supabase** pilve. Veebileht hostitakse **Render**-is.

---

## Kausta sisu

```
salakivi-treening/
├── JUHEND.md           ← see fail
├── README.md
├── render.yaml         ← Render Blueprint (staatiline sait)
├── supabase/
│   └── schema.sql      ← andmebaasi tabel + turvareeglid
├── public/
│   └── _redirects      ← SPA marsruutimine Renderis
├── src/
│   ├── App.tsx
│   ├── cloud/sync.ts   ← pilve laadimine/salvestamine
│   ├── lib/supabase.ts
│   └── screens/        ← ekraanid (sh AuthScreen)
└── .env.example        ← kohalikud võtmed (ära commiti .env)
```

---

## 1. Supabase (andmed + sisselogimine)

### 1.1 Loo projekt

1. Mine [supabase.com](https://supabase.com) → logi sisse
2. **New project** → vali nimi (nt `salakivi-treening`), parool, regioon
3. Oota, kuni projekt valmib

### 1.2 Käivita SQL

1. Supabase → **SQL Editor** → **New query**
2. Kopeeri kogu fail `supabase/schema.sql` sisu
3. **Run**

See loob tabeli `user_app_state` ja reeglid (RLS), et iga kasutaja näeb **ainult oma** andmeid.

### 1.3 Võtmed

1. **Project Settings** → **API**
2. Kopeeri:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** võti → `VITE_SUPABASE_ANON_KEY`

### 1.4 Kasutajad (kuni 10 inimest)

1. **Authentication** → **Providers** → luba **Email**
2. Iga inimene:
   - avab äpi → **Loo konto** (e-post + parool min 6 tähemärki), või
   - saad kutsuda: **Authentication** → **Users** → **Add user**

Soovi korral lülita välja e-posti kinnitamine (väike grupp):
**Authentication** → **Providers** → Email → **Confirm email** = OFF.

---

## 2. Render (veebiäpp)

### 2.1 GitHub

1. Lükka projekt GitHubi (kui pole veel)
2. Veendu, et repo juures on `render.yaml`

### 2.2 Deploy

1. [render.com](https://render.com) → logi sisse GitHubiga
2. **New +** → **Blueprint** (või **Static Site**)
3. Vali repo `salakivi-treening`
4. Lisa keskkonnamuutujad (**Environment**):
   - `VITE_SUPABASE_URL` = Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` = Supabase anon key
5. **Deploy**

Pärast buildi saad lingi, nt `https://salakivi-treening.onrender.com`.

### 2.3 Märkused

- **Tasuta plaan:** esimene avamine võib võtta ~30 s (magab)
- Muutujad peavad olema seatud **enne** buildi (Vite paneb need buildi sisse)
- Kui muudad võtmeid, tee **Manual Deploy** → **Clear build cache & deploy**

---

## 3. Kohalik arendus

```bash
cd salakivi-treening
npm install
cp .env.example .env
# täida .env Supabase võtmetega
npm run dev
```

Ava `http://localhost:5173` (telefon samas WiFis: arvuti IP + port 5173).

**Ilma `.env` failita** töötab äpp endiselt ainult `localStorage`-iga (üks seade, ilma sisselogimiseta).

---

## 4. Kuidas andmed liiguvad

| Koht | Mis |
|------|-----|
| **Supabase** | Iga kasutaja täielik `AppState` (kavad, logid, statistika) |
| **localStorage** | Vahemälu samas brauseris (kiirem, offline tugi) |

- Sisselogimisel laetakse andmed pilvest
- Iga muudatus salvestatakse ~0,7 s pärast pilve
- Esimene sisselogimine: kui brauseris olid varem andmed, kantakse need üles pilve

---

## 5. Kasutamine (treenijale)

1. Ava Renderi link telefonis või arvutis
2. **Loo konto** või **Logi sisse**
3. **Treenima** → vali päev → tee treening
4. **Seaded** → kavad, grupid, faasid, nädalamallid
5. Treeningu lõpus **Sauna!** + statistika → **Valmis** (tagasi avalehele)
6. **Seaded** → **Logi välja** (teine kasutaja saab oma kontoga sisse logida)

---

## 6. Turvalisus

- Iga kasutaja näeb ainult oma rida tabelis `user_app_state` (Supabase RLS)
- Äpis kasutatakse ainult **anon** võtit (see on avalik front-endis — see on Supabase’i tavapärane mudel)
- Ära jaga **service_role** võtit; seda front-endis ei kasutata

---

## 7. Tõrkeotsing

| Probleem | Lahendus |
|----------|----------|
| Sisselogimine ei tööta | Kontrolli Supabase URL ja anon key Renderis; tee uus deploy |
| „Pilve salvestamine ebaõnnestus“ | Kontrolli, kas `schema.sql` on käivitatud; vaata Supabase **Logs** |
| Tühi äpp pärast sisselogimist | Normaalne uue kasutaja puhul — seadista kavad **Seadetes** |
| Vana telefon ei näe uusi andmeid | Logi välja ja uuesti sisse; kontrolli internetiühendust |
| Render näitab vana versiooni | Manual deploy + clear cache |

---

## 8. Uuendamine

1. Tee muudatused koodis
2. `git push` → Render buildib automaatselt (kui CI/CD on ühendatud)
3. Supabase skeemi muudatused: käivita uus SQL `schema.sql` failis (kui lisandub)

---

Küsimuste korral: kontrolli esmalt Supabase **Table Editor** → `user_app_state` (peaks olema üks rida kasutaja kohta pärast esimest salvestust).
