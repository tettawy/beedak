/*
  beedak-lab-bridge.ino  —  كود الجسر بتاع «المعمل» في بإيدك (البروتوكول v2)
  ---------------------------------------------------------------------------
  ارفعوه مرة واحدة على الكارت من Arduino IDE (Arduino Uno أو Nano أو ESP32).
  بعدها صفحة المعمل في Chrome أو Edge بتشغّل الكود بتاعكم في المتصفح، وبتبعت للكارت
  أوامر أطراف بس (اكتب على طرف، اقرا طرف، PWM، نغمة…) بالـUSB. الصفحة ما بترفعش حاجة
  على الكارت ولا بتغيّر الكود ده: بتبعت سطور نص بس.

  السرعة: 115200. كل سطر بيخلص بـ "\n" (الـ "\r" بيتجاهل)، وأقصى طول للسطر 200 بايت.

  الصفحة بتبعت:
    PING <token>                  -> ok PING <token> <BOARD> 2
    X <seq> <op>[;<op>]...        -> ok <seq>[ <r1> <r2> ...]   أو   err <seq> <CODE> <opIndex>
  الكارت أول ما يشتغل بيكتب:  ready beedak-bridge 2 <BOARD>      (BOARD = UNO أو NANO أو ESP32 أو OTHER)

  الأوامر (op):
    PM p m      pinMode، و m واحد من: I (INPUT) · O (OUTPUT) · U (INPUT_PULLUP) · D (INPUT_PULLDOWN، ESP32 بس)
    DW p v      digitalWrite، v = 0 أو 1
    DR p        digitalRead                        -> 0 أو 1
    AR p        analogRead بدقة الكارت نفسه         -> رقم (Uno/Nano من 0 لـ1023، ESP32 من 0 لـ4095)
    AW p v      analogWrite من 0 لـ255 (على ESP32 بالـledc، 1000 هرتز، 8 بت)
    TN p hz ms  tone، و ms = 0 يعني لحد NT
    NT p        noTone
    US n        delayMicroseconds، n لحد 10000
    PI p l t    pulseIn(p, l, t)، و t لحد 100000 ميكروثانية   -> عرض النبضة بالميكروثانية (0 = مفيش نبضة)
    RS          كل الأطراف المسموحة ترجع INPUT، والنغمة تقف
  كل قيمة بترجع بالترتيب في سطر الـok. الأوامر بتتراجع كلها الأول، ولو فيه أمر غلط مفيش حاجة بتتنفذ
  (غير لو الغلط ظهر وقت التنفيذ نفسه، ساعتها اللي قبله اتنفذ). opIndex بيبدأ من 0.
  أكواد الأخطاء: BADOP · BADPIN · RESERVED · INPUTONLY · RANGE · NOTSUP · TOOLONG

  الأطراف المسموحة:
    Uno: من 2 لـ19 (A0..A5 = 14..19).  Nano: من 2 لـ21 (A6 و A7 = 20 و21 قراية analog بس).
    ESP32: 2، 4، 5، 12..19، 21..23، 25..27، 32..39 (34..39 دخل بس).
    محجوزة (خط الـUSB أو الفلاش): Uno/Nano 0 و1 — ESP32 1 و3 و6..11.
  أي سطر تاني من الكارت مش رد على أمر. السيرفو والشاشة والـDHT والواي فاي والـinterrupt مش مدعومين
  على الجهاز الحقيقي في النسخة دي (الصفحة بترفض قبل ما تبعت).
*/

#include <Arduino.h>
#include <stdlib.h>
#include <string.h>

/* ---------------- board detection ---------------- */
#if defined(ARDUINO_ARCH_ESP32)
  #define BEEDAK_ESP32 1
  #define BEEDAK_BOARD "ESP32"
  #if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    #define BEEDAK_LEDC 3              // core 3.x: ledcAttach(pin, freq, bits) / ledcWrite(pin, duty)
  #elif defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 2
    #define BEEDAK_LEDC 2              // core 2.x: ledcSetup(ch, freq, bits) / ledcAttachPin(pin, ch) / ledcWrite(ch, duty)
  #else
    #define BEEDAK_LEDC 0              // core 1.x: analogWrite / tone answer "err NOTSUP"
  #endif
