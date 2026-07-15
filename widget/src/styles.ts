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
}

.csw-header { background: #2563eb; color: #fff; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; }
.csw-header h3 { margin: 0; font-size: 1rem; }
.csw-header button { background: none; border: none; color: #fff; font-size: 1.1rem; cursor: pointer; }

.csw-body { flex: 1; overflow-y: auto; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem; background: #f7f8fa; }

.csw-bubble-msg { max-width: 80%; padding: 0.5rem 0.7rem; border-radius: 10px; font-size: 0.88rem; line-height: 1.35; }
.csw-bubble-msg.shop { align-self: flex-end; background: #2563eb; color: #fff; }
.csw-bubble-msg.admin, .csw-bubble-msg.bot { align-self: flex-start; background: #eceff3; color: #1a1a1a; }
.csw-typing { align-self: flex-start; font-size: 0.75rem; color: #888; font-style: italic; }

.csw-form { padding: 0.85rem; display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid #eee; }
.csw-form input, .csw-form textarea {
  padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.85rem; font-family: inherit; width: 100%;
}
.csw-form textarea { resize: none; height: 44px; }
.csw-form button {
  background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 0.55rem; font-size: 0.85rem; cursor: pointer;
}
.csw-form button:disabled { opacity: 0.5; cursor: default; }

.csw-composer { display: flex; gap: 0.5rem; padding: 0.7rem; border-top: 1px solid #eee; }
.csw-composer textarea { flex: 1; resize: none; height: 40px; padding: 0.5rem; border: 1px solid #ddd; border-radius: 6px; font-family: inherit; font-size: 0.85rem; }
.csw-composer button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 0 0.9rem; cursor: pointer; }
.csw-composer button:disabled { opacity: 0.5; cursor: default; }

.csw-closed-banner { text-align: center; font-size: 0.75rem; color: #888; padding: 0.5rem; }
`;
