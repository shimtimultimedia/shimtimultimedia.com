/*
 * Shimti Multimedia - the pipeline map on the AI page
 *
 * The page claims AI is tooling inside all seventeen disciplines. This turns that claim
 * into something a visitor can check, one practice at a time.
 *
 * PROGRESSIVE ENHANCEMENT, AND WHY IT IS NOT DECORATION HERE
 *
 * Every discipline is written into the HTML as an ordinary heading and list. Without this
 * script the section is five stacked lists - longer, but complete and readable, and every
 * word of it reaches a crawler and a reader mode. This script only restructures what is
 * already there: it builds the tab strip itself, so a visitor with no JavaScript is never
 * shown a row of buttons that do nothing.
 *
 * That ordering matters. Markup that hides content and waits for script to reveal it puts
 * the whole section one failed request away from being invisible.
 */

'use strict';

(() => {
  const root = document.querySelector('[data-pipeline]');
  if (!root) return;

  const panels = [...root.querySelectorAll('.pipeline-practice')];
  if (panels.length < 2) return;

  const strip = document.createElement('div');
  strip.className = 'pipeline-tabs';
  strip.setAttribute('role', 'tablist');
  strip.setAttribute('aria-label', 'Practices');

  const tabs = panels.map((panel, i) => {
    const heading = panel.querySelector('h3');
    const id = 'pipeline-' + i;

    panel.id = id + '-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', id + '-tab');
    // The heading is what the tab is made from, so leaving it in the panel would print
    // the practice name twice.
    heading.hidden = true;

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = id + '-tab';
    tab.className = 'pipeline-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.innerHTML = heading.innerHTML;
    strip.append(tab);
    return tab;
  });

  let index = 0;

  function select(next, moveFocus) {
    index = (next + tabs.length) % tabs.length;
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      // Roving tabindex: one stop for the whole strip, then arrow keys inside it. A
      // seventeen-item map that costs five tabs to walk past is a nuisance.
      tab.tabIndex = on ? 0 : -1;
      panels[i].hidden = !on;
    });
    if (moveFocus) tabs[index].focus();
  }

  strip.addEventListener('click', (event) => {
    const tab = event.target.closest('.pipeline-tab');
    if (tab) select(tabs.indexOf(tab), false);
  });

  strip.addEventListener('keydown', (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    const move = keys[event.key];
    if (move === undefined) return;
    event.preventDefault();
    if (move === 'first') return select(0, true);
    if (move === 'last') return select(tabs.length - 1, true);
    select(index + move, true);
  });

  root.prepend(strip);
  select(0, false);
})();
