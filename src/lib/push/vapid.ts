import webpush from "web-push";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";

const KEY_PUBLIC = "vapid_public_key";
const KEY_PRIVATE = "vapid_private_key";

export type VapidKeys = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

let cached: VapidKeys | null = null;
let configured = false;

export async function getVapidKeys(): Promise<VapidKeys> {
  if (cached) return cached;

  const subject = env.VAPID_SUBJECT || "mailto:support@obramate.app";

  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    cached = {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject,
    };
    return cached;
  }

  const [pubRow, privRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: KEY_PUBLIC } }),
    prisma.systemSetting.findUnique({ where: { key: KEY_PRIVATE } }),
  ]);

  if (pubRow?.value && privRow?.value) {
    cached = { publicKey: pubRow.value, privateKey: privRow.value, subject };
    return cached;
  }

  const generated = webpush.generateVAPIDKeys();
  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: KEY_PUBLIC },
      create: { key: KEY_PUBLIC, value: generated.publicKey },
      update: { value: generated.publicKey },
    }),
    prisma.systemSetting.upsert({
      where: { key: KEY_PRIVATE },
      create: { key: KEY_PRIVATE, value: generated.privateKey },
      update: { value: generated.privateKey },
    }),
  ]);

  console.log("[push] VAPID keys generated and stored in SystemSetting");
  cached = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject,
  };
  return cached;
}

export async function ensureWebPushConfigured(): Promise<VapidKeys> {
  const keys = await getVapidKeys();
  if (!configured) {
    webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
    configured = true;
  }
  return keys;
}
