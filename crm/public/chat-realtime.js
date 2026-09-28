/**
 * Minimal browser client for chat SSE + catch-up.
 * Used by chat UI (Etapa 4). No dependencies.
 *
 *   const rt = ChatRealtime.connect({
 *     conversationId: '...', // optional
 *     onEvent(ev) { ... },
 *     getAfterMessageId: () => lastMsgId,
 *     fetchMessagesSince(afterId) { return fetch(...).then(r => r.json()) },
 *   });
 *   rt.close();
 */
(function (global) {
  function connect(options) {
    const opts = options || {};
    let es = null;
    let closed = false;
    let retryMs = 1000;
    let lastEventId = opts.lastEventId || null;
    let reconnectTimer = null;

    function eventsUrl() {
      const params = new URLSearchParams();
      if (opts.conversationId) params.set("conversation_id", opts.conversationId);
      if (lastEventId) params.set("last_event_id", lastEventId);
      const q = params.toString();
      return "/api/chat/events" + (q ? "?" + q : "");
    }

    async function catchUp() {
      if (typeof opts.fetchMessagesSince !== "function") return;
      const afterId =
        typeof opts.getAfterMessageId === "function" ? opts.getAfterMessageId() : null;
      if (!afterId && !opts.conversationId) return;
      try {
        await opts.fetchMessagesSince(afterId);
      } catch (err) {
        if (typeof opts.onError === "function") opts.onError(err);
      }
    }

    function open() {
      if (closed) return;
      if (es) {
        try {
          es.close();
        } catch (_) {
          /* ignore */
        }
        es = null;
      }
      es = new EventSource(eventsUrl(), { withCredentials: true });

      const types = [
        "message.created",
        "message.updated",
        "message.hidden",
        "typing",
        "read",
        "mention.created",
        "conversation.updated",
        "ping",
      ];
      for (let i = 0; i < types.length; i++) {
        es.addEventListener(types[i], function (e) {
          retryMs = 1000;
          if (e.lastEventId) lastEventId = e.lastEventId;
          let data = null;
          try {
            data = JSON.parse(e.data);
          } catch (_) {
            data = { raw: e.data };
          }
          if (typeof opts.onEvent === "function") {
            opts.onEvent(data, types[i]);
          }
        });
      }

      es.onopen = function () {
        retryMs = 1000;
        if (typeof opts.onOpen === "function") opts.onOpen();
        catchUp();
      };

      es.onerror = function () {
        if (closed) return;
        if (typeof opts.onError === "function") opts.onError(new Error("sse_error"));
        try {
          es.close();
        } catch (_) {
          /* ignore */
        }
        es = null;
        const wait = Math.min(15000, retryMs);
        retryMs = Math.min(15000, retryMs * 1.5);
        reconnectTimer = setTimeout(function () {
          catchUp().finally(open);
        }, wait);
      };
    }

    open();

    return {
      close: function () {
        closed = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (es) {
          try {
            es.close();
          } catch (_) {
            /* ignore */
          }
          es = null;
        }
      },
      getLastEventId: function () {
        return lastEventId;
      },
    };
  }

  global.ChatRealtime = { connect: connect };
})(typeof window !== "undefined" ? window : globalThis);
