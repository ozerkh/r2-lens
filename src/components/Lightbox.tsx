import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type Props = { src: string; alt: string; onClose: () => void };

export function Lightbox({ src, alt, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex animate-[r2-lens-fade_150ms_ease-out] cursor-zoom-out items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-10"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full animate-[r2-lens-zoom_180ms_ease-out] rounded-md object-contain shadow-2xl"
      />
      <button
        ref={closeButton}
        type="button"
        aria-label="Close"
        className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
        onClick={onClose}
      >
        <XIcon size={20} />
      </button>
    </div>,
    document.body,
  );
}
