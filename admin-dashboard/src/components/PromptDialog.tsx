import { useState, type FormEvent } from "react";

interface PromptDialogProps {
  title: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** In-app replacement for window.prompt -- real client-side validation (required, trimmed), no native popup. */
export function PromptDialog({ title, label, placeholder, confirmLabel = "Save", onSubmit, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("This can't be empty.");
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <h3 id="prompt-title">{title}</h3>
        <label className="modal-field-label" htmlFor="prompt-input">
          {label}
        </label>
        <input
          id="prompt-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          autoFocus
        />
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
