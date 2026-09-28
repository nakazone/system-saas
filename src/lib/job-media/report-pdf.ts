import PDFDocument from "pdfkit";
import type { JobReportDraft, JobReportTemplate } from "./report.js";

export type JobReportPdfInput = {
  organizationName: string;
  jobTitle: string;
  jobNumber: number | null;
  client: string;
  address: string | null;
  templateKey: JobReportTemplate | string;
  report: JobReportDraft & { status?: string; created_at?: string | null };
  photoCount: number;
};

const TEMPLATE_LABEL: Record<string, string> = {
  site_visit: "Site visit",
  delivery: "Delivery",
  progress: "Progress",
  maintenance: "Maintenance",
};

export function buildJobReportPdf(input: JobReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const r = input.report;
    doc.fontSize(16).fillColor("#1a2036").text(input.organizationName);
    doc
      .fontSize(10)
      .fillColor("#595e6b")
      .text(TEMPLATE_LABEL[input.templateKey] || "Field report");
    doc.moveDown(0.6);
    doc.fontSize(14).fillColor("#1a2036").text(r.title || "Job photo report");
    doc
      .fontSize(10)
      .fillColor("#595e6b")
      .text(`Job #${input.jobNumber ?? "—"} · ${input.jobTitle}`);
    doc.text(`Client: ${input.client}`);
    if (input.address) doc.text(`Site: ${input.address}`);
    doc.text(`Photos referenced: ${input.photoCount}`);
    if (r.created_at) {
      doc.text(`Drafted: ${new Date(r.created_at).toLocaleString("en-US")}`);
    }
    doc.moveDown();

    const section = (title: string, body: () => void) => {
      doc.fontSize(12).fillColor("#1a2036").text(title);
      doc.moveDown(0.25);
      body();
      doc.moveDown(0.6);
    };

    if (r.summary) {
      section("Summary", () => {
        doc.fontSize(10).fillColor("#1a2036").text(r.summary, { align: "left" });
      });
    }

    if (r.observations?.length) {
      section("Observations", () => {
        for (const item of r.observations) {
          doc.fontSize(10).fillColor("#1a2036").text(`• ${item.text}`);
        }
      });
    }

    if (r.issues?.length) {
      section("Issues", () => {
        for (const item of r.issues) {
          doc.fontSize(10).fillColor("#1a2036").text(`• ${item.text}`);
        }
      });
    }

    if (r.recommendations?.length) {
      section("Recommendations", () => {
        for (const item of r.recommendations) {
          doc.fontSize(10).fillColor("#1a2036").text(`• ${item}`);
        }
      });
    }

    if (r.next_steps?.length) {
      section("Next steps", () => {
        for (const item of r.next_steps) {
          doc.fontSize(10).fillColor("#1a2036").text(`• ${item}`);
        }
      });
    }

    doc
      .fontSize(8)
      .fillColor("#8a8074")
      .text("Generated from job photo proof in ObraMate. Edit before sharing externally.", {
        align: "center",
      });

    doc.end();
  });
}
