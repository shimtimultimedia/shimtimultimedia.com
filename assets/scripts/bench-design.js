/*
 * Shimti Multimedia - the three design instruments on Work
 *
 *   [data-bench="responsive"]  drag a viewport, watch a layout reflow
 *   [data-bench="monogram"]    type a name, see the mark it makes at three sizes
 *   [data-bench="formats"]     one photograph, six platform crops, one focal point
 *
 * None of the three needs an asset, a library or a network request. Each demonstrates a
 * discipline by doing the actual job in front of you rather than describing it.
 */

'use strict';

(() => {
  /* --------------------------------------------------------------- responsive frame */

  /**
   * The miniature page inside the frame is laid out with container queries, not media
   * queries. That is the whole trick: a media query asks how wide the window is, so a
   * layout built with them cannot reflow inside a 400px box on a 1400px screen - it would
   * stay in its desktop arrangement and prove nothing. Container queries ask how wide the
   * parent is, which is exactly the question a component should be asking anyway.
   */
  function setUpResponsive(bench) {
    const frame = bench.querySelector('[data-frame]');
    const range = bench.querySelector('[data-frame-width]');
    const readout = bench.querySelector('[data-frame-readout]');
    const presets = [...bench.querySelectorAll('[data-frame-preset]')];
    if (!frame || !range) return;

    const label = (w) => (w < 480 ? 'phone' : w < 820 ? 'tablet' : 'desktop');

    const shell = bench.querySelector('[data-frame-shell]');
    const stage = shell ? shell.parentElement : frame.parentElement;

    function apply() {
      const w = +range.value;

      // Set the true width first and let it lay out, so the natural height can be read
      // back. A phone-width page is much taller than a desktop one, and fitting on width
      // alone is what let the phone view spill out of the bottom of the stage.
      frame.style.width = w + 'px';
      frame.style.transform = 'none';
      const naturalHeight = frame.offsetHeight;

      const roomW = stage.clientWidth - 20;
      const roomH = stage.clientHeight - 20;
      const fit = Math.min(1, roomW / w, roomH / naturalHeight);

      frame.style.transform = '';
      frame.style.setProperty('--fit', String(fit));

      if (shell) {
        // The shell is what the stage centres, so it carries the size you actually see.
        shell.style.width = Math.round(w * fit) + 'px';
        shell.style.height = Math.round(naturalHeight * fit) + 'px';
      }

      if (readout) readout.textContent = w + 'px · ' + label(w);
      presets.forEach((b) => b.setAttribute('aria-pressed',
        String(+b.dataset.framePreset === w)));
    }

    new ResizeObserver(apply).observe(stage);

    range.addEventListener('input', apply);
    presets.forEach((button) => {
      button.addEventListener('click', () => { range.value = button.dataset.framePreset; apply(); });
    });
    apply();
  }

  /* ------------------------------------------------------------------- monogram */

  /**
   * Shown at three sizes at once, deliberately.
   *
   * A mark that only works large is not a mark, it is a picture. Setting the same
   * construction at 112px, 44px and 16px in one row is the fastest way to show whether it
   * survives being a favicon - which is the argument the Logo design copy actually makes.
   */
  function setUpMonogram(bench) {
    const input = bench.querySelector('[data-mono-name]');
    const marks = [...bench.querySelectorAll('[data-mono-mark]')];
    const weight = bench.querySelector('[data-mono-weight]');
    const tracking = bench.querySelector('[data-mono-tracking]');
    const shapes = [...bench.querySelectorAll('[data-mono-shape]')];
    if (!input || !marks.length) return;

    let shape = 'circle';

    /** Initials, the way a person would read them: first letter of each real word. */
    const initials = (value) => {
      const words = value.trim().split(/[\s\-_]+/).filter(Boolean);
      if (!words.length) return 'SM';
      const letters = words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
      return letters || 'SM';
    };

    function apply() {
      const text = initials(input.value);
      marks.forEach((mark) => {
        mark.textContent = text;
        mark.style.fontWeight = weight ? weight.value : 600;
        // Tracking is set in em so it scales with each size rather than blowing the small
        // one apart - a fixed pixel value looks correct at 112px and unreadable at 16.
        mark.style.letterSpacing = (tracking ? tracking.value : 4) / 100 + 'em';
        mark.dataset.shape = shape;
      });
    }

    input.addEventListener('input', apply);
    weight?.addEventListener('input', apply);
    tracking?.addEventListener('input', apply);
    shapes.forEach((button) => {
      button.addEventListener('click', () => {
        shape = button.dataset.monoShape;
        shapes.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        apply();
      });
    });

    apply();
  }

  /* -------------------------------------------------------------------- formats */

  /**
   * One photograph, six platform crops, one shared focal point.
   *
   * object-position does the cropping rather than canvas: the browser is already very good
   * at this, it stays sharp at any density, and moving the focal point costs one style
   * change on six elements instead of six redraws.
   */
  function setUpFormats(bench) {
    const images = [...bench.querySelectorAll('[data-format] img')];
    const x = bench.querySelector('[data-focal-x]');
    const y = bench.querySelector('[data-focal-y]');
    const readout = bench.querySelector('[data-focal-readout]');
    if (!images.length || !x || !y) return;

    function apply() {
      const px = +x.value;
      const py = +y.value;
      images.forEach((img) => { img.style.objectPosition = px + '% ' + py + '%'; });
      if (readout) readout.textContent = px + '% / ' + py + '%';
    }

    x.addEventListener('input', apply);
    y.addEventListener('input', apply);

    // Clicking the largest crop sets the focal point directly, which is how anyone would
    // expect to use it - the sliders are the keyboard route to the same thing.
    const lead = bench.querySelector('[data-format="1:1"]');
    lead?.addEventListener('click', (event) => {
      const box = lead.getBoundingClientRect();
      x.value = String(Math.round(((event.clientX - box.left) / box.width) * 100));
      y.value = String(Math.round(((event.clientY - box.top) / box.height) * 100));
      apply();
    });

    apply();
  }

  document.querySelectorAll('[data-bench="responsive"]').forEach(setUpResponsive);
  document.querySelectorAll('[data-bench="monogram"]').forEach(setUpMonogram);
  document.querySelectorAll('[data-bench="formats"]').forEach(setUpFormats);
})();
