export const widgetStyles = `
:host, .csw-root { all: initial; }
.csw-root, .csw-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.csw-root { position: fixed; bottom: 20px; right: 20px; z-index: 2147483000; }

.csw-bubble {
  width: 56px; height: 56px; border-radius: 50%; background: #2563eb; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  box-shadow: 0 6px 20px rgba(0,0,0,0.2); border: none; font-size: 24px;
}

.csw-panel {
  width: 340px; max-width: calc(100vw - 40px); height: 480px; max-height: calc(100vh - 100px);
  background: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.25);
  display: flex; flex-direction: column; overflow: hidden; position: absolute; bottom: 68px; right: 0;
  transition: width 0.2s ease, height 0.2s ease;
}
.csw-panel.maximized {
  width: 420px; height: calc(100vh - 100px); max-height: calc(100vh - 40px);
}

.csw-header { background: #2563eb; color: #fff; padding: 0.7rem 0.85rem 0.7rem 1rem; display: flex; justify-content: space-between; align-items: center; }
.csw-header h3 { margin: 0; font-size: 1rem; }
.csw-header-actions { display: flex; align-items: center; gap: 0.15rem; }
.csw-header-actions button {
  background: none; border: none; color: #fff; cursor: pointer; border-radius: 6px;
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 0.95rem;
  opacity: 0.9;
}
.csw-header-actions button:hover { background: rgba(255,255,255,0.15); opacity: 1; }
.csw-header-actions button:disabled { opacity: 0.5; cursor: default; }
.csw-header-actions button[aria-label="End chat"] { width: auto; padding: 0 0.5rem; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; }

.csw-content { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }

.csw-confirm-overlay {
  position: absolute; inset: 0; background: rgba(20, 22, 31, 0.45); z-index: 5;
  display: flex; align-items: center; justify-content: center; padding: 1.2rem;
}
.csw-confirm-card { background: #fff; border-radius: 12px; padding: 1.1rem 1.2rem; width: 100%; max-width: 260px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); text-align: center; }
.csw-confirm-title { margin: 0 0 0.3rem; font-size: 0.92rem; font-weight: 700; color: #1a1a1a; }
.csw-confirm-sub { margin: 0 0 1rem; font-size: 0.78rem; color: #888; }
.csw-confirm-actions { display: flex; gap: 0.5rem; }
.csw-confirm-actions button { flex: 1; padding: 0.5rem; border-radius: 6px; font-size: 0.82rem; cursor: pointer; border: none; }
.csw-confirm-cancel { background: #f1f1f1; color: #333; }
.csw-confirm-end { background: #dc2626; color: #fff; }
.csw-confirm-actions button:disabled { opacity: 0.6; cursor: default; }

.csw-dropzone { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.csw-drop-overlay {
  position: absolute; inset: 0; z-index: 4; background: rgba(37, 99, 235, 0.08);
  border: 2px dashed #2563eb; border-radius: 8px; margin: 0.4rem;
  display: flex; align-items: center; justify-content: center;
  color: #2563eb; font-weight: 600; font-size: 0.85rem; pointer-events: none;
}

.csw-body { flex: 1; overflow-y: auto; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem; background: #f7f8fa; }

.csw-bubble-msg { max-width: 80%; padding: 0.5rem 0.7rem; border-radius: 10px; font-size: 0.88rem; line-height: 1.35; }
.csw-bubble-msg.shop { align-self: flex-end; background: #2563eb; color: #fff; }
.csw-bubble-msg.admin, .csw-bubble-msg.bot { align-self: flex-start; background: #eceff3; color: #1a1a1a; }
.csw-typing { align-self: flex-start; font-size: 0.75rem; color: #888; font-style: italic; }

.csw-attachment-list { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.35rem; }
.csw-attachment-image img { max-width: 180px; max-height: 140px; border-radius: 8px; display: block; }
.csw-attachment-file {
  display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.78rem;
  color: inherit; text-decoration: underline; word-break: break-all;
}
.csw-attachment-size { opacity: 0.7; font-size: 0.72rem; }

.csw-attachment-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0.6rem 0.7rem 0; }
.csw-attachment-chip {
  display: flex; align-items: center; gap: 0.3rem; background: #eef2ff; border-radius: 6px;
  padding: 0.25rem 0.4rem; font-size: 0.72rem; max-width: 140px;
}
.csw-attachment-chip img { width: 20px; height: 20px; object-fit: cover; border-radius: 4px; }
.csw-attachment-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.csw-attachment-chip button { background: none; border: none; cursor: pointer; font-size: 0.7rem; color: #666; padding: 0; }
.csw-attachment-uploading { color: #888; font-style: italic; }

.csw-form { padding: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid #eee; }
.csw-form input, .csw-form textarea {
  padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.85rem; font-family: inherit; width: 100%;
}
.csw-form textarea { resize: none; height: 44px; }
.csw-form button {
  background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 0.55rem; font-size: 0.85rem; cursor: pointer;
}
.csw-form button:disabled { opacity: 0.5; cursor: default; }

.csw-composer-wrap { border-top: 1px solid #eee; }
.csw-error { color: #dc2626; font-size: 0.72rem; padding: 0.4rem 0.7rem 0; }
.csw-composer { display: flex; gap: 0.5rem; padding: 0.7rem; align-items: flex-end; }
.csw-composer textarea { flex: 1; resize: none; height: 40px; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-family: inherit; font-size: 0.85rem; }
.csw-composer button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 0 0.9rem; cursor: pointer; height: 40px; }
.csw-composer button:disabled { opacity: 0.5; cursor: default; }
.csw-attach-btn { background: none !important; color: inherit !important; padding: 0 0.4rem !important; font-size: 1.1rem; }

.csw-closed-banner {
  text-align: center; padding: 0.9rem 0.7rem; border-top: 1px solid #eee;
  display: flex; flex-direction: column; align-items: center; gap: 0.55rem;
}
.csw-closed-banner p { margin: 0; font-size: 0.78rem; color: #888; }
.csw-closed-banner button {
  background: #2563eb; color: #fff; border: none; border-radius: 6px;
  padding: 0.45rem 1rem; font-size: 0.8rem; cursor: pointer;
}
`;
