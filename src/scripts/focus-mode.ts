// Shared full-viewport slideshow engine — dark overlay, one photo at a
// time, slow crossfade. Two consumers build on this same core so the
// feature can't drift between them the way page styling has before:
//
//   - initFocusMode(): per-series "Slideshow" button on works/index.astro
//     and works/[slug].astro (identical markup, reuses whatever <img> the
//     gallery already loaded).
//   - Drift (src/pages/drift.astro): sitewide random slideshow across every
//     works + monthly photo, with idle auto-advance and music auto-started.
//
// Music is never paused/resumed by opening or closing — the overlay's own
// button just reflects the one shared <audio id="bg-audio"> element's
// state, same as Header.astro's toggle. No coupling between buttons.

export interface Slide {
  src: string;
  alt: string;
  title: string;
  /** Intrinsic pixel size, used to size the <img> before it decodes so its
   *  rendered box (and therefore the caption/counter pinned to its corners)
   *  is correct on the very first layout, not just after the image loads. */
  width: number;
  height: number;
}

export interface FocusPlayerOptions {
  /** Auto-advance to the next slide after this many ms of inactivity. Any
   *  manual navigation (keyboard/swipe/click) resets the timer. Omit for
   *  manual-only browsing. */
  autoAdvanceMs?: number;
  /** Try to start music when the overlay opens (subject to the browser's
   *  autoplay policy — silently ignored if blocked). */
  autoPlayMusic?: boolean;
  /** Called instead of the default close behavior (which just fades the
   *  overlay out). Drift uses this to navigate back to "/" since it has no
   *  underlying gallery to reveal. */
  onClose?: () => void;
  ariaLabel?: string;
}

