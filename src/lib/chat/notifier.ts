/**
 * Chat notification port — in-app mentions now; push/email plugged later.
 */

import { notifyUsersPush } from "../push/notify.js";

export type ChatNotifyEvent =
  | {
      type: "mention";
      organizationId: string;
      userIds: string[];
      conversationId: string;
      messageId: string;
      preview: string;
      excludeUserId?: string;
    }
  | {
      type: "message";
      organizationId: string;
      userIds: string[];
      conversationId: string;
      messageId: string;
      preview: string;
      excludeUserId?: string;
    };

export interface ChatNotifier {
  notify(event: ChatNotifyEvent): Promise<void>;
}

export class PushChatNotifier implements ChatNotifier {
  async notify(event: ChatNotifyEvent): Promise<void> {
    const title = event.type === "mention" ? "Nova menção" : "Nova mensagem";
    const url = `/chat.html?c=${encodeURIComponent(event.conversationId)}&m=${encodeURIComponent(event.messageId)}`;
    await notifyUsersPush(event.organizationId, event.userIds, {
      title,
      body: event.preview.slice(0, 120),
      url,
      tag: `chat-${event.conversationId}`,
    }, event.excludeUserId ? { excludeUserId: event.excludeUserId } : undefined);
  }
}

/** Default notifier — safe no-op if push fails inside notifyUsersPush. */
export const chatNotifier: ChatNotifier = new PushChatNotifier();
