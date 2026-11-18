/* examples.js — the 10 ready example projects of «المعمل», transcribed from lab-sim-spec.md §12 (parts, holes, wires, code).
 *
 * NS.Examples = [{ id, board, title_ar, desc_ar, learn_ar, project, expect }]
 *   project: the §11 project JSON (format 'beedak-lab', version 1). Plug parts use `on: "bb1:<hole>"`;
 *            sim-main runs Parts.resolvePlacement(project) before loading it. Fresh deep copy per call: NS.Examples.get(id).
 *   expect:  test-only script (tmp/sim-tests/examples.test.cjs). Times in seconds of sim time.
 *            steps: [{ at, set?: { id, key, value }, check?: [check] }]   (a step's `set` is applied at `at`, then its checks run)
 *            check: { vis: 'inst.key', gt|lt|gte|lte|eq: n | between: [a, b] | trimmed: [..] }
 *                   { serialHas: text } · { serialLacks: text } · { serialLast: text }
 *                   { serialLastNum: { between: [a, b] } } · { serialCount: { text, gte } }
 *                   { code: 'W_FLOATING', present: bool } · { anyCode: ['W_LCD_NO_ACK', 'W_I2C_PINS'] }
 *            gate: true -> the unmodified example must run with no error/warn (spec §10.4).
 *            variants: [{ name, edit: { removeWire: [a, b] } | { removePart: id }, steps, gate: false }]
 *
 * Node-loadable (no DOM). Code strings are verbatim from the spec (the test compares them with the spec text).
 * desc_ar strings are NEW COPY (the spec gives title_ar and learn_ar only).
 */
