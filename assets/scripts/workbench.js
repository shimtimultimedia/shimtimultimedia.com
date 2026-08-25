/*
 * Shimti Multimedia - the workbench
 *
 * The instruments on the Work page. Each one demonstrates a discipline by letting a visitor
 * operate it, rather than describing it in a paragraph they have no reason to believe.
 *
 * WHY EVERY CONTROL IS A RANGE INPUT OR A BUTTON
 *
 * A reveal handle and a turntable both want dragging, and dragging is the single most
 * commonly broken interaction on the web: built by hand it usually works with a mouse, half
 * works on touch, and is unusable by keyboard - which is also a WCAG 2.5.7 failure, since
 * dragging must have a single-pointer alternative.
 *
 * A native range input is already all of those things. It drags, it responds to arrow keys,
 * Home and End, it announces itself to a screen reader, and it handles touch and pointer
 * capture correctly on every platform. Styling one is a little fiddly; reimplementing
 * everything it does correctly is far more than a little fiddly, and the reimplementation
 * is never as good.
 *
 * WIRED IMMEDIATELY, LOADED LAZILY
 *
 * The controls are connected as soon as the page is ready. Only the rotation frames wait
 * until the instrument is approached, because those are the expensive part and a visitor
 * who never scrolls that far should not pay for them.
 *
 * The split matters: making the controls themselves wait on an observer put a rendering-step
 * callback between a visitor and every interaction on the page, and where those callbacks
 * do not arrive on schedule the result is inert sliders on the one page whose whole argument
 * is that it can be operated.
 *
 * @requires markup: [data-bench] blocks, see work.html
 * @requires assets/styles/workbench.css
 */

'use strict';

(function () {
    const benches = document.querySelectorAll('[data-bench]');
    if (!benches.length) return;

    /* ------------------------------------------------------------------ reveal */

    /**
     * Two images stacked, the top one clipped to the handle's position.
     * The clip is a CSS custom property so the browser does the compositing.
     */
    function setUpReveal(bench) {
        const range = bench.querySelector('.bench-range');
        const clip = bench.querySelector('.bench-clip');
        if (!range || !clip) return;

        const apply = () => {
            bench.style.setProperty('--reveal', range.value + '%');
            // Spoken as a percentage rather than a bare number, which on its own tells a
            // screen reader user nothing about what it is a percentage of.
            range.setAttribute('aria-valuetext', range.value + '% revealed');
        };

        range.addEventListener('input', apply);
        apply();
    }

    /* --------------------------------------------------------------- turntable */

    /**
     * A pre-rendered rotation, scrubbed. Every frame is decoded once on set-up so that
     * dragging never waits on a network request mid-spin.
     */
    function setUpTurntable(bench) {
        const range = bench.querySelector('.bench-range');
        const shown = bench.querySelector('.bench-frame');
        const sources = (bench.dataset.frames || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!range || !shown || !sources.length) return;

        range.max = String(sources.length - 1);

        /*
         * Frames are warmed on approach, so a drag does not become a slideshow of
         * half-loaded images - but only as an optimisation. If the observer never
         * delivers, each frame simply loads the first time it is asked for.
         */
        const warm = () => sources.forEach((src) => { const img = new Image(); img.src = src; });

        if (window.IntersectionObserver) {
            const observer = new IntersectionObserver((entries) => {
                if (!entries.some((e) => e.isIntersecting)) return;
                observer.disconnect();
                warm();
            }, { rootMargin: '300px' });
            observer.observe(bench);
        } else {
            warm();
        }

        const apply = () => {
            const i = Math.min(sources.length - 1, Math.max(0, Number(range.value)));
            shown.src = sources[i];
            const degrees = Math.round((i / sources.length) * 360);
            range.setAttribute('aria-valuetext', degrees + ' degrees');
        };

        range.addEventListener('input', apply);
        apply();
    }

    /* -------------------------------------------------------------------- grade */

    /**
     * The same frame under different treatments. Buttons rather than a select, because the
     * point is comparison and comparison wants every option visible at once.
     */
    function setUpGrade(bench) {
        const stage = bench.querySelector('.bench-stage');
        /*
         * Scoped to the buttons, not to the attribute.
         *
         * The stage carries data-grade too - it is how the treatment is applied - so a bare
         * [data-grade] selector collected the stage along with the four buttons and then
         * set aria-pressed on it. A div announcing itself as an unpressed toggle is
         * nonsense to a screen reader, and it made the real buttons impossible to query by
         * attribute, since the stage matched first.
         */
        const buttons = bench.querySelectorAll('.bench-option[data-grade]');
        if (!stage || !buttons.length) return;

        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                stage.dataset.grade = button.dataset.grade;
                buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
            });
        });
    }

    /* ---------------------------------------------------------------- construction */

    /** Guides over a finished mark: the geometry a logo was built on, shown on demand. */
    function setUpConstruction(bench) {
        const toggle = bench.querySelector('[data-guides]');
        if (!toggle) return;

        toggle.addEventListener('click', () => {
            const on = bench.dataset.guides === 'on';
            bench.dataset.guides = on ? 'off' : 'on';
            toggle.setAttribute('aria-pressed', String(!on));
        });
    }

    const setUp = {
        reveal: setUpReveal,
        turntable: setUpTurntable,
        grade: setUpGrade,
        construction: setUpConstruction,
    };

    /*
     * Wired immediately. Only the loading is deferred.
     *
     * The first version built each instrument when it scrolled into view, which made an
     * IntersectionObserver callback the thing standing between a visitor and every control
     * on the page. Observer callbacks are delivered as part of the rendering steps, so
     * anywhere those do not run on schedule the instruments are simply dead - inert
     * sliders and buttons that do nothing, on the one page whose entire argument is that
     * you can operate it.
     *
     * That is a bad trade for an optimisation. Wiring four sets of handlers costs
     * effectively nothing; it is decoding rotation frames that is worth avoiding, and that
     * is what the observer defers now. If it never fires, the frames simply load when the
     * control first asks for them, and everything still works.
     */
    benches.forEach((bench) => {
        setUp[bench.dataset.bench]?.(bench);
        bench.dataset.ready = '';
    });
}());
