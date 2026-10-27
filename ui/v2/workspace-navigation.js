import { retainV2EdgeHost } from './lifecycle.js';
import { bindV2ZDismissAffordance } from './z-affordance.js';
import { bindV2StableZFrame } from './z-stack.js';

export function setV2DeckOpen(root, open) {
  const app = root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
  if (!app) return false;
  const next = Boolean(open);
  if (next) app.classList.remove('is-z-entering');
  app.classList.toggle('is-deck-open', next);
  app.classList.remove('is-revealing-deck');
  if (!next) app.classList.remove('is-e-open');
  return next;
}

export function initV2WorkspaceInteraction(root, {
  activeId = '',
  eActiveId = '',
  deckOpen = false,
  eOpen = false,
  onRootSelect = null,
  onSecondarySelect = null,
  onDeckOpenChange = null,
  onEOpenChange = null,
  onZRight = null,
  onZLeft = null,
  bindZ = true,
  threshold = 28,
  maxDrag = 180,
  edgeWidth = 36,
} = {}) {
  const app = root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
  if (!app) return () => {};

  const stage = app.querySelector('.v2-app__stage');
  const front = app.querySelector('[data-v2-front]');
  const fDeck = app.querySelector('[data-v2-card-deck][data-v2-deck-level="f"]');
  const eDeck = app.querySelector('[data-v2-card-deck][data-v2-deck-level="e"]');
  const z = app.querySelector('[data-v2-front] > [data-v2-z]');
  const edgeHost = app.querySelector('[data-v2-edge-swipe]') || stage;
  if (!stage || !front) return () => {};
  bindV2StableZFrame(z);
  const releaseEdgeHost = retainV2EdgeHost(bindZ && edgeHost?.matches?.('[data-v2-edge-swipe]') ? edgeHost : null);

  const fCards = [...(fDeck?.querySelectorAll?.('[data-v2-card-item]') || [])];
  const eCards = [...(eDeck?.querySelectorAll?.('[data-v2-card-item]') || [])];
  let fActiveIndex = Math.max(0, fCards.findIndex((card) => String(card.getAttribute('data-v2-card-item') || '') === String(activeId || '')));
  let eActiveIndex = Math.max(0, eCards.findIndex((card) => String(card.getAttribute('data-v2-card-item') || '') === String(eActiveId || '')));
  let open = Boolean(deckOpen);
  let secondaryOpen = Boolean(open && eOpen && eCards.length);
  let zGesture = null;
  let eGesture = null;
  let eDismissTimer = 0;
  const disposers = [];
  const scrollFrames = new Map();
  const cardId = (card) => String(card?.getAttribute('data-v2-card-item') || '');
  const deckIsOpen = () => app.classList.contains('is-deck-open');
  const secondaryIsOpen = () => app.classList.contains('is-e-open');

  const setActiveCard = (cards, index) => {
    cards.forEach((card, cardIndex) => {
      const active = cardIndex === index;
      card.classList.toggle('is-active', active);
      if (active) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
    });
  };

  setActiveCard(fCards, fActiveIndex);
  setActiveCard(eCards, eActiveIndex);

  const updateDeckGeometry = (deck, cards, axis) => {
    if (!deck || !cards.length) return -1;
    const center = axis === 'y' ? Number(deck.clientHeight || 0) / 2 : Number(deck.clientWidth || 0) / 2;
    const scroll = axis === 'y' ? Number(deck.scrollTop || 0) : Number(deck.scrollLeft || 0);

    // Read all layout geometry first. Mixing offset reads with style writes card-by-card
    // forces repeated layout work and makes the deck feel behind the finger.
    const metrics = cards.map((card, index) => {
      const cardCenter = axis === 'y'
        ? Number(card.offsetTop || 0) - scroll + Number(card.offsetHeight || 0) / 2
        : Number(card.offsetLeft || 0) - scroll + Number(card.offsetWidth || 0) / 2;
      const span = Math.max(1, axis === 'y' ? Number(card.offsetHeight || 0) : Number(card.offsetWidth || 0));
      const signed = (cardCenter - center) / Math.max(1, span * .72);
      const absolute = Math.min(2.6, Math.abs(signed));
      return {
        card,
        index,
        distance: Math.abs(cardCenter - center),
        depth: -Math.min(180, absolute * 82),
        scale: 1 - Math.min(.13, absolute * .055),
        opacity: 1 - Math.min(.38, absolute * .16),
        brightness: 1 - Math.min(.22, absolute * .09),
        rotation: Math.max(-13, Math.min(13, signed * (axis === 'y' ? -6.5 : 7.5))),
        shift: Math.max(-18, Math.min(18, signed * -8)),
        stack: Math.max(1, 100 - Math.round(absolute * 24)),
      };
    });

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    metrics.forEach((metric) => {
      const { card } = metric;
      card.style.setProperty('--v2-card-depth', `${metric.depth}px`);
      card.style.setProperty('--v2-card-scale', metric.scale.toFixed(4));
      card.style.setProperty('--v2-card-opacity', metric.opacity.toFixed(4));
      card.style.setProperty('--v2-card-brightness', metric.brightness.toFixed(4));
      card.style.setProperty('--v2-card-rotation', `${metric.rotation.toFixed(3)}deg`);
      card.style.setProperty('--v2-card-shift', `${metric.shift.toFixed(3)}px`);
      card.style.setProperty('--v2-card-stack', String(metric.stack));
      if (metric.distance < nearestDistance) {
        nearestDistance = metric.distance;
        nearestIndex = metric.index;
      }
    });

    setActiveCard(cards, nearestIndex);
    return nearestIndex;
  };

  const scheduleGeometry = (deck, cards, axis, assign) => {
    if (!deck) return;
    const prior = scrollFrames.get(deck);
    if (prior) cancelAnimationFrame(prior);
    const frame = requestAnimationFrame(() => {
      scrollFrames.delete(deck);
      const index = updateDeckGeometry(deck, cards, axis);
      if (index >= 0) assign(index);
    });
    scrollFrames.set(deck, frame);
  };

  const centerCard = (card, axis, behavior = 'auto') => {
    const deck = card?.closest?.('[data-v2-card-deck]');
    if (!card || !deck) return;
    const target = axis === 'y'
      ? Math.max(0, Math.min(
        Math.max(0, Number(deck.scrollHeight || 0) - Number(deck.clientHeight || 0)),
        Number(card.offsetTop || 0) + Number(card.offsetHeight || 0) / 2 - Number(deck.clientHeight || 0) / 2,
      ))
      : Math.max(0, Math.min(
        Math.max(0, Number(deck.scrollWidth || 0) - Number(deck.clientWidth || 0)),
        Number(card.offsetLeft || 0) + Number(card.offsetWidth || 0) / 2 - Number(deck.clientWidth || 0) / 2,
      ));

    if (behavior === 'smooth') {
      if (axis === 'y') deck.scrollTo({ top:target, behavior:'smooth' });
      else deck.scrollTo({ left:target, behavior:'smooth' });
      return;
    }

    // State restore/open must land on the exact semantic card. Native mandatory
    // snap may otherwise reinterpret a large programmatic jump as a fling and
    // choose the neighbouring snap point.
    const previousSnap = deck.style.scrollSnapType;
    deck.style.scrollSnapType = 'none';
    if (axis === 'y') deck.scrollTop = target;
    else deck.scrollLeft = target;
    void deck.offsetWidth;
    deck.style.scrollSnapType = previousSnap;
  };

  const bindNativeDeck = (deck, cards, axis, getActiveIndex, setActiveIndex, onSelect, isEnabled = () => true) => {
    if (!deck || !cards.length) return;
    let pointer = null;
    let suppressClick = false;
    let settleTimer = 0;

    const refresh = () => {
      if (!isEnabled()) return;
      scheduleGeometry(deck, cards, axis, setActiveIndex);
    };
    const settle = () => {
      if (!isEnabled()) return;
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (!isEnabled()) return;
        const next = updateDeckGeometry(deck, cards, axis);
        if (next >= 0) setActiveIndex(next);
      }, 90);
    };
    const down = (event) => {
      if (!isEnabled()) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dragged: false,
      };
      suppressClick = false;
    };
    const move = (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (Math.hypot(dx, dy) >= 9) pointer.dragged = true;
    };
    const up = (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      suppressClick = pointer.dragged;
      pointer = null;
    };
    const cancel = () => {
      pointer = null;
      suppressClick = true;
    };
    const click = (event) => {
      if (!isEnabled()) return;
      const card = event.target.closest?.('[data-v2-card-item]');
      if (!card || !deck.contains(card)) return;
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const index = cards.indexOf(card);
      if (index < 0) return;
      setActiveIndex(index);
      setActiveCard(cards, index);
      const id = cardId(card);
      if (id) onSelect?.(id);
    };

    deck.addEventListener('scroll', refresh, { passive: true });
    deck.addEventListener('scroll', settle, { passive: true });
    deck.addEventListener('pointerdown', down, { passive: true });
    deck.addEventListener('pointermove', move, { passive: true });
    deck.addEventListener('pointerup', up, { passive: true });
    deck.addEventListener('pointercancel', cancel, { passive: true });
    deck.addEventListener('click', click, true);
    disposers.push(() => {
      if (settleTimer) window.clearTimeout(settleTimer);
      deck.removeEventListener('scroll', refresh);
      deck.removeEventListener('scroll', settle);
      deck.removeEventListener('pointerdown', down);
      deck.removeEventListener('pointermove', move);
      deck.removeEventListener('pointerup', up);
      deck.removeEventListener('pointercancel', cancel);
      deck.removeEventListener('click', click, true);
    });
  };

  const setEOpen = (nextOpen, notify = true) => {
    open = deckIsOpen();
    if (eDismissTimer) {
      window.clearTimeout(eDismissTimer);
      eDismissTimer = 0;
    }
    secondaryOpen = Boolean(open && nextOpen && eCards.length);
    app.classList.toggle('is-e-open', secondaryOpen);
    eDeck?.style.removeProperty('--v2-e-dismiss-x');
    eDeck?.classList.remove('is-dragging');
    if (secondaryOpen) {
      setActiveCard(eCards, eActiveIndex);
      centerCard(eCards[eActiveIndex], 'y');
      const index = updateDeckGeometry(eDeck, eCards, 'y');
      if (index >= 0) eActiveIndex = index;
    }
    if (notify) onEOpenChange?.(secondaryOpen);
    return secondaryOpen;
  };

  const setOpen = (nextOpen, notify = true) => {
    open = setV2DeckOpen(app, nextOpen);
    if (!open) {
      secondaryOpen = false;
      app.classList.remove('is-e-open');
    }
    front.classList.remove('is-dragging');
    front.style.removeProperty('--v2-front-drag-x');
    if (open) {
      setActiveCard(fCards, fActiveIndex);
      centerCard(fCards[fActiveIndex], 'x');
      const index = updateDeckGeometry(fDeck, fCards, 'x');
      if (index >= 0) fActiveIndex = index;
    }
    if (notify) onDeckOpenChange?.(open);
    return open;
  };

  const clearZEntry = (event) => {
    if (event.animationName === 'v2-z-enter-from-right') app.classList.remove('is-z-entering');
  };
  front.addEventListener('animationend', clearZEntry);
  disposers.push(() => front.removeEventListener('animationend', clearZEntry));

  bindNativeDeck(
    fDeck,
    fCards,
    'x',
    () => fActiveIndex,
    (index) => { fActiveIndex = index; },
    (id) => onRootSelect?.(id),
    () => deckIsOpen() && !secondaryIsOpen() && !app.classList.contains('has-v2-modal'),
  );
  bindNativeDeck(
    eDeck,
    eCards,
    'y',
    () => eActiveIndex,
    (index) => { eActiveIndex = index; },
    (id) => onSecondarySelect?.(id),
    () => secondaryIsOpen() && !app.classList.contains('has-v2-modal'),
  );

  const eDown = (event) => {
    if (app.classList.contains('has-v2-modal')) return;
    if (!secondaryIsOpen() || !eDeck?.contains(event.target)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    eGesture = { id:event.pointerId, x:event.clientX, y:event.clientY, dx:0, axis:'pending' };
  };
  const eMove = (event) => {
    if (!eGesture || event.pointerId !== eGesture.id) return;
    const dx = event.clientX - eGesture.x;
    const dy = event.clientY - eGesture.y;
    eGesture.dx = dx;
    if (eGesture.axis === 'pending') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 7) return;
      if (Math.abs(dy) >= Math.abs(dx) * 1.05 || dx <= 0) {
        eGesture = null;
        return;
      }
      eGesture.axis = 'horizontal';
      eDeck.setPointerCapture?.(event.pointerId);
    }
    const dragX = Math.max(0, Math.min(Math.max(maxDrag, Number(stage.clientWidth || 0)), dx));
    eDeck.classList.add('is-dragging');
    eDeck.style.setProperty('--v2-e-dismiss-x', `${dragX}px`);
    event.preventDefault();
  };
  const eUp = (event) => {
    if (!eGesture || event.pointerId !== eGesture.id) return;
    const current = eGesture;
    eGesture = null;
    try {
      if (eDeck.hasPointerCapture?.(event.pointerId)) eDeck.releasePointerCapture?.(event.pointerId);
    } catch {}

    if (current.axis === 'horizontal' && current.dx >= threshold) {
      // Continue from the finger position instead of snapping E back to x=0 first.
      const currentX = Math.max(0, current.dx);
      const exitX = Math.max(Number(stage.clientWidth || 0), currentX);
      eDeck.style.setProperty('--v2-e-dismiss-x', `${currentX}px`);
      eDeck.classList.remove('is-dragging');
      void eDeck.offsetWidth;
      secondaryOpen = false;
      app.classList.remove('is-e-open');
      eDeck.style.setProperty('--v2-e-dismiss-x', `${exitX}px`);
      onEOpenChange?.(false);
      eDismissTimer = window.setTimeout(() => {
        eDismissTimer = 0;
        if (!secondaryOpen) eDeck.style.removeProperty('--v2-e-dismiss-x');
      }, 260);
      return;
    }

    eDeck.classList.remove('is-dragging');
    eDeck.style.removeProperty('--v2-e-dismiss-x');
  };
  const eCancel = () => {
    eGesture = null;
    eDeck?.classList.remove('is-dragging');
    eDeck?.style.removeProperty('--v2-e-dismiss-x');
  };
  eDeck?.addEventListener('pointerdown', eDown);
  eDeck?.addEventListener('pointermove', eMove, { passive:false });
  eDeck?.addEventListener('pointerup', eUp);
  eDeck?.addEventListener('pointercancel', eCancel);
  disposers.push(() => {
    eDeck?.removeEventListener('pointerdown', eDown);
    eDeck?.removeEventListener('pointermove', eMove);
    eDeck?.removeEventListener('pointerup', eUp);
    eDeck?.removeEventListener('pointercancel', eCancel);
  });

  const clearZGesture = () => {
    if (zGesture?.captured && zGesture.id != null) {
      try {
        if (edgeHost.hasPointerCapture?.(zGesture.id)) edgeHost.releasePointerCapture?.(zGesture.id);
      } catch {}
    }
    zGesture = null;
    front.classList.remove('is-dragging');
    front.style.removeProperty('--v2-front-drag-x');
    app.classList.remove('is-revealing-deck');
  };

  const dismissBaseZ = () => {
    if (typeof z?.v2Back === 'function' && z.v2Back() === true) return;
    if (onZRight) onZRight();
    else {
      setOpen(true);
      setEOpen(false, false);
    }
  };

  const disposeZDismissAffordance = bindV2ZDismissAffordance(z, {
    onDismiss: dismissBaseZ,
    isEnabled: () => bindZ
      && !deckIsOpen()
      && !app.classList.contains('has-v2-modal')
      && !app.querySelector('[data-v2-z-layer]'),
  });
  disposers.push(disposeZDismissAffordance);

  const zDown = (event) => {
    if (app.classList.contains('has-v2-modal')) return;
    if (!bindZ || deckIsOpen() || zGesture || app.querySelector('[data-v2-z-layer]')) return;
    if (event.target.closest?.('[data-v2-layer], [data-v2-z-layer]')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (edgeHost === stage) {
      const rect = stage.getBoundingClientRect();
      if (Number(event.clientX || 0) > rect.left + edgeWidth) return;
    }
    zGesture = {
      id:event.pointerId,
      x:event.clientX,
      y:event.clientY,
      dx:0,
      axis:'pending',
      captured:false,
      scrollTop:Number(z?.scrollTop || 0),
    };
  };
  const zMove = (event) => {
    if (!zGesture || event.pointerId !== zGesture.id) return;
    const dx = event.clientX - zGesture.x;
    const dy = event.clientY - zGesture.y;
    zGesture.dx = dx;
    if (zGesture.axis === 'pending') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * .72) {
        clearZGesture();
        return;
      }
      zGesture.axis = 'horizontal';
      edgeHost.setPointerCapture?.(event.pointerId);
      zGesture.captured = true;
    }
    if (z) z.scrollTop = zGesture.scrollTop;
    const dragX = Math.max(0, Math.min(Math.max(maxDrag, Number(stage.clientWidth || 0)), dx));
    front.classList.add('is-dragging');
    front.style.setProperty('--v2-front-drag-x', `${dragX}px`);
    app.classList.add('is-revealing-deck');
    event.preventDefault();
  };
  const zUp = (event) => {
    if (!zGesture || event.pointerId !== zGesture.id) return;
    const current = zGesture;
    clearZGesture();
    if (current.axis !== 'horizontal' || current.dx < threshold) return;
    dismissBaseZ();
  };
  const zCancel = () => clearZGesture();

  edgeHost.addEventListener('pointerdown', zDown);
  edgeHost.addEventListener('pointermove', zMove, { passive:false });
  edgeHost.addEventListener('pointerup', zUp);
  edgeHost.addEventListener('pointercancel', zCancel);
  disposers.push(() => {
    edgeHost.removeEventListener('pointerdown', zDown);
    edgeHost.removeEventListener('pointermove', zMove);
    edgeHost.removeEventListener('pointerup', zUp);
    edgeHost.removeEventListener('pointercancel', zCancel);
  });

  setOpen(open, false);
  setEOpen(secondaryOpen, false);

  return () => {
    clearZGesture();
    eCancel();
    for (const frame of scrollFrames.values()) cancelAnimationFrame(frame);
    scrollFrames.clear();
    if (eDismissTimer) window.clearTimeout(eDismissTimer);
    eDismissTimer = 0;
    disposers.forEach((dispose) => dispose?.());
    releaseEdgeHost();
  };
}
