import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef
} from "react";

export function useOfflineSubmitGuard({
  isOffline,
  isSubmitting,
  onBlocked
}: {
  isOffline: boolean;
  isSubmitting: boolean;
  onBlocked: () => void;
}) {
  const attemptedNetworkActionRef = useRef(false);
  const handleSubmit = useCallback((event: FormEvent<HTMLElement>) => {
    if (isOffline) {
      event.preventDefault();
      onBlocked();
      return;
    }

    attemptedNetworkActionRef.current = true;
  }, [isOffline, onBlocked]);

  useEffect(() => {
    if (isOffline && attemptedNetworkActionRef.current) {
      attemptedNetworkActionRef.current = false;
      onBlocked();
      return;
    }

    if (!isOffline && !isSubmitting) {
      attemptedNetworkActionRef.current = false;
    }
  }, [isOffline, isSubmitting, onBlocked]);

  return handleSubmit;
}
