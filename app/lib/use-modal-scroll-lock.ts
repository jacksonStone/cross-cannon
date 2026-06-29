import { useEffect } from "react";

let lockCount = 0;
let previousBodyOverflow = "";
let previousBodyOverscroll = "";
let previousHtmlOverflow = "";
let previousHtmlOverscroll = "";

export function useModalScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked || typeof window === "undefined") {
      return;
    }

    const { body, documentElement } = document;

    if (lockCount === 0) {
      previousBodyOverflow = body.style.overflow;
      previousBodyOverscroll = body.style.overscrollBehavior;
      previousHtmlOverflow = documentElement.style.overflow;
      previousHtmlOverscroll = documentElement.style.overscrollBehavior;

      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
      documentElement.style.overflow = "hidden";
      documentElement.style.overscrollBehavior = "none";
    }

    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);

      if (lockCount > 0) {
        return;
      }

      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      documentElement.style.overflow = previousHtmlOverflow;
      documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, [isLocked]);
}
