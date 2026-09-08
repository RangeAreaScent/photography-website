// Focus/slideshow mode for works galleries. Shared by works/index.astro and
// works/[slug].astro (both render the same .series-head/.library markup) so
// the feature can't drift between them the way styling has before.
//
// Dark full-viewport overlay, one photo at a time, slow crossfade. Reuses
// whatever <img> the gallery already loaded (currentSrc) rather than
// fetching anything new. Music keeps playing untouched — this is a same-page
// overlay, not a navigation.

export function initFocusMode() {
  const library = document.querySelector<HTMLElement>('.library');
  const trigger = document.querySelector<HTMLButtonElement>('.focus-trigger');
  if (!library || !trigger) return;

  // astro:page-load fires on the initial load too, in addition to the
  // direct call right below — guard so we don't build a second overlay
  // and double-bind the trigger.
  if (trigger.dataset.bound === '1') return;
  trigger.dataset.bound = '1';

  const figures = Array.from(library.querySelectorAll<HTMLElement>('.figure'));
  if (figures.length === 0) return;

  const titleText = document.querySelector('.series-head .title')?.textContent ?? '';

  const controller = new AbortController();
  const { signal } = controller;

  const overlay = document.createElement('div');
  overlay.className = 'focus-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', titleText ? `${titleText} — slideshow` : 'Slideshow');
  overlay.innerHTML = `
    <p class="focus-title">${titleText}</p>
    <div class="focus-stage">
      <img class="focus-img focus-img-a" alt="" />
      <img class="focus-img focus-img-b" alt="" />
    </div>
    <div class="focus-bottom">
      <button class="focus-music-btn off" type="button" aria-label="Play music">
        <span class="focus-music-icon" aria-hidden="true">♪</span>
      </button>
      <p class="focus-counter"></p>
    </div>
    <button class="focus-close" type="button" aria-label="Close slideshow">×</button>
  `;
  document.body.appendChild(overlay);

  const imgA = overlay.querySelector<HTMLImageElement>('.focus-img-a')!;
  const imgB = overlay.querySelector<HTMLImageElement>('.focus-img-b')!;
  const counter = overlay.querySelector<HTMLElement>('.focus-counter')!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>('.focus-close')!;
  const musicBtn = overlay.querySelector<HTMLButtonElement>('.focus-music-btn')!;

  let activeLayer = imgA;
  let inactiveLayer = imgB;
  let index = 0;
  let isOpen = false;

  const srcFor = (i: number) => {
    const img = figures[i].querySelector('img');
    return img?.currentSrc || img?.src || '';
  };
  const altFor = (i: number) => figures[i].querySelector('img')?.alt ?? '';

  const preload = (i: number) => {
    if (i < 0 || i >= figures.length) return;
    const src = srcFor(i);
    if (src) new Image().src = src;
  };

  function show(i: number) {
    index = (i + figures.length) % figures.length;
    inactiveLayer.src = srcFor(index);
    inactiveLayer.alt = altFor(index);
    inactiveLayer.classList.add('visible');
    activeLayer.classList.remove('visible');
    [activeLayer, inactiveLayer] = [inactiveLayer, activeLayer];

    counter.textContent = `${index + 1} / ${figures.length}`;
    preload(index - 1);
    preload(index + 1);
  }

  function findCurrentIndex() {
    const anchor = 120;
    let idx = 0;
    for (let i = 0; i < figures.length; i++) {
      if (figures[i].getBoundingClientRect().top <= anchor) idx = i;
    }
    return idx;
  }

  function open(startIndex: number) {
    isOpen = true;
    document.body.classList.add('focus-open');
    document.documentElement.style.overflow = 'hidden';
    // Set the first frame before the overlay fades in, so there's no flash
    // of an empty stage during the overlay's own opacity transition.
    index = (startIndex + figures.length) % figures.length;
    activeLayer.src = srcFor(index);
    activeLayer.alt = altFor(index);
    activeLayer.classList.add('visible');
    counter.textContent = `${index + 1} / ${figures.length}`;
    preload(index - 1);
    preload(index + 1);
    // Force layout before adding .open so its transition actually runs.
    overlay.getBoundingClientRect();
    overlay.classList.add('open');
    closeBtn.focus();
  }

  function close() {
    isOpen = false;
    document.body.classList.remove('focus-open');
    document.documentElement.style.overflow = '';
    overlay.classList.remove('open');
  }

  trigger.addEventListener('click', () => open(findCurrentIndex()), { signal });
  closeBtn.addEventListener('click', close, { signal });

  // Mirrors Header.astro's own music toggle — both buttons just reflect the
  // one shared <audio id="bg-audio"> element's state, so they stay in sync
  // without needing to know about each other.
  const audio = document.getElementById('bg-audio') as HTMLAudioElement | null;
  if (audio) {
    const syncMusicBtn = () => {
      musicBtn.classList.toggle('off', audio.paused);
      musicBtn.setAttribute('aria-label', audio.paused ? 'Play music' : 'Pause music');
    };
    musicBtn.addEventListener('click', async () => {
      if (audio.paused) {
        try {
          await audio.play();
        } catch {
          // autoplay policy — ignore, user can click again
        }
      } else {
        audio.pause();
      }
    }, { signal });
    audio.addEventListener('play', syncMusicBtn, { signal });
    audio.addEventListener('pause', syncMusicBtn, { signal });
    syncMusicBtn();
  } else {
    musicBtn.style.display = 'none';
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  }, { signal });

  document.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'j') {
      e.preventDefault();
      show(index + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'k') {
      e.preventDefault();
      show(index - 1);
    }
  }, { signal });

  let touchStartX = 0;
  overlay.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { signal });
  overlay.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) show(dx < 0 ? index + 1 : index - 1);
  }, { signal });

  document.addEventListener('astro:before-swap', () => {
    controller.abort();
    document.documentElement.style.overflow = '';
    document.body.classList.remove('focus-open');
    overlay.remove();
  }, { once: true });
}
