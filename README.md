# Time & Age Calculator

US ⇄ India time converter and precise age calculator. Pure Node/Express + vanilla JS — no build step, no frontend framework, so it deploys in seconds.

## Features
- Live clock (US Eastern + India IST), updates every second, DST-aware
- Two-way US ↔ India time conversion across 4 US timezones (ET/CT/MT/PT)
- Flexible date parsing: `09-Sep-2026 10:00 AM`, `2026-09-09 22:30`, `09/27/1950`, `September 27, 1950`, etc.
- DOB → exact age in years/months/days, leap-year safe
- Copy-to-clipboard on all results

## Run locally
```bash
npm install
npm start
```
Visit http://localhost:3000

## Deploy on Render
1. Push this folder to a new GitHub repo.
2. On [render.com](https://render.com) → **New → Web Service** → connect the repo.
3. Render will auto-detect `render.yaml`. If not, set manually:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Deploy. Render assigns a public URL automatically — no other config needed.

## Project structure
```
time-age-app/
├── package.json
├── server.js          # Express static server
├── render.yaml         # Render service config (auto-detected)
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js       # All calculator/converter logic
└── README.md
```
