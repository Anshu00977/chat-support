interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** In-app replacement for window.confirm -- styled, keyboard-friendly, never blocks the whole tab. */
export function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{title}</h3>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button className={danger ? "btn-danger" : undefined} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
