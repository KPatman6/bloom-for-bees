/*
 * Bloom for Bees — cinematic scroll renderer
 *
 * One lightweight canvas carries the story. Local photographic plates are
 * treated as a continuous film: the camera drifts, focus changes, atmosphere
 * moves, and the scenes blend while the user scrolls. No procedural bee,
 * remote model, remote HDRI, or static image carousel runs behind the story.
 */

const journey = document.querySelector('[data-bee-world]');
const opening = document.querySelector('[data-opening-scene]');
const journeyCanvas = document.getElementById('webgl-canvas');
const openingCanvas = document.getElementById('opening-webgl-canvas');

if (journey && journeyCanvas) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const journeyTrack = journey.querySelector('.bee-journey-track');
  const journeyStage = journey.querySelector('.bee-journey-stage');
  const openingTrack = opening?.querySelector('.opening-track');
  const openingStage = opening?.querySelector('.opening-stage');
  const chapters = [...journey.querySelectorAll('[data-bee-chapter]')];
  const jumps = [...journey.querySelectorAll('[data-bee-jump]')];
  const count = journey.querySelector('#bee-journey-count');
  const index = journey.querySelector('.bee-journey-index b');
  const progressBar = journey.querySelector('.bee-journey-progress span');

  const scenes = [
    { id: 'nest', src: 'assets/journey-01-nest.jpg', pan: [-0.08, 0.02], zoom: [1.06, 1.16], warmth: 0.9 },
    { id: 'flight', src: 'assets/bloom-cinematic-02-flight.jpg', pan: [0.05, 0.01], zoom: [1.12, 1.05], warmth: 1.02 },
    { id: 'pollen', src: 'assets/bloom-cinematic-03-pollen.jpg', pan: [0.08, 0.04], zoom: [1.08, 1.22], warmth: 1.06 },
    { id: 'habitat', src: 'assets/bloom-cinematic-04-habitat.jpg', pan: [-0.03, 0.01], zoom: [1.05, 1.1], warmth: 1.02 },
    { id: 'planting', src: 'assets/bloom-cinematic-05-planting.jpg', pan: [0.07, 0.02], zoom: [1.08, 1.04], warmth: 0.98 },
    { id: 'seedling', src: 'assets/bloom-cinematic-06-seedling.jpg', pan: [-0.02, 0.03], zoom: [1.08, 1.18], warmth: 1.04 },
    { id: 'corridor', src: 'assets/bloom-cinematic-07-corridor.jpg', pan: [0.02, 0.02], zoom: [1.05, 1.12], warmth: 1.01 },
    { id: 'invitation', src: 'assets/bloom-cinematic-08-invitation.jpg', pan: [0.03, 0.01], zoom: [1.04, 1.08], warmth: 1.04 }
  ];

  const cache = new Map();
  let journeyContext;
  let openingContext;
  let journeySize = { width: 1, height: 1, dpr: 1 };
  let openingSize = { width: 1, height: 1, dpr: 1 };
  let assetsReady = false;
  let journeyVisible = true;
  let openingVisible = true;
  let targetJourneyProgress = 0;
  let displayedJourneyProgress = 0;
  let targetOpeningProgress = 0;
  let displayedOpeningProgress = 0;
  let currentChapter = -1;
  let pointerTarget = { x: 0, y: 0 };
  let pointer = { x: 0, y: 0 };
  let lastFrame = 0;
  let frameId = 0;

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const smoother = (value) => value * value * value * (value * (value * 6 - 15) + 10);
  const lerp = (a, b, amount) => a + (b - a) * amount;

  const random = (seed) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  };

  const pollen = Array.from({ length: 110 }, (_, itemIndex) => {
    const next = random(itemIndex * 931 + 19);
    return {
      x: next(),
      y: next(),
      radius: 0.7 + next() * 2.6,
      drift: 0.4 + next() * 1.4,
      phase: next() * Math.PI * 2,
      depth: 0.18 + next() * 0.82
    };
  });

  function loadImage(src) {
    if (cache.has(src)) return cache.get(src);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    cache.set(src, promise);
    return promise;
  }

  function progressFor(track, stage) {
    if (!track || !stage) return 0;
    const travel = Math.max(1, track.offsetHeight - stage.clientHeight);
    return clamp(-track.getBoundingClientRect().top / travel);
  }

  function fitCanvas(canvas, context, size) {
    if (!canvas || !context) return;
    const box = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    if (size.width === width && size.height === height && size.dpr === dpr) return;
    size.width = width;
    size.height = height;
    size.dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawCover(context, image, width, height, scene, progress, alpha, time, pointerAmount = 1) {
    if (!image || alpha <= 0.001) return;
    const sourceRatio = image.width / image.height;
    const targetRatio = width / height;
    const cover = sourceRatio > targetRatio ? height / image.height : width / image.width;
    const baseZoom = lerp(scene.zoom[0], scene.zoom[1], progress);
    const drift = Math.sin(time * 0.00012 + scene.pan[0] * 4) * 0.012;
    const panX = scene.pan[0] * width + drift * width + pointer.x * 10 * pointerAmount;
    const panY = scene.pan[1] * height + Math.cos(time * 0.0001 + scene.pan[1] * 6) * 5 + pointer.y * 6 * pointerAmount;
    const drawWidth = image.width * cover * baseZoom;
    const drawHeight = image.height * cover * baseZoom;

    context.save();
    context.globalAlpha = alpha;
    context.translate(width * 0.5 + panX, height * 0.5 + panY);
    context.filter = `saturate(${scene.warmth}) contrast(1.055) brightness(.84)`;
    context.drawImage(image, -drawWidth * 0.5, -drawHeight * 0.5, drawWidth, drawHeight);
    context.restore();
  }

  function drawAtmosphere(context, width, height, progress, time) {
    context.save();
    context.globalCompositeOperation = 'screen';
    const light = context.createRadialGradient(width * (0.63 + pointer.x * 0.02), height * 0.2, 0, width * 0.63, height * 0.2, height * 0.82);
    light.addColorStop(0, `rgba(255, 214, 119, ${0.12 + progress * 0.08})`);
    light.addColorStop(0.36, 'rgba(255, 214, 119, .025)');
    light.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = light;
    context.fillRect(0, 0, width, height);

    for (const item of pollen) {
      const driftX = Math.sin(time * 0.00022 * item.drift + item.phase) * (9 + item.depth * 18);
      const driftY = Math.cos(time * 0.00018 * item.drift + item.phase * 1.4) * (7 + item.depth * 13);
      const x = item.x * width + driftX + pointer.x * 20 * item.depth;
      const y = item.y * height + driftY + pointer.y * 12 * item.depth;
      const alpha = (0.035 + item.depth * 0.105) * (0.72 + Math.sin(time * 0.001 + item.phase) * 0.28);
      context.fillStyle = `rgba(255, 221, 139, ${alpha})`;
      context.beginPath();
      context.arc(x, y, item.radius * item.depth, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawFlightTrace(context, width, height, progress, time) {
    const phase = clamp((progress - 0.03) / 0.84);
    if (phase <= 0 || phase >= 1) return;
    const visible = Math.sin(clamp(phase * Math.PI)) * 0.75;
    const startX = width * (0.18 + phase * 0.05);
    const startY = height * 0.69;
    const endX = width * (0.76 - phase * 0.08);
    const endY = height * 0.31;
    context.save();
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = visible;
    context.strokeStyle = 'rgba(248, 201, 96, .34)';
    context.lineWidth = 1.4;
    context.setLineDash([2, 13]);
    context.lineDashOffset = -time * 0.06;
    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(width * 0.32, height * (0.78 - phase * 0.18), width * 0.56, height * (0.26 + phase * 0.18), endX, endY);
    context.stroke();

    const marker = smoother((phase * 1.14) % 1);
    const x = lerp(startX, endX, marker);
    const y = height * (0.69 + (0.31 - 0.69) * marker) + Math.sin(marker * Math.PI * 4 + time * 0.002) * 15;
    const glow = context.createRadialGradient(x, y, 0, x, y, 30);
    glow.addColorStop(0, 'rgba(255, 228, 146, .7)');
    glow.addColorStop(0.18, 'rgba(247, 190, 66, .26)');
    glow.addColorStop(1, 'rgba(247, 190, 66, 0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, 30, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255, 235, 167, .96)';
    context.beginPath();
    context.arc(x, y, 2.4, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawVignette(context, width, height, intensity = 1) {
    const side = context.createLinearGradient(0, 0, width, 0);
    side.addColorStop(0, `rgba(3, 8, 6, ${0.86 * intensity})`);
    side.addColorStop(0.26, `rgba(3, 8, 6, ${0.42 * intensity})`);
    side.addColorStop(0.62, 'rgba(3, 8, 6, .06)');
    side.addColorStop(1, 'rgba(3, 8, 6, .2)');
    context.fillStyle = side;
    context.fillRect(0, 0, width, height);
    const lower = context.createLinearGradient(0, 0, 0, height);
    lower.addColorStop(0, 'rgba(2, 5, 4, .13)');
    lower.addColorStop(0.55, 'rgba(2, 5, 4, .02)');
    lower.addColorStop(1, `rgba(2, 5, 4, ${0.72 * intensity})`);
    context.fillStyle = lower;
    context.fillRect(0, 0, width, height);
  }

  function renderOpening(time) {
    if (!openingContext || !openingCanvas) return;
    fitCanvas(openingCanvas, openingContext, openingSize);
    const { width, height } = openingSize;
    const image = cache.get('assets/bee-garden-hero.jpg')?.value;
    if (!image) return;
    const progress = displayedOpeningProgress;
    openingContext.clearRect(0, 0, width, height);
    drawCover(openingContext, image, width, height, { pan: [0.13 - progress * 0.2, 0.03], zoom: [1.04, 1.16], warmth: 1.02 }, progress, 1, time, 1.4);
    drawAtmosphere(openingContext, width, height, progress, time);
    const sweep = (time * 0.00004 + progress * 0.8) % 1.4 - 0.2;
    openingContext.save();
    openingContext.globalCompositeOperation = 'screen';
    openingContext.fillStyle = 'rgba(255, 223, 144, .07)';
    openingContext.fillRect(width * sweep, 0, width * 0.16, height);
    openingContext.restore();
  }

  function renderJourney(time) {
    if (!journeyContext || !journeyCanvas || !assetsReady) return;
    fitCanvas(journeyCanvas, journeyContext, journeySize);
    const { width, height } = journeySize;
    const progress = displayedJourneyProgress;
    const position = progress * (scenes.length - 1);
    const sceneIndex = Math.min(scenes.length - 1, Math.floor(position));
    const local = sceneIndex === scenes.length - 1 ? 0 : position - sceneIndex;
    const crossfade = smoother(clamp((local - 0.18) / 0.64));
    const current = scenes[sceneIndex];
    const next = scenes[Math.min(scenes.length - 1, sceneIndex + 1)];
    const currentImage = cache.get(current.src)?.value;
    const nextImage = cache.get(next.src)?.value;
    journeyContext.clearRect(0, 0, width, height);
    drawCover(journeyContext, currentImage, width, height, current, local, 1 - crossfade, time, 1);
    if (nextImage && crossfade > 0) drawCover(journeyContext, nextImage, width, height, next, local, crossfade, time, 1);
    drawAtmosphere(journeyContext, width, height, progress, time);
    drawFlightTrace(journeyContext, width, height, progress, time);
    drawVignette(journeyContext, width, height, 1);
  }

  function updateCopy(progress) {
    const chapter = Math.min(chapters.length - 1, Math.floor(clamp(progress) * chapters.length));
    if (chapter === currentChapter) return;
    currentChapter = chapter;
    chapters.forEach((item, itemIndex) => {
      const active = itemIndex === chapter;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-hidden', String(!active));
      item.style.display = active ? 'block' : 'none';
      item.style.opacity = active ? '1' : '0';
      item.style.transform = active ? 'translate3d(0,0,0)' : 'translate3d(0,14px,0)';
    });
    jumps.forEach((button, itemIndex) => {
      if (itemIndex === chapter) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const label = String(chapter + 1).padStart(2, '0');
    if (count) count.textContent = label;
    if (index) index.textContent = label;
    journey.dataset.activeChapter = String(chapter);
    journey.dataset.activeScene = scenes[chapter]?.id || 'garden';
  }

  function updateProgress() {
    targetJourneyProgress = progressFor(journeyTrack, journeyStage);
    targetOpeningProgress = progressFor(openingTrack, openingStage);
    journey.style.setProperty('--bee-progress', targetJourneyProgress.toFixed(4));
    if (progressBar) progressBar.style.transform = `scaleX(${targetJourneyProgress})`;
    updateCopy(targetJourneyProgress);
  }

  function jumpTo(indexValue) {
    const target = clamp(Number(indexValue), 0, scenes.length - 1);
    if (!journeyTrack || !journeyStage) return;
    const travel = Math.max(1, journeyTrack.offsetHeight - journeyStage.clientHeight);
    const top = window.scrollY + journeyTrack.getBoundingClientRect().top + travel * (target / (scenes.length - 1));
    window.scrollTo({ top, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  function resize() {
    fitCanvas(journeyCanvas, journeyContext, journeySize);
    fitCanvas(openingCanvas, openingContext, openingSize);
  }

  function pointerMove(event) {
    const target = journeyVisible && journeyStage?.getBoundingClientRect() || openingVisible && openingStage?.getBoundingClientRect();
    if (!target || !target.width || !target.height) return;
    pointerTarget.x = clamp((event.clientX - target.left) / target.width * 2 - 1, -1, 1);
    pointerTarget.y = clamp((event.clientY - target.top) / target.height * 2 - 1, -1, 1);
  }

  function observeVisibility() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === journey) journeyVisible = entry.isIntersecting;
        if (entry.target === opening) openingVisible = entry.isIntersecting;
      });
    }, { rootMargin: '35% 0px 35% 0px' });
    observer.observe(journey);
    if (opening) observer.observe(opening);
  }

  async function boot() {
    journeyContext = journeyCanvas.getContext('2d', { alpha: false, desynchronized: true });
    openingContext = openingCanvas?.getContext('2d', { alpha: false, desynchronized: true });
    if (!journeyContext) return;
    const assets = [
      ['assets/bee-garden-hero.jpg', loadImage('assets/bee-garden-hero.jpg')],
      ...scenes.map((scene) => [scene.src, loadImage(scene.src)])
    ];
    try {
      await Promise.all(assets.map(async ([src, promise]) => { cache.set(src, { value: await promise }); }));
      assetsReady = true;
      journey.classList.add('is-ready');
      opening?.classList.add('is-ready');
      journey.dataset.renderer = 'cinematic-canvas';
      journey.dataset.assetMode = 'local-photographic-plates';
      updateProgress();
      resize();
      renderOpening(performance.now());
      renderJourney(performance.now());
    } catch (error) {
      journey.classList.add('no-webgl');
      console.warn('[Bloom for Bees] Cinematic plates unavailable', error);
    }
  }

  function frame(time) {
    frameId = requestAnimationFrame(frame);
    const delta = Math.min(0.08, Math.max(0.001, (time - lastFrame) / 1000 || 0.016));
    lastFrame = time;
    pointer.x += (pointerTarget.x - pointer.x) * (reduceMotion.matches ? 1 : Math.min(1, delta * 5));
    pointer.y += (pointerTarget.y - pointer.y) * (reduceMotion.matches ? 1 : Math.min(1, delta * 5));
    displayedJourneyProgress += (targetJourneyProgress - displayedJourneyProgress) * (reduceMotion.matches ? 1 : Math.min(1, delta * 12));
    displayedOpeningProgress += (targetOpeningProgress - displayedOpeningProgress) * (reduceMotion.matches ? 1 : Math.min(1, delta * 12));
    if (openingVisible) renderOpening(time);
    if (journeyVisible) renderJourney(time);
  }

  jumps.forEach((button) => button.addEventListener('click', () => jumpTo(button.dataset.beeJump)));
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', pointerMove, { passive: true });
  reduceMotion.addEventListener?.('change', () => { updateProgress(); resize(); });
  observeVisibility();
  updateProgress();
  boot();
  frameId = requestAnimationFrame(frame);
}
