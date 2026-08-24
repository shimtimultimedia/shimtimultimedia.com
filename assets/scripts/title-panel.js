/**
 * @module TitlePanel
 * @description Initializes the title panel with logo and text for Shimti Multimedia’s sci-fi UI.
 * Restores original behavior from title-panel.js, handling logo load errors with minimal logging.
 * Uses shared ShimtiUtils.Logger for debugging, with verbose logging toggled by VERBOSE_LOGGING.
 * @requires DOM element with id 'shimtiPanel' containing an img element
 * @requires assets/images/logo.svg
 * @requires window.ShimtiUtils.Logger from ui-elements.js
 */

/** @type {window.ShimtiUtils.Logger} Logger instance for title panel module */
const titleLogger = new window.ShimtiUtils.Logger('TitlePanel');

/**
 * @function initTitlePanel
 * @description Sets up the title panel with logo and text, handling load errors
 */
function initTitlePanel() {
    const startTime = performance.now();
    try {
        const titlePanel = document.getElementById('shimtiPanel');
        if (!titlePanel) {
            throw new Error('Title panel element not found');
        }

        const logo = titlePanel.querySelector('img');
        if (!logo) {
            throw new Error('Logo image not found in title panel');
        }

        logo.addEventListener('error', () => {
            try {
                logo.alt = 'Shimti Multimedia Logo (Failed to Load)';
                titleLogger.error('Logo failed to load', null, { src: logo.src });
            } catch (error) {
                titleLogger.error('Logo error handler failed', error);
            }
        });

        logo.addEventListener('load', () => {
            titleLogger.log('Logo loaded successfully', { src: logo.src });
        });

        titleLogger.log('Title panel initialized', { duration: performance.now() - startTime });
    } catch (error) {
        titleLogger.error('Failed to initialize title panel', error);
    }
}

window.addEventListener('load', () => {
    titleLogger.log('Starting title panel initialization');
    initTitlePanel();
});