<div dir="rtl">

# بإيدك · beedak

**مشروعكم واقف؟ افهموه، وكمّلوه بإيدكم.**

«بإيدك» خدمة إرشاد لفرق المشاريع في مصر: أي مشروع، أي سنة، من الثانوي للجامعة. أول 15 فريق مجانًا، وبعدهم 350 جنيه للفريق كله. بتبدأ بجلسة تشخيص أونلاين مدتها 45 دقيقة، بنحدد فيها مع الفريق اللي واقف وسببه، والفريق بيطلع بخطة للخطوة الجاية مكتوبة بإيده.

> إحنا بنرشد ونراجع، وانتو اللي بتنفذوا.

**الموقع:** https://beedak.vercel.app

## الصفحات

| الصفحة | فيها إيه |
|---|---|
| [الرئيسية](https://beedak.vercel.app) | العرض والأسعار والضمان، ومنشئ رسالة «قضية» اللي بتتبعت على واتساب |
| [المعمل](https://beedak.vercel.app/lab) | محاكي Arduino وESP32: بتختاروا الكارت، وتزوّدوا القطع اللي محتاجينها بس من كتالوج، وتوصّلوها بأسلاك على طاولة 2D، وتكتبوا كود Arduino يشتغل على المحاكي، وهو بيدعم جزء كبير من Arduino مش كله (دايرة كهربا محسوبة: لمبة بتتحرق من غير مقاومة، شورت، طرف عايم…). لو عدّى 3 ثواني من غير أخطاء ولا تحذيرات، تقدروا تشغّلوه على جهازكم بالـUSB، والخطوة دي لسه تجريبية (Web Serial + `assets/firmware/beedak-lab-bridge`، بروتوكول v2). فيه 10 أمثلة جاهزة، وحفظ وفتح ملف، وشكل 3D لبعض القطع |
| [الشروط](https://beedak.vercel.app/terms) | الحجز والدفع والتأجيل والضمان والإحالة (مسودة لحد المراجعة القانونية) |
| [النتايج](https://beedak.vercel.app/results) | الأرقام الحقيقية من استبيان بعد كل جلسة (من `assets/data/stats.json`). لو مفيش جلسات، بتظهر رسالة «لسه بنبدأ» بدل أصفار |
| [رأيكم بعد الجلسة](https://beedak.vercel.app/feedback) | استبيان قصير بيتبعت على واتساب لرقم الحجز. مش متربط من الموقع (noindex): بيتبعت لينكه للفريق بعد الجلسة |

## اللي يميّز الموقع

- خلفية أكواد تفاعلية بتتحرك مع الماوس، وعدسة بتكبّر وتنوّر اللي تحتها.
- قصة بالألوان: الأحمر عطل، والبنفسجي عائق، والأخضر اتحل.
- البطة المحققة بتطلع من ورا العنوان وتغمز، وبتتبع الماوس.
- معمل محاكي (مفسّر Arduino C++ ومحلّل دواير) مكتوب بإيدنا، من غير أي مكتبات خارجية.
- زرار إيقاف لكل الحركة، وبديل ثابت لأي حد مقفل الحركة، والموقع شغال من غير JavaScript.
- عربي بالكامل، من اليمين للشمال، والموبايل الأول.

</div>

## Tech

Plain static site — no framework, no build step required, no external requests at runtime (the only extra request is the same-origin analytics script below, on the deployed site only).

- `index.html`, `lab.html`, `terms.html`, `results.html`, `feedback.html`
- `assets/data/stats.json` — the real numbers (free-spots counter on the home page + the results page). See "Real numbers" below
- `assets/css/styles.css` — all styles (RTL, logical properties, reduced-motion fallbacks)
- `assets/js/app.js` — interactions, code background, booking message builder
- `assets/js/sim/` — the lab simulator (spec: `design-system/beedak/pages/lab-sim-spec.md`), classic ES2017 scripts, no eval:
  - `interp.js` + `interp-2.js` — Arduino C++ interpreter (lexer, preprocessor, parser, stepping runner with virtual time; Arduino core, `String`, `Serial`, Servo, Wire, LiquidCrystal_I2C, DHT, WiFi, ledc)
  - `parts.js` — board profiles + parts catalog (pinouts, datasheet-typical values, electrical models)
  - `circuit.js` — netlist + DC solver (MNA + Newton) + realism rules / warnings
  - `board-sim.js` — the simulated board (IO backend for the interpreter)
  - `part-art.js`, `workbench.js` — 2D SVG bench (drag, snap into breadboard holes, click-click wiring, undo)
  - `serial-io.js` — real board over Web Serial (bridge protocol v2), stage-2 checks, stage-1 gate
  - `examples.js` — the 10 ready examples · `view3d.js` — CSS-3D viewer (models from the old lab)
  - `panels.js` (catalog, inspector, editor, problems, serial monitor, stages) and `sim-main.js` (the app, loaded last)
- `assets/css/lab-extra.css`, `lab-sim.css` (bench), `lab-ui.css` (panels) — lab-only styles
- `assets/firmware/beedak-lab-bridge/beedak-lab-bridge.ino` — bridge sketch, protocol v2 (Uno / Nano / ESP32)
- Retired, kept in the repo but no longer loaded: `assets/js/lab.js` (old 3D bench + command language) and `assets/js/esp-behavior.js`.
- `assets/fonts` — local Alexandria and IBM Plex Sans Arabic (woff2 subsets)
- `vercel.json` — clean URLs, caching and security headers

## Real numbers (`assets/data/stats.json`)

Absolute rule: only real data goes in this file. Never sample, rounded-up or "expected" numbers.

```json
{
  "updated": "2026-11-18",
  "free_total": 15,
  "free_booked": 0,
  "sessions_done": 0,
  "left_with_plan": 0,
  "would_pay": 0,
  "paid_teams": 0,
  "quotes": []
}
```

| Field | What to put |
|---|---|
| `updated` | The date you edited the file, `YYYY-MM-DD` (shown as «آخر تحديث») |
| `free_total` | Number of free spots (15) |
| `free_booked` | Teams that booked a free session so far. The home page shows «اتحجز X من 15»; at 0 it says «لسه مفيش فرق حجزت، كونوا أول فريق»; when it reaches `free_total`, the home page switches to the paid offer (350) and hides the "first 15 free" notes |
| `sessions_done` | Diagnosis sessions that actually happened. While it is 0, /results shows the honest empty state instead of percentages |
| `left_with_plan` | Survey answers «أيوه» to «طلعتوا بخطة واضحة للخطوة الجاية؟» («جزئيًا» does not count) |
| `would_pay` | Survey answers «أيوه» to the «خطة ومتابعة» question («يمكن» does not count) |
| `paid_teams` | Teams that actually transferred money (any paid stage), not promises |
| `quotes` | Optional. Only quotes the team agreed to in the survey. Each entry: `{ "text": "…", "team": "…", "consent": "name" }` or `"consent": "anonymous"` (team name is never shown). Entries without one of those two consent values are not shown; an empty array hides the whole block |

Percentages on /results are `left_with_plan / sessions_done` and `would_pay / sessions_done`, rounded; a team that didn't answer the survey counts as «لأ». The page also shows «X من N» next to each percentage.

How to update after a session:

1. Read the team's survey message on WhatsApp (sent from /feedback).
2. Edit the numbers in `assets/data/stats.json` (and `updated`). Keep it valid JSON (commas, double quotes).
3. Rebuild: `node tmp/build_production.cjs` (from `D:/المشروع`).
4. Deploy the dist folder: `vercel deploy --prod`.

`/assets/data/*` is served with `Cache-Control: max-age=0, must-revalidate`, so the new numbers show right after the deploy.

## Analytics (cookie-free, added 19 Nov 2026)

Every page loads Vercel Web Analytics from the same origin: an inline `<head>` snippet defines the `window.va` queue and adds `/_vercel/insights/script.js` (defer). It is skipped on `localhost`, `127.0.0.1`, `*.localhost` and `file://`, so local runs have no 404 and no console error; if the script is blocked, nothing breaks. No cookies, no personal data, no message text.

**One-time step for the owner (cannot be done from code):** in the Vercel dashboard, open the project → **Analytics** → **Enable** (Web Analytics), then redeploy. Until it is enabled, `/_vercel/insights/script.js` does not exist on the site and no visits are counted.

Custom events sent through `window.va('event', { name, data })` (helper `window.beedakTrack` in `app.js`):

| Event | When | Data |
|---|---|---|
| `booking_whatsapp_click` | Any booking WhatsApp link («قضية» message) is clicked | `page`, `from` (link id or section id) |
| `lab_tech_session_click` | The lab's technical-session button or toast link | `page` |
| `lab_example_run` | A ready lab example is run (once per example per visit) | `example` (example id) |

Note: Vercel may count custom events only on some plans (check the Analytics page of the project); page views work either way.

The privacy line about it is in `terms.html` (section «الخصوصية»).

## Run locally

```bash
python -m http.server 8765
```

Then open http://127.0.0.1:8765. Opening `index.html` directly from disk also works (the lab's real-board connection needs http(s)).

### Lab simulator tests

From the project root (`D:/المشروع`):

```bash
node tmp/sim-tests/interp.test.cjs      # interpreter (143 checks)
node tmp/sim-tests/circuit.test.cjs     # solver, parts, simulated board (155)
node tmp/sim-tests/examples.test.cjs    # the 10 examples on the real circuit (165)
node tmp/sim-tests/serial-io.test.cjs   # real-board backend + bridge protocol v2 (66)
node tmp/sim-tests/workbench.test.cjs   # bench helpers
node tmp/test_lab_sim.cjs               # end-to-end in headless Edge (starts the 8765 server if needed)
```

`tmp/build_production.cjs` minifies `assets/js/sim/*.js` with `--target=es2017` (without the target esbuild emits `??`).

## Deploy

The site is deployed on Vercel as a static project:

```bash
vercel deploy --prod
```

---

© 2026 beedak. All rights reserved.