export function createFocusPlayer(slides: Slide[], options: FocusPlayerOptions = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'focus-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', options.ariaLabel ?? 'Slideshow');
  overlay.innerHTML = `
    <p class="focus-title"></p>
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

  const titleEl = overlay.querySelector<HTMLElement>('.focus-title')!;
  const imgA = overlay.querySelector<HTMLImageElement>('.focus-img-a')!;
  const imgB = overlay.querySelector<HTMLImageElement>('.focus-img-b')!;
  const counter = overlay.querySelector<HTMLElement>('.focus-counter')!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>('.focus-close')!;
  const musicBtn = overlay.querySelector<HTMLButtonElement>('.focus-music-btn')!;
  const bottomBar = overlay.querySelector<HTMLElement>('.focus-bottom')!;

  let activeLayer = imgA;
  let inactiveLayer = imgB;
  let index = 0;
  let isOpen = false;
  let advanceTimer: ReturnType<typeof setTimeout> | null = null;

  const preload = (i: number) => {
    if (i < 0 || i >= slides.length) return;
    new Image().src = slides[i].src;
  };

  // Pins the title (bottom-left) and counter/music (bottom-right) to the
  // *photo's* actual rendered corners, not the viewport's — photos narrower
  // than the overlay (portrait, or just not wide enough to hit max-width)
  // otherwise leave a gap between the frame edge and the screen edge.
  function positionCaptions() {
    const rect = activeLayer.getBoundingClientRect();
    const gap = 12; // px between the photo's bottom edge and the caption
    titleEl.style.left = `${Math.round(rect.left)}px`;
    titleEl.style.top = `${Math.round(rect.bottom + gap)}px`;
    bottomBar.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
    bottomBar.style.top = `${Math.round(rect.bottom + gap)}px`;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let showToken = 0;
  const underTimers = new WeakMap<HTMLImageElement, ReturnType<typeof setTimeout>>();

  // Instantly hides a layer (no fade) and clears the inline state show() leaves
  // on a layer that is sitting underneath the incoming photo.
  function resetLayer(layer: HTMLImageElement) {
    const t = underTimers.get(layer);
    if (t) clearTimeout(t);
    layer.classList.remove('visible');
    layer.style.opacity = '';
    layer.style.zIndex = '';
    layer.style.transition = 'none';
    layer.getBoundingClientRect(); // flush so the no-transition hide applies now
    layer.style.transition = '';
  }

  // Quiet bracketed caption, e.g. [ Studies of sky, 2026 ].
  const formatTitle = (t: string) => (t ? `[ ${t} ]` : '');

  const fadeMs = (el: HTMLElement) =>
    parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;

  function scheduleAdvance() {
    if (advanceTimer) clearTimeout(advanceTimer);
    if (!options.autoAdvanceMs || slides.length < 2) return;
    if (reducedMotion.matches) return; // no auto-advancing for reduced motion
    advanceTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') {
        show(index + 1);
      } else {
        scheduleAdvance(); // tab hidden — don't skip ahead, just check again later
      }
    }, options.autoAdvanceMs);
  }

  function show(i: number) {
    index = (i + slides.length) % slides.length;
    const slide = slides[index];
    const token = ++showToken;
    const incoming = inactiveLayer;
    const outgoing = activeLayer;

    resetLayer(incoming);
    incoming.width = slide.width;
    incoming.height = slide.height;
    incoming.src = slide.src;
    incoming.alt = slide.alt;
    [activeLayer, inactiveLayer] = [incoming, outgoing];

    titleEl.textContent = formatTitle(slide.title);
    counter.textContent = `${index + 1} / ${slides.length}`;
    preload(index - 1);
    preload(index + 1);
    positionCaptions();
    scheduleAdvance();

    // A plain two-way crossfade dips: while one photo fades out and the other
    // fades in, both are partly transparent and the dark background shows
    // through. Instead, hold the outgoing photo opaque underneath while the
    // incoming one fades in on top, and only then fade the outgoing one out
    // over the second half. (Vanishing it outright at the end looks like a
    // pop whenever it's a different shape and pokes out past the new photo.)
    // Waits for the incoming photo to decode so we never fade in a blank frame.
    const reveal = () => {
      if (token !== showToken) return;
      const total = fadeMs(incoming);
      const held = getComputedStyle(outgoing).opacity;
      outgoing.style.transition = 'none';
      outgoing.style.opacity = held;
      outgoing.style.zIndex = '1';
      outgoing.classList.remove('visible');
      outgoing.getBoundingClientRect();
      outgoing.style.transition = `opacity ${total / 2}ms ease-in ${total / 2}ms`;
      outgoing.style.opacity = '0';
      incoming.classList.add('visible');
      underTimers.set(outgoing, setTimeout(() => resetLayer(outgoing), total));
    };
    incoming.decode().then(reveal, reveal);
  }

  function open(startIndex: number) {
    isOpen = true;
    document.body.classList.add('focus-open');
    document.documentElement.style.overflow = 'hidden';
    index = (startIndex + slides.length) % slides.length;
    const slide = slides[index];
    showToken++; // cancel any fade still pending from before
    resetLayer(inactiveLayer);
    resetLayer(activeLayer);
    activeLayer.width = slide.width;
    activeLayer.height = slide.height;
    activeLayer.src = slide.src;
    activeLayer.alt = slide.alt;
    activeLayer.classList.add('visible');
    titleEl.textContent = formatTitle(slide.title);
    counter.textContent = `${index + 1} / ${slides.length}`;
    preload(index - 1);
    preload(index + 1);
    // Force layout before adding .open so its transition actually runs.
    overlay.getBoundingClientRect();
    overlay.classList.add('open');
    closeBtn.focus();
    positionCaptions();
    scheduleAdvance();

    if (options.autoPlayMusic) {
      const audio = document.getElementById('bg-audio') as HTMLAudioElement | null;
      audio?.play().catch(() => {
        // autoplay policy — ignore, user can click the music button
      });
    }
  }

  function close() {
    isOpen = false;
    document.body.classList.remove('focus-open');
    document.documentElement.style.overflow = '';
    overlay.classList.remove('open');
    if (advanceTimer) clearTimeout(advanceTimer);
    options.onClose?.();
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

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
  });

  // The width/height attrs set in show()/open() give the browser an
  // intrinsic aspect ratio to lay out with immediately, but reposition once
  // more on actual load and on viewport resize in case anything shifts.
  imgA.addEventListener('load', positionCaptions);
  imgB.addEventListener('load', positionCaptions);
  window.addEventListener('resize', () => {
    if (isOpen) positionCaptions();
  });

  let touchStartX = 0;
  overlay.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  });
  overlay.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) show(dx < 0 ? index + 1 : index - 1);
  });

  // Mirrors Header.astro's own music toggle — see file header comment.
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
    });
    audio.addEventListener('play', syncMusicBtn);
    audio.addEventListener('pause', syncMusicBtn);
    syncMusicBtn();
  } else {
    musicBtn.style.display = 'none';
  }

  return {
    open,
    close,
    destroy() {
      if (advanceTimer) clearTimeout(advanceTimer);
      document.documentElement.style.overflow = '';
      document.body.classList.remove('focus-open');
      overlay.remove();
    },
  };
}

/** Per-series "Slideshow" button — works/index.astro and works/[slug].astro. */
export function initFocusMode() {
  const library = document.querySelector<HTMLElement>('.library');
  const trigger = document.querySelector<HTMLButtonElement>('.focus-trigger');
  if (!library || !trigger) return;

  // astro:page-load fires on the initial load too, in addition to the
  // direct call right after this function is defined — guard so we don't
  // build a second player and double-bind the trigger.
  if (trigger.dataset.bound === '1') return;
  trigger.dataset.bound = '1';

  const figures = Array.from(library.querySelectorAll<HTMLElement>('.figure'));
  if (figures.length === 0) return;

  const titleText = document.querySelector('.series-head .title')?.textContent ?? '';
  const yearText = document.querySelector('.series-head .year')?.textContent?.trim() ?? '';
  const captionText = [titleText, yearText].filter(Boolean).join(', ');
  const slides: Slide[] = figures.map((fig) => {
    const img = fig.querySelector('img');
    return {
      src: img?.currentSrc || img?.src || '',
      alt: img?.alt ?? '',
      title: captionText,
      width: Number(img?.getAttribute('width')) || 0,
      height: Number(img?.getAttribute('height')) || 0,
    };
  });

  const player = createFocusPlayer(slides, {
    autoAdvanceMs: 8000, // same pace as Drift
    ariaLabel: titleText ? `${titleText} — slideshow` : 'Slideshow',
  });

  function findCurrentIndex() {
    const anchor = 120;
    let idx = 0;
    for (let i = 0; i < figures.length; i++) {
      if (figures[i].getBoundingClientRect().top <= anchor) idx = i;
    }
    return idx;
  }

  const controller = new AbortController();
  trigger.addEventListener('click', () => player.open(findCurrentIndex()), { signal: controller.signal });

  document.addEventListener('astro:before-swap', () => {
    controller.abort();
    player.destroy();
  }, { once: true });
}
