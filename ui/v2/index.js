export { v2Header } from './header.js';
export { v2CardDeck } from './card-deck.js';
export { v2Shell, v2Section, v2HorizontalRail, v2RailCard } from './shell.js';
export { v2V } from './v.js';
export { setV2V, clearV2V, bindV2VContext } from './v-host.js';
export { setV2Y, clearV2Y } from './y.js';
export { v2Sticker } from './sticker.js';
export { v2ZLayer, mountV2ZLayer, bindV2StableZFrame } from './z-stack.js';
export { v2ZHeader, v2ZBody, v2QHeader, v2QBody, v2ZBodySection, v2ZBodySections, v2ZFrame, v2QFrame, setV2ZHeaderRows, clearV2ZHeaderRows } from './z-layout.js';
export { v2Layer, mountV2Layer } from './modal-portal.js';
export { initV2Swipe, initV2StickerSwipe } from './swipe.js';
export { setV2MenuHeaderState, bindV2MenuHeaderState } from './header-state.js';
export { syncV2HorizontalAffordances, bindV2HorizontalAffordances } from './horizontal-affordance.js';

import { bindV2StableZFrame } from './z-stack.js';
import { setV2MenuHeaderState, bindV2MenuHeaderState } from './header-state.js';
import { bindV2HorizontalAffordances } from './horizontal-affordance.js';
import { bindV2VContext } from './v-host.js';
import { setV2DeckOpen as setV2DeckOpenOwner, initV2WorkspaceInteraction as initV2WorkspaceInteractionOwner } from './workspace-navigation.js';

function rootApp(root) {
  return root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
}

export function setV2DeckOpen(root, open) {
  const next = setV2DeckOpenOwner(root, open);
  setV2MenuHeaderState(root, next);
  return next;
}

export function initV2WorkspaceInteraction(root, options = {}) {
  const app = rootApp(root);
  bindV2StableZFrame(app?.querySelector?.('[data-v2-front] > [data-v2-z]'));
  const disposeMenuHeader = bindV2MenuHeaderState(app);
  const disposeHorizontalAffordances = bindV2HorizontalAffordances(app);
  const disposeVContext = bindV2VContext(app);
  const onDeckOpenChange = options.onDeckOpenChange;
  const dispose = initV2WorkspaceInteractionOwner(root, {
    ...options,
    onDeckOpenChange: (open) => {
      setV2MenuHeaderState(app, open);
      onDeckOpenChange?.(open);
    },
  });
  setV2MenuHeaderState(app, Boolean(options.deckOpen));
  return () => {
    disposeMenuHeader?.();
    disposeHorizontalAffordances?.();
    disposeVContext?.();
    dispose?.();
  };
}
