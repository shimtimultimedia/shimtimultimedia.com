/*
 * Shimti Multimedia: Section preview panels
 *
 * Shows a preview panel when a radial sector is hovered or keyboard-focused. Activating
 * the sector navigates to that section's page; the panel is a preview, never the
 * destination.
 *
 * Four design decisions, each fixing a specific failure:
 *
 * 1. Listeners are delegated from `document`.
 *    The sector links are NOT inside #radialMenu, despite appearances. That element is
 *    only a sizing anchor; ui-elements.js draws the real wheel into #uiSvg, a sibling.
 *    It also rebuilds the whole wheel on resize, discarding every element inside it.
 *    Delegating from the document survives both facts. mouseover/mouseout are used
 *    rather than mouseenter/mouseleave because only the former bubble.
 *
 * 2. Wiring waits on a MutationObserver, not a timer.
 *    ui-elements.js builds the wheel a full second after DOMContentLoaded. Matching
 *    that with a timeout here would couple two files through a magic number and break
 *    the moment either changed.
 *
 * 3. Touch gets an explicit two-step.
 *    A touch device has no hover, so a single tap would navigate and the preview would
 *    never be seen. First tap opens the panel, second follows the link.
 *
 * 4. Images are swapped in on first reveal rather than using loading="lazy".
 *    A native lazy image inside an opacity-driven subtree never satisfies the browser's
 *    visibility heuristic and can stay blank permanently.
 *
 * @requires DOM: #uiSvg g#wheelMenu a[data-section], #sectionPanels .section-panel
 */

'use strict';

(function () {
  const panelHost = document.getElementById('sectionPanels');
  if (!panelHost) return;

  const panels = new Map();
  panelHost.querySelectorAll('.section-panel').forEach((panel) => {
    panels.set(panel.id.replace(/^panel-/, ''), panel);
  });

  let openSection = null;
  // Recorded on pointerdown so the click handler can tell a tap from a mouse click.
  let lastPointerType = 'mouse';

  function linkFrom(target) {
    return target instanceof Element ? target.closest('a[data-section]') : null;
  }

  function revealImage(panel) {
    const img = panel.querySelector('img[data-src]');
    if (!img) return;
    img.src = img.dataset.src;
    delete img.dataset.src;
  }

  function open(section) {
    if (openSection === section) return;
    close();
    const panel = panels.get(section);
    if (!panel) return;
    revealImage(panel);
    panel.classList.add('is-open');
    // Hang the preview off the branding node and wire it there. node-panels.js owns all
    // node geometry, so it decides where the panel actually lands - including keeping it
    // on screen wherever the branding node has been dragged to.
    window.ShimtiNodes?.anchorTo('shimtiPanel', panel);
    openSection = section;
  }

  function close() {
    if (openSection === null) return;
    const panel = panels.get(openSection);
    if (panel) {
      panel.classList.remove('is-open');
      window.ShimtiNodes?.release(panel);
    }
    openSection = null;
  }

  // Point each sector link at its own teaser text, so a screen reader announces the
  // description when the link takes focus. Re-applied after every wheel rebuild, since
  // a rebuild produces fresh elements without these attributes.
  function describeLinks() {
    document.querySelectorAll('a[data-section]').forEach((link) => {
      const copy = document.getElementById(`copy-${link.dataset.section}`);
      if (copy && link.getAttribute('aria-describedby') !== copy.id) {
        link.setAttribute('aria-describedby', copy.id);
      }
    });
  }

  document.addEventListener('mouseover', (event) => {
    if (lastPointerType === 'touch') return;
    const link = linkFrom(event.target);
    if (link) open(link.dataset.section);
  });

  document.addEventListener('mouseout', (event) => {
    if (lastPointerType === 'touch') return;
    const from = linkFrom(event.target);
    if (!from) return;
    // relatedTarget is where the pointer went. Moving within the same link - from its
    // path onto its icon, say - must not close the panel.
    if (linkFrom(event.relatedTarget) === from) return;
    close();
  });

  document.addEventListener('focusin', (event) => {
    const link = linkFrom(event.target);
    if (link) open(link.dataset.section);
    else close();
  });

  document.addEventListener('pointerdown', (event) => {
    lastPointerType = event.pointerType || 'mouse';
    // A tap or click outside the wheel dismisses the preview, so a touch user is never
    // left with a panel they cannot close.
    if (!linkFrom(event.target)) close();
  });

  document.addEventListener('click', (event) => {
    const link = linkFrom(event.target);
    if (!link) return;
    const section = link.dataset.section;

    // Touch two-step: first tap previews, second tap navigates.
    if (lastPointerType === 'touch' && openSection !== section) {
      event.preventDefault();
      open(section);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  describeLinks();

  // The wheel is built ~1s after DOMContentLoaded and rebuilt on every resize. Watch
  // for it rather than assuming any particular timing.
  const host = document.getElementById('uiSvg') || document.body;
  new MutationObserver(() => {
    describeLinks();
    // A rebuild throws away the element that was open, so the class is gone even though
    // openSection still names it. Clear the stale reference, or the next hover on that
    // same section is treated as "already open" and ignored.
    if (openSection !== null && !panels.get(openSection)?.classList.contains('is-open')) {
      openSection = null;
    }
  }).observe(host, { childList: true, subtree: true });
})();
