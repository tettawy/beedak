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
| [المعمل](https://beedak.vercel.app/lab) | محاكي Arduino وESP32: بتختاروا الكارت، وتزوّدوا القطع اللي محتاجينها بس من كتالوج، وتوصّلوها بأسلاك على طاولة 2D، وتكتبوا كود Arduino حقيقي يشتغل على المحاكي (دايرة كهربا محسوبة: لمبة بتتحرق من غير مقاومة، شورت، طرف عايم…). لو عدّى 3 ثواني من غير أخطاء ولا تحذيرات، تقدروا تشغّلوه على جهازكم بالـUSB (Web Serial + `assets/firmware/beedak-lab-bridge`، بروتوكول v2). فيه 10 أمثلة جاهزة، وحفظ وفتح ملف، وشكل 3D لبعض القطع |
| [الشروط](https://beedak.vercel.app/terms) | الحجز والدفع والتأجيل والضمان والإحالة (مسودة لحد المراجعة القانونية) |

## اللي يميّز الموقع

- خلفية أكواد تفاعلية بتتحرك مع الماوس، وعدسة بتكبّر وتنوّر اللي تحتها.
- قصة بالألوان: الأحمر عطل، والبنفسجي عائق، والأخضر اتحل.
- البطة المحققة بتطلع من ورا العنوان وتغمز، وبتتبع الماوس.
- معمل محاكي (مفسّر Arduino C++ ومحلّل دواير) مكتوب بإيدنا، من غير أي مكتبات خارجية.
- زرار إيقاف لكل الحركة، وبديل ثابت لأي حد مقفل الحركة، والموقع شغال من غير JavaScript.
- عربي بالكامل، من اليمين للشمال، والموبايل الأول.

</div>

## Tech

Plain static site — no framework, no build step required, no external requests at runtime.

- `index.html`, `lab.html`, `terms.html`
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
