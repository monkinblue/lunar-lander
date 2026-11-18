import { GameController } from './game/GameController';

function bootstrap(): void {
  const webglCanvas = document.getElementById('crt-webgl-canvas') as HTMLCanvasElement | null;
  const srLive = document.getElementById('sr-telemetry-live');
  const shell = document.getElementById('console-shell');

  if (!webglCanvas) {
    throw new Error('Console canvas element missing from DOM.');
  }

  const controller = new GameController(webglCanvas, srLive);

  // High-DPI responsive resize handling
  const handleResize = () => {
    controller.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', handleResize);

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
      controller.resize(window.innerWidth, window.innerHeight);
    });
  }

  syncLoopState();
}

bootstrap();
