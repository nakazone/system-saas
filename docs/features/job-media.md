# Job media (field photo proof)

Photo documentation for field jobs (Work Orders).

## Scope

| Phase | Delivered |
|-------|-----------|
| **1** | `JobMedia`, Campo capture (stage/GPS/caption/hash), offline queue, public photos on temp link |
| **2** | Isolated AI client, `JobReport`, summarize-from-photos, voice caption, job-detail gallery + PDF |
| **3** | Photo annotations, photo-required checklist, spoken checklist, templates, recap, media-health |
| **4** | Job → Quote proposal, send for signature (existing public accept), before/after export, review request |
| **5** | Spoken inspection + photo marks, manager photo board/map, public portfolio iframe, label OCR, experimental measure flag, quote sign hash + GPS, `subcontractor` field role |

- **Surface:** Campo PWA + office job detail (no native app yet)
- **Market:** US field crews (English AI / templates / recap / proposals)
- **Not included:** payment gateways, third-party e-sign vendors, auto-post to social / Google

## Data model

### JobMedia

Includes `annotationsJson` layer: `{ version: 1, shapes: [...] }` (freehand, arrow, circle, text). Original image bytes stay unchanged; SHA-256 remains the capture hash.

Also: `inPortfolio`, `ocrJson` (label / serial extraction).

### JobInspection / JobInspectionMark

Spoken field walkthrough: audio upload (+ optional AI transcript/summary), marks link photos by `offsetMs` on the recording timeline.

### JobMeasurement

Manual (default) or `ar_experimental` area/length values. Org flag `job_measure: false` disables create/list for Campo.

### Quote approval extras

On public approve: `signedDocumentSha256` of the signature image, optional `approvedLat` / `approvedLng` / `approvedGpsAccuracyM` from browser geolocation.

### Campo checklist (`WorkOrder.campoChecklist`)

```json
{
  "id": "c1",
  "text": "Subfloor checked",
  "done": false,
  "photo_required": true,
  "photo_media_ids": [],
  "note": null,
  "done_by": null,
  "done_at": null
}
```

Built-in templates: `pre_install`, `install_day`, `final_walkthrough`.

## Campo API (Phase 3–5)

| Method | Path | Notes |
|--------|------|--------|
| `PATCH` | `/api/campo/jobs/:id/checklist` | `done` + optional `photo_media_id` / `note`; blocks complete if photo required |
| `GET` | `/api/campo/jobs/:id/checklist/templates` | Field templates |
| `POST` | `/api/campo/jobs/:id/checklist/from-template` | Replace checklist |
| `POST` | `/api/campo/jobs/:id/checklist/propose` | Speech/text → proposed items |
| `POST` | `/api/campo/jobs/:id/checklist/apply` | Confirm proposed items |
| `GET` | `/api/campo/jobs/:id/recap` | Done / pending / risks |
| `PATCH` | `/api/campo/jobs/:jobId/media/:mediaId` | Includes `annotations` |
| `POST` | `/api/campo/jobs/:jobId/media/:mediaId/ocr` | Label / serial OCR → `ocrJson` |
| `POST` | `/api/campo/jobs/:id/inspections` | Spoken inspection + photo marks |
| `GET` | `/api/campo/jobs/:id/inspections` | List inspections |
| `POST` | `/api/campo/jobs/:id/measurements` | Manual / experimental measure |
| `GET` | `/api/campo/jobs/:id/measurements` | List + `meta.enabled` |

## Office API

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/work-orders/media-health?days=3` | Open jobs with no recent photos |
| `GET` | `/api/job-media/board?days=3` | Map + feed for manager photo board |
| `PATCH` | `/api/work-orders/:jobId/media/:mediaId/portfolio` | Toggle `in_portfolio` (forces public when on) |
| `GET` | `/api/work-orders/:id/quotes` | Proposals linked to job |
| `POST` | `/api/work-orders/:id/quotes` | Create draft quote from job lines (+ optional AI) |
| `POST` | `/api/work-orders/:jobId/quotes/:quoteId/send` | Issue public token + return sign URL |
| `GET` | `/api/work-orders/:id/portfolio-preview` | Before/after + social caption |
| `GET` | `/api/work-orders/:id/review-request` | WhatsApp/SMS/email review copy |

## Public surfaces

| Path | Notes |
|------|--------|
| `/public/quotes/:token` | Customer sign (canvas + name + IP/UA + hash + optional GPS) |
| `/public/portfolio/:slug` | Org portfolio gallery; `?embed=1` for iframe |

Customer signing reuses `/public/quotes/:token` (no third-party e-sign vendor).

Org tip for reviews: `featureFlags.google_review_url`.

Disable public portfolio: `featureFlags.public_portfolio: false`.

Disable field measures: `featureFlags.job_measure: false`.

Field roles that use Campo: `installer`, `crew_lead`, `subcontractor`.

## Later (filter before shipping)

Stripe (or other) on-site charge, DocuSign-class e-sign, Meta auto-publish, NFS-e.
