/*
 * Shimti Multimedia - back to top
 *
 * The window on these pages does not scroll. The header and footer are fixed by the
 * layout and only the white sheet moves, so window.scrollTo(0, 0) - the thing every
 * back-to-top snippet on the internet does - would do exactly nothing here. The sheet
 * itself is the scroll container, and it is what this scrolls.
 *
 * The button is created here rather than written into fifteen pages: it is useless
 * without scripting, so shipping it in the markup would leave a dead control on the page
 * for anyone who never runs this file. Built in script, it exists only when it works.
 *
 * It also moves focus, not just the viewport. Scrolling a keyboard user to the top while
 * leaving their focus half way down the page is the standard version of this bug: the
 * next Tab throws them straight back to where they came from, and a screen reader is
 * still reading the middle of the document.
 */

'use strict';

(() => {
  const sheet = document.querySelector('.section-main');
  if (!sheet) return;

  // Show it once there is enough behind you to be worth going back over. Tied to the
  // sheet's own height rather than a fixed pixel count, so a long page on a phone and a
  // long page on a desktop reveal it at the same point in the reading.
  const threshold = () => Math.max(320, sheet.clientHeight * 0.75);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'to-top';
  button.setAttribute('aria-label', 'Back to top');
  button.hidden = true;
  button.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
    + '<path d="M8 3.5a.5.5 0 0 1 .354.146l5 5a.5.5 0 0 1-.708.708L8 4.707 3.354 9.354a.5.5'
    + ' 0 1 1-.708-.708l5-5A.5.5 0 0 1 8 3.5"/>'
    + '<path d="M2.5 12h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1 0-1"/></svg>';

  button.addEventListener('click', () => {
    sheet.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });

    // Put the reading position back at the top too, not just the pixels. tabindex="-1"
    // makes the sheet focusable by script without adding it to the tab order.
    sheet.setAttribute('tabindex', '-1');
    sheet.focus({ preventScroll: true });
  });

  document.body.append(button);

  // Deliberately not batched through requestAnimationFrame.
  //
  // The usual advice is to defer scroll work to the next frame, and the usual advice is
  // wrong here: rAF does not fire when the document is not being rendered, so anywhere the
  // page is scrollable but unpainted the button simply never appears. What it would buy is
  // not worth that - this handler reads one number and compares one boolean, and touches
  // the DOM only on the two scroll positions where the answer actually changes.
  const update = () => {
    const show = sheet.scrollTop > threshold();
    if (show === !button.hidden) return;      // nothing changed - do not touch the DOM
    button.hidden = !show;
  };

  sheet.addEventListener('scroll', update, { passive: true });

  update();
})();
