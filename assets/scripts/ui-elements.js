/**
 * @module UIElements
 * @description Manages SVG-based UI for Shimti Multimedia’s sci-fi interface with radial menu, welcome carousel, rings, and connection lines. Uses canvas-based hit detection for hover to bypass SVG event issues.
 * @requires DOM elements (uiSvg, radialMenu, shimtiPanel, shimtiPanelBottom, welcomeText), assets/data/languages.xml, assets/images/*.svg
 */

/** @namespace ShimtiUtils - Shared utilities for logging */
window.ShimtiUtils = window.ShimtiUtils || {};
window.ShimtiUtils.DEBUG_MODE = true;
window.ShimtiUtils.VERBOSE_LOGGING = true;

/** @class ShimtiUtils.Logger - Centralized logging */
window.ShimtiUtils.Logger = class {
    constructor(category) { this.category = category; }
    log(message, context = {}, verbose = false) {
        if (window.ShimtiUtils.DEBUG_MODE && (!verbose || window.ShimtiUtils.VERBOSE_LOGGING)) {
            console.log(`[${new Date().toISOString()}] [${this.category}] ${message}`, context);
        }
    }
    error(message, error = null, context = {}) {
        console.error(`[${new Date().toISOString()}] [${this.category}] ${message}`, { error, context });
        if (error && error.stack) console.error(error.stack);
    }
    warn(message, context = {}) {
        console.warn(`[${new Date().toISOString()}] [${this.category}] ${message}`, context);
    }
};

const uiLogger = new window.ShimtiUtils.Logger('UIElements');
const SVG_NS = 'http://www.w3.org/2000/svg';

const UI_CONFIG = {
    OUTER_RADIUS: 180,
    INNER_RADIUS: 70,
    GRID_SPACING: 20,
    PARTICLE_COUNT_MIN: 4,
    PARTICLE_COUNT_MAX: 12,
    SECTOR_FILL: 'rgba(180, 220, 255, 0.08)',
    STROKE_COLOR: '#fff',
    INNER_CIRCLE_RADIUS: 58,
    INNER_FILLED_RADIUS: 48,
    CORE_RADIUS: 20,
    RING_RADII: [25, 30, 35],
    NAVIGATION_LINKS: ['Contact', 'AI', 'Work', 'Media', 'Shop', 'About'],
    WELCOME_INTERVAL: 8000,
    PARTICLE_INTERVAL_MIN: 1000,
    PARTICLE_INTERVAL_MAX: 3000,
    BACKGROUND_RADIUS: 192,
    FALLBACK_LANGUAGES: [
        { lang: 'English', text: 'Welcome' },
        { lang: 'Spanish', text: 'Bienvenido' },
        { lang: 'French', text: 'Bienvenue' },
        { lang: 'German', text: 'Willkommen' },
        { lang: 'Russian', text: 'Добро пожаловать' },
        { lang: 'Mandarin', text: '欢迎' },
        { lang: 'Japanese', text: 'ようこそ' },
        { lang: 'Hindi', text: 'स्वागत है' },
        { lang: 'Swahili', text: 'Karibu' },
        { lang: 'Arabic', text: 'أهلاً' },
        { lang: 'Portuguese', text: 'Bem-vindo' },
        { lang: 'Yoruba', text: 'Kaabọ' }
    ],
    STATIONARY_RING_OUTER: 245,
    STATIONARY_RING_INNER: 210,
    SQUARE_RADIUS: 227.5,
    SQUARE_COUNT: 24,
    SQUARE_SIZE: 8,
    OUTER_SEGMENTED: { outer: 330, inner: 260, count: 16, minArc: 2, maxArc: 90, minGap: 5, maxGap: 15 },
    INNER_SEGMENTED: { outer: 480, inner: 400, count: 9, minArc: 30, maxArc: 90, minGap: 1, maxGap: 8 },
    MIDDLE_SEGMENTED: { outer: 257.5, inner: 240, count: 4, minArc: 30, maxArc: 90, minGap: 5, maxGap: 15 },
    DOTTED_RADIUS: 335,
    THICK_CIRCLE_OUTER: 480,
    THICK_CIRCLE_INNER: 360,
    CONNECTION_STROKE: 'rgba(255, 255, 255, 0.3)',
    CONNECTION_POINT_RADIUS: 5
};

/** @function debounce - Limits function execution rate */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/** @function createSvgElement - Creates SVG element with attributes */
function createSvgElement(tag, attributes = {}, styles = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    Object.entries(styles).forEach(([key, value]) => element.style[key] = value);
    return element;
}

