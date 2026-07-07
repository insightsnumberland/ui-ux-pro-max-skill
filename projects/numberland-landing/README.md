# Numberland — Gamified Landing (Persian / RTL)

Self-contained HTML + Tailwind CSS + vanilla JS. No build framework required.
Two sections implemented so far:

1. **Hero** — «مرزتو بشکن» digital-world with Player HUD, ecosystems, mission-start CTA.
2. **Choose Your Path** («مسیرتو انتخاب کن») — hex-star game map, six selectable zones, +100 XP, persisted state.

## Run

Install once:

```bash
npm install
```

Start the dev server (rebuilds CSS + serves on port 8123):

```bash
npm run dev
```

Open in a browser:

```
http://localhost:8123/
```

## Scripts

- `npm run build` — compile `src.css` → `tailwind.css` (minified)
- `npm run watch` — Tailwind in watch mode
- `npm run serve` — static server on port 8123
- `npm run dev` — build + serve

## State

Persisted game state lives in `localStorage` under the key `numberland:state:v1`
(fields: `heroStarted`, `selectedPath`, `xp`, `mission`). To reset, run in the
browser console:

```js
localStorage.removeItem('numberland:state:v1'); location.reload();
```

## Files

- `index.html` — full page (Hero + Choose Your Path + all JS)
- `src.css` — Tailwind entry (`@tailwind base/components/utilities`)
- `tailwind.css` — compiled output (referenced by `index.html`)
- `tailwind.config.js` — tokens + custom breakpoints
