const STORAGE_KEY = 'bloomForBeesPlan';

const form = document.querySelector('#plan-form');
const flowerSelect = document.querySelector('#flower');
const placeSelect = document.querySelector('#place');
const savedPlan = document.querySelector('#saved-plan');
const planSummary = document.querySelector('#plan-summary');
const plantStatus = document.querySelector('#plant-status');
const plantedToggle = document.querySelector('#planted-toggle');
const editPlan = document.querySelector('#edit-plan');
const sharePlan = document.querySelector('#share-plan');
const downloadPlan = document.querySelector('#download-plan');
const shareChallenge = document.querySelector('#share-challenge');
const shareFeedback = document.querySelector('#share-feedback');
const toast = document.querySelector('#site-toast');
let toastTimer;

function nextBloomDay() {
  const today = new Date();
  const year = today.getFullYear();
  let eventDay = new Date(year, 5, 7);
  const startOfToday = new Date(year, today.getMonth(), today.getDate());
  if (eventDay < startOfToday) eventDay = new Date(year + 1, 5, 7);
  return { eventDay, days: Math.round((eventDay - startOfToday) / 86_400_000) };
}

function renderCountdown() {
  const { eventDay, days } = nextBloomDay();
  const countdown = document.querySelector('#countdown');
  const note = document.querySelector('#countdown-note');
  countdown.textContent = eventDay.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  note.textContent = days === 0 ? 'Today is Bloom for Bees Day!' : `${days} ${days === 1 ? 'day' : 'days'} to get ready.`;
}

function readPlan() {
  try {
    const plan = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!plan || typeof plan.flower !== 'string' || typeof plan.place !== 'string') return null;
    return { flower: plan.flower, place: plan.place, planted: Boolean(plan.planted) };
  } catch {
    return null;
  }
}

function renderPlan(plan) {
  if (!plan) {
    savedPlan.hidden = true;
    form.hidden = false;
    return;
  }

  form.hidden = true;
  savedPlan.hidden = false;
  planSummary.innerHTML = `On June 7, I’ll plant <span>${escapeHtml(plan.flower)}</span> in <span>${escapeHtml(plan.place)}</span>.`;
  plantStatus.textContent = plan.planted
    ? 'Your flower is planted. Here’s to a little more colour.'
    : 'When your flower is in the ground, mark it planted here.';
  plantStatus.classList.toggle('is-planted', Boolean(plan.planted));
  plantedToggle.innerHTML = plan.planted
    ? 'Undo planted mark <span aria-hidden="true">↶</span>'
    : 'I planted my flower <span aria-hidden="true">✿</span>';
  document.querySelector('#progress-label').textContent = plan.planted ? 'Step 2 of 2' : 'Step 1 of 2';
  document.querySelector('#progress-fill').style.width = plan.planted ? '100%' : '50%';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function escapeXml(value) {
  return escapeHtml(value);
}

function persistPlan(plan) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    showToast('Your plan is ready, but this browser could not save it. Keep your keepsake instead.');
  }
  renderPlan(plan);
}

function planMessage(plan) {
  return `I’m joining Bloom for Bees Day on June 7! My plan: plant ${plan.flower} in ${plan.place}. Join me and let’s help our neighbourhood bloom. 🌼🐝`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

async function shareText(message) {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Bloom for Bees Day', text: message });
      shareFeedback.textContent = 'Thanks for spreading the idea!';
      showToast('Thanks for spreading the idea!');
      return;
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(message);
    shareFeedback.textContent = 'Challenge copied. Send it to a friend!';
    showToast('Challenge copied. Send it to a friend!');
  } catch {
    shareFeedback.textContent = message;
    showToast('Copy this invitation: ' + message);
  }
}

