import { useEffect } from 'react';

interface Props {
  status: { kind: 'ok' | 'error'; text: string } | null;
  onClose: () => void;
}

/** Save result message. Success fades out by itself; errors stay until closed. */
export function Toast({ status, onClose }: Props) {
  useEffect(() => {
    if (status?.kind !== 'ok') return;
    const timer = setTimeout(onClose, 2500);
    return () => clearTimeout(timer);
  }, [status, onClose]);

  if (!status) return null;
  return (
    <div className={`toast toast-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
      <span>{status.text}</span>
      <button type="button" className="toast-close" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}
