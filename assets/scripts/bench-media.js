/*
 * Shimti Multimedia - the media instruments on Work
 *
 *   [data-bench="video"]  a video player with a playlist
 *   [data-bench="audio"]  an audio player with a playlist
 *
 * Both wrap a native <video>/<audio> element rather than building a player from scratch.
 * That is deliberate: the native controls already handle fullscreen, picture-in-picture,
 * playback rate, captions, AirPlay, media keys, the lock screen, and every accessibility
 * affordance the platform provides. A hand-built transport bar loses all of it and gains
 * nothing but a set of buttons that match the site, which is a poor trade on a page whose
 * whole argument is competence.
 *
 * What is added is only what the native element has no concept of: a playlist, and the
 * discipline to stop the moment nobody is looking at it.
 */

'use strict';

(() => {
  function setUpPlaylist(bench, mediaSelector) {
    const media = bench.querySelector(mediaSelector);
    const list = bench.querySelector('[data-playlist]');
    if (!media || !list) return;

    const buttons = [...list.querySelectorAll('[data-track]')];
    if (!buttons.length) return;

    const titleOut = bench.querySelector('[data-now-playing]');
    let index = -1;

    function select(next, autoplay) {
      const wrapped = (next + buttons.length) % buttons.length;
      if (wrapped === index) return;
      index = wrapped;
      const button = buttons[index];

      media.src = button.dataset.track;
      // load() only when the visitor asked for it. Calling it on the first selection
      // defeats preload="none" outright: the element obediently fetches the whole track
      // before anyone has pressed anything, which on this page was 157KB of placeholder
      // audio downloaded by every single visitor to Work.
      if (autoplay) media.load();
      // The poster follows the clip. One still left over from the first item is a small
      // lie about what the second one is - and the poster is the only thing anyone sees
      // before they press play.
      if (button.dataset.poster) media.setAttribute('poster', button.dataset.poster);

      if (titleOut) titleOut.textContent = button.dataset.title || button.textContent.trim();

      buttons.forEach((b, i) => {
        // aria-current rather than a class alone: the state has to reach a screen reader,
        // not only the eye.
        if (i === index) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });

      if (autoplay) {
        // Autoplay is refused by every browser unless the user has already interacted,
        // and an unhandled rejection here would surface as a console error on a page that
        // has done nothing wrong.
        const played = media.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      }
    }

    buttons.forEach((button, i) => {
      button.addEventListener('click', () => select(i, true));
    });

    // Roll on to the next item, so a playlist behaves like one.
    media.addEventListener('ended', () => select(index + 1, true));

    // Nothing plays to an empty room: pause when scrolled away or when the tab is hidden.
    // The browser does this for video on some platforms and for audio on almost none.
    let wasPlaying = false;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (wasPlaying) {
          const played = media.play();
          if (played && typeof played.catch === 'function') played.catch(() => {});
        }
      } else if (!media.paused) {
        wasPlaying = true;
        media.pause();
        return;
      }
      if (entries[0].isIntersecting) wasPlaying = false;
    }, { threshold: 0.2 });
    observer.observe(media);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !media.paused) media.pause();
    });

    select(0, false);
  }

  document.querySelectorAll('[data-bench="video"]')
    .forEach((b) => setUpPlaylist(b, 'video'));
  document.querySelectorAll('[data-bench="audio"]')
    .forEach((b) => setUpPlaylist(b, 'audio'));
})();
