import { type MouseEvent as ReactMouseEvent, type RefObject, useEffect } from "react";

export function useEscapeDismiss({
  isOpen,
  onDismiss
}: {
  isOpen: boolean;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onDismiss]);
}

export function useOutsideClickDismiss({
  ignoreSelector,
  isOpen,
  onDismiss,
  ref
}: {
  ignoreSelector?: string;
  isOpen: boolean;
  onDismiss: () => void;
  ref: RefObject<HTMLElement>;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: globalThis.MouseEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (
        ref.current?.contains(target)
        || (ignoreSelector ? target.closest(ignoreSelector) : null)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onDismiss();
    };

    window.addEventListener("click", closeOnOutsideClick, { capture: true });
    return () => {
      window.removeEventListener("click", closeOnOutsideClick, { capture: true });
    };
  }, [ignoreSelector, isOpen, onDismiss, ref]);
}

export function isBackdropClick(event: ReactMouseEvent<HTMLElement>) {
  return event.target === event.currentTarget;
}
