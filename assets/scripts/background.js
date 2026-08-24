/**
 * @module Background
 * @description Manages background grid and particle animations for Shimti Multimedia’s sci-fi UI.
 * Renders a grid and neural-like particles with trails in a single canvas, optimized for 30 FPS and
 * Brave browser compatibility. Uses shared ShimtiUtils.Logger for error logging and debugging.
 * @requires Canvas element with id 'backgroundCanvas'
 * @requires window.ShimtiUtils.Logger from ui-elements.js
 * @requires Browser support for devicePixelRatio and requestAnimationFrame
 */

/** @constant {Object} BACKGROUND_CONFIG - Configuration for grid and particle animations */
const BACKGROUND_CONFIG = {
    GRID_SPACING: 80, // Grid line spacing in pixels, chosen for sci-fi grid aesthetic
    GRID_STROKE: 'rgba(100, 150, 255, 0.1)', // Semi-transparent blue for subtle grid lines
    MAX_PARTICLES: 30, // Maximum particles, balanced for performance and visual density
    TURN_PROBABILITY: 0.01, // Probability of particle direction change per frame
    DIRECTION_ANGLES: [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2], // Cardinal angles (radians) for movement
    STROKE_COLOR: 'rgba(180, 220, 255, {alpha})', // Particle trail color with dynamic alpha
    SHADOW_COLOR: '#8cf', // Cyan shadow for particle glow effect
    FILL_COLOR: 'rgba(234, 255, 255, {depth})', // Particle fill color with depth-based opacity
    TARGET_FPS: 30 // Target frames per second for animation
};

/** @type {window.ShimtiUtils.Logger} Logger instance for background module */
const bgLogger = new window.ShimtiUtils.Logger('Background');

/**
 * @class Particle
 * @description Represents a single particle with position, trail, and rendering logic
 */
class Particle {
    /**
     * @param {number} depth - Visual depth (0.3 to 1.0) for scaling speed and size
     * @param {number} id - Unique particle identifier
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    constructor(depth, id, width, height) {
        this.id = id;
        this.depth = depth;
        this.width = width;
        this.height = height;
        try {
            this.reset();
            bgLogger.log('Particle initialized', { id, depth });
        } catch (error) {
            bgLogger.error('Failed to initialize particle', error, { id, depth });
        }
    }

    /**
     * @method reset
     * @description Initializes or resets particle properties to random values
     */
    reset() {
        try {
            if (!this.width || !this.height) {
                throw new Error('Invalid canvas dimensions');
            }
            this.x = Math.random() * this.width;
            this.y = Math.random() * this.height;
            this.setRandomDirection();
            this.baseSpeed = (0.5 + Math.random() * (Math.random() < 0.2 ? 4.0 : 1.2)) * this.depth; // Random speed with occasional bursts
            this.speed = this.baseSpeed;
            this.size = (0.5 + Math.random() * 1.2) * this.depth; // Size scaled by depth
            this.trail = [];
            this.maxTrailLength = Math.floor(Math.random() * 20) + 2; // Random trail length
            this.fadeCounter = 0;
            this.fadeLimit = Math.random() * 400 + 100; // Random fade duration
            bgLogger.log('Particle reset', { id: this.id, x: this.x, y: this.y });
        } catch (error) {
            bgLogger.error('Particle reset failed', error, { id: this.id });
        }
    }

    /**
     * @method setRandomDirection
     * @description Sets a random cardinal direction for particle movement
     */
    setRandomDirection() {
        try {
            this.angle = BACKGROUND_CONFIG.DIRECTION_ANGLES[Math.floor(Math.random() * BACKGROUND_CONFIG.DIRECTION_ANGLES.length)];
        } catch (error) {
            bgLogger.error('Failed to set particle direction', error, { id: this.id });
        }
    }

    /**
     * @method maybeTurn
     * @description Randomly changes direction based on TURN_PROBABILITY
     */
    maybeTurn() {
        try {
            if (Math.random() < BACKGROUND_CONFIG.TURN_PROBABILITY) {
                const directionIndex = BACKGROUND_CONFIG.DIRECTION_ANGLES.indexOf(this.angle);
                const turn = Math.random() < 0.5 ? -1 : 1;
                const newIndex = (directionIndex + turn + BACKGROUND_CONFIG.DIRECTION_ANGLES.length) % BACKGROUND_CONFIG.DIRECTION_ANGLES.length;
                this.angle = BACKGROUND_CONFIG.DIRECTION_ANGLES[newIndex];
                bgLogger.log('Particle turned', { id: this.id, newAngle: this.angle });
            }
        } catch (error) {
            bgLogger.error('Particle turn failed', error, { id: this.id });
        }
    }

    /**
     * @method update
     * @description Updates particle position and trail, resetting if off-screen or faded
     */
    update() {
        try {
            this.maybeTurn();
            this.trail.push({ x: this.x, y: this.y });
            if (this.trail.length > this.maxTrailLength) {
                this.trail.shift();
            }
            this.x += Math.cos(this.angle) * this.speed;
            this.y += Math.sin(this.angle) * this.speed;

            this.fadeCounter++;
            if (
                this.fadeCounter > this.fadeLimit ||
                this.x < -50 ||
                this.x > this.width + 50 ||
                this.y < -50 ||
                this.y > this.height + 50
            ) {
                this.reset();
            }
        } catch (error) {
            bgLogger.error('Particle update failed', error, { id: this.id });
        }
    }

