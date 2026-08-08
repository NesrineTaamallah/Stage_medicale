import { useRef, useEffect } from 'react';


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
      if (e.button !== undefined && e.button !== 0) return; 
      if (isInteractive(e.target)) return;
      isDown = true;
      moved = false;
      startX = e.clientX;
      startScrollLeft = el.scrollLeft;
      el.classList.add('drag-scrolling');
      el.setPointerCapture?.(e.pointerId);
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