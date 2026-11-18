/*
  beedak-lab-bridge.ino  —  كود الجسر بتاع «المعمل» في بإيدك
  ---------------------------------------------------------------
  ارفعوه مرة واحدة على الكارت من Arduino IDE (ESP32 أو Arduino Uno).
  بعدها صفحة المعمل في Chrome أو Edge تقدر تبعتله أوامر بسيطة بالـUSB.
  الصفحة ما بتغيّرش الكود ده ولا بترفع حاجة على الكارت: بتبعت سطور نص بس.

  السرعة: 115200. كل أمر في سطر لوحده، والكارت بيرد بسطر واحد:
  "ok <الأمر> ..." أو "err <الأمر> ...". الصفحة بتطابق الرد بالأمر اللي بعتته.

    PING <token>         -> ok PING <token>     (الصفحة بتستخدمه علشان تتجاهل أي رد قديم)
    LED ON | LED OFF | LED TOGGLE
    BLINK <ms> <times>   مثال: BLINK 400 3   (ms من 200 لـ 3000، والعدد من 1 لـ 20)
    DELAY <ms>           مثال: DELAY 500     (لحد 5000)
    PRINT <text>         بيكتب "> <text>" في السيريال، وبعده ok PRINT
    COLOR <name>         مفيش لمبة RGB في الكارت العادي: بيرد ok ومش بيغيّر حاجة
  أي سطر تاني من الكارت (زي "> ..." أو "ready ...") مش رد على أمر.

  اللمبة: Uno على الطرف 13. أغلب لوحات ESP32 DevKit عليها لمبة على GPIO2،
  وبعضها ما عليهاش لمبة خالص. لو لوحتكم مختلفة غيّروا BEEDAK_LED تحت.
*/

#if defined(ARDUINO_ARCH_ESP32)
const int BEEDAK_LED = 2;            // ESP32 DevKit: blue LED on GPIO2 (not on every board)
#elif defined(LED_BUILTIN)
const int BEEDAK_LED = LED_BUILTIN;  // Arduino Uno: pin 13
#else
const int BEEDAK_LED = 13;
#endif

const unsigned long BAUD = 115200;
const int BEEDAK_LINE_MAX = 200;     // longest command line we keep, in bytes (not LINE_MAX: newlib defines that macro)

char line[BEEDAK_LINE_MAX + 1];
int lineLen = 0;
bool lineTooLong = false;
bool ledState = false;

void setLed(bool on) {
  ledState = on;
  digitalWrite(BEEDAK_LED, on ? HIGH : LOW);
}

// true when line starts with word (case-insensitive) followed by end or a space
bool startsWithWord(const char *s, const char *word) {
  size_t n = strlen(word);
  if (strncasecmp(s, word, n) != 0) return false;
  return s[n] == '\0' || s[n] == ' ';
}

// skip the command word and spaces, return the rest
const char *argsOf(const char *s) {
  while (*s && *s != ' ') s++;
  while (*s == ' ') s++;
  return s;
}

void runCommand(char *cmd) {
  // trim trailing spaces / CR
  int n = strlen(cmd);
  while (n > 0 && (cmd[n - 1] == ' ' || cmd[n - 1] == '\r' || cmd[n - 1] == '\t')) cmd[--n] = '\0';
  while (*cmd == ' ') cmd++;
  if (*cmd == '\0') return;

  if (startsWithWord(cmd, "PING")) {
    Serial.print(F("ok PING "));
    Serial.println(argsOf(cmd));       // echo the token back so the page can skip stale replies
  } else if (startsWithWord(cmd, "LED")) {
    const char *a = argsOf(cmd);
    if (strcasecmp(a, "ON") == 0) { setLed(true); Serial.println(F("ok LED ON")); }
    else if (strcasecmp(a, "OFF") == 0) { setLed(false); Serial.println(F("ok LED OFF")); }
    else if (strcasecmp(a, "TOGGLE") == 0) { setLed(!ledState); Serial.println(ledState ? F("ok LED ON") : F("ok LED OFF")); }
    else Serial.println(F("err LED needs ON, OFF or TOGGLE"));
  } else if (startsWithWord(cmd, "BLINK")) {
    long ms = 0, times = 0;
    if (sscanf(argsOf(cmd), "%ld %ld", &ms, &times) != 2) { Serial.println(F("err BLINK <ms> <times>")); return; }
    if (ms < 200) ms = 200;
    if (ms > 3000) ms = 3000;
    if (times < 1 || times > 20) { Serial.println(F("err BLINK times 1..20")); return; }
    for (long i = 0; i < times; i++) {
      setLed(true);  delay(ms);
      setLed(false); delay(ms);
    }
    Serial.print(F("ok BLINK ")); Serial.print(ms); Serial.print(' '); Serial.println(times);
  } else if (startsWithWord(cmd, "DELAY")) {
    long ms = atol(argsOf(cmd));
    if (ms < 0 || ms > 5000) { Serial.println(F("err DELAY 0..5000")); return; }
    delay(ms);
    Serial.print(F("ok DELAY ")); Serial.println(ms);
  } else if (startsWithWord(cmd, "PRINT")) {
    Serial.print(F("> "));             // the "> " prefix keeps the text from looking like a reply
    Serial.println(argsOf(cmd));       // UTF-8 text passes through as bytes
    Serial.println(F("ok PRINT"));
  } else if (startsWithWord(cmd, "COLOR")) {
    Serial.print(F("ok COLOR ")); Serial.print(argsOf(cmd)); Serial.println(F(" (no RGB LED, ignored)"));
  } else {
    Serial.print(F("err UNKNOWN ")); Serial.println(cmd);
  }
}

void setup() {
  pinMode(BEEDAK_LED, OUTPUT);
  setLed(false);
  Serial.begin(BAUD);
  delay(200);
  Serial.println(F("ready beedak-bridge"));
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n') {
      line[lineLen] = '\0';
      if (lineTooLong) Serial.println(F("err TOOLONG line too long"));
      else runCommand(line);
      lineLen = 0;
      lineTooLong = false;
    } else if (lineLen < BEEDAK_LINE_MAX) {
      line[lineLen++] = c;
    } else {
      lineTooLong = true;
    }
  }
}