/** @function polarToCartesian - Converts polar to Cartesian coordinates */
function polarToCartesian(cx, cy, r, angleDeg) {
    const angleRad = (Math.PI / 180) * angleDeg;
    return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

/** @function generateSegments - Generates random segment angles for rings */
function generateSegments(config) {
    try {
        const { count, minArc, maxArc, minGap, maxGap } = config;
        const segments = [];
        let currentAngle = 0;
        while (currentAngle < 360 && segments.length < count) {
            const arcLength = minArc + Math.random() * (maxArc - minArc);
            const gapLength = minGap + Math.random() * (maxGap - minGap);
            if (currentAngle + arcLength > 360) break;
            segments.push({ start: currentAngle, end: currentAngle + arcLength });
            currentAngle += arcLength + gapLength;
        }
        uiLogger.log('Generated segments', { count: segments.length }, true);
        return segments;
    } catch (error) {
        uiLogger.error('Failed to generate segments', error);
        return [];
    }
}

/** @class GridParticle - Manages particle at grid intersections */
class GridParticle {
    constructor(x, y, gridOverlay) {
        this.x = x;
        this.y = y;
        this.gridOverlay = gridOverlay;
        try {
            this.element = createSvgElement('circle', {
                cx: this.x,
                cy: this.y,
                r: '3',
                fill: 'rgba(234, 255, 255, 0.8)'
            }, { opacity: '0', pointerEvents: 'none' });
            this.gridOverlay.appendChild(this.element);
            uiLogger.log('GridParticle initialized', { x, y }, true);
        } catch (error) {
            uiLogger.error('Failed to initialize GridParticle', error);
        }
    }
}

/** @function animateParticles - Manages animation for all particles */
function animateParticles(particles) {
    const animate = () => {
        particles.forEach(particle => {
            try {
                particle.element.style.opacity = particle.element.style.opacity === '1' ? '0' : '1';
            } catch (error) {
                uiLogger.error('Particle animation failed', error);
            }
        });
        setTimeout(animate, UI_CONFIG.PARTICLE_INTERVAL_MIN + Math.random() * (UI_CONFIG.PARTICLE_INTERVAL_MAX - UI_CONFIG.PARTICLE_INTERVAL_MIN));
    };
    setTimeout(animate, Math.random() * UI_CONFIG.PARTICLE_INTERVAL_MAX);
}

/** @function createNavigationSector - Creates SVG sector for radial menu */
function createNavigationSector(position, label, fillColor, fragment, centerX, centerY) {
    try {
        const { p1, p2, p3, p4, iconPos, start, end } = position;
        const largeArc = end - start > 180 ? 1 : 0;
        const pathData = [
            'M', p1.x, p1.y,
            'A', UI_CONFIG.OUTER_RADIUS, UI_CONFIG.OUTER_RADIUS, 0, largeArc, 0, p2.x, p2.y,
            'L', p3.x, p3.y,
            'A', UI_CONFIG.INNER_RADIUS, UI_CONFIG.INNER_RADIUS, 0, largeArc, 1, p4.x, p4.y,
            'Z'
        ].join(' ');

        const group = createSvgElement('g', {
            id: `sector-${label.toLowerCase()}`,
            'data-label': label,
            'data-startAngle': start,
            'data-endAngle': end
        });
        const path = createSvgElement('path', {
            d: pathData,
            fill: fillColor,
            stroke: UI_CONFIG.STROKE_COLOR,
            'stroke-width': '1'
        });
        const icon = createSvgElement('image', {
            href: `assets/images/${label}.svg`,
            x: iconPos.x - 25,
            y: iconPos.y - 25,
            width: '50',
            height: '50',
            'aria-label': `${label} Icon`,
            loading: 'lazy'
        }, { pointerEvents: 'none' });

        group.appendChild(path);
        group.appendChild(icon);
        fragment.appendChild(group);
        uiLogger.log('Created navigation sector', { label, id: group.getAttribute('id') }, true);
    } catch (error) {
        uiLogger.error('Failed to create navigation sector', error);
    }
}

/** @function setupSectorHover - Uses canvas for hit detection */
let hitAreasDrawn = false;
function setupSectorHover(canvas, ctx, sectorPositions, welcomeText, carouselState, centerX, centerY) {
    const menuLogger = new window.ShimtiUtils.Logger('RadialMenu');
    try {
        if (!canvas || !ctx || !welcomeText) {
            throw new Error('Missing canvas, context, or welcomeText');
        }

        let currentHoverSector = null;

        const drawHitAreas = () => {
            if (hitAreasDrawn) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            sectorPositions.forEach((pos, i) => {
                const label = UI_CONFIG.NAVIGATION_LINKS[i];
                ctx.fillStyle = `rgb(${i + 1}, 0, 0)`;
                ctx.beginPath();
                ctx.arc(centerX, centerY, UI_CONFIG.OUTER_RADIUS, (pos.start * Math.PI) / 180, (pos.end * Math.PI) / 180);
                ctx.arc(centerX, centerY, UI_CONFIG.INNER_RADIUS, (pos.end * Math.PI) / 180, (pos.start * Math.PI) / 180, true);
                ctx.closePath();
                ctx.fill();
            });
            hitAreasDrawn = true;
            menuLogger.log('Hit areas drawn', { sectorCount: sectorPositions.length }, true);
        };

        const checkHover = (mouseX, mouseY) => {
            try {
                const pixel = ctx.getImageData(mouseX, mouseY, 1, 1).data;
                const sectorIndex = pixel[0] - 1;
                if (sectorIndex >= 0 && sectorIndex < sectorPositions.length) {
                    const label = UI_CONFIG.NAVIGATION_LINKS[sectorIndex];
                    const sector = document.getElementById(`sector-${label.toLowerCase()}`);
                    if (sector && (!currentHoverSector || currentHoverSector.label !== label)) {
                        if (currentHoverSector) resetSector(currentHoverSector);
                        if (carouselState.timeoutId) clearTimeout(carouselState.timeoutId);
                        carouselState.isHovering = true;
                        welcomeText.textContent = label;
                        welcomeText.style.opacity = '1';
                        const path = sector.querySelector('path');
                        path.style.fill = 'rgba(180, 220, 255, 0.4)';
                        path.style.stroke = '#8cf';
                        path.style.strokeWidth = '3';
                        currentHoverSector = { label, sector, path };
                        menuLogger.log('Sector hover', { label }, true);
                    }
                } else if (currentHoverSector) {
                    resetSector(currentHoverSector);
                    currentHoverSector = null;
                }
            } catch (error) {
                menuLogger.error('Hover detection failed', error);
            }
        };

        const resetSector = (hoverData) => {
            try {
                if (carouselState.timeoutId) clearTimeout(carouselState.timeoutId);
                carouselState.isHovering = false;
                welcomeText.textContent = carouselState.languages[carouselState.currentIndex].text || 'Welcome';
                welcomeText.style.opacity = '1';
                hoverData.path.style.fill = UI_CONFIG.SECTOR_FILL;
                hoverData.path.style.stroke = UI_CONFIG.STROKE_COLOR;
                hoverData.path.style.strokeWidth = '1';
                menuLogger.log('Sector mouseleave', { label: hoverData.label }, true);
                carouselState.timeoutId = setTimeout(() => {
                    carouselState.currentIndex = (carouselState.currentIndex + 1) % carouselState.languages.length;
                    welcomeText.textContent = carouselState.languages[carouselState.currentIndex].text || 'Welcome';
                    menuLogger.log('Carousel resumed', { text: carouselState.languages[carouselState.currentIndex].text }, true);
                }, UI_CONFIG.WELCOME_INTERVAL);
            } catch (error) {
                menuLogger.error('Sector reset failed', error);
            }
        };

        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            checkHover(e.clientX - rect.left, e.clientY - rect.top);
        });

        canvas.addEventListener('mouseleave', () => {
            if (currentHoverSector) {
                resetSector(currentHoverSector);
                currentHoverSector = null;
            }
        });

        drawHitAreas();
        menuLogger.log('Canvas hover setup complete', { sectorCount: sectorPositions.length }, true);
    } catch (error) {
        menuLogger.error('Failed to setup canvas hover', error);
    }
}

/** @function initWelcomeCarousel - Initializes welcome text carousel */
function initWelcomeCarousel(svgElement, menuWheel, canvas, ctx, carouselState, sectorPositions, centerX, centerY) {
    const carouselLogger = new window.ShimtiUtils.Logger('WelcomeCarousel');
    try {
        const welcomeText = document.getElementById('welcomeText');
        if (!welcomeText || !menuWheel || !canvas || !ctx) {
            throw new Error('Missing required elements for carousel');
        }

        welcomeText.textContent = 'Loading...';
        carouselState.languages = UI_CONFIG.FALLBACK_LANGUAGES;

        fetch('assets/data/languages.xml')
            .then(response => response.ok ? response.text() : Promise.reject(response.status))
            .then(text => new DOMParser().parseFromString(text, 'text/xml'))
            .then(xmlDoc => {
                const languageNodes = xmlDoc.getElementsByTagName('language');
                if (languageNodes.length > 0) {
                    carouselState.languages = Array.from(languageNodes).map(node => ({
                        lang: node.getAttribute('lang'),
                        text: node.getAttribute('text') || 'Welcome'
                    }));
                    carouselLogger.log('Loaded languages.xml', { count: carouselState.languages.length });
                } else {
                    carouselLogger.warn('languages.xml empty, using fallback');
                }
                startCarousel();
            })
            .catch(error => {
                carouselLogger.warn('Failed to load languages.xml', { error });
                startCarousel();
            });

        function startCarousel() {
            carouselState.currentIndex = 0;
            carouselState.isHovering = false;
            carouselState.timeoutId = null;

            const cycleText = () => {
                try {
                    if (carouselState.timeoutId) clearTimeout(carouselState.timeoutId);
                    if (carouselState.isHovering) {
                        carouselState.timeoutId = setTimeout(cycleText, UI_CONFIG.WELCOME_INTERVAL);
                        return;
                    }

                    welcomeText.classList.remove('fade-in');
                    welcomeText.classList.add('fade-out');
                    setTimeout(() => {
                        carouselState.currentIndex = (carouselState.currentIndex + 1) % carouselState.languages.length;
                        welcomeText.textContent = carouselState.languages[carouselState.currentIndex].text || 'Welcome';
                        welcomeText.classList.remove('fade-out');
                        welcomeText.classList.add('fade-in');
                        carouselLogger.log('Cycled text', { text: carouselState.languages[carouselState.currentIndex].text }, true);
                        carouselState.timeoutId = setTimeout(cycleText, UI_CONFIG.WELCOME_INTERVAL);
                    }, 500);
                } catch (error) {
                    carouselLogger.error('Carousel cycle failed', error);
                }
            };

            welcomeText.textContent = carouselState.languages[0].text || 'Welcome';
            welcomeText.classList.add('fade-in');
            carouselState.timeoutId = setTimeout(cycleText, UI_CONFIG.WELCOME_INTERVAL);
        }

        setTimeout(() => setupSectorHover(canvas, ctx, sectorPositions, welcomeText, carouselState, centerX, centerY), 1000);
    } catch (error) {
        carouselLogger.error('Failed to initialize welcome carousel', error);
    }
}

