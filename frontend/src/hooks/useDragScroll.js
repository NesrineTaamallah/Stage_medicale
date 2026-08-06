import { useRef, useEffect } from 'react';

/**
 * Ajoute le "glisser pour défiler" (drag-to-scroll) horizontal à un
 * conteneur `overflowX: auto` — pratique pour les tableaux larges (ex.
 * "Dossiers" dans Entités Médicales) sur desktop, où il n'y a pas de geste
 * tactile de swipe natif. Le scroll à la molette/trackpad et la barre de
 * défilement continuent de fonctionner normalement en plus du drag.
 *
 * Note : s'il n'y a pas de débordement horizontal (le tableau tient déjà
 * entièrement dans le conteneur), il n'y a rien à faire glisser — c'est le
 * comportement attendu, pas un bug.
 *
 * Usage : const scrollRef = useDragScroll();  <div ref={scrollRef} style={{ overflowX: 'auto' }}>
 */
export default function useDragScroll() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    let isDown = false;
    let startX = 0;
    let startScrollLeft = 0;
    let moved = false;

    const isInteractive = (target) =>
      target.closest('button, a, input, select, textarea, [contenteditable="true"]');

    const onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return; // clic gauche uniquement
      if (isInteractive(e.target)) return;
      isDown = true;
      moved = false;
      startX = e.clientX;
      startScrollLeft = el.scrollLeft;
      el.classList.add('drag-scrolling');
      el.setPointerCapture?.(e.pointerId);
      // Empêche la sélection de texte native de "voler" le drag pendant le mousemove.
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!isDown) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      el.scrollLeft = startScrollLeft - dx;
    };

    const endDrag = (e) => {
      if (!isDown) return;
      isDown = false;
      el.classList.remove('drag-scrolling');
      if (e.pointerId !== undefined) el.releasePointerCapture?.(e.pointerId);
    };

    // Empêche un clic "accidentel" (ex. sur une ligne) juste après un drag.
    const onClickCapture = (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('pointerleave', endDrag);
    el.addEventListener('click', onClickCapture, true);
    // Le drag démarre sur mousedown ; sans ceci le navigateur commence une
    // sélection de texte native qui empêche le scroll de suivre le curseur.
    el.addEventListener('dragstart', (e) => e.preventDefault());

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
      el.removeEventListener('pointerleave', endDrag);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return ref;
}