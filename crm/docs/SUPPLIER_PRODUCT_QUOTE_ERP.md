# Supplier & Product ERP + Quote integration

This document maps the **requested lightweight ERP + quoting** features to the **Senior Floors CRM** implementation.

## Production stack (this repo)

| Layer | Technology |
|--------|------------|
| API | **Node.js + Express** (not NestJS) |
| Database | **MySQL** (not PostgreSQL) |
| ORM | **mysql2** + repository modules (not Prisma) |
| CRM UI | **HTML + Tailwind (CDN) + vanilla JS** (not React SPA) |

A **Prisma reference schema** for PostgreSQL lives at [`reference-erp-quote.prisma`](./reference-erp-quote.prisma) for portability or future migration.

## Migration (database)

```bash
cd senior-floors-system
npm run migrate:supplier-product-erp
```

Creates / updates: `suppliers`, `products`, `category_margin_defaults`, `quote_items` product columns (`item_type`, `product_id`, `cost_price`, `markup_percentage`, `sell_price`), optional `quote_template_items` parity.

## Module map

| Feature | Location |
|---------|----------|
| Supplier CRUD | `modules/erp/suppliersRepo.js`, `routes/erpMaterials.js`, UI `public/suppliers.html` |
| Product CRUD + filter | `modules/erp/productsRepo.js`, `routes/erpMaterials.js`, UI `public/products-erp.html` |
| Default margin by category | `category_margin_defaults` + `modules/erp/categoryMarginsRepo.js`, UI on `products-erp.html` |
| Pricing math | `modules/pricing/marginPricing.js` (`sellPriceFromCostAndMarkup`, `summarizeQuoteProfit`, `validateMarkup`, defaults Hardwood 35%, LVP 25%, Engineered 30%, Accessories 50%) |
| Quote lines (service / product) | `modules/quotes/quoteRepository.js`, `public/quote-builder.js` |
| Add product modal (cost, margin %, sell, qty) | `quote-builder.html` + `quote-builder.js` |
| Product pricing preview API | `GET /api/erp/products/preview/:id` |
| Profit on quote | Sidebar in `quote-builder.html` + `localProfitSummary()` / API `profit_summary` on quote load |

## API routes (authenticated, `quotes.*` permissions)

- `GET/POST /api/erp/suppliers`, `PUT/DELETE /api/erp/suppliers/:id`
- `GET/POST /api/erp/products`, `PUT/DELETE /api/erp/products/:id`
- `GET /api/erp/products/preview/:id` — cost, default markup, suggested sell, warnings
- `GET/PUT /api/erp/category-margins` — default % per category

## Pricing modes (spec)

1. **Default margin by category** — table `category_margin_defaults`; fallback in `DEFAULT_CATEGORY_MARGINS` in code.
2. **Manual markup %** — editable in product modal; recalculates sell from cost.
3. **Final price override** — edit sell price; markup % updates from cost/sell.

## Validation

- Margin **≥ 0** enforced on add product line.
- **&lt; 15%** → confirm dialog (quote builder).
- Products require **supplier_id** on create/update (API).

## Bonus features (spec)

| Item | Status |
|------|--------|
| Stock | `products.stock_qty` exists; no full stock movements UI |
| Bundles | Not implemented |
| Volume tiers | Not implemented |
| Supplier price history | Not implemented |

## Related files

- `database/migrate-supplier-product-erp.js`
- `routes/erpMaterials.js`
- `index.js` (route registration under `/api/erp/...`)