#elif defined(ARDUINO_AVR_UNO)
  #define BEEDAK_BOARD "UNO"
#elif defined(ARDUINO_AVR_NANO)
  #define BEEDAK_BOARD "NANO"
  #define BEEDAK_NANO 1
#else
  #define BEEDAK_BOARD "OTHER"
#endif

const unsigned long BAUD = 115200;
#define BEEDAK_LINE_MAX 200          // longest command line we keep, in bytes (not LINE_MAX: newlib defines that macro)
#define BEEDAK_OPS_MAX 24            // ops per line (the page sends at most 8)
#define BEEDAK_PROTO 2

// one parsed op. Defined before any function so the Arduino IDE's generated prototypes can use it.
struct Op {
  char v0, v1;     // verb letters (upper case)
  long a, b, c;    // arguments (PM: b = mode letter)
};

char line[BEEDAK_LINE_MAX + 1];
int lineLen = 0;
bool lineTooLong = false;

/* ---------------- pins ---------------- */
// pin kinds
#define PK_NONE 0       // not a pin of this board -> BADPIN
#define PK_RESERVED 1   // USB serial / flash -> RESERVED
#define PK_IO 2         // digital in/out
#define PK_IN 3         // input only (ESP32 34..39)
#define PK_ANALOG 4     // analog read only (Nano A6/A7)

uint8_t pinKind(long p) {
#if defined(BEEDAK_ESP32)
  if (p == 1 || p == 3 || (p >= 6 && p <= 11)) return PK_RESERVED;
  if (p == 2 || p == 4 || p == 5 || (p >= 12 && p <= 19) || (p >= 21 && p <= 23) || (p >= 25 && p <= 27) || (p >= 32 && p <= 33)) return PK_IO;
  if (p >= 34 && p <= 39) return PK_IN;
  return PK_NONE;
#elif defined(BEEDAK_NANO)
  if (p == 0 || p == 1) return PK_RESERVED;
  if (p >= 2 && p <= 19) return PK_IO;
  if (p == 20 || p == 21) return PK_ANALOG;
  return PK_NONE;
#elif defined(ARDUINO_AVR_UNO)
  if (p == 0 || p == 1) return PK_RESERVED;
  if (p >= 2 && p <= 19) return PK_IO;
  return PK_NONE;
#else
  if (p == 0 || p == 1) return PK_RESERVED;
  if (p >= 2 && p <= 13) return PK_IO;   // unknown board: plain digital pins only
  return PK_NONE;
#endif
}

bool isAdc(long p) {
#if defined(BEEDAK_ESP32)
  return p == 36 || p == 39 || p == 32 || p == 33 || p == 34 || p == 35 || p == 4 || p == 2 || p == 15 ||
         p == 13 || p == 12 || p == 14 || p == 27 || p == 25 || p == 26;
#elif defined(BEEDAK_NANO)
  return p >= 14 && p <= 21;
#elif defined(ARDUINO_AVR_UNO)
  return p >= 14 && p <= 19;
#else
  return false;
#endif
}

/* ---------------- ESP32 PWM / tone over ledc ---------------- */
#if defined(BEEDAK_ESP32)
uint8_t ledcMode[40];                // 0 none, 1 analogWrite PWM, 2 tone
unsigned long toneEnd[40];           // millis() when a timed tone stops (0 = until NT)
#if BEEDAK_LEDC == 2
int8_t ledcChan[40];                 // core 2.x: channel per pin, -1 = none
// even channels only: channels 2k and 2k+1 share one timer, so every pin gets its own frequency
int8_t allocChan() {
  for (int8_t c = 0; c < 16; c += 2) {
    bool used = false;
    for (int p = 0; p < 40; p++) if (ledcChan[p] == c) { used = true; break; }
    if (!used) return c;
  }
  return -1;
}
#endif