    /**
     * @method draw
     * @description Renders particle trail and dot on the canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
     */
    draw(ctx) {
        try {
            // Draw trail
            for (let i = 0; i < this.trail.length - 1; i++) {
                const p1 = this.trail[i];
                const p2 = this.trail[i + 1];
                const alpha = (i / this.trail.length) * this.depth * 0.3;
                ctx.strokeStyle = BACKGROUND_CONFIG.STROKE_COLOR.replace('{alpha}', alpha);
                ctx.lineWidth = 0.5 * this.depth;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }

            // Draw particle
            ctx.shadowBlur = 1.5 * this.depth;
            ctx.shadowColor = BACKGROUND_CONFIG.SHADOW_COLOR;
            ctx.fillStyle = BACKGROUND_CONFIG.FILL_COLOR.replace('{depth}', this.depth);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        } catch (error) {
            bgLogger.error('Particle draw failed', error, { id: this.id });
        }
    }
}

/**
 * @function debounce
 * @description Limits the rate of function execution to prevent performance issues
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * @function initBackground
 * @description Initializes and renders the background grid and particle animations
 */
function initBackground() {
    const startTime = performance.now();
    try {
        const canvas = document.getElementById('backgroundCanvas');
        if (!canvas) {
            throw new Error('Background canvas element not found');
        }

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) {
            throw new Error('Failed to get canvas context');
        }

        let width = window.innerWidth;
        let height = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = width * dpr;
        offscreenCanvas.height = height * dpr;
        const offscreenCtx = offscreenCanvas.getContext('2d', { alpha: true });
        if (!offscreenCtx) {
            throw new Error('Failed to get offscreen canvas context');
        }
        offscreenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const particles = [];
        let particleId = 0;
        for (let depth = 0.3; depth <= 1.0; depth += 0.2) {
            const count = Math.floor(BACKGROUND_CONFIG.MAX_PARTICLES * depth);
            for (let i = 0; i < count; i++) {
                particles.push(new Particle(depth, particleId, width, height));
                particleId++;
            }
        }
        bgLogger.log('Initialized particles', { count: particles.length });

        /**
         * @function drawGrid
         * @description Draws grid lines on the offscreen canvas
         */
        function drawGrid() {
            try {
                offscreenCtx.clearRect(0, 0, width, height);
                offscreenCtx.strokeStyle = BACKGROUND_CONFIG.GRID_STROKE;
                offscreenCtx.lineWidth = 1;

                for (let x = 0; x < width; x += BACKGROUND_CONFIG.GRID_SPACING) {
                    offscreenCtx.beginPath();
                    offscreenCtx.moveTo(x, 0);
                    offscreenCtx.lineTo(x, height);
                    offscreenCtx.stroke();
                }
                for (let y = 0; y < height; y += BACKGROUND_CONFIG.GRID_SPACING) {
                    offscreenCtx.beginPath();
                    offscreenCtx.moveTo(0, y);
                    offscreenCtx.lineTo(width, y);
                    offscreenCtx.stroke();
                }
                bgLogger.log('Grid drawn', { width, height });
            } catch (error) {
                bgLogger.error('Failed to draw grid', error);
            }
        }

        let lastTime = performance.now();
        let frameCount = 0;
        let lastFpsTime = lastTime;

        /**
         * @function animate
         * @description Updates and renders particles, maintaining target FPS
         */
        function animate() {
            try {
                const now = performance.now();
                const delta = now - lastTime;
                const frameInterval = 1000 / BACKGROUND_CONFIG.TARGET_FPS;

                if (delta >= frameInterval) {
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(offscreenCanvas, 0, 0); // Draw grid
                    particles.forEach(particle => {
                        particle.update();
                        particle.draw(ctx);
                    });
                    lastTime = now - (delta % frameInterval);

                    // Log FPS every second
                    frameCount++;
                    if (now - lastFpsTime >= 1000) {
                        const fps = frameCount * 1000 / (now - lastFpsTime);
                        bgLogger.log('Animation FPS', { fps });
                        frameCount = 0;
                        lastFpsTime = now;
                    }
                }

                requestAnimationFrame(animate);
            } catch (error) {
                bgLogger.error('Animation loop failed', error);
            }
        }

        drawGrid();
        animate();

        /**
         * @function updateCanvas
         * @description Updates canvas dimensions and particle positions on resize
         */
        const updateCanvas = debounce(() => {
            try {
                width = window.innerWidth;
                height = window.innerHeight;
                canvas.width = width * dpr;
                canvas.height = height * dpr;
                canvas.style.width = `${width}px`;
                canvas.style.height = `${height}px`;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                offscreenCanvas.width = width * dpr;
                offscreenCanvas.height = height * dpr;
                offscreenCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                particles.forEach(particle => {
                    particle.width = width;
                    particle.height = height;
                });
                drawGrid();
                bgLogger.log('Canvas resized', { width, height });
            } catch (error) {
                bgLogger.error('Canvas resize failed', error);
            }
        }, 100);

        window.addEventListener('resize', updateCanvas);
        bgLogger.log('Background initialized', { duration: performance.now() - startTime });
    } catch (error) {
        bgLogger.error('Failed to initialize background', error);
    }
}

window.addEventListener('load', () => {
    bgLogger.log('Starting background initialization');
    initBackground();
});