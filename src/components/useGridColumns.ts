import { useEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

const CARD_WIDTH = 176;
const MIN_CARD_WIDTH = 140;
const GRID_GAP = 12;
const SECTION_PADDING = 32;

const fit = (width: number, card: number) => Math.floor((width - SECTION_PADDING + GRID_GAP) / (card + GRID_GAP));

export function useGridColumns(content: RefObject<HTMLElement | null>, listing: RefObject<HTMLElement | null>) {
  const [columns, setColumns] = useState(2);
  useEffect(() => {
    const outer = content.current;
    const inner = listing.current;
    if (!outer || !inner) return;
    const update = () => {
      const total = outer.clientWidth;
      if (total < 640) return setColumns(2);
      setColumns(Math.max(2, Math.min(fit(total, CARD_WIDTH), fit(inner.clientWidth, MIN_CARD_WIDTH))));
    };
    const observer = new ResizeObserver(() => flushSync(update));
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [content, listing]);
  return columns;
}