void ledcOff(int p) {
  if (!ledcMode[p]) return;
#if BEEDAK_LEDC == 3
  ledcDetach(p);
#elif BEEDAK_LEDC == 2
  ledcDetachPin(p);
  ledcChan[p] = -1;
#endif
  ledcMode[p] = 0;
  toneEnd[p] = 0;
}

// attach pin p to ledc with freq/bits; false when no channel is free or the core refuses
bool ledcOn(int p, uint32_t freq, uint8_t bits, uint8_t mode) {
#if BEEDAK_LEDC == 3
  if (ledcMode[p]) ledcDetach(p);
  ledcMode[p] = 0;
  if (!ledcAttach(p, freq, bits)) return false;
  ledcMode[p] = mode;
  return true;
#elif BEEDAK_LEDC == 2
  if (ledcChan[p] < 0) {
    int8_t c = allocChan();
    if (c < 0) return false;
    ledcChan[p] = c;
  }
  ledcSetup(ledcChan[p], freq, bits);
  ledcAttachPin(p, ledcChan[p]);
  ledcMode[p] = mode;
  return true;
#else
  (void)p; (void)freq; (void)bits; (void)mode;
  return false;
#endif
}
#elif defined(__AVR__)
int8_t tonePin = -1;                 // AVR: one tone at a time (Timer2)
#endif

void resetPins() {
  for (long p = 0; p < 40; p++) {
    uint8_t k = pinKind(p);
    if (k != PK_IO && k != PK_IN) continue;
#if defined(BEEDAK_ESP32)
    ledcOff(p);
#endif
    if (k == PK_IO) digitalWrite(p, LOW);   // AVR: also turns PWM off and the pull-up off
    pinMode(p, INPUT);
  }
#if defined(__AVR__) && !defined(BEEDAK_ESP32)
  if (tonePin >= 0) { noTone(tonePin); pinMode(tonePin, INPUT); tonePin = -1; }
#endif
}

/* ---------------- parsing ---------------- */
Op ops[BEEDAK_OPS_MAX];
long results[BEEDAK_OPS_MAX];

char up(char c) { return (c >= 'a' && c <= 'z') ? (char)(c - 32) : c; }
const char *skipSp(const char *s) { while (*s == ' ' || *s == '\t') s++; return s; }

// reads a decimal integer; false if there is none
bool readNum(const char **ps, long *out) {
  const char *s = skipSp(*ps);
  char *end = 0;
  if (!((*s >= '0' && *s <= '9') || *s == '-' || *s == '+')) return false;
  long v = strtol(s, &end, 10);
  if (end == s) return false;
  *out = v;
  *ps = end;
  return true;
}

bool verbIs(const Op &o, const char *v) { return o.v0 == v[0] && o.v1 == v[1]; }

// error codes
const char *E_BADOP = "BADOP";
const char *E_BADPIN = "BADPIN";
const char *E_RESERVED = "RESERVED";
const char *E_INPUTONLY = "INPUTONLY";
const char *E_RANGE = "RANGE";
const char *E_NOTSUP = "NOTSUP";
const char *E_TOOLONG = "TOOLONG";

void replyErr(long seq, const char *code, int index) {
  Serial.print(F("err ")); Serial.print(seq); Serial.print(' ');
  Serial.print(code); Serial.print(' '); Serial.println(index);
}

