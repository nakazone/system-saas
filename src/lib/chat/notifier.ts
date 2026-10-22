/**
 * Chat notification port — in-app mentions now; push/email plugged later.
 */

import { publishAppNotification } from "../notifications/publish.js";

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
    await publishAppNotification({
      organizationId: event.organizationId,
      type: event.type === "mention" ? "chat.mention" : "chat.message",
      title,
      body: event.preview.slice(0, 120),
      url,
      tag: `chat-${event.messageId}`,
      dedupeKey: `chat-${event.messageId}-${event.type}`,
      userIds: event.userIds,
      excludeUserId: event.excludeUserId,
    });
  }
}

/** Default notifier — safe no-op if push fails inside notifyUsersPush. */
export const chatNotifier: ChatNotifier = new PushChatNotifier();
