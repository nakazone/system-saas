/**
 * Terms of Service, Privacy Policy and Data Processing Addendum shown at /terms, /privacy and /dpa.
 *
 * Changing the text in a way that matters to customers: bump `version` (YYYY-MM-DD). Company admins are
 * then asked to accept the new version the next time they open the app (see acceptance.ts).
 *
 * Entity, contact e-mail and governing state come from the environment so they can be fixed without a code
 * change once the legal entity is final:
 *   LEGAL_ENTITY_NAME (default "ObraMate"), LEGAL_CONTACT_EMAIL (default SUPPORT_INBOX_EMAIL or support@obramate.com),
 *   LEGAL_GOVERNING_STATE (default "Colorado").
 */

export type LegalKey = "terms" | "privacy" | "dpa";

export type LegalSection = { heading: string; paragraphs: string[]; bullets?: string[] };

export type LegalDocument = {
  key: LegalKey;
  path: string;
  title: string;
  shortTitle: string;
  version: string;
  summary: string;
  sections: LegalSection[];
};

export const LEGAL_KEYS: LegalKey[] = ["terms", "privacy", "dpa"];

export function legalEntity(): { name: string; email: string; state: string } {
  return {
    name: (process.env.LEGAL_ENTITY_NAME || "ObraMate").trim(),
    email: (process.env.LEGAL_CONTACT_EMAIL || process.env.SUPPORT_INBOX_EMAIL || "support@obramate.com").trim(),
    state: (process.env.LEGAL_GOVERNING_STATE || "Colorado").trim(),
  };
}

/** Sub-processors listed in the Privacy Policy and the DPA. */
export const SUBPROCESSORS: { name: string; purpose: string; location: string }[] = [
  { name: "Railway", purpose: "Application hosting and database", location: "United States" },
  { name: process.env.LEGAL_STORAGE_PROVIDER || "S3-compatible object storage", purpose: "Photos, documents and file storage", location: "United States" },
  { name: "Resend", purpose: "Transactional e-mail delivery", location: "United States" },
  { name: "Stripe", purpose: "Subscription billing and card payments", location: "United States" },
  { name: "Google Maps Platform", purpose: "Address lookup, geocoding and maps", location: "United States" },
  { name: "OpenAI", purpose: "Reading receipts and photos you choose to scan", location: "United States" },
];

