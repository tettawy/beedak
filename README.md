<div dir="rtl">

# بإيدك · beedak

**مشروع التخرج واقف؟ افهموه، وكمّلوه بإيدكم.**

«بإيدك» خدمة إرشاد لفرق مشروعات التخرج (سنة رابعة حاسبات وهندسة) في مصر. بتبدأ بجلسة تشخيص أونلاين مدتها 45 دقيقة، بنحدد فيها مع الفريق اللي واقف وسببه، والفريق بيطلع بخطة للخطوة الجاية مكتوبة بإيده.

> إحنا بنرشد ونراجع، وانتو اللي بتنفذوا.

**الموقع:** https://beedak.vercel.app

## الصفحات

| الصفحة | فيها إيه |
|---|---|
| [الرئيسية](https://beedak.vercel.app) | العرض والأسعار والضمان، ومنشئ رسالة «قضية» اللي بتتبعت على واتساب |
| [المعمل](https://beedak.vercel.app/lab) | أجهزة 3D (ESP32 وArduino وبريدبورد وحساس) بتلفّوها وتحركوها، ومحرر أوامر بسيط للـESP32 |
| [الشروط](https://beedak.vercel.app/terms) | الحجز والدفع والتأجيل والضمان والإحالة (مسودة لحد المراجعة القانونية) |

## اللي يميّز الموقع

- خلفية أكواد تفاعلية بتتحرك مع الماوس، وعدسة بتكبّر وتنوّر اللي تحتها.
- قصة بالألوان: الأحمر عطل، والبنفسجي عائق، والأخضر اتحل.
- البطة المحققة بتطلع من ورا العنوان وتغمز، وبتتبع الماوس.
- معمل CSS 3D من غير أي مكتبات خارجية.
- زرار إيقاف لكل الحركة، وبديل ثابت لأي حد مقفل الحركة، والموقع شغال من غير JavaScript.
- عربي بالكامل، من اليمين للشمال، والموبايل الأول.

</div>

## Tech

Plain static site — no framework, no build step required, no external requests at runtime.

- `index.html`, `lab.html`, `terms.html`
- `assets/css/styles.css` — all styles (RTL, logical properties, reduced-motion fallbacks)
- `assets/js/app.js` — interactions, code background, booking message builder
- `assets/js/lab.js` — CSS 3D bench, controls, safe command parser (no `eval`)
- `assets/js/esp-behavior.js` — **edit this file to change how the ESP32 behaves** (LED colours, blink speed, Wi-Fi states, serial messages, click action, sequences). Comments are in Arabic.
- `assets/fonts` — local Alexandria and IBM Plex Sans Arabic (woff2 subsets)
- `vercel.json` — clean URLs, caching and security headers

## Run locally

```bash
python -m http.server 8765
```

Then open http://127.0.0.1:8765. Opening `index.html` directly from disk also works.

## Deploy

The site is deployed on Vercel as a static project:

```bash
vercel deploy --prod
```

---

© 2026 beedak. All rights reserved.
