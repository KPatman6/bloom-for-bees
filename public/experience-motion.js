const experience = document.querySelector("#marketing-site");
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (value) => {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
};

if (experience) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const widePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const openingTrack = experience.querySelector(".opening-track");
  const openingStage = experience.querySelector(".opening-stage");
  const openingImage = experience.querySelector("[data-opening-image]");
  const growthTrack = experience.querySelector(".growth-track");
  const growthStage = experience.querySelector(".growth-stage");
  const growthBeats = [...experience.querySelectorAll("[data-growth-beat]")];
  const growthButtons = [...experience.querySelectorAll("[data-growth-jump]")];
  const growthPlant = experience.querySelector(".growth-plant");
  const growthCanvas = experience.querySelector(".growth-pollen");
  const growthProgress = experience.querySelector("#growth-progress-fill");
  const growthArtState = experience.querySelector("#growth-art-state");
  const spacesTrack = experience.querySelector(".spaces-track");
  const spacesStage = experience.querySelector(".spaces-stage");
  const spacesRail = experience.querySelector(".spaces-rail");
  const spacesViewport = experience.querySelector(".spaces-viewport");
  const spacePanels = [...experience.querySelectorAll("[data-space-panel]")];
  const spaceCount = experience.querySelector("#space-count");
  const spaceCurrent = experience.querySelector("#space-current-label");
  const spaceProgress = experience.querySelector("#space-progress-fill");
  const closingSection = experience.querySelector(".closing-section");
  const closingOrbits = experience.querySelector(".closing-orbits");
  const closingCopy = experience.querySelector(".closing-copy");
  const closingDate = experience.querySelector(".closing-date");
  const sectionLinks = [...document.querySelectorAll('.main-nav a[href^="#"]')];
  const headerHeight = () => document.querySelector(".site-header")?.getBoundingClientRect().height || 78;
  let motionReady = false;
  let raf = 0;
  let viewportWidth = window.innerWidth;
  let lastTone = "light";
  let activeGrowth = 0;
  let activeSpace = 0;
  const spacesLabels = ["THE WINDOW", "THE BALCONY", "THE COMMUNITY"];
  const growthLabels = ["A PLACE TO BEGIN", "ROOTED HERE", "LEAFING OUT", "A FLOWER IN BLOOM"];

  function measureProgress(track, stage, offset) {
    if (!track || !stage) return 0;
    const trackRect = track.getBoundingClientRect();
    const travel = Math.max(1, track.offsetHeight - stage.clientHeight);
    return clamp((offset - trackRect.top) / travel);
  }

  function resetStories() {
    experience.classList.remove("motion-ready");
    motionReady = false;
    openingStage?.style.removeProperty("--opening-progress");
    openingImage?.style.removeProperty("--opening-image-scale");
    openingImage?.style.removeProperty("--opening-photo-scale");
    openingImage?.style.removeProperty("--opening-photo-y");
    openingImage?.style.removeProperty("--opening-date-y");
    openingStage?.style.removeProperty("--opening-copy-y");
    openingStage?.style.removeProperty("--opening-copy-opacity");
    openingStage?.style.removeProperty("--opening-word-y");
    growthTrack?.style.removeProperty("--growth-progress");
    growthStage?.style.removeProperty("--root-progress");
    growthStage?.style.removeProperty("--root-offset");
    growthStage?.style.removeProperty("--root-opacity");
    growthStage?.style.removeProperty("--stem-progress");
    growthStage?.style.removeProperty("--stem-offset");
    growthStage?.style.removeProperty("--leaf-opacity");
    growthStage?.style.removeProperty("--flower-scale");
    growthStage?.style.removeProperty("--flower-opacity");
    growthStage?.style.removeProperty("--bee-x");
    growthStage?.style.removeProperty("--bee-y");
    growthStage?.style.removeProperty("--bee-opacity");
    growthStage?.style.removeProperty("--sun-scale");
    growthStage?.style.removeProperty("--daylight-scale");
    growthStage?.style.removeProperty("--growth-word-y");
    if (growthProgress) growthProgress.style.transform = "scaleX(0)";
    growthBeats.forEach((beat) => {
      beat.removeAttribute("aria-hidden");
      beat.style.removeProperty("visibility");
    });
    growthButtons.forEach((button, index) => {
      if (index === 0) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    if (growthArtState) growthArtState.textContent = growthLabels[0];
    activeGrowth = 0;
    if (spacesRail) spacesRail.style.transform = "";
    spacePanels.forEach((panel) => {
      panel.classList.remove("is-current");
      panel.removeAttribute("aria-current");
      panel.style.removeProperty("--space-depth-x");
      panel.style.removeProperty("--space-depth-y");
      panel.style.removeProperty("--space-depth-scale");
      panel.style.removeProperty("--space-art-y");
      panel.style.removeProperty("--space-art-scale");
    });
    if (spaceCount) spaceCount.innerHTML = "01 <i>/ 03</i>";
    if (spaceCurrent) spaceCurrent.textContent = spacesLabels[0];
    if (spaceProgress) spaceProgress.style.transform = "scaleX(0)";
    activeSpace = 0;
    const context = growthCanvas?.getContext("2d");
    if (context) context.clearRect(0, 0, growthCanvas.width, growthCanvas.height);
    document.body.dataset.experienceTone = "light";
  }

  function syncMode() {
    viewportWidth = window.innerWidth;
    const shouldEnhance = !reducedMotion.matches && viewportWidth >= 901 && window.innerHeight >= 620;
    if (shouldEnhance === motionReady) {
      if (!shouldEnhance) resetStories();
      return;
    }
    if (shouldEnhance) {
      experience.classList.add("motion-ready");
      motionReady = true;
    } else {
      resetStories();
    }
    if (motionReady) {
      growthBeats.forEach((beat, index) => beat.setAttribute("aria-hidden", index === 0 ? "false" : "true"));
    }
    update();
  }

  function setActiveGrowth(index) {
    growthBeats.forEach((beat, i) => {
      const hidden = i !== index;
      if (beat.getAttribute("aria-hidden") !== String(hidden)) beat.setAttribute("aria-hidden", String(hidden));
    });
    growthButtons.forEach((button, i) => {
      if (i === index) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    if (growthArtState && growthArtState.textContent !== growthLabels[index]) growthArtState.textContent = growthLabels[index];
  }

  function paintPollen(progress) {
    if (!growthCanvas || !growthStage) return;
    const rect = growthStage.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || reducedMotion.matches) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (growthCanvas.width !== width || growthCanvas.height !== height) {
      growthCanvas.width = width;
      growthCanvas.height = height;
    }
    const ctx = growthCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const visibleW = rect.width;
    const visibleH = rect.height;
    for (let i = 0; i < 28; i += 1) {
      const seed = (i * 57.73) % 1;
      const drift = progress * (18 + (i % 5) * 7);
      const x = ((i * 113.1 + drift * 1.15) % (visibleW + 20)) - 10;
      const y = ((i * 79.7 - drift + visibleH) % (visibleH + 30)) - 15;
      const radius = 1 + (i % 4) * 0.45;
      const alpha = (0.13 + (i % 3) * 0.055) * (0.55 + seed * 0.6);
      ctx.beginPath();
      ctx.fillStyle = `rgba(238, 210, 139, ${alpha})`;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function updateOpening() {
    if (!motionReady || !openingTrack || !openingStage) return;
    const progress = measureProgress(openingTrack, openingStage, headerHeight());
    const eased = smooth(progress);
    openingImage?.style.setProperty("--opening-image-scale", String(1 - eased * 0.055));
    openingImage?.style.setProperty("--opening-photo-scale", String(1.06 + eased * 0.17));
    openingImage?.style.setProperty("--opening-photo-y", `${-progress * 23}px`);
    openingImage?.style.setProperty("--opening-date-y", `${-progress * 19}px`);
    openingStage.style.setProperty("--opening-copy-y", `${-progress * 38}px`);
    openingStage.style.setProperty("--opening-copy-opacity", String(1 - smooth((progress - 0.28) / 0.68) * 0.52));
    openingStage.style.setProperty("--opening-word-y", `${progress * -30}px`);
  }

  function updateGrowth() {
    if (!motionReady || !growthTrack || !growthStage) return;
    const progress = measureProgress(growthTrack, growthStage, headerHeight());
    growthStage.style.setProperty("--growth-progress", String(progress));
    growthStage.style.setProperty("--root-progress", String(smooth(progress / 0.23)));
    const rootProgress = smooth(progress / 0.23);
    const stemProgress = smooth((progress - 0.1) / 0.62);
    growthStage.style.setProperty("--root-offset", `${(1 - rootProgress) * 450}px`);
    growthStage.style.setProperty("--root-opacity", String(1 - smooth((progress - 0.16) / 0.18) * 0.55));
    growthStage.style.setProperty("--stem-progress", String(stemProgress));
    growthStage.style.setProperty("--stem-offset", `${(1 - stemProgress) * 680}px`);
    growthStage.style.setProperty("--leaf-opacity", String(smooth((progress - 0.32) / 0.27)));
    growthStage.style.setProperty("--flower-scale", String(0.04 + smooth((progress - 0.51) / 0.38) * 0.96));
    growthStage.style.setProperty("--flower-opacity", String(smooth((progress - 0.54) / 0.18)));
    growthStage.style.setProperty("--bee-x", `${Math.sin(progress * Math.PI * 2.2) * 42 + (progress - 0.5) * -24}px`);
    growthStage.style.setProperty("--bee-y", `${Math.cos(progress * Math.PI * 2.2) * 19 - 17}px`);
    growthStage.style.setProperty("--bee-opacity", String(smooth((progress - 0.64) / 0.18)));
    growthStage.style.setProperty("--sun-scale", String(0.72 + smooth(progress) * 0.25));
    growthStage.style.setProperty("--daylight-scale", String(0.72 + smooth(progress) * 0.42));
    growthStage.style.setProperty("--growth-word-y", `${(1 - progress) * 25}px`);
    if (growthProgress) growthProgress.style.transform = `scaleX(${progress})`;
    const chapterPosition = progress * 4;
    while (activeGrowth < 3 && chapterPosition > activeGrowth + 1.04) activeGrowth += 1;
    while (activeGrowth > 0 && chapterPosition < activeGrowth - 0.04) activeGrowth -= 1;
    setActiveGrowth(activeGrowth);
    paintPollen(progress);
  }

  function updateSpaces() {
    if (!motionReady || !spacesTrack || !spacesStage || !spacesRail || !spacesViewport) return;
    const progress = measureProgress(spacesTrack, spacesStage, headerHeight());
    const maxShift = Math.max(0, spacesRail.scrollWidth - spacesViewport.clientWidth);
    const eased = progress + Math.sin(Math.PI * progress) * 0.012;
    const shift = maxShift * clamp(eased);
    spacesRail.style.transform = `translate3d(${-shift}px, 0, 0)`;
    if (spaceProgress) spaceProgress.style.transform = `scaleX(${progress})`;
    const centerX = spacesViewport.clientWidth / 2;
    const distances = spacePanels.map((panel) => Math.abs(panel.offsetLeft + panel.offsetWidth / 2 - shift - centerX));
    const nearest = distances.reduce((bestIndex, distance, index) => distance < distances[bestIndex] ? index : bestIndex, 0);
    if (nearest === activeSpace || distances[nearest] + 14 < distances[activeSpace]) activeSpace = nearest;
    const active = activeSpace;
    if (spaceCount) spaceCount.innerHTML = `${String(active + 1).padStart(2, "0")} <i>/ 03</i>`;
    if (spaceCurrent) spaceCurrent.textContent = spacesLabels[active];
    spacePanels.forEach((panel, index) => {
      const distance = Math.abs(index - (progress * (spacePanels.length - 1)));
      const current = index === active;
      panel.classList.toggle("is-current", current);
      if (current) panel.setAttribute("aria-current", "step");
      else panel.removeAttribute("aria-current");
      panel.style.setProperty("--space-depth-y", `${Math.min(14, distance * 8)}px`);
      panel.style.setProperty("--space-depth-scale", String(1 - Math.min(distance, 1) * 0.025));
      panel.style.setProperty("--space-art-y", `${(index - progress * (spacePanels.length - 1)) * -5}px`);
      panel.style.setProperty("--space-art-scale", String(1 + (current ? 0.025 : 0)));
    });
  }

  function updateClosing() {
    if (!motionReady || !closingSection) return;
    const rect = closingSection.getBoundingClientRect();
    const progress = clamp((window.innerHeight - rect.top) / (window.innerHeight + rect.height));
    const orbitScale = 0.8 + smooth(progress) * 0.23;
    closingSection.style.setProperty("--closing-orbit-scale", String(orbitScale));
    closingOrbits?.style.setProperty("--closing-rotation", `${(progress - 0.5) * 10}deg`);
    closingDate?.style.setProperty("--closing-date-x", `${(progress - 0.5) * 22}px`);
    closingDate?.style.setProperty("--closing-date-y", `${(0.5 - progress) * 13}px`);
    closingCopy?.style.setProperty("--closing-copy-y", `${(0.5 - progress) * 13}px`);
  }

  function setTone() {
    const growthRect = growthTrack?.getBoundingClientRect();
    const closingRect = experience.querySelector(".closing-section")?.getBoundingClientRect();
    const inDarkScene = (growthRect && growthRect.top < headerHeight() && growthRect.bottom > headerHeight()) ||
      (closingRect && closingRect.top < headerHeight() && closingRect.bottom > headerHeight());
    const tone = inDarkScene ? "dark" : "light";
    if (tone !== lastTone) {
      lastTone = tone;
      document.body.dataset.experienceTone = tone;
    }
  }

  function update() {
    raf = 0;
    if (document.body.classList.contains("is-app")) return;
    updateOpening();
    updateGrowth();
    updateSpaces();
    updateClosing();
    setTone();
  }

  function queueUpdate() {
    if (raf) return;
    raf = window.requestAnimationFrame(update);
  }

  function goToGrowthChapter(index) {
    if (!motionReady || !growthTrack || !growthStage) {
      growthBeats[index]?.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "center" });
      return;
    }
    const travel = Math.max(1, growthTrack.offsetHeight - growthStage.clientHeight);
    const rect = growthTrack.getBoundingClientRect();
    const startAt = window.scrollY + rect.top - headerHeight();
    const ratio = index / growthBeats.length;
    window.scrollTo({ top: startAt + travel * ratio, behavior: reducedMotion.matches ? "auto" : "smooth" });
  }

  growthButtons.forEach((button) => button.addEventListener("click", () => goToGrowthChapter(Number(button.dataset.growthJump))));
  window.addEventListener("scroll", queueUpdate, { passive: true });
  window.addEventListener("resize", () => {
    syncMode();
    queueUpdate();
  }, { passive: true });
  reducedMotion.addEventListener?.("change", syncMode);
  widePointer.addEventListener?.("change", queueUpdate);
  const appModeObserver = new MutationObserver(() => {
    if (document.body.classList.contains("is-app")) {
      lastTone = "light";
      document.body.dataset.experienceTone = "light";
    } else {
      queueUpdate();
    }
  });
  appModeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  if ("IntersectionObserver" in window) {
    const sceneObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const section = entry.target.dataset.experienceSection;
        sectionLinks.forEach((link) => {
          const target = link.getAttribute("href").slice(1);
          const active = target === section || (target === "day" && section === "growth");
          if (active) link.setAttribute("aria-current", "location");
          else if (link.getAttribute("aria-current") === "location") link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-25% 0px -58% 0px", threshold: 0 });
    experience.querySelectorAll("[data-experience-section]").forEach((section) => sceneObserver.observe(section));
  }

  syncMode();
  queueUpdate();
}