// parses one op from s up to ';' or end. Returns NULL on a syntax error, else the char after the op.
const char *parseOp(const char *s, Op &o) {
  s = skipSp(s);
  if (!s[0] || !s[1]) return NULL;
  o.v0 = up(s[0]); o.v1 = up(s[1]);
  s += 2;
  if (*s && *s != ' ' && *s != ';' && *s != '\t') return NULL;
  o.a = o.b = o.c = 0;
  int need = -1;
  if (verbIs(o, "RS")) need = 0;
  else if (verbIs(o, "DR") || verbIs(o, "AR") || verbIs(o, "NT") || verbIs(o, "US")) need = 1;
  else if (verbIs(o, "DW") || verbIs(o, "AW")) need = 2;
  else if (verbIs(o, "TN") || verbIs(o, "PI")) need = 3;
  else if (verbIs(o, "PM")) {
    if (!readNum(&s, &o.a)) return NULL;
    s = skipSp(s);
    char m = up(*s);
    if (m != 'I' && m != 'O' && m != 'U' && m != 'D') return NULL;
    o.b = m;
    s++;
    need = 0;
  } else return NULL;
  long *dst[3] = { &o.a, &o.b, &o.c };
  for (int i = 0; i < need; i++) if (!readNum(&s, dst[i])) return NULL;
  s = skipSp(s);
  if (*s && *s != ';') return NULL;
  return s;
}

// checks one op against this board. Returns an error code or NULL.
const char *checkOp(const Op &o) {
  if (verbIs(o, "RS")) return NULL;
  if (verbIs(o, "US")) return (o.a < 0 || o.a > 10000) ? E_RANGE : NULL;
  uint8_t k = pinKind(o.a);
  if (k == PK_NONE) return E_BADPIN;
  if (k == PK_RESERVED) return E_RESERVED;
  bool out = verbIs(o, "DW") || verbIs(o, "AW") || verbIs(o, "TN") || verbIs(o, "NT") || (verbIs(o, "PM") && o.b == 'O');
  if (k == PK_IN && out) return E_INPUTONLY;
  if (k == PK_ANALOG && !verbIs(o, "AR")) return E_NOTSUP;
  if (verbIs(o, "PM")) {
#if defined(BEEDAK_ESP32)
    if (k == PK_IN && (o.b == 'U' || o.b == 'D')) return E_NOTSUP;   // GPIO34..39 have no internal pull resistors
#else
    if (o.b == 'D') return E_NOTSUP;                                  // AVR has no INPUT_PULLDOWN
#endif
    return NULL;
  }
  if (verbIs(o, "DW")) return (o.b == 0 || o.b == 1) ? NULL : E_RANGE;
  if (verbIs(o, "DR")) return NULL;
  if (verbIs(o, "AR")) return isAdc(o.a) ? NULL : E_NOTSUP;
  if (verbIs(o, "AW")) {
    if (o.b < 0 || o.b > 255) return E_RANGE;
#if defined(BEEDAK_ESP32) && BEEDAK_LEDC == 0
    return E_NOTSUP;
#endif
    return NULL;
  }
  if (verbIs(o, "TN")) {
    if (o.b < 1 || o.b > 65535 || o.c < 0) return E_RANGE;
#if defined(BEEDAK_ESP32) && BEEDAK_LEDC == 0
    return E_NOTSUP;
#elif !defined(BEEDAK_ESP32) && !defined(__AVR__)
    return E_NOTSUP;
#endif
    return NULL;
  }
  if (verbIs(o, "NT")) {
#if defined(BEEDAK_ESP32) && BEEDAK_LEDC == 0
    return E_NOTSUP;
#elif !defined(BEEDAK_ESP32) && !defined(__AVR__)
    return E_NOTSUP;
#endif
    return NULL;
  }
  if (verbIs(o, "PI")) {
    if ((o.b != 0 && o.b != 1) || o.c < 1 || o.c > 100000) return E_RANGE;
    return NULL;
  }
  return E_BADOP;
}