(function (root) {
  'use strict';
  var NS = root.BeedakSim = root.BeedakSim || {};

  // wire helper: [a, b, colour] -> { id, a, b, color }
  function wires(list) {
    return list.map(function (w, i) { return { id: 'w' + (i + 1), a: w[0], b: w[1], color: w[2] }; });
  }
  function project(board, parts, wireList, code, baud, controls) {
    return {
      format: 'beedak-lab', version: 1, board: board,
      parts: parts, wires: wires(wireList), controls: controls || {},
      code: code, serial: { baud: baud, lineEnding: 'nl' }
    };
  }
  function P(id, type, at, props, rot) {
    var p = { id: id, type: type, rot: rot || 0, props: props || {} };
    if (typeof at === 'string') p.on = at; else { p.x = at[0]; p.y = at[1]; }
    return p;
  }
  var UNO = P('uno1', 'uno', [0, 0]);
  var BB = P('bb1', 'bb400', [30, 0]);
  function uno() { return JSON.parse(JSON.stringify(UNO)); }
  function bb() { return JSON.parse(JSON.stringify(BB)); }

  /* ------------------------------------------------------------ 12.1 blink ------------------------------------------------------------ */
  var CODE_BLINK = [
    '// Blink: اللمبة بتنوّر ثانية وتطفي ثانية',
    'void setup() {',
    '  pinMode(13, OUTPUT);',
    '}',
    '',
    'void loop() {',
    '  digitalWrite(13, HIGH);',
    '  delay(1000);',
    '  digitalWrite(13, LOW);',
    '  delay(1000);',
    '}',
    ''].join('\n');

  /* ---------------------------------------------------------- 12.2 button-led ---------------------------------------------------------- */
  var CODE_BUTTON = [
    'const int BUTTON_PIN = 2;',
    'const int LED_PIN = 13;',
    '',
    'void setup() {',
    '  pinMode(BUTTON_PIN, INPUT);   // فيه مقاومة 10k لـGND على البريدبورد (pull-down)',
    '  pinMode(LED_PIN, OUTPUT);',
    '}',
    '',
    'void loop() {',
    '  int pressed = digitalRead(BUTTON_PIN);',
    '  if (pressed == HIGH) {',
    '    digitalWrite(LED_PIN, HIGH);',
    '  } else {',
    '    digitalWrite(LED_PIN, LOW);',
    '  }',
    '  delay(10);',
    '}',
    ''].join('\n');

  /* ----------------------------------------------------------- 12.3 pot-pwm ----------------------------------------------------------- */
  var CODE_POT = [
    'const int POT_PIN = A0;',
    'const int LED_PIN = 9;   // طرف PWM (عليه علامة ~)',
    '',
    'void setup() {',
    '  pinMode(LED_PIN, OUTPUT);',
    '  Serial.begin(9600);',
    '}',
    '',
    'void loop() {',
    '  int raw = analogRead(POT_PIN);          // من 0 لـ 1023',
    '  int level = map(raw, 0, 1023, 0, 255);  // analogWrite من 0 لـ 255',
    '  analogWrite(LED_PIN, level);',
    '  Serial.println(level);',
    '  delay(50);',
    '}',
    ''].join('\n');

  /* ----------------------------------------------------------- 12.4 hcsr04 ------------------------------------------------------------ */
  var CODE_SR04 = [
    'const int TRIG_PIN = 9;',
    'const int ECHO_PIN = 10;',
    '',
    'void setup() {',
    '  Serial.begin(9600);',
    '  pinMode(TRIG_PIN, OUTPUT);',
    '  pinMode(ECHO_PIN, INPUT);',
    '}',
    '',
    'void loop() {',
    '  digitalWrite(TRIG_PIN, LOW);',
    '  delayMicroseconds(2);',
    '  digitalWrite(TRIG_PIN, HIGH);',
    '  delayMicroseconds(10);',
    '  digitalWrite(TRIG_PIN, LOW);',
    '',
    '  long duration = pulseIn(ECHO_PIN, HIGH, 30000);  // بالميكروثانية',
    '  float distanceCm = duration * 0.0343 / 2;        // الصوت بيمشي 343 متر في الثانية',
    '',
    '  if (duration == 0) {',
    '    Serial.println("مفيش حاجة قدام الحساس");',
    '  } else {',
    '    Serial.print("المسافة: ");',
    '    Serial.print(distanceCm);',
    '    Serial.println(" سم");',
    '  }',
    '  delay(200);',
    '}',
    ''].join('\n');

  /* ----------------------------------------------------------- 12.5 dht-lcd ----------------------------------------------------------- */
  var CODE_DHT = [
    '#include <Wire.h>',
    '#include <LiquidCrystal_I2C.h>',
    '#include <DHT.h>',
    '',
    '#define DHT_PIN 2',
    '#define DHT_TYPE DHT11',
    '',
    'DHT dht(DHT_PIN, DHT_TYPE);',
    'LiquidCrystal_I2C lcd(0x27, 16, 2);',
    '',
    'void setup() {',
    '  dht.begin();',
    '  lcd.init();',
    '  lcd.backlight();',
    '  lcd.setCursor(0, 0);',
    '  lcd.print("Beedak Lab");',
    '  delay(1000);',
    '}',
    '',
    'void loop() {',
    '  float t = dht.readTemperature();',
    '  float h = dht.readHumidity();',
    '',
    '  lcd.clear();',
    '  if (isnan(t) || isnan(h)) {',
    '    lcd.print("DHT error");',
    '  } else {',
    '    lcd.setCursor(0, 0);',
    '    lcd.print("Temp: ");',
    '    lcd.print(t, 1);',
    '    lcd.print(" C");',
    '    lcd.setCursor(0, 1);',
    '    lcd.print("Hum:  ");',
    '    lcd.print(h, 0);',
    '    lcd.print(" %");',
    '  }',
    '  delay(2000);',
    '}',
    ''].join('\n');

  /* --------------------------------------------------------- 12.6 servo-sweep --------------------------------------------------------- */
  var CODE_SERVO = [
    '#include <Servo.h>',
    '',
    'Servo myServo;',
    '',
    'void setup() {',
    '  myServo.attach(9);',
    '}',
    '',
    'void loop() {',
    '  for (int angle = 0; angle <= 180; angle++) {',
    '    myServo.write(angle);',
    '    delay(15);',
    '  }',
    '  for (int angle = 180; angle >= 0; angle--) {',
    '    myServo.write(angle);',
    '    delay(15);',
    '  }',
    '}',
    ''].join('\n');

  /* ----------------------------------------------------------- 12.7 traffic ----------------------------------------------------------- */
  var CODE_TRAFFIC = [
    'const int RED = 10;',
    'const int YELLOW = 9;',
    'const int GREEN = 8;',
    '',
    'void setup() {',
    '  pinMode(RED, OUTPUT);',
    '  pinMode(YELLOW, OUTPUT);',
    '  pinMode(GREEN, OUTPUT);',
    '}',
    '',
    'void light(int pin, unsigned long ms) {',
    '  digitalWrite(RED, pin == RED ? HIGH : LOW);',
    '  digitalWrite(YELLOW, pin == YELLOW ? HIGH : LOW);',
    '  digitalWrite(GREEN, pin == GREEN ? HIGH : LOW);',
    '  delay(ms);',
    '}',
    '',
    'void loop() {',
    '  light(GREEN, 4000);',
    '  light(YELLOW, 1000);',
    '  light(RED, 4000);',
    '}',
    ''].join('\n');

  /* ---------------------------------------------------------- 12.8 ldr-night ---------------------------------------------------------- */
  var CODE_LDR = [
    'const int LDR_PIN = A0;',
    'const int LED_PIN = 9;',
    'const int DARK_LEVEL = 300;   // أقل من كده يبقى الدنيا ضلمة',
    '',
    'void setup() {',
    '  pinMode(LED_PIN, OUTPUT);',
    '  Serial.begin(9600);',
    '}',
    '',
    'void loop() {',
    '  int light = analogRead(LDR_PIN);',
    '  Serial.println(light);',
    '  if (light < DARK_LEVEL) {',
    '    digitalWrite(LED_PIN, HIGH);',
    '  } else {',
    '    digitalWrite(LED_PIN, LOW);',
    '  }',
    '  delay(200);',
    '}',
    ''].join('\n');

  /* ---------------------------------------------------------- 12.9 pir-alarm ---------------------------------------------------------- */
  var CODE_PIR = [
    'const int PIR_PIN = 2;',
    'const int BUZZER_PIN = 8;',
    '',
    'void setup() {',
    '  pinMode(PIR_PIN, INPUT);',
    '  pinMode(BUZZER_PIN, OUTPUT);',
    '  Serial.begin(9600);',
    '  Serial.println("الحساس جاهز");',
    '}',
    '',
    'void loop() {',
    '  if (digitalRead(PIR_PIN) == HIGH) {',
    '    Serial.println("فيه حركة!");',
    '    digitalWrite(BUZZER_PIN, HIGH);',
    '    delay(500);',
    '    digitalWrite(BUZZER_PIN, LOW);',
    '    delay(500);',
    '  } else {',
    '    digitalWrite(BUZZER_PIN, LOW);',
    '    delay(50);',
    '  }',
    '}',
    ''].join('\n');

  /* --------------------------------------------------------- 12.10 esp32-wifi --------------------------------------------------------- */
  var CODE_WIFI = [
    '#include <WiFi.h>',
    '',
    'const char* WIFI_NAME = "beedak-lab";',
    'const char* WIFI_PASS = "12345678";',
    'const int LED_PIN = 2;',
    '',
    'void setup() {',
    '  Serial.begin(115200);',
    '  pinMode(LED_PIN, OUTPUT);',
    '  WiFi.begin(WIFI_NAME, WIFI_PASS);',
    '  Serial.print("بيتوصل بالواي فاي");',
    '  bool on = false;',
    '  while (WiFi.status() != WL_CONNECTED) {',
    '    on = !on;',
    '    digitalWrite(LED_PIN, on ? HIGH : LOW);',
    '    Serial.print(".");',
    '    delay(250);',
    '  }',
    '  Serial.println();',
    '  Serial.print("اتوصل! الـIP: ");',
    '  Serial.println(WiFi.localIP());',
    '  digitalWrite(LED_PIN, HIGH);',
    '}',
    '',
    'void loop() {',
    '}',
    ''].join('\n');

  /* ------------------------------------------------------------- the list ------------------------------------------------------------- */
  // blink's resistor + LED (also used by button-led and pot-pwm)
  function blinkPair() {
    return [P('r1', 'resistor', 'bb1:e5', { ohms: 220 }), P('led1', 'led', 'bb1:c9', { color: 'red' })];
  }

  var LIST = [
    {
      id: 'blink', board: 'uno',
      title_ar: 'Blink: اللمبة بتنوّر وتطفي',
      desc_ar: 'لمبة حمرا ومقاومة 220 أوم على البريدبورد، متوصلين بالطرف 13.',   // NEW COPY
      learn_ar: 'أول تجربة: طرف خرج، ومقاومة بتحمي اللمبة، وdelay بيستنى.',
      project: function () {
        return project('uno', [uno(), bb()].concat(blinkPair()), [
          ['uno1.D13', 'bb1.a5', 'green'],
          ['bb1.a10', 'bb1.tn8', 'black'],
          ['uno1.GND3', 'bb1.tn1', 'black']
        ], CODE_BLINK, 9600);
      },
      expect: {
        gate: true,
        steps: [
          { at: 0.5, check: [{ vis: 'led1.b', gt: 0.5 }, { vis: 'r1.mA', between: [11, 13.5] }, { vis: 'uno1.ledL', gt: 0.5 }, { serialEmpty: true }] },
          { at: 1.5, check: [{ vis: 'led1.b', lt: 0.01 }, { vis: 'uno1.ledL', lt: 0.01 }] },
          { at: 2.5, check: [{ vis: 'led1.b', gt: 0.5 }] }
        ],
        variants: [
          { name: 'GND wire removed -> H_LED_OPEN, LED dark', edit: { removeWire: ['bb1.a10', 'bb1.tn8'] },
            steps: [{ at: 0.6, check: [{ vis: 'led1.b', lt: 0.01 }, { code: 'H_LED_OPEN', present: true }] }] }
        ]
      }
    },
    {
      id: 'button-led', board: 'uno',
      title_ar: 'زرار ولمبة (pull-down)',
      desc_ar: 'زرار على البريدبورد بمقاومة 10k لـGND على الطرف 2، ولمبة على الطرف 13.',   // NEW COPY
      learn_ar: 'الزرار محتاج مقاومة 10k لـGND، وإلا الطرف بيبقى عايم والقراية عشوائية.',
      project: function () {
        return project('uno', [uno(), bb()].concat(blinkPair(), [
          P('btn1', 'button', 'bb1:e15'),
          P('r2', 'resistor', 'bb1:i17', { ohms: 10000 })
        ]), [
          ['uno1.D13', 'bb1.a5', 'green'],
          ['bb1.a10', 'bb1.tn8', 'black'],
          ['uno1.GND3', 'bb1.tn1', 'black'],
          ['uno1.5V', 'bb1.tp1', 'red'],
          ['bb1.tp12', 'bb1.a15', 'red'],
          ['uno1.D2', 'bb1.j17', 'yellow'],
          ['bb1.j21', 'bb1.bn18', 'black'],
          ['uno1.GND1', 'bb1.bn1', 'black']
        ], CODE_BUTTON, 9600);
      },
      expect: {
        gate: true,
        steps: [
          { at: 1.0, check: [{ vis: 'led1.b', lt: 0.01 }, { code: 'W_FLOATING', present: false }] },
          { at: 1.0, set: { id: 'btn1', key: 'pressed', value: true } },
          { at: 1.02, check: [{ vis: 'led1.b', gt: 0.5 }] },
          { at: 1.5, set: { id: 'btn1', key: 'pressed', value: false } },
          { at: 1.53, check: [{ vis: 'led1.b', lt: 0.01 }] }
        ],
        variants: [
          { name: 'pull-down removed -> W_FLOATING', edit: { removePart: 'r2' },
            steps: [{ at: 1.0, check: [{ code: 'W_FLOATING', present: true }] }] }
        ]
      }
    },
    {
      id: 'pot-pwm', board: 'uno',
      title_ar: 'مقاومة متغيرة بتتحكم في نور اللمبة',
      desc_ar: 'مقاومة متغيرة 10k على A0، ولمبة على الطرف 9 (PWM).',   // NEW COPY
      learn_ar: 'analogRead بيقرا من 0 لـ1023، وmap بيحوّلها لـ0–255 علشان analogWrite على طرف PWM.',
      project: function () {
        return project('uno', [uno(), bb()].concat(blinkPair(), [P('pot1', 'pot', 'bb1:c20')]), [
          ['uno1.D9', 'bb1.a5', 'green'],
          ['bb1.a10', 'bb1.tn8', 'black'],
          ['uno1.GND3', 'bb1.tn1', 'black'],
          ['uno1.5V', 'bb1.tp1', 'red'],
          ['bb1.a20', 'bb1.tn17', 'black'],
          ['bb1.a22', 'bb1.tp18', 'red'],
          ['bb1.a21', 'uno1.A0', 'yellow']
        ], CODE_POT, 9600, { pot1: { pos: 50 } });
      },
      expect: {
        gate: true,
        steps: [
          { at: 1.0, check: [{ serialLastNum: { between: [127, 127] } }, { vis: 'led1.b', between: [0.3, 0.8] }] },
          { at: 1.0, set: { id: 'pot1', key: 'pos', value: 100 } },
          { at: 1.5, check: [{ serialLastNum: { between: [255, 255] } }, { vis: 'led1.b', gt: 0.7 }] },
          { at: 1.5, set: { id: 'pot1', key: 'pos', value: 0 } },
          { at: 2.0, check: [{ serialLastNum: { between: [0, 0] } }, { vis: 'led1.b', lt: 0.01 }] }
        ]
      }
    },
    {
      id: 'hcsr04', board: 'uno',
      title_ar: 'حساس المسافة على السيريال',
      desc_ar: 'حساس HC-SR04 على البريدبورد: Trig على 9 وEcho على 10، والمسافة بتطلع على شاشة السيريال.',   // NEW COPY
      learn_ar: 'نبضة 10 ميكروثانية على Trig، وpulseIn بيقيس قد إيه Echo فضل HIGH.',
      project: function () {
        return project('uno', [uno(), bb(), P('sr1', 'hcsr04', 'bb1:c12')], [
          ['uno1.5V', 'bb1.tp1', 'red'],
          ['uno1.GND3', 'bb1.tn1', 'black'],
          ['bb1.a12', 'bb1.tp10', 'red'],
          ['uno1.D9', 'bb1.a13', 'green'],
          ['uno1.D10', 'bb1.a14', 'yellow'],
          ['bb1.a15', 'bb1.tn12', 'black']
        ], CODE_SR04, 9600, { sr1: { distance: 50 } });
      },
      expect: {
        gate: true,
        steps: [
          { at: 1.0, check: [{ serialLastNum: { between: [49.5, 50.5] } }, { serialHas: 'المسافة: ' }] },
          { at: 1.0, set: { id: 'sr1', key: 'distance', value: 100 } },
          { at: 1.6, check: [{ serialLastNum: { between: [99.5, 100.5] } }] },
          { at: 1.6, set: { id: 'sr1', key: 'noObject', value: true } },
          { at: 2.2, check: [{ serialLast: 'مفيش حاجة قدام الحساس' }] }
        ]
      }
    },
    {
      id: 'dht-lcd', board: 'uno',
      title_ar: 'الحرارة والرطوبة على شاشة LCD',
      desc_ar: 'حساس DHT11 على الطرف 2، وشاشة LCD 16×2 بـI2C على A4 وA5.',   // NEW COPY
      learn_ar: 'الشاشة بتتكلم I2C على A4 وA5، والـDHT11 بيتقري مرة كل ثانيتين.',
      project: function () {
        return project('uno', [uno(), bb(), P('dht1', 'dht11', [31, 26]), P('lcd1', 'lcd1602', [46, 34], { addr: 39 })], [
          ['uno1.5V', 'bb1.tp1', 'red'],
          ['uno1.GND3', 'bb1.tn1', 'black'],
          ['dht1.VCC', 'bb1.tp8', 'red'],
          ['dht1.DATA', 'uno1.D2', 'yellow'],
          ['dht1.GND', 'bb1.tn9', 'black'],
          ['lcd1.GND', 'bb1.tn20', 'black'],
          ['lcd1.VCC', 'bb1.tp20', 'red'],
          ['lcd1.SDA', 'uno1.A4', 'blue'],
          ['lcd1.SCL', 'uno1.A5', 'orange']
        ], CODE_DHT, 9600, { dht1: { temp: 25, hum: 60 } });
      },
      expect: {
        gate: true,
        steps: [
          { at: 3.5, check: [{ vis: 'lcd1.lines', trimmed: ['Temp: 25.0 C', 'Hum:  60 %'] }, { vis: 'lcd1.backlight', eq: true }] }
        ],
        variants: [
          { name: 'SDA wire removed -> W_LCD_NO_ACK / W_I2C_PINS', edit: { removeWire: ['lcd1.SDA', 'uno1.A4'] },
            steps: [{ at: 3.5, check: [{ anyCode: ['W_LCD_NO_ACK', 'W_I2C_PINS'] }] }] }
        ]
      }
    },
    {
      id: 'servo-sweep', board: 'uno',
      title_ar: 'سيرفو بيلف رايح جاي',
      desc_ar: 'موتور سيرفو SG90 متوصّل على طول بالكارت: الإشارة على الطرف 9.',   // NEW COPY
      learn_ar: 'مكتبة Servo بتبعت نبضة كل 20 مللي ثانية، وعرض النبضة هو اللي بيحدد الزاوية.',
      project: function () {
        return project('uno', [uno(), P('srv1', 'sg90', [31, 12])], [
          ['srv1.GND', 'uno1.GND1', 'black'],
          ['srv1.VCC', 'uno1.5V', 'red'],
          ['srv1.SIG', 'uno1.D9', 'orange']
        ], CODE_SERVO, 9600);
      },
      expect: {
        gate: true,
        steps: [
          { at: 1.0, check: [{ vis: 'srv1.angle', between: [40, 90] }] },
          { at: 2.75, check: [{ vis: 'srv1.angle', gte: 170 }] },
          { at: 4.0, check: [{ vis: 'srv1.angle', lt: 150 }, { code: 'W_USB_BUDGET', present: false }] }
        ]
      }
    },
    {
      id: 'traffic', board: 'uno',
      title_ar: 'إشارة مرور',
      desc_ar: 'تلات لمبات (أحمر وأصفر وأخضر) على الأطراف 10 و9 و8، كل واحدة بمقاومة 220 أوم.',   // NEW COPY
      learn_ar: 'تلات لمبات، كل واحدة بمقاومتها، ودالة صغيرة بتنوّر واحدة وتطفي الباقي.',
      project: function () {
        return project('uno', [uno(), bb(),
          P('r1', 'resistor', 'bb1:e3', { ohms: 220 }), P('led1', 'led', 'bb1:c7', { color: 'red' }),
          P('r2', 'resistor', 'bb1:e11', { ohms: 220 }), P('led2', 'led', 'bb1:c15', { color: 'yellow' }),
          P('r3', 'resistor', 'bb1:e19', { ohms: 220 }), P('led3', 'led', 'bb1:c23', { color: 'green' })
        ], [
          ['uno1.D10', 'bb1.a3', 'red'],
          ['uno1.D9', 'bb1.a11', 'yellow'],
          ['uno1.D8', 'bb1.a19', 'green'],
          ['bb1.a8', 'bb1.tn5', 'black'],
          ['bb1.a16', 'bb1.tn11', 'black'],
          ['bb1.a24', 'bb1.tn20', 'black'],
          ['uno1.GND3', 'bb1.tn1', 'black']
        ], CODE_TRAFFIC, 9600);
      },
      expect: {
        gate: true,
        steps: [
          { at: 2.0, check: [{ vis: 'led3.b', gt: 0.5 }, { vis: 'led2.b', lt: 0.01 }, { vis: 'led1.b', lt: 0.01 }, { vis: 'r3.mA', between: [10.5, 12.5] }] },
          { at: 4.5, check: [{ vis: 'led2.b', gt: 0.5 }, { vis: 'led3.b', lt: 0.01 }, { vis: 'led1.b', lt: 0.01 }] },
          { at: 6.0, check: [{ vis: 'led1.b', gt: 0.5 }, { vis: 'led2.b', lt: 0.01 }, { vis: 'led3.b', lt: 0.01 }] }
        ]
      }
    },
    {
      id: 'ldr-night', board: 'uno',
      title_ar: 'لمبة بتنوّر لوحدها في الضلمة',
      desc_ar: 'حساس ضوء LDR مع مقاومة 10k على A0، ولمبة على الطرف 9.',   // NEW COPY
      learn_ar: 'الـLDR مع مقاومة 10k بيعملوا مقسّم جهد، والكود بيقارن القراية برقم.',
      project: function () {
        return project('uno', [uno(), bb(),
          P('r1', 'resistor', 'bb1:e3', { ohms: 220 }), P('led1', 'led', 'bb1:c7', { color: 'red' }),
          P('ldr1', 'ldr', 'bb1:c20'), P('r2', 'resistor', 'bb1:e21', { ohms: 10000 })
        ], [
          ['uno1.D9', 'bb1.a3', 'green'],
          ['bb1.a8', 'bb1.tn5', 'black'],
          ['uno1.GND3', 'bb1.tn1', 'black'],
          ['uno1.5V', 'bb1.tp1', 'red'],
          ['bb1.a20', 'bb1.tp16', 'red'],
          ['bb1.b21', 'uno1.A0', 'yellow'],
          ['bb1.a25', 'bb1.tn21', 'black']
        ], CODE_LDR, 9600, { ldr1: { lux: 300 } });
      },
      expect: {
        gate: true,
        steps: [
          { at: 1.0, check: [{ serialLastNum: { between: [888, 908] } }, { vis: 'led1.b', lt: 0.01 }] },
          { at: 1.0, set: { id: 'ldr1', key: 'lux', value: 1 } },
          { at: 1.6, check: [{ serialLastNum: { between: [110, 130] } }, { vis: 'led1.b', gt: 0.5 }] }
        ]
      }
    },
    {
      id: 'pir-alarm', board: 'uno',
      title_ar: 'إنذار حركة بالبازر',
      desc_ar: 'حساس حركة PIR على الطرف 2، وبازر على الطرف 8.',   // NEW COPY
      learn_ar: 'حساس الـPIR بيطلّع HIGH لما يحس بحركة، والكود بيشغّل البازر.',
      project: function () {
        return project('uno', [uno(), bb(), P('pir1', 'pir', [33, 34]), P('bz1', 'buzzer', 'bb1:c10')], [
          ['uno1.5V', 'bb1.tp1', 'red'],
          ['uno1.GND3', 'bb1.tn1', 'black'],
          ['pir1.VCC', 'bb1.tp20', 'red'],
          ['pir1.GND', 'bb1.tn20', 'black'],
          ['pir1.OUT', 'uno1.D2', 'yellow'],
          ['uno1.D8', 'bb1.a10', 'green'],
          ['bb1.a13', 'bb1.tn12', 'black']
        ], CODE_PIR, 9600, { pir1: { skipWarmup: true, holdS: 5 } });
      },
      expect: {
        gate: true,
        steps: [
          { at: 1.0, check: [{ serialHas: 'الحساس جاهز' }, { vis: 'bz1.on', eq: false }] },
          { at: 1.0, set: { id: 'pir1', key: 'motion', value: true } },
          { at: 1.1, check: [{ vis: 'bz1.on', eq: true }, { serialHas: 'فيه حركة!' }] },
          { at: 7.1, check: [{ vis: 'bz1.on', eq: false }] },
          { at: 7.6, check: [{ vis: 'bz1.on', eq: false }] },
          { at: 8.0, check: [{ vis: 'bz1.on', eq: false }, { code: 'W_PIN_CURRENT', present: false }] }
        ]
      }
    },
    {
      id: 'esp32-wifi', board: 'esp32',
      title_ar: 'ESP32: اتصال بالواي فاي ولمبة',
      desc_ar: 'ESP32 بيتوصل بشبكة واي فاي وهمية، ولمبة على الطرف 2 بتقول الحالة.',   // NEW COPY
      learn_ar: 'WiFi.begin بيبدأ الاتصال، والكود بيستنى لحد ما الحالة تبقى WL_CONNECTED. الإنترنت هنا وهمي.',
      project: function () {
        return project('esp32', [P('esp1', 'esp32', [0, 0]), P('bb1', 'bb400', [15, 0]),
          P('r1', 'resistor', 'bb1:e5', { ohms: 220 }), P('led1', 'led', 'bb1:c9', { color: 'red' })
        ], [
          ['esp1.D2', 'bb1.a5', 'green'],
          ['bb1.a10', 'bb1.tn8', 'black'],
          ['esp1.GND2', 'bb1.tn1', 'black']
        ], CODE_WIFI, 115200);
      },
      expect: {
        gate: true,
        steps: [
          { at: 4.0, check: [{ serialHas: 'اتوصل! الـIP: 192.168.1.' }, { vis: 'led1.b', gt: 0.1 }] }
        ],
        variants: [
          { name: 'router off -> keeps printing dots', controls: { esp1: { routerOff: true } },
            steps: [{ at: 4.0, check: [{ serialLacks: 'اتوصل!' }, { serialCount: { text: '.', gte: 10 } }] }] }
        ]
      }
    }
  ];

  // public list: project is a plain object (fresh copy per access through get())
  var Examples = LIST.map(function (e) {
    return { id: e.id, board: e.board, title_ar: e.title_ar, desc_ar: e.desc_ar, learn_ar: e.learn_ar, project: e.project(), expect: e.expect };
  });
  // fresh deep copy of one example (sim-main loads this, so edits on the bench never change the list)
  Object.defineProperty(Examples, 'get', {
    enumerable: false,
    value: function (id) {
      for (var i = 0; i < LIST.length; i++) {
        if (LIST[i].id === id) {
          var e = LIST[i];
          return { id: e.id, board: e.board, title_ar: e.title_ar, desc_ar: e.desc_ar, learn_ar: e.learn_ar,
            project: e.project(), expect: JSON.parse(JSON.stringify(e.expect)) };
        }
      }
      return null;
    }
  });

  NS.Examples = Examples;
})(typeof window !== 'undefined' ? window : globalThis);
