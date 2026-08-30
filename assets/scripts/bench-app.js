/*
 * Shimti Multimedia - the app instrument on Work
 *
 * A working calculator, built as one app inside a switcher rather than as the whole
 * instrument. Nothing here knows it is the only app: the picker, the panel swapping and
 * the keyboard routing are all written for a list, so a second app is a new entry in
 * APPS and a new panel in the markup, not a rewrite.
 *
 * The arithmetic is done on numbers, not by evaluating a string. eval() and its cousins
 * would be shorter and are how most browser calculators are written, but they turn every
 * keystroke into executable code - and this page's CSP forbids exactly that, for the same
 * reason it is a bad idea anywhere.
 */

'use strict';

(() => {
  const bench = document.querySelector('[data-bench="app"]');
  if (!bench) return;

  /* ------------------------------------------------------------------- calculator */

  function calculator(panel) {
    const display = panel.querySelector('[data-calc-display]');
    const keys = panel.querySelector('[data-calc-keys]');
    if (!display || !keys) return null;

    let entry = '0';        // what is being typed
    let stored = null;      // the left-hand side, once an operator is pressed
    let pending = null;     // the operator waiting for a right-hand side
    let fresh = true;       // next digit starts a new entry

    const show = () => {
      // Long results are the one thing that can break the box, so they are trimmed to
      // something a display of this size can hold rather than allowed to overflow it.
      let text = entry;
      if (text.length > 12 && Number.isFinite(+text)) {
        text = String(+(+text).toPrecision(10));
      }
      display.textContent = text.length > 14 ? (+text).toExponential(6) : text;
    };

    const apply = (a, b, op) => {
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? NaN : a / b;
        default: return b;
      }
    };

    function digit(d) {
      if (fresh) { entry = d === '.' ? '0.' : d; fresh = false; }
      else if (d === '.') { if (!entry.includes('.')) entry += '.'; }
      else entry = entry === '0' ? d : entry + d;
      show();
    }

    function operator(op) {
      const value = parseFloat(entry);
      if (pending !== null && !fresh) {
        const result = apply(stored, value, pending);
        stored = result;
        entry = Number.isFinite(result) ? String(result) : 'Error';
      } else {
        stored = value;
      }
      pending = op;
      fresh = true;
      show();
    }

    function equals() {
      if (pending === null) return;
      const result = apply(stored, parseFloat(entry), pending);
      entry = Number.isFinite(result) ? String(result) : 'Error';
      stored = null;
      pending = null;
      fresh = true;
      show();
    }

    function press(key) {
      if (/^[0-9.]$/.test(key)) return digit(key);
      switch (key) {
        case '+': case '-': case '*': case '/': return operator(key);
        case '=': return equals();
        case 'clear': entry = '0'; stored = null; pending = null; fresh = true; return show();
        case 'sign':
          entry = entry.startsWith('-') ? entry.slice(1) : '-' + entry;
          return show();
        case 'percent':
          entry = String(parseFloat(entry) / 100);
          fresh = true;
          return show();
        default:
      }
    }

    keys.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-key]');
      if (button) press(button.dataset.key);
    });

    show();
    return { press };
  }

  /* ------------------------------------------------------------------------ clock */

  function clock(panel) {
    const time = panel.querySelector('[data-clock-time]');
    const date = panel.querySelector('[data-clock-date]');
    const zone = panel.querySelector('[data-clock-zone]');
    const toggle = panel.querySelector('[data-clock-format]');
    const faceButton = panel.querySelector('[data-clock-face]');
    const face = panel.querySelector('.clock-face');
    const hands = {
      hour: panel.querySelector('[data-hand="hour"]'),
      minute: panel.querySelector('[data-hand="minute"]'),
      second: panel.querySelector('[data-hand="second"]'),
    };
    if (!time) return null;

    let hour24 = true;
    let analogue = false;
    let timer = 0;

    const pad = (n) => String(n).padStart(2, '0');

    function paint() {
      const now = new Date();
      let h = now.getHours();
      let suffix = '';
      if (!hour24) {
        suffix = h < 12 ? ' AM' : ' PM';
        h = h % 12 || 12;
      }
      time.textContent = (hour24 ? pad(h) : h) + ':' + pad(now.getMinutes())
        + ':' + pad(now.getSeconds()) + suffix;

      if (date) {
        date.textContent = now.toLocaleDateString(undefined,
          { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
      if (zone) {
        // Whatever the visitor's machine is set to. There is no server to disagree with.
        zone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      }

      /*
       * The hands.
       *
       * Each is set from the whole time below it, not from its own unit alone: the hour
       * hand carries the minutes and the minute hand carries the seconds. Without that
       * they jump a whole division at a time and the clock reads wrong for most of every
       * hour - at half past, an hour hand pointing squarely at the numeral is the giveaway
       * that nobody checked.
       */
      if (hands.second) {
        const sec = now.getSeconds();
        const min = now.getMinutes() + sec / 60;
        const hr = (now.getHours() % 12) + min / 60;
        hands.second.setAttribute('transform', 'rotate(' + sec * 6 + ' 50 50)');
        hands.minute.setAttribute('transform', 'rotate(' + min * 6 + ' 50 50)');
        hands.hour.setAttribute('transform', 'rotate(' + hr * 30 + ' 50 50)');
      }
    }

    /*
     * Scheduled to the next second boundary rather than every 1000ms.
     *
     * setInterval(…, 1000) drifts: each tick is a millisecond or two late, the error
     * accumulates, and eventually a whole second is skipped and the display jumps from
     * :07 to :09. Aiming at the boundary each time means the error never compounds - the
     * clock is late by a fraction and then immediately corrects.
     */
    function schedule() {
      clearTimeout(timer);
      const wait = 1000 - (Date.now() % 1000);
      timer = setTimeout(() => { paint(); schedule(); }, wait + 5);
    }

    // A clock nobody is looking at is a timer firing for nothing.
    const stop = () => clearTimeout(timer);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else { paint(); schedule(); }
    });
    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { paint(); schedule(); } else stop();
    }, { threshold: 0.1 }).observe(panel);

    faceButton?.addEventListener('click', () => {
      analogue = !analogue;
      face.dataset.clockMode = analogue ? 'analogue' : 'digital';
      faceButton.setAttribute('aria-pressed', String(analogue));
      faceButton.textContent = analogue ? 'Digital' : 'Analogue';
      // The 12/24 switch has nothing to say about a dial, so it steps aside rather than
      // sitting there doing nothing.
      if (toggle) toggle.hidden = analogue;
      paint();
    });

    toggle?.addEventListener('click', () => {
      hour24 = !hour24;
      toggle.textContent = hour24 ? '24h' : '12h';
      toggle.setAttribute('aria-label',
        hour24 ? 'Switch to 12-hour clock' : 'Switch to 24-hour clock');
      paint();
    });

    paint();
    schedule();

    // The switcher hands keystrokes to whichever app is showing; this one wants none.
    return { press() {} };
  }

  /* ----------------------------------------------------------------- the switcher */

  const APPS = { calculator, clock };

  const panels = [...bench.querySelectorAll('[data-app]')];
  const tabs = [...bench.querySelectorAll('[data-app-pick]')];
  const instances = new Map();
  let current = null;

  function select(name) {
    if (current === name) return;
    current = name;

    panels.forEach((panel) => {
      const active = panel.dataset.app === name;
      panel.hidden = !active;
    });
    tabs.forEach((tab) => {
      const active = tab.dataset.appPick === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });

    // Built once, on first use, and kept - a second visit to a tab should find it as it
    // was left rather than reset.
    if (!instances.has(name)) {
      const panel = panels.find((p) => p.dataset.app === name);
      const build = APPS[name];
      if (panel && build) instances.set(name, build(panel));
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => select(tab.dataset.appPick));
  });

  // Keyboard, routed to whichever app is showing. Scoped to the instrument, so typing
  // anywhere else on the page is untouched.
  bench.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const app = instances.get(current);
    if (!app) return;

    const map = { Enter: '=', '=': '=', Escape: 'clear', c: 'clear', C: 'clear',
                  x: '*', '%': 'percent' };
    const key = /^[0-9.+\-*/]$/.test(event.key) ? event.key : map[event.key];
    if (!key) return;
    event.preventDefault();
    app.press(key);
  });

  select(bench.dataset.appDefault || panels[0]?.dataset.app);
})();
