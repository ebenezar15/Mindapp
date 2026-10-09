// Voice to text using the browser's built-in speech recognition (Safari on iPhone, iPad
// and Mac; Chrome/Edge elsewhere). What you say is inserted exactly as recognised —
// like typing — so the "your words, untouched" promise still holds.
//
// Where speech recognition isn't available (for example some home-screen apps on older
// iOS versions), the keyboard's own dictation 🎙 key works in every text box.

// The desktop app (Electron) exposes the API but has no speech service behind it,
// so there we hand over to the operating system's own dictation instead.
const isDesktopApp = () => typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent);
const engine = () => (typeof window === 'undefined' || isDesktopApp() ? null : (window.SpeechRecognition || window.webkitSpeechRecognition));

export const voiceSupported = () => !!engine();

let current = null;

export function isListening() { return !!current; }

export function stopDictation() {
  if (!current) return;
  const c = current;
  current = null;
  c.stopped = true;
  try { c.rec.stop(); } catch { /* already stopped */ }
  c.onEnd?.();
}

/**
 * Start listening.
 * onInterim(text): words heard so far (not final yet)
 * onFinal(text):   a finished phrase, exactly as recognised
 * onEnd():         listening stopped
 * onError(message)
 */
export function startDictation({ lang, onInterim, onFinal, onEnd, onError } = {}) {
  stopDictation();
  const Recognition = engine();
  if (!Recognition) { onError?.(unsupportedMessage()); return null; }
  const rec = new Recognition();
  rec.lang = lang || navigator.language || 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  const c = { rec, stopped: false, onEnd };
  current = c;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { const t = r[0].transcript.trim(); if (t) onFinal?.(t); }
      else interim += r[0].transcript;
    }
    onInterim?.(interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return; // keep going / user stopped
    const msg = {
      'not-allowed': 'Microphone access is blocked. Allow it in Settings → Safari → Microphone (or the site’s permissions), then try again.',
      'service-not-allowed': 'Voice input isn’t available here. Tip: tap the 🎙 key on your keyboard to dictate instead.',
      'audio-capture': 'No microphone was found.',
      network: 'Voice recognition needs a connection on this device. Tip: your keyboard’s 🎙 dictation key also works offline on newer iPhones and iPads.',
    }[e.error] || `Voice input stopped (${e.error}).`;
    onError?.(msg);
    if (current === c) { current = null; c.stopped = true; onEnd?.(); }
  };
  // Safari ends sessions after a pause — quietly restart until the user taps stop.
  rec.onend = () => {
    if (current !== c || c.stopped) return;
    try { rec.start(); } catch { current = null; onEnd?.(); }
  };
  try { rec.start(); } catch (err) { current = null; onError?.(String(err.message || err)); onEnd?.(); return null; }
  return c;
}

export function unsupportedMessage() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (isDesktopApp()) {
    if (/Mac/.test(ua)) return 'To dictate on your Mac: click in a text box, then press Fn (🌐) twice — or choose Edit → Start Dictation. Your words are typed in as you speak.';
    if (/Windows/.test(ua)) return 'To dictate on Windows: click in a text box, then press Windows key + H. Your words are typed in as you speak.';
    return 'Use your system’s dictation to speak into any text box.';
  }
  return 'Voice input isn’t supported in this browser. Tip: tap the 🎙 key on your iPhone/iPad keyboard (or press Fn twice on a Mac) to dictate into any box.';
}

/** Insert dictated text into a textarea at the cursor, adding a space if needed. */
export function insertAtCursor(ta, text) {
  // at the caret if you're editing the box, otherwise at the end
  const focused = document.activeElement === ta;
  const start = focused ? ta.selectionStart : ta.value.length;
  const end = focused ? ta.selectionEnd : ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^\s/.test(after) ? ' ' : '';
  ta.value = before + pre + text + post + after;
  const pos = (before + pre + text).length;
  ta.setSelectionRange?.(pos, pos);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
