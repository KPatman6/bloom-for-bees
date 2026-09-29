import { api, ApiError } from "./api.js";
import { plants } from "./plants.js";

const $ = (selector, root) => (root || document).querySelector(selector);
const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
const state = {
  user: null,
  gardens: [],
  settings: { theme: "system", reminderEnabled: false, reminderDate: null },
  view: "overview",
  authMode: "register",
  pendingGarden: null,
  confirmAction: null,
  toastTimer: null,
  searchTimer: null
};

const bloomStorageKey = "bloomForBeesPlan";
const canonicalPlaces = {
  "a pot or window box": "A pot or window box",
  "my garden": "My garden",
  "a school or community space": "A school or community space",
  "a shared garden": "A shared garden"
};

const motionSettings = {
  reduced: false,
  enabled: false,
  pointerEnabled: false,
  frame: 0,
  pointerFrame: 0,
  pointerTarget: null,
  pointerEvent: null,
  revealObserver: null,
  entryPlayed: false
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setMotionValue(element, property, value, suffix) {
  if (!element) return;
  const formatted = String(Math.round(value * 1000) / 1000) + (suffix || "");
  if (element.style.getPropertyValue(property) !== formatted) element.style.setProperty(property, formatted);
}

function animateStatCount(node) {
  if (!node || motionSettings.reduced || node.dataset.countStarted === "true") return;
  const target = Number(node.dataset.countTo);
  if (!Number.isFinite(target)) return;
  node.dataset.countStarted = "true";
  const start = performance.now();
  const duration = 760;
  const tick = (now) => {
    const progress = clamp((now - start) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = String(Math.round(target * eased));
    if (progress < 1) window.requestAnimationFrame(tick);
    else node.textContent = String(target);
  };
  window.requestAnimationFrame(tick);
}

function observeReveals(scope) {
  if (!motionSettings.enabled) return;
  const root = scope || document;
  $$('[data-reveal]:not(.is-revealed)', root).forEach((element) => {
    if (element.closest('[hidden]')) return;
    if (!motionSettings.revealObserver) {
      element.classList.add('is-revealed');
      return;
    }
    motionSettings.revealObserver.observe(element);
  });
}

function stickyTop() {
  return document.body.classList.contains('is-app') ? 0 : ($('.site-header')?.getBoundingClientRect().height || 82);
}

function resetPointerTarget(target) {
  if (!target) return;
  ['--mag-x', '--mag-y', '--tilt-x', '--tilt-y'].forEach((property) => target.style.removeProperty(property));
}

function queuePointerFrame(event) {
  if (!motionSettings.pointerEnabled) return;
  const target = event.target && event.target.closest ? event.target.closest('[data-magnetic], [data-tilt]') : null;
  if (target !== motionSettings.pointerTarget) resetPointerTarget(motionSettings.pointerTarget);
  motionSettings.pointerTarget = target;
  motionSettings.pointerEvent = { x: event.clientX, y: event.clientY };
  if (motionSettings.pointerFrame) return;
  motionSettings.pointerFrame = window.requestAnimationFrame(() => {
    motionSettings.pointerFrame = 0;
    const current = motionSettings.pointerTarget;
    const point = motionSettings.pointerEvent;
    const marketing = $('#marketing-site');
    if (marketing && point) {
      setMotionValue(marketing, '--cursor-x', point.x, 'px');
      setMotionValue(marketing, '--cursor-y', point.y, 'px');
    }
    if (current && point && current.isConnected) {
      const rect = current.getBoundingClientRect();
      const x = clamp((point.x - rect.left) / Math.max(1, rect.width) - .5, -.5, .5);
      const y = clamp((point.y - rect.top) / Math.max(1, rect.height) - .5, -.5, .5);
      if (current.hasAttribute('data-magnetic')) {
        setMotionValue(current, '--mag-x', x * 9, 'px');
        setMotionValue(current, '--mag-y', y * 7, 'px');
      }
      if (current.hasAttribute('data-tilt')) {
        setMotionValue(current, '--tilt-x', x * 3.4, 'deg');
        setMotionValue(current, '--tilt-y', y * -3.4, 'deg');
      }
    }
  });
}

function setupSpaceGutters(space, enabled) {
  const track = $('.space-track', space);
  const viewport = $('.space-viewport', space);
  const firstCard = $('.space-card', track);
  if (!track || !viewport || !firstCard) return;
  if (!enabled) {
    track.style.removeProperty('padding-left');
    track.style.removeProperty('padding-right');
    return;
  }
  const gutter = Math.max(0, (viewport.clientWidth - firstCard.getBoundingClientRect().width) / 2);
  setMotionValue(track, 'padding-left', gutter, 'px');
  setMotionValue(track, 'padding-right', gutter, 'px');
}

function clearPinnedState() {
  const story = $('[data-scroll-story]');
  $('.story-pin', story)?.style.removeProperty('--pin-exit-opacity');
  if (story) delete story.dataset.activeChapter;
  $$('.story-chapter', story).forEach((chapter) => {
    chapter.removeAttribute('aria-hidden');
    chapter.style.removeProperty('visibility');
    ['--story-alpha', '--story-rise', '--story-slide'].forEach((property) => chapter.style.removeProperty(property));
  });
  $$('[data-story-mockup]', story).forEach((card) => {
    card.style.removeProperty('visibility');
    card.style.removeProperty('z-index');
    ['--mockup-x', '--mockup-y', '--mockup-scale', '--mockup-rotate', '--mockup-opacity'].forEach((property) => card.style.removeProperty(property));
  });
  $$('[data-story-jump]', story).forEach((button, index) => {
    if (index === 0) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  const storyPhoto = $('.story-photo', story);
  if (storyPhoto) storyPhoto.style.removeProperty('transform');
  const storyVisual = $('.story-visual', story);
  if (storyVisual) ['--story-world-scale', '--story-world-x', '--story-world-y', '--story-world-saturation', '--story-world-brightness'].forEach((property) => storyVisual.style.removeProperty(property));
  const storyCanvas = $('.story-world-canvas', storyVisual);
  if (storyCanvas) storyCanvas.getContext('2d')?.clearRect(0, 0, storyCanvas.width, storyCanvas.height);
  const storyWorldWord = $('.story-world-word', storyVisual);
  if (storyWorldWord) ['--story-word-y', '--story-word-x', '--story-word-scale'].forEach((property) => storyWorldWord.style.removeProperty(property));
  if ($('#story-scene-number', story)) $('#story-scene-number', story).textContent = '1';

  const day = $('[data-step-story]');
  if (day) delete day.dataset.activeStep;
  $('.day-pin', day)?.style.removeProperty('--pin-exit-opacity');
  $$('.step-card', day).forEach((card) => {
    ['--stack-y', '--stack-scale', '--stack-rotate', '--stack-opacity', '--stack-depth'].forEach((property) => card.style.removeProperty(property));
    card.removeAttribute('aria-current');
  });
  if ($('#step-story-fill')) $('#step-story-fill').style.removeProperty('transform');
  if ($('#step-story-count')) $('#step-story-count').innerHTML = '01 <i>/ 03</i>';
  if ($('#step-story-label')) $('#step-story-label').textContent = 'CHOOSE';

  const space = $('[data-horizontal-story]');
  if (space) delete space.dataset.activeCard;
  $('.space-pin', space)?.style.removeProperty('--pin-exit-opacity');
  const spaceTrack = $('.space-track', space);
  if (spaceTrack) spaceTrack.style.removeProperty('transform');
  $$('.space-card', space).forEach((card) => { card.classList.remove('is-current'); card.removeAttribute('aria-current'); });
  if ($('#space-progress-fill')) $('#space-progress-fill').style.removeProperty('transform');
  const spaceLabel = $('#space-step-label');
  if (spaceLabel) {
    spaceLabel.innerHTML = '01 <span>/ 03</span> · WINDOW BOX';
    delete spaceLabel.dataset.activeIndex;
  }

  const opening = $('[data-opening-scene]');
  const openingStage = $('.opening-stage', opening);
  if (openingStage) openingStage.removeAttribute('data-opening-state');
  [opening, openingStage, $('.opening-image-layer img', opening), $('.opening-copy', opening), $('.opening-copy h1', opening), $('.opening-date', opening), $('.opening-caption', opening), $('.opening-facts', opening), $('.opening-word', opening), ...$$('.opening-halo', opening)].forEach((element) => {
    if (!element) return;
    ['--opening-progress', '--opening-photo-scale', '--opening-photo-x', '--opening-photo-y', '--opening-copy-x', '--opening-copy-y', '--opening-copy-scale', '--opening-copy-opacity', '--opening-title-y', '--opening-date-x', '--opening-date-y', '--opening-caption-y', '--opening-facts-y', '--opening-facts-opacity', '--opening-word-x', '--opening-word-y', '--opening-word-scale', '--opening-halo-y', '--opening-halo-scale', '--opening-after-opacity', '--opening-after-y'].forEach((property) => element.style.removeProperty(property));
  });

  const growing = $('[data-growing-scene]');
  if (growing) delete growing.dataset.activeChapter;
  $$('.growing-chapter', growing).forEach((chapter) => chapter.removeAttribute('aria-hidden'));
  $$('[data-growing-jump]', growing).forEach((button, index) => {
    if (index === 0) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  const growingCount = $('#growing-count', growing);
  if (growingCount) growingCount.textContent = '01';
  const growingCanvas = $('.growing-pollen', growing);
  if (growingCanvas) growingCanvas.getContext('2d')?.clearRect(0, 0, growingCanvas.width, growingCanvas.height);
  [growing, $('.growing-plant', growing), $('.growing-pollen', growing), $('.growing-photo', growing), $('.growing-cinematic-art', growing)].forEach((element) => {
    if (!element) return;
    ['--scene-progress', '--growing-photo-opacity', '--growing-photo-scale', '--growing-light-opacity', '--growing-plant-scale', '--growing-plant-x', '--growing-plant-y', '--growing-art-scale', '--growing-art-x', '--growing-art-y', '--growing-word-x', '--roots-offset', '--roots-opacity', '--stem-offset', '--leaves-opacity', '--leaves-scale', '--bloom-stem-opacity', '--flower-opacity', '--flower-scale', '--bee-opacity', '--bee-x', '--bee-y', '--sun-opacity', '--sun-scale', '--seed-opacity', '--pollen-opacity', '--pollen-shift'].forEach((property) => element.style.removeProperty(property));
  });

  const place = $('[data-place-scene]');
  if (place) delete place.dataset.activePlace;
  $$('.place-caption', place).forEach((caption) => caption.removeAttribute('aria-hidden'));
  $$('[data-place-jump]', place).forEach((button, index) => {
    if (index === 0) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  const placeLabel = $('#place-progress-label', place);
  if (placeLabel) placeLabel.textContent = '01 / 03 · WINDOW BOX';
  const placeIndex = $('.place-scroll-index b', place);
  if (placeIndex) placeIndex.textContent = '01 — 03';
  [place, $('.place-panorama', place), $('.place-cinematic-art', place), $('.place-sky', place), ...$$('.place-environment', place)].forEach((element) => {
    if (!element) return;
    ['--place-progress', '--place-shift', '--place-art-y', '--place-art-scale', '--place-copy-y', '--place-atmosphere', '--place-bee-opacity', '--place-env-opacity', '--place-env-x', '--place-env-scale'].forEach((property) => element.style.removeProperty(property));
  });

  const ritual = $('[data-ritual-scene]');
  if (ritual) delete ritual.dataset.activeStep;
  $$('.ritual-chapter', ritual).forEach((chapter) => chapter.removeAttribute('aria-hidden'));
  $$('[data-ritual-jump]', ritual).forEach((button, index) => {
    if (index === 0) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  if ($('#ritual-count', ritual)) $('#ritual-count', ritual).textContent = '01';
  if ($('#ritual-word', ritual)) $('#ritual-word', ritual).textContent = 'CHOOSE';
  const ritualBee = $('.ritual-orbit-bee', ritual);
  if (ritualBee) { ritualBee.setAttribute('cx', '400'); ritualBee.setAttribute('cy', '90'); }
  [ritual, $('.ritual-atmosphere-one', ritual), $('.ritual-atmosphere-two', ritual), $('.ritual-orbit', ritual), $('.ritual-cinematic-art', ritual), $('.ritual-flower', ritual), $('.ritual-big-word', ritual), $('.ritual-path', ritual)].forEach((element) => {
    if (!element) return;
      ['--scene-progress', '--ritual-atmosphere-one', '--ritual-atmosphere-two', '--ritual-art-scale', '--ritual-photo-x', '--ritual-photo-y', '--ritual-flower-scale', '--ritual-flower-rotate', '--ritual-orbit-rotate', '--ritual-word-x', '--ritual-word-y', '--ritual-word-scale', '--ritual-path-offset', '--ritual-bee-x', '--ritual-bee-y'].forEach((property) => element.style.removeProperty(property));
  });

  const cinematic = $('[data-cinematic-journey]');
  if (cinematic) delete cinematic.dataset.activeCinematic;
  $$('.cinematic-journey-chapter', cinematic).forEach((chapter, index) => {
    if (index === 0) chapter.removeAttribute('aria-hidden');
    else chapter.setAttribute('aria-hidden', 'true');
  });
  $$('[data-cinematic-jump]', cinematic).forEach((button, index) => {
    if (index === 0) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  [cinematic, $('.cinematic-journey-stage', cinematic), ...$$('.cinematic-frame', cinematic), ...$$('.cinematic-journey-chapter', cinematic)].forEach((element) => {
    if (!element) return;
    ['--cinematic-progress', '--cinematic-opacity', '--cinematic-scale', '--cinematic-x', '--cinematic-y', '--cinematic-copy-opacity', '--cinematic-copy-y'].forEach((property) => element.style.removeProperty(property));
  });
}

function playPageEntry() {
  if (motionSettings.entryPlayed || motionSettings.reduced || document.body.classList.contains('is-app') || window.scrollY > 24) return;
  motionSettings.entryPlayed = true;
  document.body.classList.add('motion-entering');
  window.setTimeout(() => document.body.classList.remove('motion-entering'), 1600);
}

function syncMotionMode() {
  motionSettings.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  motionSettings.enabled = !motionSettings.reduced && 'IntersectionObserver' in window;
  const publicMode = !document.body.classList.contains('is-app');
  const allowPinned = motionSettings.enabled && publicMode && window.innerWidth > 900 && window.innerHeight > 700;
  $$('#header-cta, #marketing-site .button-primary, #share-challenge, .workspace-heading .button-primary').forEach((element) => element.setAttribute('data-magnetic', ''));
  motionSettings.pointerEnabled = motionSettings.enabled && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  document.body.classList.toggle('motion-enabled', motionSettings.enabled);
  document.body.classList.toggle('has-pointer-motion', motionSettings.pointerEnabled);

  $('[data-hero-sequence]')?.classList.toggle('is-motion-enhanced', motionSettings.enabled && publicMode);
  $('[data-scroll-story]')?.classList.toggle('is-scroll-enhanced', allowPinned);
  $('[data-step-story]')?.classList.toggle('is-scroll-enhanced', allowPinned);
  $('[data-horizontal-story]')?.classList.toggle('is-scroll-enhanced', allowPinned);
  $('[data-cinematic-journey]')?.classList.toggle('is-enhanced', allowPinned);
  ['[data-opening-scene]', '[data-growing-scene]', '[data-place-scene]', '[data-ritual-scene]'].forEach((selector) => $(selector)?.classList.toggle('is-enhanced', allowPinned));
  $('.hero-media')?.classList.toggle('is-parallax-ready', motionSettings.enabled && publicMode);
  $('.share-section')?.classList.toggle('is-parallax-ready', motionSettings.enabled && publicMode);
  setupSpaceGutters($('[data-horizontal-story]'), allowPinned);

  if (!allowPinned) clearPinnedState();
  if (!motionSettings.enabled || !publicMode) {
    resetPointerTarget(motionSettings.pointerTarget);
    motionSettings.pointerTarget = null;
    ['--hero-progress', '--page-progress', '--global-drift'].forEach((property) => document.body.style.removeProperty(property));
  }
  if (motionSettings.reduced || !publicMode) {
    ['--hero-photo-scale', '--hero-photo-shift', '--hero-sticker-shift', '--hero-caption-shift', '--hero-stage-scale', '--hero-stage-shift', '--hero-copy-shift', '--hero-copy-opacity'].forEach((property) => $('.hero-sequence')?.style.removeProperty(property));
    ['--share-flower-x', '--share-flower-y', '--share-card-x', '--share-card-y', '--share-card-rotate', '--share-copy-y', '--share-copy-scale'].forEach((property) => {
      $('.share-flower')?.style.removeProperty(property);
      $('.share-date-card')?.style.removeProperty(property);
      $('.share-copy')?.style.removeProperty(property);
    });
    $('.hero-media')?.classList.remove('is-parallax-ready');
    $('.share-section')?.classList.remove('is-parallax-ready');
    document.body.classList.remove('motion-entering');
  } else {
    playPageEntry();
  }

  if (motionSettings.revealObserver) motionSettings.revealObserver.disconnect();
  motionSettings.revealObserver = motionSettings.enabled
    ? new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        if (entry.target.classList.contains('stat-card')) {
          animateStatCount($('strong[id="stat-plans"], strong[id="stat-planted"]', entry.target));
        }
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' })
    : null;

  if (motionSettings.enabled) observeReveals(document);
  else $$('[data-reveal]').forEach((element) => element.classList.add('is-revealed'));
  queueMotionFrame();
}

function queueMotionFrame() {
  if (motionSettings.frame) return;
  motionSettings.frame = window.requestAnimationFrame(updateMotionFrame);
}

function setActiveScene() {
  const marketing = $('#marketing-site');
  const anchor = window.innerHeight * .46;
  const scenes = [
    ['[data-opening-scene]', 'opening'], ['[data-bee-world]', 'journey'], ['#plan', 'plan'],
    ['#faq', 'answers'], ['#share', 'share'], ['.site-footer', 'ending']
  ];
  let active = 'opening';
  scenes.forEach(([selector, name]) => {
    const element = $(selector);
    if (!element || element.hidden) return;
    const rect = element.getBoundingClientRect();
    if (rect.top <= anchor && rect.bottom >= anchor) active = name;
  });
  if (marketing.dataset.scene !== active) marketing.dataset.scene = active;

  const navTarget = active === 'journey' ? '#journey'
    : active === 'story' ? '#day'
    : active === 'spaces' ? '#small-spaces'
      : active === 'ritual' || active === 'plan' ? '#plan'
        : active === 'answers' ? '#faq' : '';
  $$('.main-nav:not(.app-top-nav) a, #mobile-nav a').forEach((link) => {
    if (navTarget && link.getAttribute('href') === navTarget) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function pinnedProgress(region, pin, top) {
  if (!region || !pin) return 0;
  const rect = region.getBoundingClientRect();
  const travel = Math.max(1, rect.height - pin.clientHeight);
  return clamp((top - rect.top) / travel, 0, 1);
}

function pinExitOpacity(progress) {
  const exit = clamp((progress - .96) / .04, 0, 1);
  // Keep the pinned artwork present as it leaves its track. A full fade here
  // creates an empty tail while the section itself is still on screen.
  return 1 - exit * exit * (3 - 2 * exit) * .18;
}

function easeScene(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function sceneChapter(scene, key, position) {
  let active = Number(scene.dataset[key]);
  if (!Number.isFinite(active)) active = Math.round(position);
  while (active < 2 && position > active + .56) active += 1;
  while (active > 0 && position < active - .56) active -= 1;
  scene.dataset[key] = String(active);
  return active;
}

function setSceneChapters(scene, itemSelector, buttonSelector, active) {
  $$(itemSelector, scene).forEach((item, index) => {
    const hidden = String(index !== active);
    if (item.getAttribute('aria-hidden') !== hidden) item.setAttribute('aria-hidden', hidden);
  });
  $$(buttonSelector, scene).forEach((button, index) => {
    if (index === active && button.getAttribute('aria-current') !== 'step') button.setAttribute('aria-current', 'step');
    else if (index !== active) button.removeAttribute('aria-current');
  });
}

function updateCinematicJourney(top) {
  const journey = $('[data-cinematic-journey]');
  if (!journey) return;
  const track = $('.cinematic-journey-track', journey);
  const stage = $('.cinematic-journey-stage', journey);
  if (!track || !stage) return;

  const enhanced = journey.classList.contains('is-enhanced');
  const progress = enhanced ? pinnedProgress(track, stage, top) : 0;
  const position = progress * 4;
  let active = Number(journey.dataset.activeCinematic);
  if (!Number.isFinite(active)) active = 0;
  while (active < 4 && position > active + .54) active += 1;
  while (active > 0 && position < active - .46) active -= 1;
  journey.dataset.activeCinematic = String(active);

  setMotionValue(stage, '--cinematic-progress', progress, '');
  $$('.cinematic-frame', journey).forEach((frame, index) => {
    const distance = Math.abs(position - index);
    const opacity = easeScene(clamp(1 - distance, 0, 1));
    setMotionValue(frame, '--cinematic-opacity', opacity, '');
    setMotionValue(frame, '--cinematic-scale', 1.055 + (index === active ? progress * .045 : .02), '');
    setMotionValue(frame, '--cinematic-x', ((index - position) * 12) + progress * -6, 'px');
    setMotionValue(frame, '--cinematic-y', Math.sin(progress * Math.PI) * -7, 'px');
    const image = $('img', frame);
    if (image && distance < 1.35) image.fetchPriority = 'high';
  });

  $$('.cinematic-journey-chapter', journey).forEach((chapter, index) => {
    const isActive = index === active;
    const opacity = isActive ? 1 : 0;
    setMotionValue(chapter, '--cinematic-copy-opacity', opacity, '');
    setMotionValue(chapter, '--cinematic-copy-y', isActive ? 0 : (index < active ? -18 : 18), 'px');
    const hidden = String(!isActive);
    if (chapter.getAttribute('aria-hidden') !== hidden) chapter.setAttribute('aria-hidden', hidden);
  });
  $$('[data-cinematic-jump]', journey).forEach((button, index) => {
    if (index === active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  const count = $('#cinematic-journey-count', journey);
  if (count && count.textContent !== String(active + 1).padStart(2, '0')) count.textContent = String(active + 1).padStart(2, '0');
  const index = $('.cinematic-journey-index b', journey);
  if (index && index.textContent !== String(active + 1).padStart(2, '0')) index.textContent = String(active + 1).padStart(2, '0');
}

function paintGrowingPollen(canvas, progress) {
  if (!canvas) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const reveal = easeScene((progress - .45) / .26);
  if (!reveal) return;
  const mobile = window.innerWidth < 760;
  const count = mobile ? 58 : 156;
  const centerX = width * .53;
  const centerY = height * .26;
  const phase = progress * Math.PI * 3.2;
  for (let index = 0; index < count; index += 1) {
    const seed = ((index * 67) % count) / count;
    const lane = (index % 7) / 6;
    const drift = progress * (.035 + (index % 4) * .008);
    const spread = ((seed + drift) % 1) - .5;
    const x = centerX + spread * width * (.22 + lane * .42) + Math.sin(phase + index * .79) * 3;
    const y = centerY + (lane - .35) * height * .23 + Math.sin(phase * .7 + index * .61) * height * .045;
    const radius = .7 + (index % 5) * .28;
    const alpha = reveal * (.13 + (index % 4) * .055);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = index % 6 === 0
      ? 'rgba(255,229,166,' + alpha + ')'
      : 'rgba(255,248,220,' + alpha + ')';
    context.fill();
    if (index % 23 === 0) {
      context.beginPath();
      context.moveTo(x - radius * 2.5, y);
      context.lineTo(x + radius * 2.5, y);
      context.moveTo(x, y - radius * 2.5);
      context.lineTo(x, y + radius * 2.5);
      context.strokeStyle = 'rgba(255,232,176,' + (alpha * .74) + ')';
      context.lineWidth = .7;
      context.stroke();
    }
  }
}

function updateWorldScenes(top) {
  const opening = $('[data-opening-scene].is-enhanced');
  if (opening) {
    const track = $('.opening-track', opening);
    const stage = $('.opening-stage', opening);
    const progress = pinnedProgress(track, stage, top);
    const image = $('.opening-image-layer img', opening);
    const copy = $('.opening-copy', opening);
    const date = $('.opening-date', opening);
    const caption = $('.opening-caption', opening);
    const facts = $('.opening-facts', opening);
    setMotionValue(stage, '--opening-progress', progress, '');
    setMotionValue(image, '--opening-photo-scale', 1.075 + progress * .19, '');
    setMotionValue(image, '--opening-photo-x', progress * -20, 'px');
    setMotionValue(image, '--opening-photo-y', progress * -24, 'px');
    setMotionValue(copy, '--opening-copy-x', progress * -17, 'px');
    setMotionValue(copy, '--opening-copy-y', progress * -19, 'px');
    setMotionValue(copy, '--opening-copy-scale', 1 - progress * .055, '');
    setMotionValue(copy, '--opening-copy-opacity', 1 - progress * .22, '');
    setMotionValue($('.opening-copy h1', opening), '--opening-title-y', progress * -9, 'px');
    setMotionValue(date, '--opening-date-x', progress * -11, 'px');
    setMotionValue(date, '--opening-date-y', progress * 17, 'px');
    setMotionValue(caption, '--opening-caption-y', progress * 12, 'px');
    setMotionValue(facts, '--opening-facts-y', progress * 9, 'px');
    setMotionValue(facts, '--opening-facts-opacity', .92 + progress * .08, '');
    $$('.opening-halo', opening).forEach((halo, index) => {
      setMotionValue(halo, '--opening-halo-y', progress * (index ? 22 : -24), 'px');
      setMotionValue(halo, '--opening-halo-scale', 1 + progress * (index ? .055 : .035), '');
    });
    const word = $('.opening-word', opening);
    setMotionValue(word, '--opening-word-x', progress * -38, 'px');
    setMotionValue(word, '--opening-word-y', progress * 18, 'px');
    setMotionValue(word, '--opening-word-scale', 1.04 - progress * .045, '');
    const after = easeScene((progress - .37) / .28);
    setMotionValue(stage, '--opening-after-opacity', after, '');
    setMotionValue(stage, '--opening-after-y', (1 - after) * 15, 'px');
    const currentState = stage.dataset.openingState === '1';
    const nextState = currentState ? progress > .45 : progress > .51;
    if (String(Number(nextState)) !== (stage.dataset.openingState || '0')) stage.dataset.openingState = String(Number(nextState));
  }

  const growing = $('[data-growing-scene].is-enhanced');
  if (growing) {
    const track = $('.growing-track', growing);
    const stage = $('.growing-stage', growing);
    const progress = pinnedProgress(track, stage, top);
    const active = sceneChapter(growing, 'activeChapter', progress * 2);
    setSceneChapters(growing, '.growing-chapter', '[data-growing-jump]', active);
    const count = $('#growing-count', growing);
    if (count && count.textContent !== String(active + 1).padStart(2, '0')) count.textContent = String(active + 1).padStart(2, '0');
    const plant = $('.growing-plant', growing);
    const cinematicArt = $('.growing-cinematic-art', growing);
    const root = easeScene(progress / .27);
    const stem = easeScene((progress - .08) / .47);
    const leaves = easeScene((progress - .27) / .28);
    const bloom = easeScene((progress - .51) / .31);
    const pollination = easeScene((progress - .7) / .23);
    setMotionValue(stage, '--scene-progress', progress, '');
    setMotionValue($('.growing-photo', growing), '--growing-photo-opacity', .1 + progress * .12, '');
    setMotionValue($('.growing-photo', growing), '--growing-photo-scale', 1.07 + progress * .1, '');
    setMotionValue($('.growing-light', growing), '--growing-light-opacity', .22 + bloom * .68, '');
    setMotionValue(plant, '--growing-plant-scale', .89 + progress * .11 + bloom * .025, '');
    setMotionValue(plant, '--growing-plant-x', Math.sin(progress * Math.PI) * -8, 'px');
    setMotionValue(plant, '--growing-plant-y', (1 - progress) * 8, 'px');
    setMotionValue($('.growing-word', growing), '--growing-word-x', progress * -72, 'px');
    setMotionValue(plant, '--roots-offset', 1 - root, '');
    setMotionValue(plant, '--roots-opacity', .18 + root * .82, '');
    setMotionValue(plant, '--stem-offset', 1 - stem, '');
    setMotionValue(plant, '--leaves-opacity', leaves, '');
    setMotionValue(plant, '--leaves-scale', .72 + leaves * .28, '');
    setMotionValue(plant, '--bloom-stem-opacity', bloom, '');
    setMotionValue(plant, '--flower-opacity', bloom, '');
    setMotionValue(plant, '--flower-scale', .14 + bloom * .86, '');
    setMotionValue(plant, '--bee-opacity', pollination, '');
    setMotionValue(plant, '--bee-x', 690 - pollination * 170, 'px');
    setMotionValue(plant, '--bee-y', 300 - pollination * 85, 'px');
    setMotionValue(plant, '--sun-opacity', .28 + bloom * .67, '');
    setMotionValue(plant, '--sun-scale', .82 + bloom * .27, '');
    setMotionValue(plant, '--seed-opacity', 1 - root, '');
    setMotionValue($('.growing-pollen', growing), '--pollen-opacity', .16 + bloom * .44, '');
    setMotionValue(cinematicArt, '--growing-art-scale', 1.03 + progress * .08, '');
    setMotionValue(cinematicArt, '--growing-art-x', Math.sin(progress * Math.PI) * -10, 'px');
    setMotionValue(cinematicArt, '--growing-art-y', (1 - progress) * 8, 'px');
    const pollen = $('.growing-pollen', growing);
    const pollenRect = pollen.getBoundingClientRect();
    if (pollenRect.bottom > 0 && pollenRect.top < window.innerHeight) paintGrowingPollen(pollen, progress);
  }

  const place = $('[data-place-scene].is-enhanced');
  if (place) {
    const track = $('.place-track', place);
    const stage = $('.place-stage', place);
    const windowView = $('.place-world-window', place);
    const panorama = $('.place-cinematic-art', place) || $('.place-panorama', place);
    const progress = pinnedProgress(track, stage, top);
    const chapterPosition = progress * 2;
    const active = sceneChapter(place, 'activePlace', chapterPosition);
    setSceneChapters(place, '.place-caption', '[data-place-jump]', active);
    const maxShift = Math.max(0, panorama.clientWidth - windowView.clientWidth);
    const shift = maxShift * progress;
    setMotionValue(panorama, '--place-shift', -shift, 'px');
    setMotionValue(panorama, '--place-art-y', Math.sin(progress * Math.PI) * -6, 'px');
    setMotionValue(panorama, '--place-art-scale', 1 + Math.sin(progress * Math.PI) * .018, '');
    setMotionValue(stage, '--place-progress', progress, '');
    setMotionValue(stage, '--place-atmosphere', .38 + Math.sin(progress * Math.PI) * .17, '');
    setMotionValue($('.place-copy', place), '--place-copy-y', (progress - .5) * -15, 'px');
    setMotionValue($('.place-bees', place), '--place-bee-opacity', .38 + Math.sin(progress * Math.PI) * .42, '');
    $$('.place-environment', place).forEach((environment, index) => {
      const weight = clamp(1 - Math.abs(chapterPosition - index), 0, 1);
      setMotionValue(environment, '--place-env-opacity', .68 + weight * .32, '');
      setMotionValue(environment, '--place-env-scale', .97 + weight * .03, '');
    });
    const names = ['WINDOW BOX', 'BALCONY', 'COMMUNITY'];
    const label = $('#place-progress-label', place);
    const text = String(active + 1).padStart(2, '0') + ' / 03 · ' + names[active];
    if (label && label.textContent !== text) label.textContent = text;
    const index = $('.place-scroll-index b', place);
    const indexText = String(active + 1).padStart(2, '0') + ' — 03';
    if (index && index.textContent !== indexText) index.textContent = indexText;
  }

  const ritual = $('[data-ritual-scene].is-enhanced');
  if (ritual) {
    const track = $('.ritual-track', ritual);
    const stage = $('.ritual-stage', ritual);
    const progress = pinnedProgress(track, stage, top);
    const active = sceneChapter(ritual, 'activeStep', progress * 2);
    setSceneChapters(ritual, '.ritual-chapter', '[data-ritual-jump]', active);
    const words = ['CHOOSE', 'PLANT', 'SHARE'];
    const word = $('#ritual-word', ritual);
    if (word && word.textContent !== words[active]) word.textContent = words[active];
    const count = $('#ritual-count', ritual);
    if (count && count.textContent !== String(active + 1).padStart(2, '0')) count.textContent = String(active + 1).padStart(2, '0');
    const garden = easeScene((progress - .35) / .65);
    const orbit = $('.ritual-cinematic-art', ritual) || $('.ritual-orbit', ritual);
    const flower = $('.ritual-flower', ritual);
    setMotionValue(stage, '--scene-progress', progress, '');
    setMotionValue(stage, '--ritual-atmosphere-one', 1 - garden * .92, '');
    setMotionValue(stage, '--ritual-atmosphere-two', garden, '');
    setMotionValue(orbit, '--ritual-art-scale', .91 + garden * .07, '');
    setMotionValue(orbit, '--ritual-photo-y', Math.sin(progress * Math.PI) * -8, 'px');
    setMotionValue(orbit, '--ritual-photo-x', progress * -10, 'px');
    setMotionValue(orbit, '--ritual-orbit-rotate', -8 + progress * 18, 'deg');
    setMotionValue(flower, '--ritual-flower-scale', .74 + garden * .24 + Math.sin(progress * Math.PI) * .07, '');
    setMotionValue(flower, '--ritual-flower-rotate', progress * 13, 'deg');
    setMotionValue(word, '--ritual-word-x', progress * -31, 'px');
    setMotionValue(word, '--ritual-word-y', progress * 9, 'px');
    setMotionValue(word, '--ritual-word-scale', .94 + progress * .1, '');
    setMotionValue(word, '--ritual-word-opacity', .11 + Math.sin(progress * Math.PI) * .12, '');
    setMotionValue($('.ritual-path', ritual), '--ritual-path-offset', 1 - progress, '');
    const bee = $('.ritual-orbit-bee', ritual);
    const angle = -Math.PI / 2 + progress * Math.PI * 2;
    if (bee) {
      const cx = Math.round(400 + Math.cos(angle) * 310);
      const cy = Math.round(400 + Math.sin(angle) * 310);
      if (bee.getAttribute('cx') !== String(cx)) bee.setAttribute('cx', String(cx));
      if (bee.getAttribute('cy') !== String(cy)) bee.setAttribute('cy', String(cy));
    }
  }

  if (!motionSettings.enabled) return;
  const openingStatic = $('[data-opening-scene]:not(.is-enhanced)');
  const growingStatic = $('[data-growing-scene]:not(.is-enhanced)');
  const placeStatic = $('[data-place-scene]:not(.is-enhanced)');
  const ritualStatic = $('[data-ritual-scene]:not(.is-enhanced)');
  const viewportProgress = (section) => {
    const rect = section.getBoundingClientRect();
    return clamp((window.innerHeight - rect.top) / Math.max(1, window.innerHeight + rect.height), 0, 1);
  };
  if (openingStatic) {
    const progress = viewportProgress(openingStatic);
    const image = $('.opening-image-layer img', openingStatic);
    setMotionValue(image, '--opening-photo-scale', 1.07 + progress * .055, '');
    setMotionValue(image, '--opening-photo-x', progress * -6, 'px');
    setMotionValue(image, '--opening-photo-y', progress * -8, 'px');
  }
  if (growingStatic) {
    const progress = viewportProgress(growingStatic);
    const plant = $('.growing-plant', growingStatic);
    const cinematicArt = $('.growing-cinematic-art', growingStatic);
    setMotionValue(plant, '--growing-plant-scale', 1.015 - Math.sin(progress * Math.PI) * .025, '');
    setMotionValue(plant, '--growing-plant-y', progress * -5, 'px');
    setMotionValue(cinematicArt, '--growing-art-scale', 1.03 + progress * .04, '');
    setMotionValue(cinematicArt, '--growing-art-y', progress * -5, 'px');
    setMotionValue(plant, '--bee-x', 690 - easeScene(progress) * 25, 'px');
    setMotionValue(plant, '--bee-y', 300 - easeScene(progress) * 12, 'px');
  }
  if (placeStatic) {
    const progress = viewportProgress(placeStatic);
    setMotionValue($('.place-cinematic-art', placeStatic) || $('.place-panorama', placeStatic), '--place-art-y', progress * -4, 'px');
  }
  if (ritualStatic) {
    const progress = viewportProgress(ritualStatic);
    const orbit = $('.ritual-cinematic-art', ritualStatic) || $('.ritual-orbit', ritualStatic);
    setMotionValue(orbit, '--ritual-art-scale', .98 + Math.sin(progress * Math.PI) * .012, '');
    setMotionValue(orbit, '--ritual-photo-y', Math.sin(progress * Math.PI) * -5, 'px');
    setMotionValue(orbit, '--ritual-orbit-rotate', progress * 2.5, 'deg');
  }
}

function paintStoryWorld(visual, progress) {
  const canvas = $('.story-world-canvas', visual);
  if (!canvas || !visual) return;
  const width = visual.clientWidth;
  const height = visual.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const drawBranch = (points, amount, alpha) => {
    const t = clamp(amount, 0, 1);
    if (t <= 0) return;
    const [start, controlA, controlB, end] = points;
    const steps = Math.max(2, Math.ceil(t * 30));
    context.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const at = t * step / steps;
      const inverse = 1 - at;
      const x = inverse ** 3 * start[0] + 3 * inverse ** 2 * at * controlA[0] + 3 * inverse * at ** 2 * controlB[0] + at ** 3 * end[0];
      const y = inverse ** 3 * start[1] + 3 * inverse ** 2 * at * controlA[1] + 3 * inverse * at ** 2 * controlB[1] + at ** 3 * end[1];
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = 'rgba(246, 222, 157, ' + alpha + ')';
    context.lineWidth = 1.75;
    context.shadowColor = 'rgba(245, 209, 119, ' + (alpha * .62) + ')';
    context.shadowBlur = 7;
    context.stroke();
    context.shadowBlur = 0;
  };
  const drawFlower = (x, y, size, alpha) => {
    if (size < 1) return;
    context.save();
    context.translate(x, y);
    context.fillStyle = 'rgba(251, 233, 179, ' + alpha * .24 + ')';
    for (let petal = 0; petal < 6; petal += 1) {
      context.save();
      context.rotate(petal * Math.PI / 3);
      context.beginPath();
      context.ellipse(0, -size * .67, size * .3, size * .68, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.beginPath();
    context.arc(0, 0, Math.max(1.4, size * .18), 0, Math.PI * 2);
    context.fillStyle = 'rgba(250, 211, 111, ' + alpha * .82 + ')';
    context.fill();
    context.restore();
  };

  const stem = [.46 * width, .96 * height];
  const crown = [.53 * width, .55 * height];
  drawBranch([stem, [.47 * width, .78 * height], [.5 * width, .71 * height], crown], progress * 1.7, .42 + progress * .25);
  drawBranch([crown, [.49 * width, .45 * height], [.42 * width, .36 * height], [.35 * width, .29 * height]], (progress - .2) * 2.1, .39);
  drawBranch([crown, [.58 * width, .46 * height], [.64 * width, .36 * height], [.68 * width, .28 * height]], (progress - .3) * 2.2, .38);
  drawBranch([crown, [.46 * width, .63 * height], [.4 * width, .75 * height], [.35 * width, .83 * height]], (progress - .45) * 2.2, .36);
  drawBranch([crown, [.59 * width, .62 * height], [.64 * width, .73 * height], [.69 * width, .82 * height]], (progress - .6) * 2.3, .35);
  drawBranch([crown, [.54 * width, .44 * height], [.55 * width, .33 * height], [.56 * width, .23 * height]], (progress - .12) * 2.15, .33);

  drawFlower(crown[0], crown[1], 9 + clamp((progress - .1) * 72, 0, 38), .96);
  drawFlower(.35 * width, .29 * height, clamp((progress - .3) * 56, 0, 24), .72);
  drawFlower(.68 * width, .28 * height, clamp((progress - .4) * 52, 0, 22), .74);
  drawFlower(.35 * width, .83 * height, clamp((progress - .57) * 49, 0, 19), .62);
  drawFlower(.69 * width, .82 * height, clamp((progress - .72) * 46, 0, 17), .6);

  const bloomGlow = clamp((progress - .08) * 1.25, 0, 1);
  if (bloomGlow > 0) {
    const glow = context.createRadialGradient(crown[0], crown[1], 2, crown[0], crown[1], height * (.09 + bloomGlow * .17));
    glow.addColorStop(0, 'rgba(255, 223, 139, ' + (.16 * bloomGlow) + ')');
    glow.addColorStop(1, 'rgba(255, 223, 139, 0)');
    context.fillStyle = glow;
    context.fillRect(crown[0] - height * .27, crown[1] - height * .27, height * .54, height * .54);
  }

  const soil = context.createLinearGradient(.38 * width, .94 * height, width, .94 * height);
  soil.addColorStop(0, 'rgba(247, 222, 157, 0)');
  soil.addColorStop(.46, 'rgba(247, 222, 157, .25)');
  soil.addColorStop(1, 'rgba(247, 222, 157, 0)');
  context.beginPath();
  context.moveTo(.38 * width, .94 * height);
  context.bezierCurveTo(.54 * width, .91 * height, .76 * width, .96 * height, width, .92 * height);
  context.strokeStyle = soil;
  context.lineWidth = 1;
  context.stroke();

  const pollenCount = width < 760 ? 112 : 380;
  for (let index = 0; index < pollenCount; index += 1) {
    const seed = (index * 0.61803398875) % 1;
    const reveal = clamp((progress * 1.3 - seed) * 7, 0, 1);
    if (reveal <= 0) continue;
    const drift = (seed + progress * (.13 + (index % 5) * .012)) % 1;
    const x = width * (.3 + drift * .68);
    const spine = .76 - drift * .48 + Math.sin(drift * Math.PI * 3 + progress * 2.8) * .07;
    const spread = .03 + Math.sin(seed * Math.PI) * .14;
    const y = height * (spine + Math.sin(index * 91.73) * spread);
    const radius = 1 + (index % 5) * .43;
    const alpha = reveal * (.34 + (index % 6) * .065);
    context.beginPath();
    if (index % 25 === 0) {
      context.moveTo(x - radius * 2, y);
      context.lineTo(x + radius * 2, y);
      context.moveTo(x, y - radius * 2);
      context.lineTo(x, y + radius * 2);
      context.strokeStyle = 'rgba(255, 237, 187, ' + alpha + ')';
      context.lineWidth = 1;
      context.stroke();
      continue;
    }
    if (index % 9 === 0) {
      context.save();
      context.translate(x, y);
      context.rotate(seed * Math.PI + progress * .6);
      context.ellipse(0, 0, radius * 1.7, radius * .78, 0, 0, Math.PI * 2);
      context.fillStyle = 'rgba(255, 236, 181, ' + alpha + ')';
      context.fill();
      context.restore();
      continue;
    }
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = index % 7 === 0
      ? 'rgba(255, 221, 131, ' + alpha + ')'
      : 'rgba(255, 247, 218, ' + alpha + ')';
    context.fill();
  }
  const travel = clamp(progress * 1.7, 0, 1);
  const point = [
    (1 - travel) ** 3 * stem[0] + 3 * (1 - travel) ** 2 * travel * (.57 * width) + 3 * (1 - travel) * travel ** 2 * (.59 * width) + travel ** 3 * crown[0],
    (1 - travel) ** 3 * stem[1] + 3 * (1 - travel) ** 2 * travel * (.78 * height) + 3 * (1 - travel) * travel ** 2 * (.73 * height) + travel ** 3 * crown[1]
  ];
  context.beginPath();
  context.arc(point[0], point[1], 2.3, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255, 238, 186, .9)';
  context.shadowColor = 'rgba(245, 209, 119, .82)';
  context.shadowBlur = 12;
  context.fill();
  context.shadowBlur = 0;

  const easeInOut = (value) => {
    const amount = clamp(value, 0, 1);
    return amount * amount * (3 - 2 * amount);
  };
  const drawBloomCloud = (cx, cy, radius, amount, rotation, variant) => {
    const reveal = clamp(amount, 0, 1);
    if (reveal < .01) return;
    const halo = context.createRadialGradient(cx, cy, 1, cx, cy, radius * 1.38);
    halo.addColorStop(0, 'rgba(255, 221, 139, ' + (.11 * reveal) + ')');
    halo.addColorStop(.46, 'rgba(240, 203, 121, ' + (.045 * reveal) + ')');
    halo.addColorStop(1, 'rgba(240, 203, 121, 0)');
    context.fillStyle = halo;
    context.fillRect(cx - radius * 1.4, cy - radius * 1.4, radius * 2.8, radius * 2.8);

    context.save();
    context.translate(cx, cy);
    context.rotate(rotation);
    const count = variant === 0 ? 224 : 100;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let index = 0; index < count; index += 1) {
      const seed = ((index * .61803398875 + variant * .271) % 1);
      const angle = index * goldenAngle + variant * 1.7;
      const lobe = .28 + .72 * Math.pow(Math.max(0, (Math.cos(angle * 5) + 1) * .5), 1.45);
      const depth = Math.cos(angle * 2 + progress * 2.1 + variant);
      const distance = radius * Math.sqrt(seed) * lobe * (.92 + depth * .08);
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance * (.66 + depth * .035);
      const size = .8 + ((depth + 1) * .46) + (index % 3) * .2;
      const alpha = reveal * (.38 + (depth + 1) * .17);
      context.beginPath();
      if (index % 19 === 0) {
        context.arc(x, y, size * 1.9, 0, Math.PI * 2);
        context.strokeStyle = 'rgba(255, 235, 179, ' + (alpha * .64) + ')';
        context.lineWidth = .7;
        context.stroke();
      } else {
        context.arc(x, y, size, 0, Math.PI * 2);
        context.fillStyle = (index + variant) % 6 === 0
          ? 'rgba(255, 219, 129, ' + alpha + ')'
          : 'rgba(255, 247, 220, ' + alpha + ')';
        context.fill();
      }
    }
    context.restore();
  };

  // A bloom resolves from a single warm point, then connects to its neighbours.
  // Scroll progress drives the form, so it stays calm between gestures and also
  // remains deterministic when someone scrolls quickly or moves back up.
  const bloomReveal = easeInOut((progress - .015) / .23);
  const constellationReveal = easeInOut((progress - .36) / .34);
  const rippleReveal = easeInOut((progress - .66) / .3);
  const centerX = width * .51;
  const centerY = height * .51;
  const bloomRadius = height * .28;
  const upperBloom = [width * .985, height * .3];
  const lowerBloom = [width * .985, height * .76];
  context.save();
  context.beginPath();
  context.rect(width * .42, 0, width * .58, height);
  context.clip();
  drawBranch([[centerX, centerY], [width * .67, height * .48], [width * .75, height * .35], upperBloom], constellationReveal * 1.55, .43);
  drawBranch([[centerX, centerY], [width * .68, height * .62], [width * .77, height * .76], lowerBloom], constellationReveal * 1.55, .39);
  drawBloomCloud(centerX, centerY, bloomRadius, bloomReveal * (1 - rippleReveal * .34), progress * .22, 0);
  drawBloomCloud(upperBloom[0], upperBloom[1], height * .16, constellationReveal, progress * -.28, 1);
  drawBloomCloud(lowerBloom[0], lowerBloom[1], height * .155, constellationReveal, progress * .34, 2);

  if (rippleReveal > 0) {
    context.save();
    context.translate(centerX, centerY);
    context.rotate(progress * -.16);
    for (let ring = 0; ring < 3; ring += 1) {
      const radius = height * (.2 + ring * .075) * (.82 + rippleReveal * .22);
      context.beginPath();
      context.ellipse(0, 0, radius * 1.28, radius * .69, 0, .12 * Math.PI, 1.94 * Math.PI);
      context.strokeStyle = 'rgba(255, 229, 169, ' + (rippleReveal * (.13 - ring * .027)) + ')';
      context.lineWidth = ring === 0 ? 1.1 : .7;
      context.stroke();
    }
    context.restore();
  }
  context.restore();
}

function paintClosingField(canvas, progress) {
  if (!canvas) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const mobile = window.innerWidth < 760;
  const phase = progress * Math.PI * 2.8 - .45;
  const layers = mobile ? 4 : 7;
  for (let layer = 0; layer < layers; layer += 1) {
    const offset = layer / Math.max(1, layers - 1);
    context.beginPath();
    for (let point = 0; point <= 84; point += 1) {
      const x = width * point / 84;
      const t = x / width;
      const wave = Math.sin(t * Math.PI * 2.25 + phase + layer * .46);
      const y = height * (.39 + offset * .48) + wave * height * (.075 + offset * .055);
      if (point === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.strokeStyle = 'rgba(255, 225, 149, ' + (.03 + (layer % 3) * .012) + ')';
    context.lineWidth = layer === 3 ? 1.25 : .72;
    context.stroke();
  }

  const count = mobile ? 150 : 920;
  for (let index = 0; index < count; index += 1) {
    const seed = ((index * 73) % count) / count;
    const drift = progress * (.12 + (index % 5) * .014);
    const x = ((seed + drift) % 1) * width;
    const t = x / width;
    const layer = index % layers;
    const offset = layer / Math.max(1, layers - 1);
    const wave = Math.sin(t * Math.PI * 2.25 + phase + layer * .46);
    const jitter = Math.sin(index * 91.73) * height * (.035 + offset * .025);
    const y = height * (.39 + offset * .48) + wave * height * (.075 + offset * .055) + jitter;
    const radius = .72 + (index % 8) * .34;
    const warm = index % 7 === 0 || index % 11 === 0;
    context.beginPath();
    if (index % 31 === 0) {
      const gleam = radius * 2.2;
      context.moveTo(x - gleam, y);
      context.lineTo(x + gleam, y);
      context.moveTo(x, y - gleam);
      context.lineTo(x, y + gleam);
      context.strokeStyle = warm ? 'rgba(255, 226, 148, .42)' : 'rgba(255, 255, 255, .36)';
      context.lineWidth = .9;
      context.stroke();
      continue;
    }
    if (index % 17 === 0) {
      context.save();
      context.translate(x, y);
      context.rotate(Math.PI / 4 + progress * .22);
      context.fillStyle = warm ? 'rgba(255, 225, 149, .44)' : 'rgba(255, 255, 255, .4)';
      context.fillRect(-radius * .72, -radius * .72, radius * 1.44, radius * 1.44);
      context.restore();
      continue;
    }
    if (index % 9 === 0) {
      context.save();
      context.translate(x, y);
      context.rotate((index % 6) * .22 + progress * .3);
      context.ellipse(0, 0, radius * 1.65, radius * .74, 0, 0, Math.PI * 2);
      context.fillStyle = warm ? 'rgba(255, 225, 149, .44)' : 'rgba(255, 255, 255, .42)';
      context.fill();
      context.restore();
      continue;
    }
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = warm
      ? 'rgba(255, 226, 151, ' + (.16 + (index % 6) * .04) + ')'
      : 'rgba(247, 249, 255, ' + (.18 + (index % 6) * .04) + ')';
    context.fill();
  }
}

function updateMotionFrame() {
  motionSettings.frame = 0;
  const root = document.documentElement;
  const pageRange = Math.max(1, root.scrollHeight - window.innerHeight);
  const pageProgress = clamp(window.scrollY / pageRange, 0, 1);
  const progressFill = $('#reading-progress-fill');
  if (progressFill) progressFill.style.transform = 'scaleX(' + pageProgress + ')';
  document.body.classList.toggle('is-scrolled', window.scrollY > 36);
  setMotionValue(document.body, '--page-progress', pageProgress, '');

  if (document.body.classList.contains('is-app')) {
    document.body.dataset.appProgress = pageProgress.toFixed(3);
    setMotionValue(document.body, '--workspace-drift', pageProgress * -80, 'px');
    return;
  }

  setActiveScene();
  setMotionValue(document.body, '--global-drift', pageProgress * 100, 'px');
  setMotionValue(document.body, '--ambient-gold-y', pageProgress * -30, 'px');
  setMotionValue(document.body, '--ambient-green-y', pageProgress * -56, 'px');
  setMotionValue(document.body, '--ambient-word-y', pageProgress * -20, 'px');
  setMotionValue(document.body, '--progress-turn', pageProgress * 8, 'deg');
  const top = stickyTop();
  updateCinematicJourney(top);
  updateWorldScenes(top);

  const hero = $('.hero');
  const heroSequence = $('[data-hero-sequence]');
  const heroMedia = $('.hero-media');
  if (hero && heroSequence && heroMedia && heroSequence.classList.contains('is-motion-enhanced')) {
    const rect = hero.getBoundingClientRect();
    const progress = clamp((-rect.top) / Math.max(1, rect.height * .72), 0, 1);
    setMotionValue(heroSequence, '--hero-progress', progress, '');
    setMotionValue(heroSequence, '--hero-stage-scale', 1 - progress * .035, '');
    setMotionValue(heroSequence, '--hero-stage-shift', progress * -16, 'px');
    setMotionValue(heroSequence, '--hero-copy-shift', progress * -17, 'px');
    setMotionValue(heroSequence, '--hero-copy-opacity', 1 - progress * .16, '');
    setMotionValue(heroMedia, '--hero-photo-scale', 1.035 + progress * .12, '');
    setMotionValue(heroMedia, '--hero-photo-shift', progress * -23, 'px');
    setMotionValue(heroMedia, '--hero-sticker-shift', progress * -13, 'px');
    setMotionValue(heroMedia, '--hero-caption-shift', progress * 9, 'px');
  }

  const promise = $('.promise-bar');
  if (promise) {
    const rect = promise.getBoundingClientRect();
    const progress = clamp((window.innerHeight - rect.top) / Math.max(1, window.innerHeight * .52), 0, 1);
    const inner = $('.promise-inner', promise);
    setMotionValue(inner, '--promise-rise', (1 - progress) * 22, 'px');
    setMotionValue(inner, '--promise-scale', .975 + progress * .025, '');
  }

  const story = $('[data-scroll-story].is-scroll-enhanced');
  if (story) {
    const track = $('.story-scroll-track', story);
    const pin = $('.story-pin', story);
    const progress = pinnedProgress(track, pin, top);
    setMotionValue(pin, '--pin-exit-opacity', pinExitOpacity(progress), '');
    const smoothStage = (value) => {
      const amount = clamp(value, 0, 1);
      return amount * amount * (3 - 2 * amount);
    };
    const cardPosition = smoothStage((progress - .16) / .2) + smoothStage((progress - .64) / .2);
    const chapterPosition = cardPosition;
    let activeChapter = Number(story.dataset.activeChapter);
    if (!Number.isFinite(activeChapter)) activeChapter = Math.round(chapterPosition);
    while (activeChapter < 2 && chapterPosition > activeChapter + .54) activeChapter += 1;
    while (activeChapter > 0 && chapterPosition < activeChapter - .46) activeChapter -= 1;
    story.dataset.activeChapter = String(activeChapter);
    const photo = $('.story-photo', story);
    if (photo) photo.style.transform = 'translate3d(0,' + (-progress * 24) + 'px,0) scale(' + (1.04 + progress * .21) + ')';
    $$('.story-pollen', story).forEach((pollen, index) => setMotionValue(pollen, '--pollen-shift', -progress * (16 + index * 9), 'px'));
    $$('.story-chapter', story).forEach((chapter, index) => {
      const alpha = index === activeChapter ? 1 : 0;
      setMotionValue(chapter, '--story-alpha', alpha, '');
      setMotionValue(chapter, '--story-rise', (1 - alpha) * 20, 'px');
      setMotionValue(chapter, '--story-slide', index < activeChapter ? -14 : 14, 'px');
      const hidden = String(index !== activeChapter);
      if (chapter.getAttribute('aria-hidden') !== hidden) chapter.setAttribute('aria-hidden', hidden);
      const visibility = hidden === 'true' ? 'hidden' : 'visible';
      if (chapter.style.visibility !== visibility) chapter.style.visibility = visibility;
    });
    const visual = $('.story-visual', story);
    const visualWidth = visual ? visual.clientWidth : 0;
    setMotionValue(visual, '--story-world-scale', 1.02 + progress * .22, '');
    setMotionValue(visual, '--story-world-x', -progress * 17, 'px');
    setMotionValue(visual, '--story-world-y', progress * -8, 'px');
    setMotionValue(visual, '--story-world-saturation', .84 + progress * .38, '');
    setMotionValue(visual, '--story-world-brightness', .72 + progress * .12, '');
    setMotionValue($('.story-world-word', visual), '--story-word-y', (1 - progress) * 19, 'px');
    setMotionValue($('.story-world-word', visual), '--story-word-x', -progress * 28, 'px');
    setMotionValue($('.story-world-word', visual), '--story-word-scale', .94 + progress * .15, '');
    paintStoryWorld(visual, progress);
    $$('[data-story-mockup]', visual || story).forEach((card, index) => {
      const distance = index - cardPosition;
      const depth = Math.abs(distance);
      setMotionValue(card, '--mockup-x', distance * visualWidth * .34, 'px');
      setMotionValue(card, '--mockup-y', clamp(distance * 9, -18, 18), 'px');
      setMotionValue(card, '--mockup-scale', 1 - Math.min(depth, 2) * .075, '');
      setMotionValue(card, '--mockup-rotate', clamp(distance * -5, -10, 10), 'deg');
      setMotionValue(card, '--mockup-opacity', Math.pow(clamp(1 - depth, 0, 1), 1.5), '');
      const zIndex = String(20 - Math.round(depth * 3));
      const cardVisibility = depth > 1.05 ? 'hidden' : 'visible';
      if (card.style.zIndex !== zIndex) card.style.zIndex = zIndex;
      if (card.style.visibility !== cardVisibility) card.style.visibility = cardVisibility;
    });
    const sceneNumber = $('#story-scene-number', story);
    if (sceneNumber && sceneNumber.textContent !== String(activeChapter + 1)) sceneNumber.textContent = String(activeChapter + 1);
    $$('[data-story-jump]', story).forEach((button) => {
      const current = Number(button.dataset.storyJump) === activeChapter;
      if (current && button.getAttribute('aria-current') !== 'step') button.setAttribute('aria-current', 'step');
      else if (!current) button.removeAttribute('aria-current');
    });
  }

  const day = $('[data-step-story].is-scroll-enhanced');
  if (day) {
    const pin = $('.day-pin', day);
    const progress = pinnedProgress($('.day-scroll-track', day), pin, top);
    setMotionValue(pin, '--pin-exit-opacity', pinExitOpacity(progress), '');
    const chapterPosition = progress * 2;
    let activeStep = Number(day.dataset.activeStep);
    if (!Number.isFinite(activeStep)) activeStep = Math.round(chapterPosition);
    while (activeStep < 2 && chapterPosition > activeStep + .58) activeStep += 1;
    while (activeStep > 0 && chapterPosition < activeStep - .58) activeStep -= 1;
    day.dataset.activeStep = String(activeStep);
    $$('.step-card', day).forEach((card, index) => {
      const distance = index - chapterPosition;
      const depth = Math.abs(distance);
      setMotionValue(card, '--stack-y', distance * 70, 'px');
      setMotionValue(card, '--stack-scale', 1 - Math.min(depth, 2) * .055, '');
      setMotionValue(card, '--stack-rotate', clamp(distance * 2.2, -5, 5), 'deg');
      setMotionValue(card, '--stack-opacity', clamp(1 - depth * .2, .44, 1), '');
      setMotionValue(card, '--stack-depth', 10 - Math.round(depth * 2), '');
      if (index === activeStep) card.setAttribute('aria-current', 'step');
      else card.removeAttribute('aria-current');
    });
    if ($('#step-story-fill')) $('#step-story-fill').style.transform = 'scaleX(' + progress + ')';
    const labels = ['CHOOSE', 'PLANT', 'SHARE'];
    if ($('#step-story-count')) $('#step-story-count').innerHTML = String(activeStep + 1).padStart(2, '0') + ' <i>/ 03</i>';
    if ($('#step-story-label')) $('#step-story-label').textContent = labels[activeStep];
  }

  const space = $('[data-horizontal-story].is-scroll-enhanced');
  if (space) {
    const trackRegion = $('.space-scroll-track', space);
    const pin = $('.space-pin', space);
    const viewport = $('.space-viewport', space);
    const track = $('.space-track', space);
    const progress = pinnedProgress(trackRegion, pin, top);
    setMotionValue(pin, '--pin-exit-opacity', pinExitOpacity(progress), '');
    const cards = $$('.space-card', track);
    const maxShift = Math.max(0, track.scrollWidth - viewport.clientWidth);
    const ease = progress + Math.sin(Math.PI * progress) * .045;
    const shift = maxShift * ease;
    if (track) track.style.transform = 'translate3d(' + (-shift) + 'px,0,0)';
    if ($('#space-progress-fill')) $('#space-progress-fill').style.transform = 'scaleX(' + progress + ')';
    let active = 0;
    let bestDistance = Infinity;
    cards.forEach((card, index) => {
      const center = card.offsetLeft + card.offsetWidth / 2 - shift;
      const distance = Math.abs(center - viewport.clientWidth / 2);
      if (distance < bestDistance) { bestDistance = distance; active = index; }
    });
    if (space.dataset.activeCard !== String(active)) {
      cards.forEach((card, index) => {
        if (index === active) { card.classList.add('is-current'); card.setAttribute('aria-current', 'step'); }
        else { card.classList.remove('is-current'); card.removeAttribute('aria-current'); }
      });
      space.dataset.activeCard = String(active);
    }
    const short = active === 0 ? 'WINDOW BOX' : (active === 1 ? 'BALCONY' : 'COMMUNITY');
    const label = $('#space-step-label');
    if (label && label.dataset.activeIndex !== String(active)) {
      label.innerHTML = String(active + 1).padStart(2, '0') + ' <span>/ 03</span> · ' + short;
      label.dataset.activeIndex = String(active);
    }
  }

  const planner = $('#plan');
  if (planner) {
    const rect = planner.getBoundingClientRect();
    const progress = clamp((window.innerHeight * .88 - rect.top) / Math.max(1, window.innerHeight + rect.height * .6), 0, 1);
    const layout = $('.planner-layout', planner);
    const card = $('.planner-card', planner);
    setMotionValue(layout, '--planner-lift', (1 - progress) * 18, 'px');
    setMotionValue(card, '--planner-lift', (1 - progress) * 26, 'px');
    setMotionValue(card, '--planner-tilt', (1 - progress) * 1.8, 'deg');
  }

  const faq = $('#faq');
  if (faq) {
    const rect = faq.getBoundingClientRect();
    const progress = clamp((window.innerHeight - rect.top) / Math.max(1, window.innerHeight + rect.height), 0, 1);
    $$('.faq-item', faq).forEach((item, index) => {
      const stagger = clamp(progress * 1.8 - index * .13, 0, 1);
      setMotionValue(item, '--faq-shift', (1 - stagger) * (index % 2 ? 14 : -14), 'px');
      setMotionValue(item, '--faq-progress', stagger, '');
    });
  }

  const share = $('.share-section');
  if (share && share.classList.contains('is-parallax-ready')) {
    const rect = share.getBoundingClientRect();
    const progress = clamp((window.innerHeight - rect.top) / (window.innerHeight + rect.height), 0, 1);
    const flower = $('.share-flower', share);
    const dateCard = $('.share-date-card', share);
    const copy = $('.share-copy', share);
    setMotionValue(flower, '--share-flower-x', progress * 24, 'px');
    setMotionValue(flower, '--share-flower-y', progress * 11, 'px');
    setMotionValue(dateCard, '--share-card-x', progress * -19, 'px');
    setMotionValue(dateCard, '--share-card-y', progress * 7, 'px');
    setMotionValue(dateCard, '--share-card-rotate', 8 - progress * 8, 'deg');
    setMotionValue(copy, '--share-copy-y', (1 - progress) * 20, 'px');
    setMotionValue(copy, '--share-copy-scale', .96 + progress * .04, '');
    if (rect.top < window.innerHeight && rect.bottom > 0) paintClosingField($('.share-pollen-field', share), progress);
  }
  const footer = $('.site-footer');
  if (footer) {
    const rect = footer.getBoundingClientRect();
    setMotionValue(footer, '--footer-rise', (1 - clamp((window.innerHeight - rect.top) / (window.innerHeight * .5), 0, 1)) * 16, 'px');
  }
}

function navigateStoryChapter(index) {
  const story = $('[data-scroll-story]');
  const targetIndex = clamp(Number(index) || 0, 0, 2);
  if (!story) return;
  if (!story.classList.contains('is-scroll-enhanced')) {
    $('[data-story-chapter="' + targetIndex + '"]', story)?.scrollIntoView({ behavior: motionSettings.reduced ? 'auto' : 'smooth', block: 'center' });
    return;
  }
  const region = $('.story-scroll-track', story);
  const pinHeight = $('.story-pin', story).clientHeight;
  const regionTop = window.scrollY + region.getBoundingClientRect().top;
  const travel = Math.max(1, region.offsetHeight - pinHeight);
  const top = regionTop - stickyTop() + travel * (targetIndex / 2);
  window.scrollTo({ top: top, behavior: motionSettings.reduced ? 'auto' : 'smooth' });
}

function navigateCinematicChapter(index) {
  const journey = $('[data-cinematic-journey]');
  const targetIndex = clamp(Number(index) || 0, 0, 4);
  if (!journey) return;
  if (!journey.classList.contains('is-enhanced')) {
    $('[data-cinematic-step="' + targetIndex + '"]', journey)?.scrollIntoView({ behavior: motionSettings.reduced ? 'auto' : 'smooth', block: 'center' });
    return;
  }
  const track = $('.cinematic-journey-track', journey);
  const stage = $('.cinematic-journey-stage', journey);
  if (!track || !stage) return;
  const regionTop = window.scrollY + track.getBoundingClientRect().top;
  const travel = Math.max(1, track.offsetHeight - stage.clientHeight);
  window.scrollTo({
    top: regionTop - stickyTop() + travel * (targetIndex / 4),
    behavior: motionSettings.reduced ? 'auto' : 'smooth'
  });
}

function navigateWorldChapter(sceneSelector, trackSelector, stageSelector, itemSelector, index) {
  const scene = $(sceneSelector);
  const targetIndex = clamp(Number(index) || 0, 0, 2);
  if (!scene) return;
  if (!scene.classList.contains('is-enhanced')) {
    if (sceneSelector === '[data-place-scene]') {
      const panorama = $('.place-panorama', scene);
      const viewport = $('.place-world-window', scene);
      const maxShift = panorama && viewport ? Math.max(0, panorama.clientWidth - viewport.clientWidth) : 0;
      setMotionValue(panorama, '--place-shift', -maxShift * (targetIndex / 2), 'px');
      $$('.place-environment', scene).forEach((environment, index) => {
        const distance = Math.abs(targetIndex - index);
        setMotionValue(environment, '--place-env-opacity', distance === 0 ? 1 : .68, '');
        setMotionValue(environment, '--place-env-scale', distance === 0 ? 1 : .97, '');
      });
      $$('[data-place-jump]', scene).forEach((button, index) => {
        if (index === targetIndex) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      const names = ['WINDOW BOX', 'BALCONY', 'COMMUNITY'];
      const label = $('#place-progress-label', scene);
      if (label) label.textContent = String(targetIndex + 1).padStart(2, '0') + ' / 03 · ' + names[targetIndex];
      const step = $('.place-scroll-index b', scene);
      if (step) step.textContent = String(targetIndex + 1).padStart(2, '0') + ' — 03';
      if (window.innerWidth <= 760) return;
    }
    $(itemSelector + '[data-' + (sceneSelector === '[data-growing-scene]' ? 'growing-chapter' : sceneSelector === '[data-place-scene]' ? 'place-caption' : 'ritual-chapter') + '="' + targetIndex + '"]', scene)
      ?.scrollIntoView({ behavior: motionSettings.reduced ? 'auto' : 'smooth', block: 'center' });
    return;
  }
  const track = $(trackSelector, scene);
  const stage = $(stageSelector, scene);
  if (!track || !stage) return;
  const regionTop = window.scrollY + track.getBoundingClientRect().top;
  const travel = Math.max(1, track.offsetHeight - stage.clientHeight);
  window.scrollTo({
    top: regionTop - stickyTop() + travel * (targetIndex / 2),
    behavior: motionSettings.reduced ? 'auto' : 'smooth'
  });
}

function setStatValue(selector, value) {
  const node = $(selector);
  if (!node) return;
  node.dataset.countTo = String(value);
  if (motionSettings.reduced) {
    node.textContent = String(value);
  } else if (node.dataset.countStarted === 'true') {
    node.textContent = String(value);
  } else {
    node.textContent = '0';
    if (node.closest('.stat-card')?.classList.contains('is-revealed')) animateStatCount(node);
  }
}

function initMotion() {
  syncMotionMode();
  window.addEventListener('scroll', queueMotionFrame, { passive: true });
  window.addEventListener('resize', syncMotionMode, { passive: true });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', syncMotionMode);
  document.addEventListener('pointermove', queuePointerFrame, { passive: true });
  document.addEventListener('pointerout', (event) => {
    const target = event.target && event.target.closest ? event.target.closest('[data-magnetic], [data-tilt]') : null;
    if (target && !target.contains(event.relatedTarget) && target === motionSettings.pointerTarget) {
      resetPointerTarget(target);
      motionSettings.pointerTarget = null;
      motionSettings.pointerEvent = null;
    }
  }, { passive: true });
  $$('[data-story-jump]').forEach((button) => button.addEventListener('click', () => navigateStoryChapter(button.dataset.storyJump)));
  $$('[data-cinematic-jump]').forEach((button) => button.addEventListener('click', () => navigateCinematicChapter(button.dataset.cinematicJump)));
  $$('[data-growing-jump]').forEach((button) => button.addEventListener('click', () => navigateWorldChapter('[data-growing-scene]', '.growing-track', '.growing-stage', '.growing-chapter', button.dataset.growingJump)));
  $$('[data-place-jump]').forEach((button) => button.addEventListener('click', () => navigateWorldChapter('[data-place-scene]', '.place-track', '.place-stage', '.place-caption', button.dataset.placeJump)));
  $$('[data-ritual-jump]').forEach((button) => button.addEventListener('click', () => navigateWorldChapter('[data-ritual-scene]', '.ritual-track', '.ritual-stage', '.ritual-chapter', button.dataset.ritualJump)));
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function showToast(message) {
  const toast = $("#site-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog(dialog) {
  if (dialog && dialog.open) dialog.close();
}

function openAuth(mode) {
  state.authMode = mode || "register";
  renderAuthMode();
  $("#auth-error").hidden = true;
  $("#auth-form").reset();
  openDialog($("#auth-dialog"));
  window.setTimeout(() => $(state.authMode === "register" ? "#auth-name" : "#auth-email").focus(), 30);
}

function renderAuthMode() {
  const registering = state.authMode === "register";
  $("#auth-title").innerHTML = registering ? "Let’s grow <em>something good.</em>" : "Welcome <em>back.</em>";
  $("#auth-intro").textContent = registering
    ? "Create a free account to keep your garden plans safe on this device."
    : "Sign in to return to the little things you’re growing.";
  $("#auth-name-label").hidden = !registering;
  $("#auth-name").hidden = !registering;
  $("#auth-name").required = registering;
  $("#auth-password").autocomplete = registering ? "new-password" : "current-password";
  $("#auth-password-hint").textContent = registering ? "Use at least 10 characters." : "Your password is at least 10 characters.";
  $("#auth-submit").innerHTML = registering ? "Create my account <span aria-hidden=\"true\">↗</span>" : "Log in <span aria-hidden=\"true\">↗</span>";
  $("#auth-switch-copy").textContent = registering ? "Already have an account?" : "New to Bloom for Bees?";
  $("#auth-switch").textContent = registering ? "Log in" : "Create an account";
}

function setPublicMode() {
  document.body.classList.remove("is-app");
  delete document.body.dataset.appScene;
  delete document.body.dataset.appProgress;
  $("#marketing-site").hidden = false;
  $("#app-shell").hidden = true;
  $(".site-footer").hidden = false;
  $(".announcement-bar").hidden = false;
  $(".main-nav").hidden = false;
  $("#app-top-nav").hidden = true;
  $("#header-login").hidden = false;
  $("#header-cta").hidden = false;
  $("#header-profile").hidden = true;
  $("#mobile-nav").hidden = true;
  syncMotionMode();
  $("#header-login").focus({ preventScroll: true });
}

function setWorkspaceMode() {
  document.body.classList.add("is-app");
  delete document.body.dataset.appProgress;
  $("#marketing-site").hidden = true;
  $("#app-shell").hidden = false;
  $(".site-footer").hidden = true;
  $(".announcement-bar").hidden = true;
  $(".main-nav").hidden = true;
  $("#app-top-nav").hidden = false;
  $("#header-login").hidden = true;
  $("#header-cta").hidden = true;
  $("#header-profile").hidden = false;
  $("#header-user-name").textContent = state.user.name.split(/\s+/)[0];
  const initial = Array.from(state.user.name.trim())[0] || "B";
  $("#header-avatar").textContent = initial.toUpperCase();
  $("#mobile-avatar-letter").textContent = initial.toUpperCase();
  $("#welcome-name").textContent = state.user.name.split(/\s+/)[0] + ".";
  $("#profile-name").value = state.user.name;
  $("#profile-email").value = state.user.email;
  setView(state.view || "overview", false);
  syncMotionMode();
}

function nextBloomDay() {
  const now = new Date();
  let year = now.getFullYear();
  const today = new Date(year, now.getMonth(), now.getDate());
  let day = new Date(year, 5, 7);
  if (day < today) {
    year += 1;
    day = new Date(year, 5, 7);
  }
  return { day: day, days: Math.round((day - today) / 86400000) };
}

function formatDate(value) {
  if (!value) return "Date to be decided";
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return "Date to be decided";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function gardenDate(garden) {
  return garden.targetDate || garden.updatedAt || garden.createdAt || "";
}

function renderCountdown() {
  const next = nextBloomDay();
  const eventLabel = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(next.day);
  const count = next.days === 0 ? "Today" : String(next.days);
  const landingCountdown = $("#countdown");
  if (landingCountdown) {
    landingCountdown.textContent = eventLabel;
    $("#countdown-note").textContent = next.days === 0 ? "Today is Bloom for Bees Day!" : next.days + (next.days === 1 ? " day to get ready." : " days to get ready.");
  }
  $("#sidebar-countdown").textContent = eventLabel;
  $("#event-date").textContent = eventLabel;
  $("#days-left").textContent = count;
  $("#event-copy").textContent = next.days === 0
    ? "Today is your day to celebrate one small thing growing."
    : "Choose one small thing to grow. Give it a sunny spot and a little care.";
}

function getLegacyPlan() {
  try {
    const value = JSON.parse(localStorage.getItem(bloomStorageKey) || "null");
    if (!value || typeof value.flower !== "string" || typeof value.place !== "string") return null;
    return { flower: value.flower, place: value.place, planted: Boolean(value.planted) };
  } catch (_error) {
    return null;
  }
}

function saveLegacyPlan(plan) {
  try {
    localStorage.setItem(bloomStorageKey, JSON.stringify(plan));
  } catch (_error) {
    showToast("Your plan is ready, but this browser could not save it. You can still download your keepsake.");
  }
}

function renderLegacyPlan(plan) {
  const form = $("#plan-form");
  const saved = $("#saved-plan");
  if (!plan) {
    saved.hidden = true;
    form.hidden = false;
    return;
  }
  form.hidden = true;
  saved.hidden = false;
  $("#plan-summary").innerHTML = "On June 7, I’ll plant <span>" + escapeHtml(plan.flower) + "</span> in <span>" + escapeHtml(plan.place) + "</span>.";
  $("#plant-status").textContent = plan.planted
    ? "Your flower is planted. Here’s to a little more colour."
    : "When your flower is in the ground, mark it planted here.";
  $("#plant-status").classList.toggle("is-planted", plan.planted);
  $("#planted-toggle").innerHTML = plan.planted
    ? "Undo planted mark <span aria-hidden=\"true\">↶</span>"
    : "I planted my flower <span aria-hidden=\"true\">✿</span>";
  $("#progress-label").textContent = plan.planted ? "Step 2 of 2" : "Step 1 of 2";
  $("#progress-fill").classList.toggle("is-complete", plan.planted);
}

function shareInvitation(message) {
  const feedback = $("#share-feedback");
  if (navigator.share) {
    navigator.share({ title: "Bloom for Bees Day", text: message }).then(() => {
      feedback.textContent = "Thanks for spreading the idea!";
      showToast("Thanks for spreading the idea!");
    }).catch((error) => {
      if (error.name !== "AbortError") copyInvitation(message);
    });
  } else {
    copyInvitation(message);
  }
}

function copyInvitation(message) {
  const feedback = $("#share-feedback");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).then(() => {
      feedback.textContent = "Invitation copied. Send it to a friend!";
      showToast("Invitation copied. Send it to a friend!");
    }).catch(() => {
      feedback.textContent = message;
      showToast("Share this invitation with someone you know.");
    });
  } else {
    feedback.textContent = message;
    showToast("Share this invitation with someone you know.");
  }
}

function downloadKeepsake(plan) {
  const year = nextBloomDay().day.getFullYear();
  const flower = escapeHtml(plan.flower);
  const place = escapeHtml(plan.place);
  const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"675\" viewBox=\"0 0 1200 675\">" +
    "<rect width=\"1200\" height=\"675\" fill=\"#f8f7f1\"/><rect x=\"22\" y=\"22\" width=\"1156\" height=\"631\" fill=\"none\" stroke=\"#1b4934\" stroke-opacity=\".2\" stroke-width=\"2\"/>" +
    "<circle cx=\"1000\" cy=\"158\" r=\"102\" fill=\"#e6eddc\"/><circle cx=\"1000\" cy=\"158\" r=\"56\" fill=\"#f2c961\"/>" +
    "<g fill=\"#d8794c\"><ellipse cx=\"1000\" cy=\"78\" rx=\"21\" ry=\"53\"/><ellipse cx=\"1000\" cy=\"78\" rx=\"21\" ry=\"53\" transform=\"rotate(60 1000 158)\"/><ellipse cx=\"1000\" cy=\"78\" rx=\"21\" ry=\"53\" transform=\"rotate(120 1000 158)\"/></g>" +
    "<circle cx=\"1000\" cy=\"158\" r=\"31\" fill=\"#d8794c\"/><text x=\"100\" y=\"115\" fill=\"#37734e\" font-family=\"Arial,sans-serif\" font-size=\"22\" font-weight=\"700\" letter-spacing=\"5\">A LITTLE HOLIDAY FOR A LOT OF LIFE</text>" +
    "<text x=\"100\" y=\"230\" fill=\"#193c2d\" font-family=\"Georgia,serif\" font-size=\"82\" font-weight=\"600\">Bloom for Bees Day</text><text x=\"103\" y=\"300\" fill=\"#37734e\" font-family=\"Arial,sans-serif\" font-size=\"31\" font-weight=\"700\">JUNE 7 · " + year + "</text>" +
    "<path d=\"M100 354h997\" stroke=\"#dce3d8\" stroke-width=\"2\"/><text x=\"100\" y=\"425\" fill=\"#607465\" font-family=\"Arial,sans-serif\" font-size=\"24\">MY BLOOM PLAN</text>" +
    "<text x=\"100\" y=\"480\" fill=\"#193c2d\" font-family=\"Georgia,serif\" font-size=\"33\">I’ll plant " + flower + " in " + place + ".</text><text x=\"100\" y=\"571\" fill=\"#37734e\" font-family=\"Georgia,serif\" font-size=\"29\" font-style=\"italic\">One bloom at a time.</text>" +
    "<text x=\"1098\" y=\"585\" text-anchor=\"end\" fill=\"#849186\" font-family=\"Arial,sans-serif\" font-size=\"16\" letter-spacing=\"2\">BLOOM FOR BEES</text></svg>";
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "my-bloom-for-bees-plan.svg";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Your Bloom for Bees keepsake is ready.");
}

function setView(name, updateFocus) {
  const allowed = ["overview", "garden", "guide", "settings", "help"];
  const view = allowed.includes(name) ? name : "overview";
  const previousView = state.view;
  state.view = view;
  const order = { overview: 0, garden: 1, guide: 2, settings: 3, help: 4 };
  const direction = (order[view] || 0) >= (order[previousView] || 0) ? 1 : -1;
  const shell = $("#app-shell");
  if (shell) shell.dataset.currentView = view;
  document.body.dataset.appScene = view;
  const currentPanel = $(".app-view:not([hidden])");
  const nextPanel = $("[data-view-panel=\"" + view + "\"]");
  const useViewTransition = motionSettings.enabled && shell && !shell.hidden && currentPanel && nextPanel && currentPanel !== nextPanel && typeof document.startViewTransition === "function";
  const swapPanels = () => {
    $$(".app-view").forEach((panel) => {
      panel.hidden = panel.dataset.viewPanel !== view;
      if (!panel.hidden) {
        panel.style.setProperty("--view-offset", (direction * 16) + "px");
        panel.classList.remove("is-entering");
        if (motionSettings.enabled && !useViewTransition) {
          window.requestAnimationFrame(() => panel.classList.add("is-entering"));
          window.setTimeout(() => panel.classList.remove("is-entering"), 560);
        }
        observeReveals(panel);
      }
    });
  };
  const viewTransition = useViewTransition ? document.startViewTransition(swapPanels) : null;
  if (!useViewTransition) swapPanels();
  $$("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-current", active);
    if (button.classList.contains("side-link")) {
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });
  const focusView = () => {
    if (updateFocus !== false && $("#app-shell") && !$("#app-shell").hidden) {
      const heading = $("[data-view-panel=\"" + view + "\"] h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
    if (view === "garden") $("#garden-search").focus({ preventScroll: true });
  };
  if (viewTransition?.updateCallbackDone) viewTransition.updateCallbackDone.then(focusView).catch(focusView);
  else focusView();
}

function renderPlantGrid() {
  const query = $("#guide-search").value.trim().toLocaleLowerCase();
  const results = plants.filter((plant) => (plant.name + " " + plant.kind + " " + plant.light + " " + plant.detail).toLocaleLowerCase().includes(query));
  const grid = $("#plant-grid");
  if (!results.length) {
    grid.innerHTML = "<div class=\"empty-state guide-empty\"><span class=\"empty-bloom\" aria-hidden=\"true\">⌕</span><h2>No flowers found</h2><p>Try a different flower or growing condition.</p><button class=\"button button-subtle\" type=\"button\" data-clear-guide>Clear search</button></div>";
    observeReveals(grid);
    return;
  }
  grid.innerHTML = results.map((plant) =>
    "<article class=\"plant-card\" data-reveal data-tilt><div class=\"plant-visual plant-" + escapeHtml(plant.color) + "\" aria-hidden=\"true\"><span>✿</span><i>✦</i></div><div class=\"plant-copy\"><span class=\"plant-kind\">" + escapeHtml(plant.kind) + "</span><h2>" + escapeHtml(plant.name) + "</h2><p>" + escapeHtml(plant.detail) + "</p><div class=\"plant-meta\"><span><b aria-hidden=\"true\">☼</b> " + escapeHtml(plant.light) + "</span><button type=\"button\" data-add-flower=\"" + escapeHtml(plant.name) + "\">Plan this flower <span aria-hidden=\"true\">↗</span></button></div></div></article>"
  ).join("");
  observeReveals(grid);
}

function gardenCard(garden) {
  const planted = Boolean(garden.planted);
  const status = planted ? "Planted" : "Planning";
  const date = garden.targetDate ? "Plant by " + formatDate(garden.targetDate) : "Date to be decided";
  return "<article class=\"garden-card" + (planted ? " garden-card-planted" : "") + "\" data-garden-card=\"" + escapeHtml(garden.id) + "\" data-reveal data-tilt>" +
    "<div class=\"garden-flower-mark\" aria-hidden=\"true\"><span>✿</span></div><div class=\"garden-card-main\"><div class=\"garden-card-top\"><div><span class=\"garden-status " + (planted ? "status-planted" : "") + "\"><i aria-hidden=\"true\"></i>" + status + "</span><h2>" + escapeHtml(garden.flower) + "</h2></div><button class=\"icon-button garden-menu-button\" type=\"button\" data-garden-action=\"menu\" aria-label=\"Actions for " + escapeHtml(garden.flower) + "\" aria-expanded=\"false\">···</button><div class=\"garden-menu\" hidden><button type=\"button\" data-garden-action=\"edit\">Edit plan</button><button type=\"button\" data-garden-action=\"toggle\">" + (planted ? "Mark not planted" : "Mark planted") + "</button><button type=\"button\" data-garden-action=\"delete\">Delete plan</button></div></div>" +
    "<p class=\"garden-place\">" + escapeHtml(garden.place) + "<span aria-hidden=\"true\">·</span>" + escapeHtml(garden.sunlight || "Not sure yet") + "</p>" +
    (garden.notes ? "<p class=\"garden-note\">" + escapeHtml(garden.notes) + "</p>" : "") +
    "<div class=\"garden-card-footer\"><span>✳ " + escapeHtml(date) + "</span><div><button type=\"button\" class=\"text-button\" data-garden-action=\"edit\">Edit</button><button type=\"button\" class=\"garden-plant-action\" data-garden-action=\"toggle\">" + (planted ? "Planted ✓" : "Mark planted") + "</button></div></div></div></article>";
}

function filteredGardens() {
  const query = $("#garden-search").value.trim().toLocaleLowerCase();
  const filter = $("#garden-filter").value;
  const sort = $("#garden-sort").value;
  let result = state.gardens.filter((garden) => {
    const matchesText = (garden.flower + " " + garden.place + " " + garden.sunlight + " " + (garden.notes || "")).toLocaleLowerCase().includes(query);
    const matchesStatus = filter === "all" || (filter === "planted" ? garden.planted : !garden.planted);
    return matchesText && matchesStatus;
  });
  result = result.slice();
  if (sort === "az") result.sort((a, b) => a.flower.localeCompare(b.flower));
  else if (sort === "date") result.sort((a, b) => (a.targetDate || "9999-99-99").localeCompare(b.targetDate || "9999-99-99"));
  else result.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return result;
}

function emptyGardenState(query, filter) {
  if (query || filter !== "all") {
    return "<div class=\"empty-state\"><span class=\"empty-bloom\" aria-hidden=\"true\">⌕</span><h2>No plans match that search</h2><p>Try clearing the search or choosing a different filter.</p><button class=\"button button-subtle\" type=\"button\" data-clear-garden>Clear search and filters</button></div>";
  }
  return "<div class=\"empty-state\"><span class=\"empty-bloom\" aria-hidden=\"true\">✿</span><h2>Your garden starts here.</h2><p>Add a flower you’re curious about, a place it could grow, and one small next step.</p><button class=\"button button-primary\" type=\"button\" data-open-garden><span aria-hidden=\"true\">＋</span> Make your first plan</button><span class=\"empty-footnote\">No garden required. A pot can be a lovely beginning.</span></div>";
}

function renderGardenList() {
  const list = $("#garden-list");
  const results = filteredGardens();
  if (!results.length) {
    list.innerHTML = emptyGardenState($("#garden-search").value.trim(), $("#garden-filter").value);
    observeReveals(list);
    return;
  }
  list.innerHTML = "<div class=\"garden-results-note\">" + results.length + (results.length === 1 ? " garden plan" : " garden plans") + (results.length === state.gardens.length ? "" : " shown") + "</div>" + results.map(gardenCard).join("");
  observeReveals(list);
}

function renderRecentGardens() {
  const list = $("#recent-gardens");
  if (!state.gardens.length) {
    list.innerHTML = "<div class=\"recent-empty\"><span aria-hidden=\"true\">✿</span><p>Nothing here yet. Your first flower can start with a plan.</p><button type=\"button\" class=\"text-button\" data-open-garden>Make a garden plan <span aria-hidden=\"true\">↗</span></button></div>";
    return;
  }
  const items = state.gardens.slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 3);
  list.innerHTML = items.map((garden) =>
    "<article class=\"recent-item\" data-reveal><span class=\"recent-flower\" aria-hidden=\"true\">" + (garden.planted ? "✓" : "✿") + "</span><span class=\"recent-item-copy\"><strong>" + escapeHtml(garden.flower) + "</strong><small>" + escapeHtml(garden.place) + "</small></span><span class=\"recent-item-status" + (garden.planted ? " is-planted" : "") + "\">" + (garden.planted ? "In bloom" : "Planning") + "</span></article>"
  ).join("");
  observeReveals(list);
}

function renderStats() {
  const total = state.gardens.length;
  const planted = state.gardens.filter((garden) => garden.planted).length;
  const next = state.gardens.find((garden) => !garden.planted);
  setStatValue("#stat-plans", total);
  setStatValue("#stat-planted", planted);
  $("#stat-next").textContent = next ? next.flower : (total ? "Beautiful work" : "Start here");
  $("#stat-next-note").textContent = next
    ? "Your next little step"
    : (total ? "Everything in your garden is planted" : "Add a plan when you’re ready");
  renderRecentGardens();
  renderGardenList();
}

function applyTheme(theme) {
  const chosen = theme || "system";
  if (chosen === "system") {
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } else {
    document.documentElement.dataset.theme = chosen;
  }
}

function renderSettings() {
  $("#theme-setting").value = state.settings.theme || "system";
  $("#reminder-toggle").setAttribute("aria-checked", String(Boolean(state.settings.reminderEnabled)));
  $("#reminder-date").disabled = !state.settings.reminderEnabled;
  $("#reminder-date").value = state.settings.reminderDate || "";
  applyTheme(state.settings.theme);
  checkReminder();
}

async function saveSettings(changes) {
  const next = Object.assign({}, state.settings, changes);
  try {
    const result = await api.saveSettings(next);
    state.settings = result.settings;
    renderSettings();
    showToast("Your preferences are saved.");
  } catch (error) {
    renderSettings();
    showToast(error.message || "Your preferences could not be saved.");
  }
}

function checkReminder() {
  if (!state.settings.reminderEnabled || !state.settings.reminderDate) return;
  const today = new Date().toISOString().slice(0, 10);
  if (state.settings.reminderDate !== today) return;
  let sent = false;
  try {
    sent = localStorage.getItem("bloomReminderShown:" + state.settings.reminderDate) === "yes";
  } catch (_error) {}
  if (sent) return;
  const message = "A little garden moment is waiting. Check in on your Bloom for Bees plan.";
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("A little garden reminder", { body: message, icon: "/assets/flower-mark.svg" });
  } else {
    showToast(message);
  }
  try {
    localStorage.setItem("bloomReminderShown:" + state.settings.reminderDate, "yes");
  } catch (_error) {}
}

async function loadWorkspace() {
  $("#app-error").hidden = true;
  $("#app-loading").hidden = false;
  $("#app-shell").hidden = false;
  setWorkspaceMode();
  try {
    const results = await Promise.all([api.gardens(), api.settings()]);
    state.gardens = results[0].gardens || [];
    state.settings = results[1].settings || state.settings;
    $("#app-loading").hidden = true;
    $("#app-error").hidden = true;
    renderStats();
    renderSettings();
  } catch (error) {
    $("#app-loading").hidden = true;
    $("#app-error").hidden = false;
    $("#app-error-text").textContent = error.message || "Check your connection and try again.";
  }
}

async function migrateLegacyPlan() {
  if (state.gardens.length) return;
  const legacy = getLegacyPlan();
  if (!legacy) return;
  const place = canonicalPlaces[legacy.place.toLocaleLowerCase()] || "A pot or window box";
  const saved = await api.createGarden({
    flower: legacy.flower,
    place: place,
    sunlight: "Not sure yet",
    notes: "",
    targetDate: null,
    planted: legacy.planted
  });
  state.gardens.unshift(saved.garden);
  try { localStorage.removeItem(bloomStorageKey); } catch (_error) {}
  showToast("Your saved bloom plan is now in your garden.");
}

async function finishAuthentication(payload) {
  api.setCsrf(payload.csrfToken);
  state.user = payload.user;
  state.settings = payload.settings || state.settings;
  closeDialog($("#auth-dialog"));
  await loadWorkspace();
  if (!$("#app-error").hidden) return;
  try {
    if (state.pendingGarden) {
      const result = await api.createGarden(state.pendingGarden);
      state.gardens.unshift(result.garden);
      state.pendingGarden = null;
      renderStats();
      setView("garden", false);
      showToast("Your garden plan is saved to your account.");
    } else {
      await migrateLegacyPlan();
      renderStats();
      setView("overview", false);
      showToast("Welcome to your garden, " + state.user.name.split(/\s+/)[0] + ".");
    }
  } catch (error) {
    showToast(error.message || "You’re signed in, but your plan could not be saved.");
  }
}

function openGardenForm(garden) {
  $("#garden-form").reset();
  $("#garden-error").hidden = true;
  $("#garden-id").value = garden ? garden.id : "";
  $("#garden-flower").value = garden ? garden.flower : "";
  $("#garden-place").value = garden ? garden.place : "A pot or window box";
  $("#garden-sunlight").value = garden ? (garden.sunlight || "Not sure yet") : "Not sure yet";
  $("#garden-date").value = garden ? (garden.targetDate || "") : "";
  $("#garden-notes").value = garden ? (garden.notes || "") : "";
  $("#garden-dialog-title").innerHTML = garden ? "Update your <em>garden plan.</em>" : "Make room for <em>a bloom.</em>";
  $("#garden-submit").innerHTML = garden ? "Save changes <span aria-hidden=\"true\">↗</span>" : "Save garden plan <span aria-hidden=\"true\">↗</span>";
  openDialog($("#garden-dialog"));
  window.setTimeout(() => $("#garden-flower").focus(), 30);
}

function gardenPayloadFromForm() {
  return {
    flower: $("#garden-flower").value.trim(),
    place: $("#garden-place").value,
    sunlight: $("#garden-sunlight").value,
    targetDate: $("#garden-date").value || null,
    notes: $("#garden-notes").value.trim(),
    planted: false
  };
}

function requestDeleteGarden(garden) {
  state.confirmAction = { type: "garden", garden: garden };
  $("#confirm-title").textContent = "Delete this garden plan?";
  $("#confirm-copy").textContent = "“" + garden.flower + "” will be removed from your garden.";
  $("#confirm-email-label").hidden = true;
  $("#confirm-email").hidden = true;
  $("#confirm-email").required = false;
  $("#confirm-email").value = "";
  $("#confirm-submit").textContent = "Delete plan";
  $("#confirm-submit").className = "button button-danger";
  $("#confirm-error").hidden = true;
  openDialog($("#confirm-dialog"));
}

function requestDeleteAccount() {
  state.confirmAction = { type: "account" };
  $("#confirm-title").textContent = "Delete your account?";
  $("#confirm-copy").textContent = "This permanently removes your account and every garden plan saved with it.";
  $("#confirm-email-label").hidden = false;
  $("#confirm-email").hidden = false;
  $("#confirm-email").required = true;
  $("#confirm-email").value = "";
  $("#confirm-submit").textContent = "Delete account";
  $("#confirm-submit").className = "button button-danger";
  $("#confirm-error").hidden = true;
  openDialog($("#confirm-dialog"));
  window.setTimeout(() => $("#confirm-email").focus(), 30);
}

function endSession() {
  api.setCsrf(null);
  state.user = null;
  state.gardens = [];
  state.settings = { theme: "system", reminderEnabled: false, reminderDate: null };
  state.pendingGarden = null;
  applyTheme("system");
  setPublicMode();
}

async function signOut() {
  try {
    await api.logout();
    endSession();
    showToast("You’re signed out. Your garden is safe for next time.");
  } catch (error) {
    showToast(error.message || "You could not be signed out. Try again.");
  }
}

function handleGardenActions(event) {
  const actionButton = event.target.closest("[data-garden-action]");
  if (!actionButton) return;
  const card = actionButton.closest("[data-garden-card]");
  if (!card) return;
  const garden = state.gardens.find((item) => item.id === card.dataset.gardenCard);
  if (!garden) return;
  const action = actionButton.dataset.gardenAction;
  if (action === "menu") {
    const menu = $(".garden-menu", card);
    const open = menu.hidden;
    $$(".garden-menu").forEach((item) => { item.hidden = true; });
    $$(".garden-menu-button").forEach((item) => item.setAttribute("aria-expanded", "false"));
    menu.hidden = !open;
    actionButton.setAttribute("aria-expanded", String(open));
  } else if (action === "edit") {
    openGardenForm(garden);
  } else if (action === "delete") {
    requestDeleteGarden(garden);
  } else if (action === "toggle") {
    updatePlanted(garden);
  }
}

async function updatePlanted(garden) {
  const oldStatus = garden.planted;
  garden.planted = !oldStatus;
  renderStats();
  try {
    const result = await api.updateGarden(garden.id, {
      flower: garden.flower,
      place: garden.place,
      sunlight: garden.sunlight || "Not sure yet",
      notes: garden.notes || "",
      targetDate: garden.targetDate || null,
      planted: garden.planted
    });
    Object.assign(garden, result.garden);
    renderStats();
    showToast(garden.planted ? "A flower planted. A tradition in bloom." : "Planting progress updated.");
  } catch (error) {
    garden.planted = oldStatus;
    renderStats();
    showToast(error.message || "That update could not be saved.");
  }
}

function navigateFromCommand(command) {
  closeDialog($("#command-dialog"));
  $("#command-search").value = "";
  renderCommandResults("");
  if (command === "new") openGardenForm(null);
  else setView(command);
}

function renderCommandResults(query) {
  const text = query.toLocaleLowerCase().trim();
  $$(".command-results button").forEach((button) => {
    button.hidden = !(button.textContent.toLocaleLowerCase().includes(text));
  });
}

function openCommand() {
  openDialog($("#command-dialog"));
  $("#command-search").value = "";
  renderCommandResults("");
  window.setTimeout(() => $("#command-search").focus(), 20);
}

function updateOnlineState() {
  const online = navigator.onLine;
  $("#offline-banner").hidden = online;
  if (online && state.user) loadWorkspace();
}

async function init() {
  initMotion();
  renderCountdown();
  renderLegacyPlan(getLegacyPlan());
  renderPlantGrid();
  applyTheme("system");
  updateOnlineState();
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }

  $$("#mobile-nav a").forEach((link) => link.addEventListener("click", () => {
    $("#mobile-nav").hidden = true;
    $(".menu-toggle").setAttribute("aria-expanded", "false");
    $(".menu-toggle").setAttribute("aria-label", "Open navigation");
  }));
  const menuToggle = $(".menu-toggle");
  menuToggle.addEventListener("click", () => {
    const open = menuToggle.getAttribute("aria-expanded") === "true";
    $("#mobile-nav").hidden = open;
    menuToggle.setAttribute("aria-expanded", String(!open));
    menuToggle.setAttribute("aria-label", open ? "Open navigation" : "Close navigation");
  });
  $("#header-login").addEventListener("click", () => openAuth("login"));
  $("#header-cta").addEventListener("click", (event) => {
    if (state.user) {
      event.preventDefault();
      setView("overview");
    }
  });
  $("#header-profile").addEventListener("click", () => setView("settings"));
  $("#mobile-profile").addEventListener("click", () => setView("settings"));
  $("#sidebar-signout").addEventListener("click", signOut);
  $("#auth-switch").addEventListener("click", () => {
    state.authMode = state.authMode === "register" ? "login" : "register";
    renderAuthMode();
    $("#auth-error").hidden = true;
    if (state.authMode === "register") $("#auth-name").focus();
    else $("#auth-email").focus();
  });
  $("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorNode = $("#auth-error");
    errorNode.hidden = true;
    if (!form.reportValidity()) return;
    const button = $("#auth-submit");
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    try {
      const details = { email: $("#auth-email").value.trim(), password: $("#auth-password").value };
      if (state.authMode === "register") details.name = $("#auth-name").value.trim();
      const result = await api.authenticate(state.authMode, details);
      await finishAuthentication(result);
    } catch (error) {
      errorNode.textContent = error.message || "We couldn’t sign you in. Try again.";
      errorNode.hidden = false;
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.removeAttribute("aria-busy");
    }
  });
  $("#plan-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const plan = { flower: $("#flower").value, place: $("#place").value, planted: false };
    saveLegacyPlan(plan);
    renderLegacyPlan(plan);
    showToast("Your bloom plan is saved on this device.");
    $("#saved-plan").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("#edit-plan").addEventListener("click", () => {
    const plan = getLegacyPlan();
    if (plan) {
      $("#flower").value = plan.flower;
      $("#place").value = plan.place;
    }
    $("#saved-plan").hidden = true;
    $("#plan-form").hidden = false;
    $("#flower").focus();
  });
  $("#planted-toggle").addEventListener("click", () => {
    const plan = getLegacyPlan();
    if (!plan) return;
    plan.planted = !plan.planted;
    saveLegacyPlan(plan);
    renderLegacyPlan(plan);
    showToast(plan.planted ? "A flower planted. A tradition in bloom." : "Planting progress updated.");
  });
  $("#share-plan").addEventListener("click", () => {
    const plan = getLegacyPlan();
    if (plan) shareInvitation("I’m joining Bloom for Bees Day on June 7! My plan: plant " + plan.flower + " in " + plan.place + ". Join me and let’s help our neighbourhood bloom. 🌼🐝");
  });
  $("#download-plan").addEventListener("click", () => {
    const plan = getLegacyPlan();
    if (plan) downloadKeepsake(plan);
  });
  $("#save-to-account").addEventListener("click", () => {
    const plan = getLegacyPlan();
    if (!plan) return;
    state.pendingGarden = {
      flower: plan.flower,
      place: canonicalPlaces[plan.place.toLocaleLowerCase()] || "A pot or window box",
      sunlight: "Not sure yet",
      notes: "",
      targetDate: null,
      planted: plan.planted
    };
    openAuth("register");
    $("#auth-intro").textContent = "Create an account and we’ll bring your saved bloom plan into your garden.";
  });
  $("#share-challenge").addEventListener("click", () => shareInvitation("Join me for Bloom for Bees Day on June 7! Plant one bee-friendly flower and help your neighbourhood bloom. 🌼🐝"));
  $$("[data-open-auth]").forEach((button) => button.addEventListener("click", () => openAuth(button.dataset.openAuth)));
  $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
  $$("[data-open-garden]").forEach((button) => button.addEventListener("click", () => {
    if (!state.user) {
      const legacy = getLegacyPlan();
      if (legacy) {
        state.pendingGarden = {
          flower: legacy.flower,
          place: canonicalPlaces[legacy.place.toLocaleLowerCase()] || "A pot or window box",
          sunlight: "Not sure yet",
          notes: "",
          targetDate: null,
          planted: legacy.planted
        };
      }
      openAuth("register");
      return;
    }
    openGardenForm(null);
  }));
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $("#retry-load").addEventListener("click", loadWorkspace);
  $("#garden-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const errorNode = $("#garden-error");
    errorNode.hidden = true;
    const submit = $("#garden-submit");
    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    const id = $("#garden-id").value;
    const payload = gardenPayloadFromForm();
    try {
      if (id) {
        const existing = state.gardens.find((garden) => garden.id === id);
        payload.planted = Boolean(existing && existing.planted);
      }
      const result = id ? await api.updateGarden(id, payload) : await api.createGarden(payload);
      if (id) state.gardens = state.gardens.map((garden) => garden.id === id ? result.garden : garden);
      else state.gardens.unshift(result.garden);
      closeDialog($("#garden-dialog"));
      renderStats();
      showToast(id ? "Your garden plan is updated." : "A new little plan is saved.");
    } catch (error) {
      errorNode.textContent = error.message || "Your garden plan could not be saved.";
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
    }
  });
  $("#garden-list").addEventListener("click", handleGardenActions);
  $("#garden-search").addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(renderGardenList, 120);
  });
  $("#garden-filter").addEventListener("change", renderGardenList);
  $("#garden-sort").addEventListener("change", renderGardenList);
  $("#garden-list").addEventListener("click", (event) => {
    if (event.target.closest("[data-clear-garden]")) {
      $("#garden-search").value = "";
      $("#garden-filter").value = "all";
      renderGardenList();
    }
  });
  $("#guide-search").addEventListener("input", renderPlantGrid);
  $("#plant-grid").addEventListener("click", (event) => {
    if (event.target.closest("[data-clear-guide]")) {
      $("#guide-search").value = "";
      renderPlantGrid();
      return;
    }
    const button = event.target.closest("[data-add-flower]");
    if (!button) return;
    if (!state.user) {
      $("#garden-flower").value = button.dataset.addFlower;
      state.pendingGarden = {
        flower: button.dataset.addFlower,
        place: "A pot or window box",
        sunlight: "Not sure yet",
        notes: "",
        targetDate: null,
        planted: false
      };
      openAuth("register");
      return;
    }
    openGardenForm(null);
    $("#garden-flower").value = button.dataset.addFlower;
  });
  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    try {
      const result = await api.updateProfile({ name: $("#profile-name").value.trim(), email: $("#profile-email").value.trim() });
      state.user = result.user;
      setWorkspaceMode();
      showToast("Your profile is up to date.");
    } catch (error) {
      showToast(error.message || "Your profile could not be saved.");
    }
  });
  $("#theme-setting").addEventListener("change", (event) => saveSettings({ theme: event.target.value }));
  $("#reminder-toggle").addEventListener("click", async () => {
    const enabled = $("#reminder-toggle").getAttribute("aria-checked") !== "true";
    if (enabled && "Notification" in window && Notification.permission === "default") {
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        showToast("Browser permission is needed for a notification. Your in-app date reminder is still available.");
      }
    }
    await saveSettings({
      reminderEnabled: enabled,
      reminderDate: enabled ? ($("#reminder-date").value || nextBloomDay().day.toISOString().slice(0, 10)) : state.settings.reminderDate
    });
  });
  $("#reminder-date").addEventListener("change", (event) => saveSettings({ reminderDate: event.target.value || null }));
  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const button = $('button[type="submit"]', event.currentTarget);
    button.disabled = true;
    try {
      const result = await api.changePassword($("#current-password").value, $("#new-password").value);
      api.setCsrf(result.csrfToken);
      state.user = result.user;
      $("#password-form").reset();
      showToast("Your password has been changed. Other sessions have been signed out.");
    } catch (error) {
      showToast(error.message || "Your password could not be changed.");
    } finally {
      button.disabled = false;
    }
  });
  $("#delete-account").addEventListener("click", requestDeleteAccount);
  $("#confirm-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("#confirm-error");
    error.hidden = true;
    const action = state.confirmAction;
    if (!action) return;
    const button = $("#confirm-submit");
    button.disabled = true;
    try {
      if (action.type === "garden") {
        await api.deleteGarden(action.garden.id);
        state.gardens = state.gardens.filter((garden) => garden.id !== action.garden.id);
        closeDialog($("#confirm-dialog"));
        renderStats();
        showToast("Garden plan deleted.");
      } else if (action.type === "account") {
        const confirmation = $("#confirm-email").value.trim();
        if (confirmation.toLocaleLowerCase() !== state.user.email.toLocaleLowerCase()) {
          error.textContent = "Type the email on your account to confirm.";
          error.hidden = false;
          button.disabled = false;
          return;
        }
        await api.deleteAccount(confirmation);
        closeDialog($("#confirm-dialog"));
        endSession();
        showToast("Your account and garden plans have been deleted.");
      }
      state.confirmAction = null;
    } catch (requestError) {
      error.textContent = requestError.message || "This action could not be completed.";
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  $("#garden-search").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.currentTarget.value = "";
      renderGardenList();
    }
  });
  $("#open-command").addEventListener("click", openCommand);
  $$(".command-results").forEach((container) => container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-command]");
    if (button) navigateFromCommand(button.dataset.command);
  }));
  $("#command-search").addEventListener("input", (event) => renderCommandResults(event.target.value));
  $("#command-search").addEventListener("keydown", (event) => {
    const visible = $$(".command-results button").filter((button) => !button.hidden);
    if (event.key === "ArrowDown" && visible.length) {
      event.preventDefault();
      visible[0].focus();
    } else if (event.key === "Enter" && visible.length) {
      event.preventDefault();
      visible[0].click();
    }
  });
  $("#command-results").addEventListener("keydown", (event) => {
    const buttons = $$(".command-results button").filter((button) => !button.hidden);
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown" && buttons.length) {
      event.preventDefault();
      buttons[(index + 1) % buttons.length].focus();
    } else if (event.key === "ArrowUp" && buttons.length) {
      event.preventDefault();
      if (index <= 0) $("#command-search").focus();
      else buttons[index - 1].focus();
    } else if (event.key === "Enter" && index >= 0) {
      event.preventDefault();
      buttons[index].click();
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k" && state.user) {
      event.preventDefault();
      openCommand();
    } else if (event.key === "Escape") {
      const open = $("dialog[open]");
      if (open) closeDialog(open);
      $$(".garden-menu").forEach((menu) => { menu.hidden = true; });
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".garden-card-top")) {
      $$(".garden-menu").forEach((menu) => { menu.hidden = true; });
      $$(".garden-menu-button").forEach((button) => button.setAttribute("aria-expanded", "false"));
    }
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (state.settings.theme === "system") applyTheme("system");
  });

  try {
    const session = await api.session();
    api.setCsrf(session.csrfToken);
    if (session.user) {
      state.user = session.user;
      state.settings = session.settings || state.settings;
      await loadWorkspace();
      if ($("#app-error").hidden) {
        try {
          await migrateLegacyPlan();
          renderStats();
        } catch (error) {
          showToast(error.message || "Your saved bloom plan could not be imported.");
        }
      }
    }
  } catch (_error) {
    showToast("The local server is not available. Start Bloom for Bees and refresh this page.");
  }
  renderLegacyPlan(getLegacyPlan());
}

init();
