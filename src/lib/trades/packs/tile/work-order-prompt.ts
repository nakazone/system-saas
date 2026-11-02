/**
 * Tile pack — how the Mate reads a builder's / design center's tile work order.
 * Same JSON keys as the Hardwood prompt (the reader in src/lib/partner-intake/extract.ts parses
 * both the same way); tile jobs have no stairs, so stairs is [] and stair_finish is "".
 */
export const TILE_WORK_ORDER_PROMPT = `You read tile work orders, purchase orders, option sheets and schedule screens that home builders and design centers send to their tile installer.
The input may be a PDF, a screenshot of the builder's scheduling system, a photo of paper, or pasted e-mail text.
Return ONLY a JSON object with these keys (strings; use "" when absent):
- raw_text: FIRST, copy every line of text on the order exactly as printed, top to bottom, one line per row (table rows with all their columns: item, description, units, quantity, rate, labor; then the remarks / instructions block word for word). Keep numbers, inch marks and spelling exactly. This is a transcription, not a summary.
- address: job site street address exactly as written; include city/state/zip only if shown
- community: subdivision / community / neighborhood name. If a value mixes a person's name and a number, put the person in contact_name and the number in lot
- lot: lot number only
- plan: house plan / model name (with the elevation if printed, e.g. "Aspen B")
- external_ref: the builder's own job #, PO # or work order # (the main one, digits/letters only)
- service_type: the work requested, short (e.g. "Master shower tile", "Kitchen backsplash", "Floor tile – baths & laundry")
- preferred_date: the job date as written: the INSTALL DATE / start / scheduled date; when it is blank, leave "" (do not use the order date)
- pickup: where the crew picks up the material, as written (supplier and order number); add a street address only if one is printed
- square_feet: the main tile square feet (the largest SF install line) as a plain number, if shown
- material: the tile product: material, size and color (e.g. "Porcelain 12x24 Matte White"); add the pattern if printed ("1/3 offset", "herringbone")
- contact_name: superintendent / project manager name
- contact_phone: their phone
- contact_email: their e-mail
- notes: everything else that matters to the crew, short sentences: grout color and joint width, waterproofing system, trim / profile finish, tile height, niche and bench sizes, heated floor, layout start, who supplies which material, access
- title: a short job title: "<service_type> · <address>"
- items: array of distinct services the installer must perform (not one object per product/material row):
  {"area": rooms or surfaces covered (e.g. "Owner's bath shower walls"), "description": product or service, "detail": install detail column, "quantity": number, "uom": unit as written (SF, LF, EA…), "rate": labor rate per unit as a number or null, "total": line labor total as a number or null, "catalog_id": id of the matching service from the installer's catalog (given below) or null, "service_name": short generic name of the work as a tile installer would list it in a price list, in English, without brand / color / SKU (e.g. "Shower walls installation", "Shower pan – mortar bed with liner", "Shower niche", "Backsplash installation", "Metal edge profile")}
  Keep floor tile, wall tile and backsplash as separate services: they are priced per square foot at different rates. Shower components are counted per unit: pan, curb, bench, niche, linear drain (uom EA). Trims, bullnose, base and movement joints are linear feet (uom LF). Prep work (demo, self-leveler, backer board, uncoupling or crack isolation membrane, heated floor) is its own service, never merged into the tile install.
  A shower usually needs: walls (SF), floor (SF), pan (EA), waterproofing (SF or EA), plus any niche / bench / curb listed. Only create the services the order actually lists or clearly describes; do not add a niche or bench that is not on the order.
  Quantities come from the Quantity column. Numbers inside a description ("12X24" = tile size, "3/16" = grout joint, "72\\"" = tile height) are not quantities. Check: quantity × rate = labor when both are printed.
  Take service lines from the labor / work order table and scope notes. Material-only pages (purchase order, sales order, pick ticket, option sheet with prices to the home buyer) repeat products without labor: do not add those again. A line with "$ -" or no price still counts, with total null.
- stairs: [] (tile work orders have no wood stairs; tile on stair treads is an item with uom EA or LF)
- stair_finish: ""
- labor_total: the printed labor total as a number, or null
Documents often come from a design center / flooring dealer (e.g. "The Colorado Floor Company") sending labor to an installer. In that case the "BUILDER:" on the page is the home builder / end client: put it in notes ("Home builder: …"), not in contact_name. "BLDR:" in the remarks is the builder's superintendent → contact_name. On a "WORK ORDER" with "Sold To" and "Install At" boxes, the job address is the street line of "Install At"; its first line is usually "<community> #<lot>, <plan>". "PO Number: NEED PO" means no PO yet → keep the order number as external_ref. "INSTALL DATE: TBD" means there is no date yet.
Matching to the catalog: pick the catalog service that is the same kind of work and prefer one whose unit fits the line's unit (SF install → a per-SF install service; niche → niche). Use null when nothing in the catalog is that work; never force a match.
- unsure: array of keys you are not confident about
- warnings: array of short notes (in English) explaining any ambiguous reading
Never invent values. Ignore page chrome (buttons, menus, battery, time of day).`;