function docs(): Record<LegalKey, LegalDocument> {
  const { name, email, state } = legalEntity();
  return {
    terms: {
      key: "terms",
      path: "/terms",
      title: "Terms of Service",
      shortTitle: "Terms",
      version: "2026-10-14",
      summary: `These terms are the agreement between your company and ${name} for the use of the ${name} software.`,
      sections: [
        {
          heading: "1. Who these terms apply to",
          paragraphs: [
            `${name} ("we", "us") provides web and mobile software for flooring and construction companies to manage leads, quotes, jobs, scheduling, invoices, payroll records and related work (the "Service"). These Terms of Service ("Terms") form a binding agreement between us and the company that creates a workspace (the "Customer", "you").`,
            "The person who creates the workspace confirms that they are at least 18 years old and authorized to accept these Terms on behalf of the Customer. The Customer is responsible for everyone it invites to its workspace (\"Users\") and for their compliance with these Terms.",
          ],
        },
        {
          heading: "2. Accounts and security",
          paragraphs: [
            "You must give accurate sign-up information and keep it current. Each User must have their own login; sharing logins is not allowed. You are responsible for keeping passwords confidential and for all activity in your workspace.",
            `Tell us right away at ${email} if you believe your workspace has been accessed without authorization.`,
          ],
        },
        {
          heading: "3. Free trial",
          paragraphs: [
            "New workspaces may start with a free trial for the period shown at sign-up. No card is required to start. When the trial ends without a paid plan, the workspace becomes read-only: you can still sign in and view or export your data, but you cannot create or change records until you subscribe. If no plan is chosen, the workspace may be suspended 14 days after the trial ends and closed 90 days after it ends.",
          ],
        },
        {
          heading: "4. Plans, billing and renewal",
          paragraphs: [
            "Paid plans are billed in advance, monthly or yearly, at the price shown when you subscribe. Subscriptions renew automatically at the end of each period until cancelled. Card payments are processed by Stripe; we do not store full card numbers.",
            "If a payment fails we will notify you and retry. If the balance stays unpaid, the workspace may become read-only 7 days after the due date, be suspended after 14 days and be closed after 90 days.",
            "We may change prices with at least 30 days' notice by e-mail; the change applies from your next renewal after the notice period. Prices do not include taxes unless stated; you are responsible for applicable taxes.",
          ],
        },
        {
          heading: "5. Cancellation and refunds",
          paragraphs: [
            "You can cancel at any time from Settings › Plan and billing or by contacting us. Cancellation takes effect at the end of the current paid period and you keep access until then. Payments already made are non-refundable except where required by law or where we decide otherwise in writing.",
          ],
        },
        {
          heading: "6. Your data",
          paragraphs: [
            "You own the data you and your Users put into the Service (\"Customer Data\"), including information about your clients, leads, jobs, employees and finances. You give us permission to host, copy, process and display Customer Data only as needed to provide, secure and support the Service and as described in our Privacy Policy and Data Processing Addendum.",
            "You are responsible for having the right to collect and use Customer Data, including giving any notices and obtaining any consents required to send quotes, invoices, e-mails and text messages to your own clients and to record information about your employees.",
            "You can export your data while your workspace is active or read-only. After a workspace is closed we keep Customer Data for up to 90 days so it can be restored on request, and then delete it from active systems; backups are overwritten on their normal schedule.",
          ],
        },
        {
          heading: "7. Acceptable use",
          paragraphs: ["You agree not to, and not to let anyone else:"],
          bullets: [
            "use the Service for anything illegal, fraudulent or harmful, or to send spam or unsolicited messages;",
            "upload malware or content that infringes someone else's rights;",
            "try to access other customers' workspaces or data, probe or break the security of the Service, or overload it;",
            "copy, resell or reverse-engineer the Service, or use it to build a competing product.",
          ],
        },
        {
          heading: "8. Payroll, tax and financial information",
          paragraphs: [
            "The Service helps you record work days, rates, payments and expenses. It is a record-keeping tool, not payroll, tax, accounting or legal advice, and it does not file taxes or make payments to employees on your behalf. You are responsible for checking calculations and for complying with wage, tax and employment laws.",
          ],
        },
        {
          heading: "9. Availability and support",
          paragraphs: [
            "We work to keep the Service available and secure, take regular backups and fix problems promptly, but the Service may occasionally be unavailable for maintenance or reasons outside our control. Support is provided through the in-app help and by e-mail.",
            "We may improve or change features over time. If we remove a feature that is material to paid plans we will give reasonable notice.",
          ],
        },
        {
          heading: "10. Suspension and termination",
          paragraphs: [
            "We may suspend or close a workspace that violates these Terms, puts the Service or other customers at risk, or remains unpaid as described above. Where reasonable we will notify you first and give you a chance to fix the problem. You may stop using the Service at any time.",
          ],
        },
        {
          heading: "11. Disclaimers",
          paragraphs: [
            "Except as expressly stated in these Terms, the Service is provided \"as is\" and \"as available\", and we disclaim all implied warranties, including merchantability, fitness for a particular purpose and non-infringement, to the extent permitted by law.",
          ],
        },
        {
          heading: "12. Limitation of liability",
          paragraphs: [
            "To the extent permitted by law, neither party is liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue or data, and our total liability arising out of these Terms is limited to the amounts you paid us for the Service in the 12 months before the event giving rise to the claim. These limits do not apply to your payment obligations or to a party's fraud or wilful misconduct.",
          ],
        },
        {
          heading: "13. Changes to these Terms",
          paragraphs: [
            "We may update these Terms. For material changes we will notify workspace administrators by e-mail or in the app at least 30 days before they take effect, and ask an administrator to accept the new version. Continuing to use the Service after the effective date means you accept the updated Terms.",
          ],
        },
        {
          heading: "14. Governing law and contact",
          paragraphs: [
            `These Terms are governed by the laws of the State of ${state}, United States, without regard to conflict-of-law rules, and disputes will be handled in the state or federal courts located in ${state}.`,
            `Questions about these Terms: ${email}.`,
          ],
        },
      ],
    },
    privacy: {
      key: "privacy",
      path: "/privacy",
      title: "Privacy Policy",
      shortTitle: "Privacy",
      version: "2026-10-14",
      summary: `How ${name} collects, uses and protects personal information.`,
      sections: [
        {
          heading: "1. Scope",
          paragraphs: [
            `This policy explains how ${name} ("we") handles personal information when you visit our website, create a workspace or use the Service. Information that our customers enter about their own clients, leads and employees ("Customer Data") is processed on the customer's behalf under our Data Processing Addendum; for that information the customer decides what is collected and why, and requests about it should go to that company first.`,
          ],
        },
        {
          heading: "2. Information we collect",
          paragraphs: ["We collect:"],
          bullets: [
            "Account information: name, work e-mail, phone, company name and password (stored only as a secure hash).",
            "Billing information: plan, invoices and payment status. Card details are collected and stored by Stripe, not by us.",
            "Usage and device information: IP address, browser and device type, pages used, sign-in times and error logs, used to keep the Service secure and working.",
            "Support messages you send us.",
            "Location and photos only when you or your Users choose to attach them (for example job photos with GPS or a scanned receipt).",
          ],
        },
        {
          heading: "3. How we use it",
          paragraphs: ["We use personal information to:"],
          bullets: [
            "create and run your workspace and provide the features you use;",
            "send service e-mails such as sign-up confirmation, password resets, trial and billing notices and security alerts;",
            "process payments and keep billing records;",
            "provide support, prevent fraud and abuse, and keep the Service secure;",
            "understand overall usage so we can improve the product.",
          ],
        },
        {
          heading: "4. What we do not do",
          paragraphs: [
            "We do not sell personal information, we do not share it for cross-context behavioral advertising, and we do not use Customer Data to market to your clients.",
          ],
        },
        {
          heading: "5. Service providers",
          paragraphs: [
            "We share information only with providers that help us run the Service, under contracts that limit their use of it, when required by law, or as part of a merger or acquisition with notice to you. Our current providers are:",
          ],
          bullets: SUBPROCESSORS.map((s) => `${s.name} — ${s.purpose} (${s.location})`),
        },
        {
          heading: "6. Security",
          paragraphs: [
            "Data is encrypted in transit (HTTPS). Each customer's data is isolated in the database, passwords are hashed, staff access to the platform requires two-factor authentication and is logged, and backups are taken regularly. No system is perfectly secure; if a breach affects your personal information we will notify you as required by law.",
          ],
        },
        {
          heading: "7. Retention",
          paragraphs: [
            "We keep account information while your workspace exists. After a workspace is closed, data is kept for up to 90 days so it can be restored on request and then deleted from active systems; backups are overwritten on their normal schedule. Billing records are kept as long as tax and accounting laws require.",
          ],
        },
        {
          heading: "8. Your choices and rights",
          paragraphs: [
            `You can view and update your account information in the app. Depending on where you live (for example California or Colorado), you may have the right to know, access, correct, delete or obtain a copy of your personal information and to opt out of certain processing. To make a request, e-mail ${email}. We will verify the request and respond within the time required by law, and we will not discriminate against you for exercising these rights.`,
          ],
        },
        {
          heading: "9. Cookies",
          paragraphs: [
            "We use cookies that are necessary to keep you signed in and protect your account, and local storage on your device to remember preferences such as filters. We do not use third-party advertising cookies.",
          ],
        },
        {
          heading: "10. Children",
          paragraphs: ["The Service is for businesses and is not directed to children under 16. We do not knowingly collect their information."],
        },
        {
          heading: "11. Changes and contact",
          paragraphs: [
            "We will post updates on this page with a new effective date and notify workspace administrators of material changes.",
            `Contact: ${email}.`,
          ],
        },
      ],
    },
    dpa: {
      key: "dpa",
      path: "/dpa",
      title: "Data Processing Addendum",
      shortTitle: "DPA",
      version: "2026-10-14",
      summary: `How ${name} processes the personal data in your workspace on your behalf. It forms part of the Terms of Service.`,
      sections: [
        {
          heading: "1. Roles",
          paragraphs: [
            `This Data Processing Addendum ("DPA") forms part of the Terms of Service between the Customer and ${name}. For personal data that the Customer and its Users put into the Service about clients, leads, employees and other people ("Customer Personal Data"), the Customer is the business / controller and ${name} is the service provider / processor.`,
          ],
        },
        {
          heading: "2. Instructions",
          paragraphs: [
            `${name} processes Customer Personal Data only to provide, secure and support the Service, according to the Customer's documented instructions (these Terms, this DPA and the Customer's use of the Service's features), and as required by law. ${name} will not sell or share Customer Personal Data, will not use it for any other commercial purpose, and will not combine it with personal data from other sources except as needed to provide the Service.`,
          ],
        },
        {
          heading: "3. Types of data and people",
          paragraphs: ["Depending on how the Customer uses the Service, Customer Personal Data may include:"],
          bullets: [
            "Clients and leads: names, phone numbers, e-mail addresses, property addresses, project details, photos, quotes, invoices and payments.",
            "Employees and crew: names, contact details, roles, work days and hours, pay rates, payments, deductions and reimbursements, and photos or GPS location attached to job records.",
            "Users of the workspace: names, e-mail addresses and activity in the app.",
          ],
        },
        {
          heading: "4. Confidentiality and staff",
          paragraphs: [
            `${name} limits access to Customer Personal Data to personnel who need it to provide or support the Service and who are bound by confidentiality. Platform staff access requires two-factor authentication and is recorded in an audit log. Staff access a workspace for support only when needed to resolve an issue.`,
          ],
        },
        {
          heading: "5. Security measures",
          paragraphs: ["We maintain reasonable technical and organizational measures, including:"],
          bullets: [
            "encryption in transit (HTTPS) and hashed passwords;",
            "logical isolation of each customer's data in the database;",
            "role-based permissions inside each workspace;",
            "regular backups and periodic restore tests;",
            "audit logging of platform staff actions and two-factor authentication for platform staff.",
          ],
        },
        {
          heading: "6. Sub-processors",
          paragraphs: [
            "The Customer authorizes the use of the sub-processors listed below. We impose data protection obligations on them that are no less protective than this DPA and remain responsible for their performance. We will update this list and notify workspace administrators at least 30 days before adding a new sub-processor; the Customer may object on reasonable data protection grounds and, if we cannot resolve the objection, terminate the affected service.",
          ],
          bullets: SUBPROCESSORS.map((s) => `${s.name} — ${s.purpose} (${s.location})`),
        },
        {
          heading: "7. Assistance and requests",
          paragraphs: [
            "Taking into account the nature of the processing, we will help the Customer respond to requests from individuals to access, correct, delete or obtain a copy of their data, mainly through the features of the Service (editing, deleting and exporting records). If we receive such a request directly, we will refer the person to the Customer.",
          ],
        },
        {
          heading: "8. Security incidents",
          paragraphs: [
            "We will notify the Customer without undue delay, and in any case within 72 hours after confirming a security incident affecting Customer Personal Data, with the information reasonably available to help the Customer meet its own obligations.",
          ],
        },
        {
          heading: "9. Return and deletion",
          paragraphs: [
            "The Customer can export its data while the workspace is active or read-only. After the workspace is closed, we keep Customer Personal Data for up to 90 days to allow restoration on request and then delete it from active systems; backups are overwritten on their normal schedule.",
          ],
        },
        {
          heading: "10. Location, audits and precedence",
          paragraphs: [
            "Customer Personal Data is hosted in the United States. On reasonable written request, and no more than once a year, we will provide information needed to show compliance with this DPA. If this DPA conflicts with the Terms of Service regarding personal data, this DPA prevails.",
            `Contact: ${email}.`,
          ],
        },
      ],
    },
  };
}

export function legalDocument(key: LegalKey): LegalDocument {
  return docs()[key];
}

export function legalDocuments(): LegalDocument[] {
  const all = docs();
  return LEGAL_KEYS.map((k) => all[k]);
}

/** Current version of each document, e.g. { terms: "2026-10-14", ... }. */
export function currentLegalVersions(): Record<LegalKey, string> {
  const all = docs();
  return { terms: all.terms.version, privacy: all.privacy.version, dpa: all.dpa.version };
}

/** "October 14, 2026" from "2026-10-14". */
export function versionDate(version: string): string {
  const [y, m, d] = version.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