/* ---------------- execution ---------------- */
// runs one op; returns NULL or an error code found while running. *hasResult / *result for reads.
const char *runOp(const Op &o, bool *hasResult, long *result) {
  *hasResult = false;
  int p = (int)o.a;
  if (verbIs(o, "RS")) { resetPins(); return NULL; }
  if (verbIs(o, "US")) { if (o.a > 0) delayMicroseconds((unsigned int)o.a); return NULL; }
  if (verbIs(o, "PM")) {
#if defined(BEEDAK_ESP32)
    ledcOff(p);
    if (o.b == 'D') { pinMode(p, INPUT_PULLDOWN); return NULL; }
#endif
    pinMode(p, o.b == 'O' ? OUTPUT : o.b == 'U' ? INPUT_PULLUP : INPUT);
    return NULL;
  }
  if (verbIs(o, "DW")) {
#if defined(BEEDAK_ESP32)
    if (ledcMode[p]) { ledcOff(p); pinMode(p, OUTPUT); }   // like AVR: digitalWrite on a PWM pin stops the PWM
#endif
    digitalWrite(p, o.b ? HIGH : LOW);
    return NULL;
  }
  if (verbIs(o, "DR")) { *hasResult = true; *result = digitalRead(p) ? 1 : 0; return NULL; }
  if (verbIs(o, "AR")) { *hasResult = true; *result = analogRead(p); return NULL; }
  if (verbIs(o, "AW")) {
#if defined(BEEDAK_ESP32)
    // 0 and 255 are plain LOW / HIGH (what analogWrite does on the real cores); between: ledc 1 kHz, 8 bit
    if (o.b == 0 || o.b == 255) {
      ledcOff(p);
      pinMode(p, OUTPUT);
      digitalWrite(p, o.b ? HIGH : LOW);
      return NULL;
    }
    if (ledcMode[p] != 1 && !ledcOn(p, 1000, 8, 1)) return E_NOTSUP;
  #if BEEDAK_LEDC == 3
    ledcWrite(p, (uint32_t)o.b);
  #elif BEEDAK_LEDC == 2
    ledcWrite(ledcChan[p], (uint32_t)o.b);
  #endif
#else
    analogWrite(p, (int)o.b);    // non-PWM pins: < 128 -> LOW, else HIGH (Arduino core behaviour)
#endif
    return NULL;
  }
  if (verbIs(o, "TN")) {
#if defined(BEEDAK_ESP32)
    if (!ledcOn(p, (uint32_t)o.b, 10, 2)) return E_NOTSUP;
  #if BEEDAK_LEDC == 3
    ledcWriteTone(p, (uint32_t)o.b);
  #elif BEEDAK_LEDC == 2
    ledcWriteTone(ledcChan[p], (double)o.b);
  #endif
    toneEnd[p] = o.c > 0 ? millis() + (unsigned long)o.c : 0;
    if (toneEnd[p] == 0 && o.c > 0) toneEnd[p] = 1;
#elif defined(__AVR__)
    if (tonePin >= 0 && tonePin != p) return NULL;   // AVR core: a second pin is ignored while one is sounding
    tonePin = p;
    if (o.c > 0) tone(p, (unsigned int)o.b, (unsigned long)o.c);
    else tone(p, (unsigned int)o.b);
#endif
    return NULL;
  }
  if (verbIs(o, "NT")) {
#if defined(BEEDAK_ESP32)
    if (ledcMode[p] == 2) { ledcOff(p); pinMode(p, OUTPUT); digitalWrite(p, LOW); }
#elif defined(__AVR__)
    noTone(p);
    if (tonePin == p) tonePin = -1;
#endif
    return NULL;
  }
  if (verbIs(o, "PI")) {
    *hasResult = true;
    *result = (long)pulseIn(p, o.b ? HIGH : LOW, (unsigned long)o.c);
    return NULL;
  }
  return E_BADOP;
}