function downloadKeepsake(plan) {
  const { eventDay } = nextBloomDay();
  const year = eventDay.getFullYear();
  const flower = escapeXml(plan.flower);
  const place = escapeXml(plan.place);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <rect width="1200" height="675" fill="#f8f7f1"/>
    <rect x="22" y="22" width="1156" height="631" fill="none" stroke="#1b4934" stroke-opacity=".2" stroke-width="2"/>
    <circle cx="1000" cy="158" r="102" fill="#e6eddc"/><circle cx="1000" cy="158" r="56" fill="#f2c961"/>
    <g fill="#d8794c"><ellipse cx="1000" cy="78" rx="21" ry="53"/><ellipse cx="1000" cy="78" rx="21" ry="53" transform="rotate(60 1000 158)"/><ellipse cx="1000" cy="78" rx="21" ry="53" transform="rotate(120 1000 158)"/></g>
    <circle cx="1000" cy="158" r="31" fill="#d8794c"/>
    <text x="100" y="115" fill="#37734e" font-family="Arial,sans-serif" font-size="22" font-weight="700" letter-spacing="5">A LITTLE HOLIDAY FOR A LOT OF LIFE</text>
    <text x="100" y="230" fill="#193c2d" font-family="Georgia,serif" font-size="82" font-weight="600">Bloom for Bees Day</text>
    <text x="103" y="300" fill="#37734e" font-family="Arial,sans-serif" font-size="31" font-weight="700">JUNE 7 · ${year}</text>
    <path d="M100 354h997" stroke="#dce3d8" stroke-width="2"/>
    <text x="100" y="425" fill="#607465" font-family="Arial,sans-serif" font-size="24">MY BLOOM PLAN</text>
    <text x="100" y="480" fill="#193c2d" font-family="Georgia,serif" font-size="33">I’ll plant ${flower} in ${place}.</text>
    <text x="100" y="571" fill="#37734e" font-family="Georgia,serif" font-size="29" font-style="italic">One bloom at a time.</text>
    <text x="1098" y="585" text-anchor="end" fill="#849186" font-family="Arial,sans-serif" font-size="16" letter-spacing="2">BLOOM FOR BEES</text>
  </svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'my-bloom-for-bees-plan.svg';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Your Bloom for Bees keepsake is ready.');
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  persistPlan({ flower: flowerSelect.value, place: placeSelect.value, planted: false });
  showToast('Your bloom plan is saved on this device.');
  savedPlan.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

editPlan.addEventListener('click', () => {
  const plan = readPlan();
  if (plan) {
    flowerSelect.value = plan.flower;
    placeSelect.value = plan.place;
  }
  savedPlan.hidden = true;
  form.hidden = false;
  flowerSelect.focus();
});

plantedToggle.addEventListener('click', () => {
  const plan = readPlan();
  if (plan) {
    const updatedPlan = { ...plan, planted: !plan.planted };
    persistPlan(updatedPlan);
    showToast(updatedPlan.planted ? 'A flower planted. A tradition in bloom.' : 'Planting progress updated.');
  }
});

sharePlan.addEventListener('click', () => {
  const plan = readPlan();
  if (plan) shareText(planMessage(plan));
});

downloadPlan.addEventListener('click', () => {
  const plan = readPlan();
  if (plan) downloadKeepsake(plan);
});

shareChallenge.addEventListener('click', () => {
  shareText('Join me for Bloom for Bees Day on June 7! Plant one bee-friendly flower and help your neighbourhood bloom. 🌼🐝');
});

const menuToggle = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('#mobile-nav');
const siteHeader = document.querySelector('.site-header');

function closeMenu() {
  mobileNav.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
}

menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  if (isOpen) {
    closeMenu();
    return;
  }
  mobileNav.style.top = `${siteHeader.getBoundingClientRect().bottom}px`;
  mobileNav.hidden = false;
  menuToggle.setAttribute('aria-expanded', 'true');
  menuToggle.setAttribute('aria-label', 'Close navigation');
});

mobileNav.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !mobileNav.hidden) {
    closeMenu();
    menuToggle.focus();
  }
});

document.addEventListener('click', (event) => {
  if (!mobileNav.hidden && !mobileNav.contains(event.target) && !menuToggle.contains(event.target)) closeMenu();
});

renderCountdown();
renderPlan(readPlan());
