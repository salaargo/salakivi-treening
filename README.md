# Salakivi Treening

Mobiilile orienteeritud treeningprogramm (veeb). Logid ja statistika pilves (**Supabase**), host **Render**.

Täpne paigaldus: **[JUHEND.md](./JUHEND.md)**

## Kiire start (arendus)

```bash
npm install
cp .env.example .env   # täida Supabase võtmed
npm run dev
```

Ilma `.env` failita töötab ainult kohalik `localStorage` (ilma sisselogimiseta).

## Build

```bash
npm run build
```

Väljund: `dist/` (Render deploy’ib selle automaatselt).
