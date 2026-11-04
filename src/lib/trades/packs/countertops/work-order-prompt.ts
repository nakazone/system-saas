/**
 * Countertops pack — how the Mate reads a builder's / design center's countertop work order.
 * Same JSON keys as the other packs (src/lib/partner-intake/extract.ts parses them the same way);
 * countertop orders have no stairs, so stairs is [] and stair_finish is "".
 */
export const COUNTERTOP_WORK_ORDER_PROMPT = `You read countertop work orders, purchase orders, option sheets and schedule screens that home builders and design centers send to their countertop fabricator / installer.
The input may be a PDF, a screenshot of the builder's scheduling system, a photo of paper, or pasted e-mail text.
Return ONLY a JSON object with these keys (strings; use "" when absent):
- raw_text: FIRST, copy every line of text on the order exactly as printed, top to bottom, one line per row (table rows with all their columns: item, description, units, quantity, rate, labor; then the remarks / instructions block word for word). Keep numbers, inch marks and spelling exactly. This is a transcription, not a summary.
- address: job site street address exactly as written; include city/state/zip only if shown
- community: subdivision / community / neighborhood name. If a value mixes a person's name and a number, put the person in contact_name and the number in lot
- lot: lot number only
- plan: house plan / model name (with the elevation if printed, e.g. "Aspen B")
- external_ref: the builder's own job #, PO # or work order # (the main one, digits/letters only)
- service_type: the work requested, short (e.g. "Kitchen countertops – Level 2 quartz", "Vanity tops", "Template")
- preferred_date: the job date as written: the TEMPLATE or INSTALL date / start / scheduled date; when it is blank, leave "" (do not use the order date)
- pickup: where the material is or who supplies the slab, as written; add a street address only if one is printed
- square_feet: the countertop square feet (the largest SF line) as a plain number, if shown
- material: the slab: material, brand, color, thickness and finish (e.g. "Quartz Cambria Brittanicca 3cm polished"); add the price level if printed ("Level 2")
- contact_name: superintendent / project manager name
- contact_phone: their phone
- contact_email: their e-mail
- notes: everything else that matters to the shop and the crew, short sentences: edge profile, sink model and mount, faucet holes and spread, cooktop / range model, backsplash height, overhangs and supports, seam instructions, who supplies the sink, tear-out, access
- title: a short job title: "<service_type> · <address>"
- items: array of distinct services the fabricator must perform (not one object per product/material row):
  {"area": room or piece (e.g. "Kitchen perimeter", "Island", "Owner's bath vanity"), "description": product or service, "detail": install detail column, "quantity": number, "uom": unit as written (SF, LF, EA…), "rate": labor rate per unit as a number or null, "total": line labor total as a number or null, "catalog_id": id of the matching service from the fabricator's catalog (given below) or null, "service_name": short generic name of the work as a countertop fabricator would list it in a price list, in English, without brand / color / SKU (e.g. "Countertop – Level 2 (fabricate & install)", "Undermount sink cutout", "4\\" backsplash", "Edge upgrade – ogee", "Tear-out & disposal")}
  Tops are priced per square foot by level; keep kitchen, island and vanities as separate services when the order lists them apart. Edges upgrades and 4" backsplash are linear feet (uom LF). Cutouts (sink, cooktop, faucet holes, outlets), waterfall sides, supports and trips are per unit (uom EA). Full-height backsplash is square feet.
  Only create the services the order actually lists or clearly describes; do not add a cutout or edge that is not on the order.
  Quantities come from the Quantity column. Numbers inside a description ("3CM" = thickness, "1.5\\"" = overhang, "30\\"" = sink size) are not quantities. Check: quantity × rate = labor when both are printed.
  Take service lines from the labor / work order table and scope notes. Material-only pages (purchase order, sales order, pick ticket, option sheet with prices to the home buyer) repeat products without labor: do not add those again. A line with "$ -" or no price still counts, with total null.
- stairs: [] (countertop orders have no stairs)
- stair_finish: ""
- labor_total: the printed labor total as a number, or null
Documents often come from a design center / flooring dealer (e.g. "The Colorado Floor Company") sending work to a fabricator. In that case the "BUILDER:" on the page is the home builder / end client: put it in notes ("Home builder: …"), not in contact_name. "BLDR:" in the remarks is the builder's superintendent → contact_name. On a "WORK ORDER" with "Sold To" and "Install At" boxes, the job address is the street line of "Install At"; its first line is usually "<community> #<lot>, <plan>". "PO Number: NEED PO" means no PO yet → keep the order number as external_ref. "INSTALL DATE: TBD" means there is no date yet.
Matching to the catalog: pick the catalog service that is the same kind of work and prefer one whose unit fits the line's unit (SF top → a per-SF top service at the same level; sink cutout → sink cutout). Use null when nothing in the catalog is that work; never force a match.
- unsure: array of keys you are not confident about
- warnings: array of short notes (in English) explaining any ambiguous reading
Never invent values. Ignore page chrome (buttons, menus, battery, time of day).`;
