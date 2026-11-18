import { GameController } from './game/GameController';

function bootstrap(): void {
  const webglCanvas = document.getElementById('crt-webgl-canvas') as HTMLCanvasElement | null;
  const srLive = document.getElementById('sr-telemetry-live');
  const shell = document.getElementById('console-shell');

  if (!webglCanvas) {
    throw new Error('Console canvas element missing from DOM.');
  }

  const controller = new GameController(webglCanvas, srLive);
  const mobileInput = document.getElementById('mobile-callsign-input');

  // High-DPI responsive & fullscreen-safe viewport measurement (prevents mobile fullscreen bottom clipping)
  const syncViewport = () => {
    const shellRect = shell
      ? shell.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    let visW = shellRect.width || window.innerWidth;
    let visH = shellRect.height || window.innerHeight;
    let offsetLeft = 0;
    let offsetTop = 0;

    if (window.innerWidth > 0) {
      visW = Math.min(visW, window.innerWidth);
    }
    if (window.innerHeight > 0) {
      visH = Math.min(visH, window.innerHeight);
    }

    const keyboardFocused = Boolean(mobileInput && document.activeElement === mobileInput);
    const vv = window.visualViewport;
    if (vv && !keyboardFocused && Math.abs((vv.scale || 1) - 1) < 0.06) {
      if (vv.width > 200) {
        visW = Math.min(visW, vv.width);
      }
      if (vv.height > 200) {
        visH = Math.min(visH, vv.height);
      }
      offsetLeft = Math.max(0, vv.offsetLeft || 0);
      offsetTop = Math.max(0, vv.offsetTop || 0);
    }

    visW = Math.max(320, Math.round(visW));
    visH = Math.max(240, Math.round(visH));

    webglCanvas.style.left = `${Math.round(offsetLeft)}px`;
    webglCanvas.style.top = `${Math.round(offsetTop)}px`;
    webglCanvas.style.width = `${visW}px`;
    webglCanvas.style.height = `${visH}px`;

    const canvasRect = webglCanvas.getBoundingClientRect();
    controller.resize(visW, visH, canvasRect.left, canvasRect.top);
  };

  const scheduleSettledViewportSync = () => {
    syncViewport();
    window.setTimeout(syncViewport, 80);
    window.setTimeout(syncViewport, 220);
    window.setTimeout(syncViewport, 450);
  };

  syncViewport();
  window.addEventListener('resize', syncViewport);
  window.addEventListener('orientationchange', scheduleSettledViewportSync);
  document.addEventListener('fullscreenchange', scheduleSettledViewportSync);
  document.addEventListener('webkitfullscreenchange', scheduleSettledViewportSync);
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('scroll', syncViewport);
  mobileInput?.addEventListener('blur', () => {
    window.setTimeout(syncViewport, 120);
  });
  if (shell && 'ResizeObserver' in window) {
    new ResizeObserver(syncViewport).observe(shell);
  }

  // Pause rendering & WebGL/Canvas work when off-screen or hidden to conserve system resources
  let loopRunning = false;
  let rafId = 0;
  let lastFrameTime = performance.now();
  let isOffscreenSkipped = false;

  const tick = (now: number) => {
    if (!loopRunning) return;
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    controller.updateAndRender(dt);
    rafId = window.requestAnimationFrame(tick);
  };

  const syncLoopState = () => {
    const shouldPause = document.hidden || isOffscreenSkipped;
    controller.setBackgroundPaused(shouldPause);
    if (shouldPause && loopRunning) {
      loopRunning = false;
      window.cancelAnimationFrame(rafId);
    } else if (!shouldPause && !loopRunning) {
      loopRunning = true;
      lastFrameTime = performance.now();
      rafId = window.requestAnimationFrame(tick);
    }
  };

  document.addEventListener('visibilitychange', syncLoopState);

  if (shell) {
    if ('contentVisibility' in document.documentElement.style) {
      shell.addEventListener('contentvisibilityautostatechange', (event) => {
        const cvEvent = event as Event & { skipped?: boolean };
        isOffscreenSkipped = Boolean(cvEvent.skipped);
        syncLoopState();
      });
    } else if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            isOffscreenSkipped = !entry.isIntersecting;
          }
          syncLoopState();
        },
        { rootMargin: '200px' }
      );
      observer.observe(shell);
    }
  }

  // Wait briefly for Google Fonts ("Share Tech Mono" & "JetBrains Mono") without blocking initial frame
  if ('fonts' in document) {
    void document.fonts.ready.then(() => {
      syncViewport();
    });
  }

  syncLoopState();
}

bootstrap();
