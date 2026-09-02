# Ülejäänud paigaldus (5–10 min)

Kood on GitHubis: **https://github.com/salaargo/salakivi-treening**

## 1. Supabase (~5 min)

1. Ava: https://supabase.com/dashboard  
   Logi sisse (soovitavalt **Continue with GitHub**).
2. **New project** → nimi `salakivi-treening` → loo parool → **Create**.
3. **SQL Editor** → **New query** → kopeeri kogu `supabase/schema.sql` → **Run**.
4. **Project Settings** → **API** → kopeeri:
   - **Project URL**
   - **anon public** key
5. **Authentication** → **Providers** → Email → lülita **Confirm email** välja (väike grupp).

## 2. Render (~5 min)

1. Ava: https://dashboard.render.com  
   Logi sisse GitHubiga (sama konto mis `salaargo`).
2. **New +** → **Blueprint**.
3. Vali repo **salaargo/salakivi-treening**.
4. Lisa keskkonnamuutujad (enne deploy lõppu):
   - `VITE_SUPABASE_URL` = Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = Supabase anon key
5. **Apply** / **Deploy**.

Pärast valmimist on link kujul `https://salakivi-treening.onrender.com` (või Renderi antud nimi).

## 3. Test

1. Ava Renderi link telefonis.
2. **Loo konto** (e-post + parool).
3. Tee üks treening → **Sauna!** → kontrolli statistikat.
4. Logi välja → teine kasutaja saab oma kontoga sisse logida.

## Kohalik `.env` (valikuline)

```bash
cp .env.example .env
# täida VITE_SUPABASE_URL ja VITE_SUPABASE_ANON_KEY
npm run dev
```
