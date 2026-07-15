import type { Attachment } from "@chat-support/shared";

const IMAGE_MIME_PREFIX = "image/";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Chips shown above the composer for files picked/dropped/pasted but not sent yet. */
export function AttachmentChips({
  attachments,
  uploading,
  onRemove,
}: {
  attachments: Attachment[];
  uploading: boolean;
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0 && !uploading) return null;
  return (
    <div className="attachment-chips">
      {attachments.map((a, i) => (
        <div key={`${a.url}-${i}`} className="attachment-chip">
          {a.mimetype.startsWith(IMAGE_MIME_PREFIX) ? (
            <img src={a.url} alt={a.name} />
          ) : (
            <span className="attachment-chip-icon">📄</span>
          )}
          <span className="attachment-chip-name">{a.name}</span>
          <button type="button" className="btn-ghost" onClick={() => onRemove(i)} aria-label={`Remove ${a.name}`}>
            ✕
          </button>
        </div>
      ))}
      {uploading && <div className="attachment-chip attachment-uploading">Uploading…</div>}
    </div>
  );
}

/** Attachments rendered inside a sent message bubble. */
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="attachment-list">
      {attachments.map((a, i) =>
        a.mimetype.startsWith(IMAGE_MIME_PREFIX) ? (
          <a key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noreferrer" className="attachment-image">
            <img src={a.url} alt={a.name} />
          </a>
        ) : (
          <a key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noreferrer" className="attachment-file">
            📄 {a.name} <span className="attachment-size">({formatSize(a.size)})</span>
          </a>
        )
      )}
    </div>
  );
}
