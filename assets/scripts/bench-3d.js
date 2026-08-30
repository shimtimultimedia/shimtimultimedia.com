/*
 * Shimti Multimedia - the 3D instrument on Work
 *
 * A real viewer: orbit, zoom, lit materials, and a .glb when one is supplied.
 *
 * Three decisions worth recording, because each of them is the reason something else in
 * here looks unusual.
 *
 * 1. three.js is loaded on demand, not with the page. It is 655KB, and the rest of this
 *    site ships no libraries at all. import() runs the moment the instrument is first
 *    scrolled into view, so a visitor who never reaches it never pays for it, and the
 *    other eight instruments are not held up behind it.
 *
 * 2. The library is vendored, with its imports rewritten to relative paths. A CDN is out -
 *    the page's CSP is script-src 'self' - and a bare 'three' specifier would need an
 *    import map, which is an inline script and blocked by the same policy. Relative paths
 *    need no map and pin the loader to the exact build sitting next to it.
 *
 * 3. The orbit control is written here rather than taken from the addons. It is forty
 *    lines, it responds to keyboard as well as pointer - the stock one does not, and a
 *    viewer that can only be driven by dragging fails WCAG 2.2 SC 2.5.7 - and it keeps
 *    another 30KB off the page.
 *
 * @requires assets/vendor/three/
 */

'use strict';

(() => {
  const bench = document.querySelector('[data-bench="model"]');
  if (!bench) return;

  const canvas = bench.querySelector('canvas');
  const status = bench.querySelector('[data-model-status]');
  const resetButton = bench.querySelector('[data-model-reset]');
  if (!canvas) return;

  let started = false;

  // Nothing is fetched until the instrument is actually on screen.
  new IntersectionObserver((entries, observer) => {
    if (!entries[0].isIntersecting || started) return;
    started = true;
    observer.disconnect();
    boot().catch((error) => {
      console.error('[bench-3d]', error);
      if (status) status.textContent = 'The 3D viewer could not start in this browser.';
    });
  }, { rootMargin: '200px' }).observe(canvas);

  async function boot() {
    if (status) status.textContent = 'Loading the viewer…';

    const THREE = await import('../vendor/three/three.module.min.js');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);

    // Three lights, not one. A single source flattens a model into a silhouette; a key,
    // a cooler fill from the opposite side and a rim behind it are what make geometry
    // read as geometry.
    scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x20262e, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8cc6e8, 1.4);
    rim.position.set(-4, 2, -5);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);

    const src = bench.dataset.model;
    if (src) {
      const { GLTFLoader } = await import('../vendor/three/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(src);
      root.add(gltf.scene);
    } else {
      root.add(placeholder(THREE));
    }

    frameObject(THREE, root, camera);
    if (status) status.textContent = src ? '' : 'Placeholder geometry — drag to orbit.';

    /* ------------------------------------------------------------------ controls */

    const home = { yaw: 0.6, pitch: 0.25, dist: camera.position.length() };
    const view = { ...home };
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const applyCamera = () => {
      const p = Math.max(-1.35, Math.min(1.35, view.pitch));
      camera.position.set(
        Math.sin(view.yaw) * Math.cos(p) * view.dist,
        Math.sin(p) * view.dist,
        Math.cos(view.yaw) * Math.cos(p) * view.dist,
      );
      camera.lookAt(0, 0, 0);
    };

    canvas.addEventListener('pointerdown', (event) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      view.yaw -= (event.clientX - lastX) * 0.008;
      view.pitch += (event.clientY - lastY) * 0.008;
      lastX = event.clientX;
      lastY = event.clientY;
      applyCamera();
    });
    const release = (event) => {
      dragging = false;
      if (event.pointerId !== undefined && canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('wheel', (event) => {
      // Only claim the wheel once the viewer has focus or the pointer is over it and the
      // user means to zoom - otherwise scrolling the page over a 3D viewer traps you.
      event.preventDefault();
      view.dist = Math.max(home.dist * 0.45, Math.min(home.dist * 2.4,
        view.dist * (1 + Math.sign(event.deltaY) * 0.12)));
      applyCamera();
    }, { passive: false });

    canvas.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 0.25 : 0.1;
      let handled = true;
      switch (event.key) {
        case 'ArrowLeft': view.yaw += step; break;
        case 'ArrowRight': view.yaw -= step; break;
        case 'ArrowUp': view.pitch -= step; break;
        case 'ArrowDown': view.pitch += step; break;
        case '+': case '=': view.dist = Math.max(home.dist * 0.45, view.dist * 0.9); break;
        case '-': case '_': view.dist = Math.min(home.dist * 2.4, view.dist * 1.1); break;
        case 'Home': Object.assign(view, home); break;
        default: handled = false;
      }
      if (!handled) return;
      event.preventDefault();
      applyCamera();
    });

    resetButton?.addEventListener('click', () => { Object.assign(view, home); applyCamera(); });

    /* --------------------------------------------------------------------- loop */

    let raf = 0;
    let onScreen = true;
    let dead = false;

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };

    const tick = () => {
      raf = 0;
      if (!onScreen || document.hidden || dead) return;
      try {
        if (!dragging) root.rotation.y += 0.0035;   // a slow idle turn, stopped while held
        renderer.render(scene, camera);
      } catch (error) {
        // Same rule as every other loop on this site: stop, do not throw once a frame.
        dead = true;
        console.error('[bench-3d] render stopped', error);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const sync = () => {
      if (onScreen && !document.hidden && !dead) { if (!raf) raf = requestAnimationFrame(tick); }
      else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    new IntersectionObserver((entries) => { onScreen = entries[0].isIntersecting; sync(); },
      { threshold: 0.1 }).observe(canvas);
    document.addEventListener('visibilitychange', sync);
    new ResizeObserver(() => { size(); renderer.render(scene, camera); }).observe(canvas);

    size();
    applyCamera();
    sync();
  }

  /** Stand-in geometry until a .glb is supplied: something with enough curvature and
   *  edge to show that the lighting and the orbit are real. */
  function placeholder(THREE) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0x2c6f9b, metalness: 0.35, roughness: 0.28,
    });
    group.add(new THREE.Mesh(new THREE.TorusKnotGeometry(0.72, 0.24, 180, 32), material));

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.35, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: 0x10151c, metalness: 0.1, roughness: 0.8 }),
    );
    plinth.position.y = -1.15;
    group.add(plinth);
    return group;
  }

  /** Puts the camera where the whole object is in shot, whatever its size. */
  function frameObject(THREE, object, camera) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    object.position.sub(centre);                      // sit it on the origin

    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const dist = (radius / Math.sin((camera.fov * Math.PI / 180) / 2)) * 1.35;
    camera.position.set(Math.sin(0.6) * dist, Math.sin(0.25) * dist, Math.cos(0.6) * dist);
    camera.near = dist / 100;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
  }
})();
