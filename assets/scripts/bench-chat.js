/*
 * Shimti Multimedia - the conversation instrument on Work
 *
 * A small rule-based assistant that answers questions about the studio.
 *
 * Entirely local, and that is not a limitation dressed up as a virtue - it is forced and
 * it is correct. The page's CSP is connect-src 'self', so nothing here may call an API
 * even if it wanted to. What that buys is an instrument that works offline, costs nothing
 * per visitor, cannot leak what anybody typed, and cannot go down or start billing.
 *
 * It is also honest about what it is. It says so when asked, and it never claims to be
 * anything cleverer than a set of patterns - a demonstration that a useful assistant does
 * not have to be a language model, which is a point worth making on a page selling AI
 * work to people who assume otherwise.
 */

'use strict';

(() => {
  const bench = document.querySelector('[data-bench="chat"]');
  if (!bench) return;

  const log = bench.querySelector('[data-chat-log]');
  const form = bench.querySelector('[data-chat-form]');
  const input = bench.querySelector('[data-chat-input]');
  if (!log || !form || !input) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /*
   * Skills before patterns.
   *
   * These actually compute something rather than returning a sentence, which is the whole
   * difference between a demonstration and a canned reply. Arithmetic, dates, unit
   * conversion, counting and reversing are all things a visitor can verify on the spot -
   * and verifying it is what makes the point that a useful assistant does not have to be
   * a language model.
   */
  const SKILLS = [
    // Arithmetic, done on numbers rather than by evaluating the string. eval() would be
    // one line and would turn anything typed into this box into executable code.
    (text) => {
      const m = text.match(/(-?\d+(?:\.\d+)?)\s*([+\-*/x×÷^])\s*(-?\d+(?:\.\d+)?)/);
      if (!m) return null;
      const a = parseFloat(m[1]);
      const b = parseFloat(m[3]);
      const op = { x: '*', '×': '*', '÷': '/' }[m[2]] || m[2];
      const value = { '+': a + b, '-': a - b, '*': a * b,
                      '/': b === 0 ? NaN : a / b, '^': a ** b }[op];
      if (!Number.isFinite(value)) return 'That one does not have an answer.';
      return `${a} ${m[2]} ${b} = ${+value.toFixed(10)}`;
    },

    // Percentages, because it is the arithmetic people actually ask for.
    (text) => {
      const m = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of)\s*(\d+(?:\.\d+)?)/i);
      if (!m) return null;
      return `${m[1]}% of ${m[2]} is ${+((+m[1] / 100) * +m[2]).toFixed(6)}.`;
    },

    (text) => {
      if (!/\b(time|clock)\b/i.test(text) || /timeline|timezone/i.test(text)) return null;
      return 'Your computer says ' + new Date().toLocaleTimeString() + '. Mine has no idea '
        + '- I have no server to ask.';
    },

    (text) => {
      if (!/\b(date|today|what day)\b/i.test(text)) return null;
      return 'Your computer says ' + new Date().toLocaleDateString(undefined,
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.';
    },

    // Unit conversion, the handful anyone actually uses.
    (text) => {
      const m = text.match(/(-?\d+(?:\.\d+)?)\s*(c|celsius|f|fahrenheit|km|miles?|mi|kg|lbs?|pounds?)\b/i);
      if (!m || !/\b(in|to|into|convert)\b/i.test(text)) return null;
      const n = parseFloat(m[1]);
      const unit = m[2].toLowerCase();
      const table = {
        c: [`${+(n * 9 / 5 + 32).toFixed(2)}°F`], celsius: [`${+(n * 9 / 5 + 32).toFixed(2)}°F`],
        f: [`${+((n - 32) * 5 / 9).toFixed(2)}°C`], fahrenheit: [`${+((n - 32) * 5 / 9).toFixed(2)}°C`],
        km: [`${+(n * 0.621371).toFixed(3)} miles`],
        mile: [`${+(n * 1.60934).toFixed(3)} km`], miles: [`${+(n * 1.60934).toFixed(3)} km`],
        mi: [`${+(n * 1.60934).toFixed(3)} km`],
        kg: [`${+(n * 2.20462).toFixed(3)} lb`],
        lb: [`${+(n * 0.453592).toFixed(3)} kg`], lbs: [`${+(n * 0.453592).toFixed(3)} kg`],
        pound: [`${+(n * 0.453592).toFixed(3)} kg`], pounds: [`${+(n * 0.453592).toFixed(3)} kg`],
      };
      return table[unit] ? `${n}${unit} is about ${table[unit][0]}.` : null;
    },

    (text) => {
      const m = text.match(/reverse\s+(.+)/i);
      return m ? [...m[1].trim()].reverse().join('') : null;
    },

    (text) => {
      const m = text.match(/(?:count|how many)\s+(?:the\s+)?(?:characters|letters|words)\s+(?:in\s+)?(.+)/i);
      if (!m) return null;
      const subject = m[1].trim().replace(/^["']|["']$/g, '');
      return /words/i.test(text)
        ? `${subject.split(/\s+/).filter(Boolean).length} words.`
        : `${subject.length} characters.`;
    },

    (text) => {
      if (!/\b(flip a coin|coin flip|heads or tails)\b/i.test(text)) return null;
      return Math.random() < 0.5 ? 'Heads.' : 'Tails.';
    },

    (text) => {
      const m = text.match(/roll(?:\s+a)?\s+(?:d|dice|die)?\s*(\d+)?/i);
      if (!m || !/\broll\b/i.test(text)) return null;
      const sides = Math.min(1000, Math.max(2, parseInt(m[1] || '6', 10)));
      return `${Math.floor(Math.random() * sides) + 1}, on a d${sides}.`;
    },
  ];

  // Ordered: the first pattern that matches wins, so put the specific above the general.
  const RULES = [
    [/^(hi|hey|hello|yo|sup|howdy|good (morning|afternoon|evening))\b/i,
     ['Hello. Ask me about the studio, or about almost anything else - I will tell you '
      + 'honestly when I am out of my depth.']],

    [/\b(how are you|how(?:'s| is) it going|you (ok|alright|good))\b/i,
     ['Idle, mostly. I am a few hundred lines of pattern matching, so my day is quiet '
      + 'until somebody types.']],

    [/\b(who|what) (are|r) you\b|are you (a )?(real|human|ai|bot|gpt|llm)|chatgpt|claude|gemini/i,
     ['A set of rules running in your browser. No server, no model, no API key, nothing '
      + 'sent anywhere. I can do arithmetic, dates, conversions and questions about the '
      + 'studio - and I will say so plainly when a question is past me.']],

    [/\b(who (made|built|wrote) you|your (creator|maker|author))\b/i,
     ['Shimti Multimedia, as part of this page. I am the demonstration, not the product.']],

    [/\b(joke|funny|make me laugh)\b/i,
     ['A designer walks into a bar and asks for a drink. The barman gives him a drink. He '
      + 'asks for one that is the same but different. Fifteen times.']],

    [/\b(weather|raining|sunny|forecast|temperature outside)\b/i,
     ['No idea - I cannot reach the internet, by design. Look out of a window; it is more '
      + 'reliable than most forecasts anyway.']],

    [/\b(meaning of life|purpose of life|why are we here)\b/i,
     ['Forty-two, allegedly. Around here it is closer to: make the thing properly, then '
      + 'make the next one.']],

    [/\b(3d|model|modelling|modeling|mesh|blender|render|glb|topology)\b/i,
     ['3D modelling, game-ready assets and prototypes, published across Fab, CGTrader, '
      + 'TurboSquid and Pinshape. There is a live viewer further up this page - orbit it.']],

    [/\b(sound|audio|music|score|mix|foley|track|cue)\b/i,
     ['Music production and sound design, written to picture rather than laid under it. '
      + 'There is a player on this page.']],

    [/\b(video|film|edit|footage|shoot|camera|grade|grading|colou?r)\b/i,
     ['Videography, editing, grading and animation. The grading instrument shows one frame '
      + 'under four treatments.']],

    [/\b(photo|photography|image|picture|retouch|upscale|enhance|resolution)\b/i,
     ['Photography and retouching, plus enhancement - the first instrument on this page is '
      + 'a before and after of exactly that.']],

    [/\b(draw|drawing|illustrat|sketch|pencil|paper|comic)\b/i,
     ['By hand, on paper, then scanned. The illustration gallery near the bottom turns like '
      + 'a comic book.']],

    [/\b(logo|brand|identity|typography|font|print|apparel|shirt|merch)\b/i,
     ['Design and identity: marks, the systems around them, and artwork prepared for the '
      + 'press or the garment it is actually going on.']],

    [/\b(game|gaming|unity|unreal|platformer|play)\b/i,
     ['Game development, and there is one on this page - press Play on the side-scroller '
      + 'and jump with Space.']],

    [/\b(app|application|software|prototype|calculator)\b/i,
     ['App development. The calculator on this page is a working one, keyboard and all.']],

    [/\b(web|site|website|html|css|javascript|code|develop|programming|accessib)\b/i,
     ['Web design and build, to standards, fast on a phone and operable by keyboard. This '
      + 'site is the sample - everything here works without a mouse.']],

    [/\b(ai|artificial intelligence|workflow|automation|prompt|pipeline|machine learning)\b/i,
     ['Every service here is AI-powered, and the tooling itself can be commissioned: '
      + 'custom workflows, automation, generation and consultation.']],

    [/\b(price|cost|quote|rate|budget|how much|expensive|cheap|afford)\b/i,
     ['It depends on scope, and an honest number needs three things: what is being made, '
      + 'roughly when, and roughly what it is worth to you. Send those and you get a real '
      + 'answer rather than a range.']],

    [/\b(deadline|how long|timeline|turnaround|when can|fast)\b/i,
     ['Depends what it is. The process bends to the project rather than the other way '
      + 'round, which is what keeps a hard deadline realistic instead of optimistic.']],

    [/\b(contact|email|reach|hire|commission|start|talk|brief|available)\b/i,
     ['shimtimultimedia@gmail.com. No form, no funnel. A sentence is enough to begin.']],

    [/\b(founder|bryant|behind|owner|team|staff|employees)\b/i,
     ['Founded in 2007 by Bryant Duhart, who directs the work. Nineteen years, several '
      + 'hundred projects, and every discipline self-taught.']],

    [/\b(shimti|bit shimti|name mean|meaning of the name|akkadian|mesopotam)\b/i,
     ['From the Akkadian bit shimti - the house where the breath of life was breathed in. '
      + 'Shimtu is the character a thing is given at the moment it is made.']],

    [/\b(where|location|based|germany|country|timezone|remote)\b/i,
     ['Based in Germany, working internationally. Time zones have never been the hard part.']],

    [/\b(shop|buy|purchase|marketplace|store|sell)\b/i,
     ['The Shop page lists every marketplace the work is sold through - models, music, '
      + 'footage, design and print.']],

    [/\b(services?|offer|sell|make|build|produce|what do you|what can you do|portfolio)\b/i,
     ['Five practices: design and identity, 3D and interactive, film and photography, '
      + 'sound, and digital. Seventeen disciplines between them. Ask about any one.']],

    [/\b(help|options|menu|topics|commands)\b/i,
     ['Studio questions: 3D, sound, video, photography, illustration, design, web, AI, '
      + 'price, contact. Or try arithmetic, "convert 20 km to miles", "what is the date", '
      + '"flip a coin", "reverse hello".']],

    [/\b(thanks|thank you|cheers|ta|appreciate)\b/i,
     ['Any time.']],

    [/\b(bye|goodbye|see ya|later|good night)\b/i,
     ['Right you are. shimtimultimedia@gmail.com when you want a human.']],

    [/\b(sorry|my bad|oops)\b/i,
     ['Nothing to apologise for. I have no feelings to hurt.']],

    [/(stupid|useless|rubbish|dumb|terrible|hate you)/i,
     ['Fair. I am deliberately simple - the point is that a lot of useful assistance does '
      + 'not need a language model behind it. Ask me something concrete and I will do '
      + 'better.']],

    [/\b(love you|you(?:'re| are) (great|good|clever|smart|nice))\b/i,
     ['Steady on. I am a regular expression in a good mood.']],
  ];

  const FALLBACK = [
    'That is past me. I know the studio, and I can do arithmetic, dates, conversions and a '
      + 'few tricks - type "help" for the list.',
    'No pattern for that one. I would rather say so than invent an answer, which is more '
      + 'than some assistants manage.',
    'Out of my depth. For anything a set of rules cannot handle, '
      + 'shimtimultimedia@gmail.com reaches a person.',
  ];

  let fallbackTurn = 0;
  let variantTurn = 0;

  function answer(text) {
    // Skills first: "what is 12 * 7" contains none of the studio keywords, but "convert
    // 20 km to miles" contains none either and both should be answered rather than
    // falling through to an apology.
    for (const skill of SKILLS) {
      let result = null;
      try { result = skill(text); } catch { result = null; }
      if (result) return result;
    }
    for (const [pattern, replies] of RULES) {
      if (pattern.test(text)) {
        // Rotate through the variants so a repeated question does not repeat verbatim.
        return replies[(variantTurn++) % replies.length];
      }
    }
    return FALLBACK[fallbackTurn++ % FALLBACK.length];
  }

  function add(who, text) {
    const row = document.createElement('p');
    row.className = 'chat-line chat-line--' + who;
    const label = document.createElement('b');
    label.textContent = who === 'you' ? 'You' : 'Studio';
    row.append(label, document.createTextNode(text));
    log.append(row);
    // Scroll the transcript, never the page: this element is its own scroll container.
    log.scrollTop = log.scrollHeight;
    return row;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    add('you', text);
    input.value = '';

    const reply = answer(text);

    if (reduceMotion.matches) {
      add('bot', reply);
      return;
    }

    // A beat before replying. Instant answers read as a lookup table, which is what this
    // is - but the pause is what makes it legible as a conversation rather than a form.
    const pending = add('bot', 'typing…');
    pending.classList.add('is-pending');
    setTimeout(() => {
      pending.classList.remove('is-pending');
      pending.lastChild.textContent = reply;
      log.scrollTop = log.scrollHeight;
    }, 420);
  });

  add('bot', 'Ask me about the studio, or try arithmetic, "convert 20 km to miles", '
    + '"what is the date", or "help".');
})();