// "X <seq> op;op;..."
void runBatch(const char *s) {
  long seq = 0;
  if (!readNum(&s, &seq) || seq < 1 || seq > 65535) { replyErr(0, E_BADOP, 0); return; }
  int n = 0;
  s = skipSp(s);
  while (*s) {
    if (n >= BEEDAK_OPS_MAX) { replyErr(seq, E_TOOLONG, n); return; }
    const char *next = parseOp(s, ops[n]);
    if (!next) { replyErr(seq, E_BADOP, n); return; }
    n++;
    s = next;
    if (*s == ';') s++;
    s = skipSp(s);
  }
  if (n == 0) { replyErr(seq, E_BADOP, 0); return; }
  // pass 1: check everything, so a bad op stops the line before anything runs
  for (int i = 0; i < n; i++) {
    const char *e = checkOp(ops[i]);
    if (e) { replyErr(seq, e, i); return; }
  }
  // pass 2: run
  int nr = 0;
  for (int i = 0; i < n; i++) {
    bool has = false;
    long r = 0;
    const char *e = runOp(ops[i], &has, &r);
    if (e) { replyErr(seq, e, i); return; }
    if (has) results[nr++] = r;
  }
  Serial.print(F("ok ")); Serial.print(seq);
  for (int i = 0; i < nr; i++) { Serial.print(' '); Serial.print(results[i]); }
  Serial.println();
}

void runLine(char *cmd) {
  // trim trailing spaces / tabs, skip leading ones
  int n = strlen(cmd);
  while (n > 0 && (cmd[n - 1] == ' ' || cmd[n - 1] == '\t')) cmd[--n] = '\0';
  const char *s = skipSp(cmd);
  if (!*s) return;
  if (up(s[0]) == 'P' && up(s[1]) == 'I' && up(s[2]) == 'N' && up(s[3]) == 'G' && (s[4] == ' ' || s[4] == '\0')) {
    Serial.print(F("ok PING "));
    Serial.print(skipSp(s + 4));       // echo the token back so the page can skip stale replies
    Serial.print(' ');
    Serial.print(F(BEEDAK_BOARD));
    Serial.print(' ');
    Serial.println(BEEDAK_PROTO);
    return;
  }
  if (up(s[0]) == 'X' && s[1] == ' ') { runBatch(s + 2); return; }
  replyErr(0, E_BADOP, 0);
}

// a line over 200 bytes: answer TOOLONG with its seq when the kept start of it has one
void tooLong(char *kept) {
  const char *s = skipSp(kept);
  long seq = 0;
  if (up(s[0]) == 'X' && s[1] == ' ') {
    const char *t = s + 2;
    if (!readNum(&t, &seq) || seq < 1 || seq > 65535) seq = 0;
  }
  replyErr(seq, E_TOOLONG, 0);
}

void setup() {
#if defined(BEEDAK_ESP32)
  for (int p = 0; p < 40; p++) {
    ledcMode[p] = 0; toneEnd[p] = 0;
  #if BEEDAK_LEDC == 2
    ledcChan[p] = -1;
  #endif
  }
#endif
  Serial.begin(BAUD);
  resetPins();
  delay(200);
  Serial.print(F("ready beedak-bridge "));
  Serial.print(BEEDAK_PROTO);
  Serial.print(' ');
  Serial.println(F(BEEDAK_BOARD));
}

void loop() {
#if defined(BEEDAK_ESP32)
  // timed tones (TN p hz ms) stop here; AVR's tone() does that by itself
  unsigned long now = millis();
  for (int p = 0; p < 40; p++) {
    if (ledcMode[p] == 2 && toneEnd[p] && (long)(now - toneEnd[p]) >= 0) {
      ledcOff(p); pinMode(p, OUTPUT); digitalWrite(p, LOW);
    }
  }
#endif
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line[lineLen] = '\0';
      if (lineTooLong) tooLong(line);
      else runLine(line);
      lineLen = 0;
      lineTooLong = false;
    } else if (lineLen < BEEDAK_LINE_MAX) {
      line[lineLen++] = c;
    } else {
      lineTooLong = true;
    }
  }
}
