/*
 * Shimti Multimedia - slideshow gallery
 *
 * Drives any element carrying [data-gallery]. See assets/styles/gallery.css for why the
 * track is a scroll-snap strip rather than a stack of toggled slides.
 *
 * Two rules shape everything below.
 *
 * The browser owns the position. Nothing here stores "the current slide" as the source
 * of truth. An IntersectionObserver watches which slide is actually on screen and that
 * observation drives the dots, the counter and the timer - so a swipe, a click, a
 * keyboard scroll and an auto-advance all update the interface through one path, and the
 * indicator can never drift out of step with what the visitor is looking at.
 *
 * Motion is opt-in and always interruptible. The slideshow does not start under
 * prefers-reduced-motion, it holds while the pointer is over it or focus is inside it,
 * it holds while the tab is hidden, and a Pause button turns it off outright - which is
 * WCAG 2.2 SC 2.2.2, since the images change on their own and last longer than five
 * seconds.
 */

'use strict';

(() => {
  const ADVANCE_MS = 6000;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const ICON_PAUSE =
    '<svg class="gallery-icon-pause" viewBox="0 0 16 16" aria-hidden="true">'
    + '<path d="M4 2h3.5v12H4zM8.5 2H12v12H8.5z"/></svg>';
  const ICON_PLAY =
    '<svg class="gallery-icon-play" viewBox="0 0 16 16" aria-hidden="true">'
    + '<path d="M4 2l9 6-9 6z"/></svg>';

  function setUpGallery(root) {
    const track = root.querySelector('[data-gallery-track]');
    if (!track) return;

    const slides = Array.from(track.children);
    if (slides.length < 2) return;

    const controls = root.querySelector('[data-gallery-controls]');
    const prevButton = root.querySelector('[data-gallery-prev]');
    const nextButton = root.querySelector('[data-gallery-next]');
    const playButton = root.querySelector('[data-gallery-play]');
    const dotList = root.querySelector('[data-gallery-dots]');
    const counter = root.querySelector('[data-gallery-count]');
    if (!controls || !prevButton || !nextButton || !playButton || !dotList) return;

    let index = 0;
    // What the visitor has asked for, kept apart from whether it is running right now.
    // Hovering pauses the slideshow without cancelling the visitor's decision to play it,
    // so moving the pointer away resumes instead of requiring another click.
    let wantsPlay = !reduceMotion.matches;
    let held = false;
    let timer = 0;

    slides.forEach((slide, i) => {
      slide.setAttribute('role', 'group');
      slide.setAttribute('aria-roledescription', 'slide');
      slide.setAttribute('aria-label', `${i + 1} of ${slides.length}`);
    });

    // 'slide' scrolls a strip; 'fade' and 'flip' stack the slides and swap them by index.
    // The strip is the default because it is the only one that still works with scripting
    // off - the other two would leave six images piled on top of each other.
    const mode = root.dataset.transition || 'slide';
    const stacked = mode === 'fade' || mode === 'flip';

    function goTo(target, instant) {
      const wrapped = (target + slides.length) % slides.length;

      if (stacked) {
        // Which way the page turns matters for flip: going forward should throw the
        // current leaf to the left, going back should bring it in from the left.
        const back = wrapped === (index - 1 + slides.length) % slides.length;
        slides.forEach((slide, i) => {
          slide.classList.toggle('is-current', i === wrapped);
          slide.classList.toggle('is-leaving', i === index && i !== wrapped);
          slide.classList.toggle('is-reverse', back);
        });
        index = wrapped;
        paint();
        arm();
        return;
      }

      // Slides are exactly one track-width wide (flex: 0 0 100%, no gap), so the offset
      // of slide n is n track-widths. Keeping the arithmetic here rather than reading
      // offsetLeft avoids depending on which ancestor happens to be positioned.
      track.scrollTo({
        left: wrapped * track.clientWidth,
        behavior: instant || reduceMotion.matches ? 'auto' : 'smooth',
      });
    }

    function paint() {
      dots.forEach((dot, i) => {
        if (i === index) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
      if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
    }

    function tick() {
      // Wrapping backwards across the whole strip smoothly reads as a glitch, so the
      // return to the first photograph is a cut rather than a scroll.
      if (index === slides.length - 1) goTo(0, true);
      else goTo(index + 1);
    }

    function arm() {
      clearTimeout(timer);
      timer = 0;
      if (!wantsPlay || held || document.hidden) return;
      timer = setTimeout(tick, ADVANCE_MS);
    }

    function reflectPlayState() {
      playButton.setAttribute('aria-pressed', wantsPlay ? 'true' : 'false');
      playButton.setAttribute(
        'aria-label',
        wantsPlay ? 'Pause the slideshow' : 'Play the slideshow',
      );
      // While pictures change on their own, announcing every one of them talks over
      // whatever the visitor is actually reading. Paused, the region is theirs again.
      track.setAttribute('aria-live', wantsPlay ? 'off' : 'polite');
    }

    function start() {
      wantsPlay = true;
      reflectPlayState();
      arm();
    }

    function stop() {
      wantsPlay = false;
      reflectPlayState();
      arm();
    }

    function hold(on) {
      held = on;
      arm();
    }

    const dots = slides.map((_, i) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gallery-dot';
      button.setAttribute('aria-label', `Show photograph ${i + 1} of ${slides.length}`);
      button.addEventListener('click', () => {
        // A deliberate jump is the visitor taking over; the slideshow stops rather than
        // pulling the picture away from under them a moment later.
        stop();
        goTo(i);
      });
      item.append(button);
      dotList.append(item);
      return button;
    });

    prevButton.addEventListener('click', () => { stop(); goTo(index - 1); });
    nextButton.addEventListener('click', () => { stop(); goTo(index + 1); });
    playButton.addEventListener('click', () => { if (wantsPlay) stop(); else start(); });

    root.addEventListener('pointerenter', () => hold(true));
    root.addEventListener('pointerleave', () => hold(false));
    root.addEventListener('focusin', () => hold(true));
    root.addEventListener('focusout', () => {
      if (!root.contains(document.activeElement)) hold(false);
    });

    // A background tab still runs timers, just throttled - so without this the slideshow
    // silently advances several frames while nobody is looking and the visitor returns to
    // a picture they never chose.
    document.addEventListener('visibilitychange', arm);

    // Reduce-motion can be switched on while the page is open.
    reduceMotion.addEventListener('change', (event) => {
      if (event.matches) stop();
    });

    // The single source of truth for which slide is showing. threshold 0.6 means a slide
    // counts as current once most of it is in view, which is the point during a snap
    // where the eye has already committed to it.
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const seen = slides.indexOf(entry.target);
        if (seen === -1 || seen === index) continue;
        index = seen;
        paint();
        // Any change restarts the clock, whoever caused it - so a swipe gives the visitor
        // a full interval on the picture they landed on rather than the remainder of the
        // previous one.
        arm();
      }
    }, { root: track, threshold: 0.6 });

    if (!stacked) slides.forEach((slide) => watcher.observe(slide));
    else slides[0].classList.add('is-current');

    // A resize changes what one track-width means, so the snap position of the current
    // slide moves. Re-seating it instantly keeps the strip aligned instead of parked
    // between two photographs.
    let resizeTimer = 0;
    if (!stacked) {
      new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => goTo(index, true), 120);
      }).observe(track);
    }

    root.setAttribute('data-ready', '');
    playButton.innerHTML = ICON_PAUSE + ICON_PLAY;
    reflectPlayState();
    paint();
    arm();
  }

  document.querySelectorAll('[data-gallery]').forEach(setUpGallery);
})();
