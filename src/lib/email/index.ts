export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    console.log("---- EMAIL (console provider) ----");
    console.log(`To: ${message.to}`);
    console.log(`Subject: ${message.subject}`);
    console.log(message.text);
    console.log("----------------------------------");
  }
}

import { env } from "../../config/env.js";

export function createEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === "console") {
    return new ConsoleEmailProvider();
  }
  return new ConsoleEmailProvider();
}

export const email = createEmailProvider();