/** @function initUIElements - Initializes SVG elements with canvas overlay */
function initUIElements() {
    const startTime = performance.now();
    try {
        const svgElement = document.getElementById('uiSvg');
        if (!svgElement) {
            throw new Error('UI SVG element not found');
        }

        const wheelRect = document.getElementById('radialMenu')?.getBoundingClientRect();
        if (!wheelRect) {
            throw new Error('Radial menu element not found');
        }

        let canvas = document.getElementById('hitCanvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'hitCanvas';
            canvas.style.position = 'absolute';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.zIndex = '1000';
            canvas.style.pointerEvents = 'auto';
            canvas.style.opacity = '0';
            document.body.appendChild(canvas);
        }
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        const ctx = canvas.getContext('2d');

        svgElement.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
        svgElement.style.zIndex = '999';
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;

        svgElement.innerHTML = '';

        const defs = createSvgElement('defs');
        const gradient = createSvgElement('radialGradient', {
            id: 'backgroundGradient',
            cx: '50%',
            cy: '50%',
            r: '50%',
            fx: '50%',
            fy: '50%'
        });
        gradient.appendChild(createSvgElement('stop', { offset: '0%', 'stop-color': 'rgb(180, 220, 255)', 'stop-opacity': '0.0' }));
        gradient.appendChild(createSvgElement('stop', { offset: '80%', 'stop-color': 'rgb(180, 220, 255)', 'stop-opacity': '0.08' }));
        const holoCoreGradient = createSvgElement('linearGradient', {
            id: 'holoCoreGradient',
            x1: '0%',
            y1: '0%',
            x2: '0%',
            y2: '100%'
        });
        holoCoreGradient.appendChild(createSvgElement('stop', { offset: '0%', 'stop-color': 'rgb(180, 220, 255)', 'stop-opacity': '0.1' }));
        holoCoreGradient.appendChild(createSvgElement('stop', { offset: '100%', 'stop-color': 'rgb(180, 220, 255)', 'stop-opacity': '0.2' }));
        const clipPath = createSvgElement('clipPath', { id: 'innerCircleClip' });
        clipPath.appendChild(createSvgElement('circle', { cx: centerX, cy: centerY, r: UI_CONFIG.INNER_CIRCLE_RADIUS }));
        defs.appendChild(gradient);
        defs.appendChild(holoCoreGradient);
        defs.appendChild(clipPath);
        svgElement.appendChild(defs);

        const rootGroup = createSvgElement('g', { 'aria-hidden': 'true' });

        const backgroundCircle = createSvgElement('circle', {
            cx: centerX,
            cy: centerY,
            r: UI_CONFIG.BACKGROUND_RADIUS,
            fill: 'url(#backgroundGradient)',
            stroke: UI_CONFIG.STROKE_COLOR,
            'stroke-width': '1',
            class: 'background-circle'
        }, { pointerEvents: 'none' });
        rootGroup.appendChild(backgroundCircle);
        uiLogger.log('Background circle initialized', { radius: UI_CONFIG.BACKGROUND_RADIUS });

        const segmentLogger = new window.ShimtiUtils.Logger('SegmentedRings');
        const ringConfigs = [
            UI_CONFIG.OUTER_SEGMENTED,
            UI_CONFIG.INNER_SEGMENTED,
            UI_CONFIG.MIDDLE_SEGMENTED
        ];
        ringConfigs.forEach((ringConfig, index) => {
            try {
                const segmentGroup = createSvgElement('g', { class: `segmented-ring ring-${index}` }, { transformOrigin: `${centerX}px ${centerY}px`, pointerEvents: 'none' });
                const segments = generateSegments(ringConfig);
                segments.forEach(segment => {
                    const { start, end } = segment;
                    const largeArc = end - start > 180 ? 1 : 0;
                    const outerStart = polarToCartesian(centerX, centerY, ringConfig.outer, start);
                    const outerEnd = polarToCartesian(centerX, centerY, ringConfig.outer, end);
                    const innerStart = polarToCartesian(centerX, centerY, ringConfig.inner, end);
                    const innerEnd = polarToCartesian(centerX, centerY, ringConfig.inner, start);
                    const pathData = `
                        M ${outerStart.x} ${outerStart.y}
                        A ${ringConfig.outer} ${ringConfig.outer} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}
                        L ${innerStart.x} ${innerStart.y}
                        A ${ringConfig.inner} ${ringConfig.inner} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}
                        Z
                    `;
                    const path = createSvgElement('path', { d: pathData, fill: 'rgba(180, 220, 255, 0.08)' }, { pointerEvents: 'none' });
                    segmentGroup.appendChild(path);
                });
                rootGroup.appendChild(segmentGroup);
                segmentLogger.log('Segmented ring initialized', { index, segmentCount: segments.length });
            } catch (error) {
                segmentLogger.error('Failed to initialize segmented ring', error);
            }
        });

        const ringLogger = new window.ShimtiUtils.Logger('RingsAndSquares');
        const ringGroup = createSvgElement('g');
        const outerD = `M${centerX + UI_CONFIG.STATIONARY_RING_OUTER},${centerY} A${UI_CONFIG.STATIONARY_RING_OUTER},${UI_CONFIG.STATIONARY_RING_OUTER} 0 1,0 ${centerX - UI_CONFIG.STATIONARY_RING_OUTER},${centerY} A${UI_CONFIG.STATIONARY_RING_OUTER},${UI_CONFIG.STATIONARY_RING_OUTER} 0 1,0 ${centerX + UI_CONFIG.STATIONARY_RING_OUTER},${centerY}`;
        const innerD = `M${centerX + UI_CONFIG.STATIONARY_RING_INNER},${centerY} A${UI_CONFIG.STATIONARY_RING_INNER},${UI_CONFIG.STATIONARY_RING_INNER} 0 1,1 ${centerX - UI_CONFIG.STATIONARY_RING_INNER},${centerY} A${UI_CONFIG.STATIONARY_RING_INNER},${UI_CONFIG.STATIONARY_RING_INNER} 0 1,1 ${centerX + UI_CONFIG.STATIONARY_RING_INNER},${centerY}`;
        const ring = createSvgElement('path', {
            d: `${outerD} ${innerD}`,
            fill: 'rgba(180, 220, 255, 0.08)',
            'fill-rule': 'evenodd',
            stroke: '#ffffff',
            'stroke-width': '2',
            class: 'stationary-ring'
        }, { pointerEvents: 'none' });
        ringGroup.appendChild(ring);

        const squareGroup = createSvgElement('g', { class: 'rotating-squares' }, { transformOrigin: `${centerX}px ${centerY}px` });
        for (let i = 0; i < UI_CONFIG.SQUARE_COUNT; i++) {
            const angle = (i / UI_CONFIG.SQUARE_COUNT) * 360;
            const posX = centerX + UI_CONFIG.SQUARE_RADIUS * Math.cos((angle * Math.PI) / 180);
            const posY = centerY + UI_CONFIG.SQUARE_RADIUS * Math.sin((angle * Math.PI) / 180);
            const square = createSvgElement('rect', {
                x: posX - UI_CONFIG.SQUARE_SIZE / 2,
                y: posY - UI_CONFIG.SQUARE_SIZE / 2,
                width: UI_CONFIG.SQUARE_SIZE,
                height: UI_CONFIG.SQUARE_SIZE,
                fill: 'rgba(180, 220, 255, 0.08)',
                class: 'rotating-square'
            }, { transformOrigin: `${posX}px ${posY}px`, pointerEvents: 'none' });
            squareGroup.appendChild(square);
        }
        ringGroup.appendChild(squareGroup);
        rootGroup.appendChild(ringGroup);
        ringLogger.log('Stationary ring and squares initialized');

        const dottedLogger = new window.ShimtiUtils.Logger('DottedCircle');
        const dottedCircle = createSvgElement('circle', {
            cx: centerX,
            cy: centerY,
            r: UI_CONFIG.DOTTED_RADIUS,
            fill: 'none',
            stroke: 'rgba(255, 255, 255, 0.3)',
            'stroke-width': '2',
            'stroke-dasharray': '4, 4',
            class: 'dotted-circle'
        }, { pointerEvents: 'none' });
        rootGroup.appendChild(dottedCircle);
        dottedLogger.log('Dotted circle initialized');

        const thickLogger = new window.ShimtiUtils.Logger('ThickCircle');
        const thickCircleGroup = createSvgElement('g');
        const thickOuterD = `M${centerX + UI_CONFIG.THICK_CIRCLE_OUTER},${centerY} A${UI_CONFIG.THICK_CIRCLE_OUTER},${UI_CONFIG.THICK_CIRCLE_OUTER} 0 1,0 ${centerX - UI_CONFIG.THICK_CIRCLE_OUTER},${centerY} A${UI_CONFIG.THICK_CIRCLE_OUTER},${UI_CONFIG.THICK_CIRCLE_OUTER} 0 1,0 ${centerX + UI_CONFIG.THICK_CIRCLE_OUTER},${centerY}`;
        const thickInnerD = `M${centerX + UI_CONFIG.THICK_CIRCLE_INNER},${centerY} A${UI_CONFIG.THICK_CIRCLE_INNER},${UI_CONFIG.THICK_CIRCLE_INNER} 0 1,1 ${centerX - UI_CONFIG.THICK_CIRCLE_INNER},${centerY} A${UI_CONFIG.THICK_CIRCLE_INNER},${UI_CONFIG.THICK_CIRCLE_INNER} 0 1,1 ${centerX + UI_CONFIG.THICK_CIRCLE_INNER},${centerY}`;
        const thickCircle = createSvgElement('path', {
            d: `${thickOuterD} ${thickInnerD}`,
            fill: 'rgba(180, 220, 255, 0.08)',
            'fill-rule': 'evenodd',
            class: 'thick-circle'
        }, { pointerEvents: 'none' });
        thickCircleGroup.appendChild(thickCircle);
        rootGroup.appendChild(thickCircleGroup);
        thickLogger.log('Thick circle initialized');

        const connectionLogger = new window.ShimtiUtils.Logger('ConnectionLines');
        const connectionGroup = createSvgElement('g');
        const titleRect = document.getElementById('shimtiPanel')?.getBoundingClientRect();
        const bottomPanelRect = document.getElementById('shimtiPanelBottom')?.getBoundingClientRect();
        if (titleRect) {
            const TITLE_PANEL_OFFSET = 0;
            const startPoint = { x: titleRect.right + TITLE_PANEL_OFFSET, y: titleRect.top + titleRect.height / 2 };
            const cornerPoint = { x: centerX, y: startPoint.y };
            const endPoint = { x: centerX, y: centerY - UI_CONFIG.OUTER_RADIUS };

            const horizontalLine = createSvgElement('line', {
                x1: startPoint.x,
                y1: startPoint.y,
                x2: cornerPoint.x,
                y2: cornerPoint.y,
                stroke: UI_CONFIG.CONNECTION_STROKE,
                'stroke-width': '2',
                class: 'connection-line top-horizontal'
            }, { pointerEvents: 'none' });
            connectionGroup.appendChild(horizontalLine);

            const verticalLine = createSvgElement('line', {
                x1: cornerPoint.x,
                y1: cornerPoint.y,
                x2: endPoint.x,
                y2: endPoint.y,
                stroke: UI_CONFIG.CONNECTION_STROKE,
                'stroke-width': '2',
                class: 'connection-line top-vertical'
            }, { pointerEvents: 'none' });
            connectionGroup.appendChild(verticalLine);

            const startCircle = createSvgElement('circle', {
                cx: startPoint.x,
                cy: startPoint.y,
                r: UI_CONFIG.CONNECTION_POINT_RADIUS,
                fill: 'none',
                stroke: '#ffffff',
                'stroke-width': '1',
                class: 'connection-point top-start'
            }, { pointerEvents: 'none' });
            connectionGroup.appendChild(startCircle);

            const endCircle = createSvgElement('circle', {
                cx: endPoint.x,
                cy: endPoint.y,
                r: UI_CONFIG.CONNECTION_POINT_RADIUS,
                fill: 'none',
                stroke: '#ffffff',
                'stroke-width': '1',
                class: 'connection-point top-end'
            }, { pointerEvents: 'none' });
            connectionGroup.appendChild(endCircle);
            connectionLogger.log('Top connection line initialized', { startX: startPoint.x, titleRight: titleRect.right, offset: TITLE_PANEL_OFFSET });
        } else {
            connectionLogger.warn('Missing shimtiPanel for top connection line');
        }

        if (bottomPanelRect) {
            const startPoint = { x: centerX, y: centerY + UI_CONFIG.OUTER_RADIUS };
            const endPoint = { x: bottomPanelRect.left + bottomPanelRect.width / 2, y: bottomPanelRect.top };
            const bendX = startPoint.x;
            const bendY = startPoint.y + (endPoint.y - startPoint.y) / 2;

            const path = createSvgElement('path', {
                d: `M ${startPoint.x} ${startPoint.y} Q ${bendX} ${bendY} ${endPoint.x} ${endPoint.y}`,
                fill: 'none',
                stroke: UI_CONFIG.CONNECTION_STROKE,
                'stroke-width': '2',
                class: 'connection-line bottom'
            }, { pointerEvents: 'none' });
            connectionGroup.appendChild(path);

            const startCircle = createSvgElement('circle', {
                cx: startPoint.x,
                cy: startPoint.y,
                r: UI_CONFIG.CONNECTION_POINT_RADIUS,
                fill: 'none',
                stroke: '#ffffff',
                'stroke-width': '1',
                class: 'connection-point bottom-start'
            }, { pointerEvents: 'none' });
            connectionGroup.appendChild(startCircle);

            const endCircle = createSvgElement('circle', {
                cx: endPoint.x,
                cy: endPoint.y,
                r: UI_CONFIG.CONNECTION_POINT_RADIUS,
                fill: 'none',
                stroke: '#ffffff',
                'stroke-width': '1',
                class: 'connection-point bottom-end'
            }, { pointerEvents: 'none' });
            connectionGroup.appendChild(endCircle);
            connectionLogger.log('Bottom connection line initialized');
        } else {
            connectionLogger.warn('Missing shimtiPanelBottom for bottom connection line');
        }
        rootGroup.appendChild(connectionGroup);

        const menuLogger = new window.ShimtiUtils.Logger('RadialMenu');
        const menuWheel = createSvgElement('g', { id: 'wheelMenu' });
        const sectorAngle = 360 / UI_CONFIG.NAVIGATION_LINKS.length;
        const sectorPositions = UI_CONFIG.NAVIGATION_LINKS.map((_, i) => {
            const start = 270 + i * sectorAngle;
            const end = start + sectorAngle;
            const labelAngle = (start + end) / 2;
            return {
                p1: polarToCartesian(centerX, centerY, UI_CONFIG.OUTER_RADIUS, end),
                p2: polarToCartesian(centerX, centerY, UI_CONFIG.OUTER_RADIUS, start),
                p3: polarToCartesian(centerX, centerY, UI_CONFIG.INNER_RADIUS, start),
                p4: polarToCartesian(centerX, centerY, UI_CONFIG.INNER_RADIUS, end),
                iconPos: polarToCartesian(centerX, centerY, (UI_CONFIG.INNER_RADIUS + UI_CONFIG.OUTER_RADIUS) / 2, labelAngle),
                start,
                end
            };
        });

        const welcomeText = document.getElementById('welcomeText');
        if (!welcomeText) {
            throw new Error('welcomeText element not found');
        }
        const carouselState = { isHovering: false, timeoutId: null, currentIndex: 0, languages: UI_CONFIG.FALLBACK_LANGUAGES };
        const fragment = document.createDocumentFragment();
        sectorPositions.forEach((pos, i) => {
            createNavigationSector(pos, UI_CONFIG.NAVIGATION_LINKS[i], UI_CONFIG.SECTOR_FILL, fragment, centerX, centerY);
        });
        menuWheel.appendChild(fragment);
        menuLogger.log('Appended sectors', { count: sectorPositions.length, sectors: Array.from(menuWheel.querySelectorAll('g')).map(g => g.getAttribute('id')) }, true);

        menuWheel.addEventListener('click', event => {
            try {
                const sector = event.target.closest('g');
                if (sector) {
                    const label = sector.dataset.label;
                    window.location.href = `#${label.toLowerCase()}`;
                    menuLogger.log('Sector clicked', { label }, true);
                }
            } catch (error) {
                menuLogger.error('Sector click failed', error);
            }
        });

        const gridOverlay = createSvgElement('g', { 'clip-path': 'url(#innerCircleClip)' });
        for (let x = -UI_CONFIG.INNER_RADIUS; x <= UI_CONFIG.INNER_RADIUS; x += UI_CONFIG.GRID_SPACING) {
            const line = createSvgElement('line', {
                x1: centerX + x,
                y1: centerY - UI_CONFIG.INNER_RADIUS,
                x2: centerX + x,
                y2: centerY + UI_CONFIG.INNER_RADIUS,
                stroke: UI_CONFIG.STROKE_COLOR,
                'stroke-width': '1'
            }, { pointerEvents: 'none' });
            gridOverlay.appendChild(line);
        }
        for (let y = -UI_CONFIG.INNER_RADIUS; y <= UI_CONFIG.INNER_RADIUS; y += UI_CONFIG.GRID_SPACING) {
            const line = createSvgElement('line', {
                x1: centerX - UI_CONFIG.INNER_RADIUS,
                y1: centerY + y,
                x2: centerX + UI_CONFIG.INNER_RADIUS,
                y2: centerY + y,
                stroke: UI_CONFIG.STROKE_COLOR,
                'stroke-width': '1'
            }, { pointerEvents: 'none' });
            gridOverlay.appendChild(line);
        }

        const gridCenters = [];
        for (let x = -UI_CONFIG.INNER_RADIUS; x <= UI_CONFIG.INNER_RADIUS; x += UI_CONFIG.GRID_SPACING) {
            for (let y = -UI_CONFIG.INNER_RADIUS; y <= UI_CONFIG.INNER_RADIUS; y += UI_CONFIG.GRID_SPACING) {
                const distance = Math.sqrt(x * x + y * y);
                if (distance <= UI_CONFIG.INNER_CIRCLE_RADIUS) {
                    gridCenters.push({ x: centerX + x, y: centerY + y });
                }
            }
        }
        const particleCount = UI_CONFIG.PARTICLE_COUNT_MIN + Math.floor(Math.random() * (UI_CONFIG.PARTICLE_COUNT_MAX - UI_CONFIG.PARTICLE_COUNT_MIN));
        const selectedCenters = gridCenters.sort(() => Math.random() - 0.5).slice(0, particleCount);
        const particles = selectedCenters.map(center => new GridParticle(center.x, center.y, gridOverlay));
        animateParticles(particles);
        menuWheel.appendChild(gridOverlay);
        menuLogger.log('Grid and particles appended', { particleCount });

        const centerCircle = createSvgElement('circle', {
            cx: centerX,
            cy: centerY,
            r: UI_CONFIG.INNER_CIRCLE_RADIUS,
            fill: 'none',
            stroke: UI_CONFIG.STROKE_COLOR,
            'stroke-width': '1'
        }, { pointerEvents: 'none' });
        menuWheel.appendChild(centerCircle);

        const innerFilledCircle = createSvgElement('circle', {
            cx: centerX,
            cy: centerY,
            r: UI_CONFIG.INNER_FILLED_RADIUS,
            fill: 'rgba(180, 220, 255, 0.06)',
            class: 'inner-filled-circle'
        }, { pointerEvents: 'none' });
        menuWheel.appendChild(innerFilledCircle);

        const holoCoreGroup = createSvgElement('g', { 'aria-hidden': 'true' });
        const holoCore = createSvgElement('circle', {
            cx: centerX,
            cy: centerY,
            r: UI_CONFIG.CORE_RADIUS,
            fill: 'rgba(234, 255, 255, 0.9)',
            class: 'holo-core'
        }, { pointerEvents: 'none' });
        holoCoreGroup.appendChild(holoCore);

        UI_CONFIG.RING_RADII.forEach((r, i) => {
            const ring = createSvgElement('circle', {
                cx: centerX,
                cy: centerY,
                r: r,
                fill: 'url(#holoCoreGradient)',
                class: `holo-ring ring-${i}`
            }, { pointerEvents: 'none' });
            holoCoreGroup.appendChild(ring);
        });
        menuWheel.appendChild(holoCoreGroup);
        rootGroup.appendChild(menuWheel);
        svgElement.appendChild(rootGroup);

        setTimeout(() => initWelcomeCarousel(svgElement, menuWheel, canvas, ctx, carouselState, sectorPositions, centerX, centerY), 1000);

        const updatePositions = debounce(() => {
            try {
                svgElement.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                const newWheelRect = document.getElementById('radialMenu')?.getBoundingClientRect();
                if (!newWheelRect) {
                    throw new Error('Radial menu missing during resize');
                }

                const newCenterX = window.innerWidth / 2;
                const newCenterY = window.innerHeight / 2;

                svgElement.innerHTML = '';
                const newDefs = createSvgElement('defs');
                const newGradient = createSvgElement('radialGradient', {
                    id: 'backgroundGradient',
                    cx: '50%',
                    cy: '50%',
                    r: '50%',
                    fx: '50%',
                    fy: '50%'
                });
                newGradient.appendChild(createSvgElement('stop', { offset: '0%', 'stop-color': 'rgb(180, 220, 255)', 'stop-opacity': '0.0' }));
                newGradient.appendChild(createSvgElement('stop', { offset: '80%', 'stop-color': 'rgb(180, 220, 255)', 'stop-opacity': '0.08' }));
                const newHoloCoreGradient = createSvgElement('linearGradient', {
                    id: 'holoCoreGradient',
                    x1: '0%',
                    y1: '0%',
                    x2: '0%',
                    y2: '100%'
                });
                newHoloCoreGradient.appendChild(createSvgElement('stop', { offset: '0%', 'stop-color': 'rgb(180, 220, 255)', 'stop-opacity': '0.1' }));
                newHoloCoreGradient.appendChild(createSvgElement('stop', { offset: '100%', 'stop-color': 'rgb(180, 220, 255)', 'stop-opacity': '0.2' }));
                const newClipPath = createSvgElement('clipPath', { id: 'innerCircleClip' });
                newClipPath.appendChild(createSvgElement('circle', { cx: newCenterX, cy: newCenterY, r: UI_CONFIG.INNER_CIRCLE_RADIUS }));
                newDefs.appendChild(newGradient);
                newDefs.appendChild(newHoloCoreGradient);
                newDefs.appendChild(newClipPath);
                svgElement.appendChild(newDefs);

                const newRootGroup = createSvgElement('g', { 'aria-hidden': 'true' });

                const newBackgroundCircle = createSvgElement('circle', {
                    cx: newCenterX,
                    cy: newCenterY,
                    r: UI_CONFIG.BACKGROUND_RADIUS,
                    fill: 'url(#backgroundGradient)',
                    stroke: UI_CONFIG.STROKE_COLOR,
                    'stroke-width': '1',
                    class: 'background-circle'
                }, { pointerEvents: 'none' });
                newRootGroup.appendChild(newBackgroundCircle);
                uiLogger.log('Background circle resized', { radius: UI_CONFIG.BACKGROUND_RADIUS });

                const segmentLogger = new window.ShimtiUtils.Logger('SegmentedRings');
                const ringConfigs = [
                    UI_CONFIG.OUTER_SEGMENTED,
                    UI_CONFIG.INNER_SEGMENTED,
                    UI_CONFIG.MIDDLE_SEGMENTED
                ];
                ringConfigs.forEach((ringConfig, index) => {
                    try {
                        const segmentGroup = createSvgElement('g', { class: `segmented-ring ring-${index}` }, { transformOrigin: `${newCenterX}px ${newCenterY}px`, pointerEvents: 'none' });
                        const segments = generateSegments(ringConfig);
                        segments.forEach(segment => {
                            const { start, end } = segment;
                            const largeArc = end - start > 180 ? 1 : 0;
                            const outerStart = polarToCartesian(newCenterX, newCenterY, ringConfig.outer, start);
                            const outerEnd = polarToCartesian(newCenterX, newCenterY, ringConfig.outer, end);
                            const innerStart = polarToCartesian(newCenterX, newCenterY, ringConfig.inner, end);
                            const innerEnd = polarToCartesian(newCenterX, newCenterY, ringConfig.inner, start);
                            const pathData = `
                                M ${outerStart.x} ${outerStart.y}
                                A ${ringConfig.outer} ${ringConfig.outer} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}
                                L ${innerStart.x} ${innerStart.y}
                                A ${ringConfig.inner} ${ringConfig.inner} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}
                                Z
                            `;
                            const path = createSvgElement('path', { d: pathData, fill: 'rgba(180, 220, 255, 0.08)' }, { pointerEvents: 'none' });
                            segmentGroup.appendChild(path);
                        });
                        newRootGroup.appendChild(segmentGroup);
                        segmentLogger.log('Segmented ring resized', { index, segmentCount: segments.length });
                    } catch (error) {
                        segmentLogger.error('Failed to resize segmented ring', error);
                    }
                });

                const ringLogger = new window.ShimtiUtils.Logger('RingsAndSquares');
                const newRingGroup = createSvgElement('g');
                const newOuterD = `M${newCenterX + UI_CONFIG.STATIONARY_RING_OUTER},${newCenterY} A${UI_CONFIG.STATIONARY_RING_OUTER},${UI_CONFIG.STATIONARY_RING_OUTER} 0 1,0 ${newCenterX - UI_CONFIG.STATIONARY_RING_OUTER},${newCenterY} A${UI_CONFIG.STATIONARY_RING_OUTER},${UI_CONFIG.STATIONARY_RING_OUTER} 0 1,0 ${newCenterX + UI_CONFIG.STATIONARY_RING_OUTER},${newCenterY}`;
                const newInnerD = `M${newCenterX + UI_CONFIG.STATIONARY_RING_INNER},${newCenterY} A${UI_CONFIG.STATIONARY_RING_INNER},${UI_CONFIG.STATIONARY_RING_INNER} 0 1,1 ${newCenterX - UI_CONFIG.STATIONARY_RING_INNER},${newCenterY} A${UI_CONFIG.STATIONARY_RING_INNER},${UI_CONFIG.STATIONARY_RING_INNER} 0 1,1 ${newCenterX + UI_CONFIG.STATIONARY_RING_INNER},${newCenterY}`;
                const newRing = createSvgElement('path', {
                    d: `${newOuterD} ${newInnerD}`,
                    fill: 'rgba(180, 220, 255, 0.08)',
                    'fill-rule': 'evenodd',
                    stroke: '#ffffff',
                    'stroke-width': '2',
                    class: 'stationary-ring'
                }, { pointerEvents: 'none' });
                newRingGroup.appendChild(newRing);

                const newSquareGroup = createSvgElement('g', { class: 'rotating-squares' }, { transformOrigin: `${newCenterX}px ${newCenterY}px` });
                for (let i = 0; i < UI_CONFIG.SQUARE_COUNT; i++) {
                    const angle = (i / UI_CONFIG.SQUARE_COUNT) * 360;
                    const posX = newCenterX + UI_CONFIG.SQUARE_RADIUS * Math.cos((angle * Math.PI) / 180);
                    const posY = newCenterY + UI_CONFIG.SQUARE_RADIUS * Math.sin((angle * Math.PI) / 180);
                    const square = createSvgElement('rect', {
                        x: posX - UI_CONFIG.SQUARE_SIZE / 2,
                        y: posY - UI_CONFIG.SQUARE_SIZE / 2,
                        width: UI_CONFIG.SQUARE_SIZE,
                        height: UI_CONFIG.SQUARE_SIZE,
                        fill: 'rgba(180, 220, 255, 0.08)',
                        class: 'rotating-square'
                    }, { transformOrigin: `${posX}px ${posY}px`, pointerEvents: 'none' });
                    newSquareGroup.appendChild(square);
                }
                newRingGroup.appendChild(newSquareGroup);
                newRootGroup.appendChild(newRingGroup);

                const dottedLogger = new window.ShimtiUtils.Logger('DottedCircle');
                const newDottedCircle = createSvgElement('circle', {
                    cx: newCenterX,
                    cy: newCenterY,
                    r: UI_CONFIG.DOTTED_RADIUS,
                    fill: 'none',
                    stroke: 'rgba(255, 255, 255, 0.3)',
                    'stroke-width': '2',
                    'stroke-dasharray': '4, 4',
                    class: 'dotted-circle'
                }, { pointerEvents: 'none' });
                newRootGroup.appendChild(newDottedCircle);

                const thickLogger = new window.ShimtiUtils.Logger('ThickCircle');
                const newThickCircleGroup = createSvgElement('g');
                const newThickOuterD = `M${newCenterX + UI_CONFIG.THICK_CIRCLE_OUTER},${newCenterY} A${UI_CONFIG.THICK_CIRCLE_OUTER},${UI_CONFIG.THICK_CIRCLE_OUTER} 0 1,0 ${newCenterX - UI_CONFIG.THICK_CIRCLE_OUTER},${newCenterY} A${UI_CONFIG.THICK_CIRCLE_OUTER},${UI_CONFIG.THICK_CIRCLE_OUTER} 0 1,0 ${newCenterX + UI_CONFIG.THICK_CIRCLE_OUTER},${newCenterY}`;
                const newThickInnerD = `M${newCenterX + UI_CONFIG.THICK_CIRCLE_INNER},${newCenterY} A${UI_CONFIG.THICK_CIRCLE_INNER},${UI_CONFIG.THICK_CIRCLE_INNER} 0 1,1 ${newCenterX - UI_CONFIG.THICK_CIRCLE_INNER},${newCenterY} A${UI_CONFIG.THICK_CIRCLE_INNER},${UI_CONFIG.THICK_CIRCLE_INNER} 0 1,1 ${newCenterX + UI_CONFIG.THICK_CIRCLE_INNER},${newCenterY}`;
                const newThickCircle = createSvgElement('path', {
                    d: `${newThickOuterD} ${newThickInnerD}`,
                    fill: 'rgba(180, 220, 255, 0.08)',
                    'fill-rule': 'evenodd',
                    class: 'thick-circle'
                }, { pointerEvents: 'none' });
                newThickCircleGroup.appendChild(newThickCircle);
                newRootGroup.appendChild(newThickCircleGroup);

                const connectionLogger = new window.ShimtiUtils.Logger('ConnectionLines');
                const newConnectionGroup = createSvgElement('g');
                const newTitleRect = document.getElementById('shimtiPanel')?.getBoundingClientRect();
                const newBottomPanelRect = document.getElementById('shimtiPanelBottom')?.getBoundingClientRect();
                if (newTitleRect) {
                    const TITLE_PANEL_OFFSET = 0;
                    const startPoint = { x: newTitleRect.right + TITLE_PANEL_OFFSET, y: newTitleRect.top + newTitleRect.height / 2 };
                    const cornerPoint = { x: newCenterX, y: startPoint.y };
                    const endPoint = { x: newCenterX, y: newCenterY - UI_CONFIG.OUTER_RADIUS };

                    const horizontalLine = createSvgElement('line', {
                        x1: startPoint.x,
                        y1: startPoint.y,
                        x2: cornerPoint.x,
                        y2: cornerPoint.y,
                        stroke: UI_CONFIG.CONNECTION_STROKE,
                        'stroke-width': '2',
                        class: 'connection-line top-horizontal'
                    }, { pointerEvents: 'none' });
                    newConnectionGroup.appendChild(horizontalLine);

                    const verticalLine = createSvgElement('line', {
                        x1: cornerPoint.x,
                        y1: cornerPoint.y,
                        x2: endPoint.x,
                        y2: endPoint.y,
                        stroke: UI_CONFIG.CONNECTION_STROKE,
                        'stroke-width': '2',
                        class: 'connection-line top-vertical'
                    }, { pointerEvents: 'none' });
                    newConnectionGroup.appendChild(verticalLine);

                    const startCircle = createSvgElement('circle', {
                        cx: startPoint.x,
                        cy: startPoint.y,
                        r: UI_CONFIG.CONNECTION_POINT_RADIUS,
                        fill: 'none',
                        stroke: '#ffffff',
                        'stroke-width': '1',
                        class: 'connection-point top-start'
                    }, { pointerEvents: 'none' });
                    newConnectionGroup.appendChild(startCircle);

                    const endCircle = createSvgElement('circle', {
                        cx: endPoint.x,
                        cy: endPoint.y,
                        r: UI_CONFIG.CONNECTION_POINT_RADIUS,
                        fill: 'none',
                        stroke: '#ffffff',
                        'stroke-width': '1',
                        class: 'connection-point top-end'
                    }, { pointerEvents: 'none' });
                    newConnectionGroup.appendChild(endCircle);
                    connectionLogger.log('Top connection line resized', { startX: startPoint.x, titleRight: newTitleRect.right, offset: TITLE_PANEL_OFFSET });
                }

                if (newBottomPanelRect) {
                    const startPoint = { x: newCenterX, y: newCenterY + UI_CONFIG.OUTER_RADIUS };
                    const endPoint = { x: newBottomPanelRect.left + newBottomPanelRect.width / 2, y: newBottomPanelRect.top };
                    const bendX = startPoint.x;
                    const bendY = startPoint.y + (endPoint.y - startPoint.y) / 2;

                    const path = createSvgElement('path', {
                        d: `M ${startPoint.x} ${startPoint.y} Q ${bendX} ${bendY} ${endPoint.x} ${endPoint.y}`,
                        fill: 'none',
                        stroke: UI_CONFIG.CONNECTION_STROKE,
                        'stroke-width': '2',
                        class: 'connection-line bottom'
                    }, { pointerEvents: 'none' });
                    newConnectionGroup.appendChild(path);

                    const startCircle = createSvgElement('circle', {
                        cx: startPoint.x,
                        cy: startPoint.y,
                        r: UI_CONFIG.CONNECTION_POINT_RADIUS,
                        fill: 'none',
                        stroke: '#ffffff',
                        'stroke-width': '1',
                        class: 'connection-point bottom-start'
                    }, { pointerEvents: 'none' });
                    newConnectionGroup.appendChild(startCircle);

                    const endCircle = createSvgElement('circle', {
                        cx: endPoint.x,
                        cy: endPoint.y,
                        r: UI_CONFIG.CONNECTION_POINT_RADIUS,
                        fill: 'none',
                        stroke: '#ffffff',
                        'stroke-width': '1',
                        class: 'connection-point bottom-end'
                    }, { pointerEvents: 'none' });
                    newConnectionGroup.appendChild(endCircle);
                }
                newRootGroup.appendChild(newConnectionGroup);

                const newMenuWheel = createSvgElement('g', { id: 'wheelMenu' });
                const newSectorPositions = UI_CONFIG.NAVIGATION_LINKS.map((_, i) => {
                    const start = 270 + i * sectorAngle;
                    const end = start + sectorAngle;
                    const labelAngle = (start + end) / 2;
                    return {
                        p1: polarToCartesian(newCenterX, newCenterY, UI_CONFIG.OUTER_RADIUS, end),
                        p2: polarToCartesian(newCenterX, newCenterY, UI_CONFIG.OUTER_RADIUS, start),
                        p3: polarToCartesian(newCenterX, newCenterY, UI_CONFIG.INNER_RADIUS, start),
                        p4: polarToCartesian(newCenterX, newCenterY, UI_CONFIG.INNER_RADIUS, end),
                        iconPos: polarToCartesian(newCenterX, newCenterY, (UI_CONFIG.INNER_RADIUS + UI_CONFIG.OUTER_RADIUS) / 2, labelAngle),
                        start,
                        end
                    };
                });
                const newFragment = document.createDocumentFragment();
                newSectorPositions.forEach((pos, i) => {
                    createNavigationSector(pos, UI_CONFIG.NAVIGATION_LINKS[i], UI_CONFIG.SECTOR_FILL, newFragment, newCenterX, newCenterY);
                });
                newMenuWheel.appendChild(newFragment);
                menuLogger.log('Appended sectors on resize', { count: newSectorPositions.length, sectors: Array.from(newMenuWheel.querySelectorAll('g')).map(g => g.getAttribute('id')) }, true);

                newMenuWheel.addEventListener('click', menuWheel.onclick);
                const newGridOverlay = createSvgElement('g', { 'clip-path': 'url(#innerCircleClip)' });
                for (let x = -UI_CONFIG.INNER_RADIUS; x <= UI_CONFIG.INNER_RADIUS; x += UI_CONFIG.GRID_SPACING) {
                    const line = createSvgElement('line', {
                        x1: newCenterX + x,
                        y1: newCenterY - UI_CONFIG.INNER_RADIUS,
                        x2: newCenterX + x,
                        y2: newCenterY + UI_CONFIG.INNER_RADIUS,
                        stroke: UI_CONFIG.STROKE_COLOR,
                        'stroke-width': '1'
                    }, { pointerEvents: 'none' });
                    newGridOverlay.appendChild(line);
                }
                for (let y = -UI_CONFIG.INNER_RADIUS; y <= UI_CONFIG.INNER_RADIUS; y += UI_CONFIG.GRID_SPACING) {
                    const line = createSvgElement('line', {
                        x1: newCenterX - UI_CONFIG.INNER_RADIUS,
                        y1: newCenterY + y,
                        x2: newCenterX + UI_CONFIG.INNER_RADIUS,
                        y2: newCenterY + y,
                        stroke: UI_CONFIG.STROKE_COLOR,
                        'stroke-width': '1'
                    }, { pointerEvents: 'none' });
                    newGridOverlay.appendChild(line);
                }
                const newGridCenters = [];
                for (let x = -UI_CONFIG.INNER_RADIUS; x <= UI_CONFIG.INNER_RADIUS; x += UI_CONFIG.GRID_SPACING) {
                    for (let y = -UI_CONFIG.INNER_RADIUS; y <= UI_CONFIG.INNER_RADIUS; y += UI_CONFIG.GRID_SPACING) {
                        const distance = Math.sqrt(x * x + y * y);
                        if (distance <= UI_CONFIG.INNER_CIRCLE_RADIUS) {
                            newGridCenters.push({ x: newCenterX + x, y: newCenterY + y });
                        }
                    }
                }
                const newSelectedCenters = newGridCenters.sort(() => Math.random() - 0.5).slice(0, particleCount);
                const newParticles = newSelectedCenters.map(center => new GridParticle(center.x, center.y, newGridOverlay));
                animateParticles(newParticles);
                newMenuWheel.appendChild(newGridOverlay);

                const newCenterCircle = createSvgElement('circle', {
                    cx: newCenterX,
                    cy: newCenterY,
                    r: UI_CONFIG.INNER_CIRCLE_RADIUS,
                    fill: 'none',
                    stroke: UI_CONFIG.STROKE_COLOR,
                    'stroke-width': '1'
                }, { pointerEvents: 'none' });
                newMenuWheel.appendChild(newCenterCircle);

                const newInnerFilledCircle = createSvgElement('circle', {
                    cx: newCenterX,
                    cy: newCenterY,
                    r: UI_CONFIG.INNER_FILLED_RADIUS,
                    fill: 'rgba(180, 220, 255, 0.06)',
                    class: 'inner-filled-circle'
                }, { pointerEvents: 'none' });
                newMenuWheel.appendChild(newInnerFilledCircle);

                const newHoloCoreGroup = createSvgElement('g', { 'aria-hidden': 'true' });
                const newHoloCore = createSvgElement('circle', {
                    cx: newCenterX,
                    cy: newCenterY,
                    r: UI_CONFIG.CORE_RADIUS,
                    fill: 'rgba(234, 255, 255, 0.9)',
                    class: 'holo-core'
                }, { pointerEvents: 'none' });
                newHoloCoreGroup.appendChild(newHoloCore);

                UI_CONFIG.RING_RADII.forEach((r, i) => {
                    const ring = createSvgElement('circle', {
                        cx: newCenterX,
                        cy: newCenterY,
                        r: r,
                        fill: 'url(#holoCoreGradient)',
                        class: `holo-ring ring-${i}`
                    }, { pointerEvents: 'none' });
                    newHoloCoreGroup.appendChild(ring);
                });
                newMenuWheel.appendChild(newHoloCoreGroup);
                newRootGroup.appendChild(newMenuWheel);

                svgElement.appendChild(newRootGroup);
                hitAreasDrawn = false;
                setTimeout(() => initWelcomeCarousel(svgElement, newMenuWheel, canvas, ctx, carouselState, newSectorPositions, newCenterX, newCenterY), 1000);
                uiLogger.log('Resized UI elements', { duration: performance.now() - startTime });
            } catch (error) {
                uiLogger.error('Resize failed', error);
            }
        }, 100);

        window.addEventListener('resize', updatePositions);
        uiLogger.log('UI elements initialized', { duration: performance.now() - startTime });
    } catch (error) {
        uiLogger.error('Failed to initialize UI elements', error);
    }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(initUIElements, 1000));