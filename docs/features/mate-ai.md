# Mate AI: text and voice Quote drafts

Mate AI accepts a short text command, optionally transcribed by the browser's speech recognition API. It resolves the customer and services inside the active tenant, uses the same merged Quote Catalog and Pricing table used by the Quote Builder, shows a price preview, and creates a draft only after the user confirms the review.

## API

Both endpoints run behind CRM session authentication and require quotes.create, customers.view, and pricing.view.

- POST /api/mate-ai/preview accepts a JSON body with command. It returns a ready-to-review customer, catalog lines (including descriptions), current unit prices, subtotal, tax, total, and a short-lived signed preview token. Ambiguous customers/services and missing prices return clarification details without a token.
- POST /api/mate-ai/quote-drafts accepts a preview token and confirmed_review: true. It checks the token's tenant and user, re-reads the customer, both catalogs, rates, descriptions, and tax setting, and creates a draft Quote only if they still match the preview.

The preview token expires after 10 minutes. Its ID is stored on the Quote to prevent replay; a transaction-scoped Postgres advisory lock serializes requests using the same token. The create path does not publish, email, approve, or otherwise send the Quote.

## Data and logging

All CRM reads and writes run through the tenant transaction helper and include the active organizationId. A successful preview adds a mate_ai.quote_previewed customer activity event. Quote creation adds the normal quote.created activity event with source: mate_ai.

The app does not persist the raw command or audio. The browser speech feature fills the text field; users can edit the transcript before the app receives the text command. Speech recognition availability and processing are controlled by the browser.

Quote Catalog is the primary list, matching the Quote Builder. Quote Catalog items merge with active, visible Pricing table items when their trimmed service names match without case sensitivity. Pricing-only services are appended. Matching rows use the Pricing table category, description, and customer-type rates when those rates are positive; otherwise Quote Catalog values are kept. Custom customer rates apply when positive; missing or zero custom rates fall back to the table rate. The Quote Builder maps contractor customers to the Builder price column.

## MVP limits

- At most 8 service lines, 500 characters per command, and 2 decimal places per quantity.
- Supported units: square feet, linear feet, fixed, each, box, step, and hour. Values are not converted.
- Customer names must resolve uniquely within the active company; exact names are checked before a unique partial match.
- Service names must resolve to one unambiguous active, visible catalog item with the requested unit.
- A service without a positive effective rate blocks draft creation.
- Portuguese service terms include common mappings for installation, removal, carpet, sanding, and finishing; other services should use their catalog name.
