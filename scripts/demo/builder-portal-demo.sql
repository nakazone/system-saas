-- Local demo data for the ObraBuilder (builder portal) presentation.
-- Builder: K&D Development (tenant builder 4e24193b…) on the senior-floors org.
-- Idempotent: removes the rows it created before (title prefix / invoice prefix "DEMO-").
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/demo/builder-portal-demo.sql
-- Times are stored as UTC (15:00 UTC = 8 AM Denver). Dates are relative to now(), so the calendar always has today / this week / overdue states.

\set org '''e5b4059a-a0b1-4b07-849e-1847139fc263'''
\set bld '''4e24193b-af32-4f76-9aae-014c83d91721'''

begin;
select set_config('app.current_tenant_id', :org, true);

delete from "InvoiceReceipt" where "organizationId" = :org and "invoiceId" in (select id from "QuoteInvoice" where "organizationId" = :org and "invoiceNumber" like 'DEMO-%');
delete from "QuoteInvoice" where "organizationId" = :org and "invoiceNumber" like 'DEMO-%';
delete from "WorkOrderLineItem" where "workOrderId" in (select id from "WorkOrder" where "organizationId" = :org and "clientRef" like 'DEMO-%');
delete from "WorkOrder" where "organizationId" = :org and "clientRef" like 'DEMO-%';

with jobs(ref, num, title, status, field, address, start_off, days, hours, sqft, rate, svc, homeowner) as (
  values
    ('DEMO-01', 9101, 'Lot 12 · Hardwood install + stairs', 'in_progress', 'in_progress', '1450 Larimer St, Denver, CO 80202', 0, 3, 15, 1240, 9.25, 'White Oak 7" engineered — install', 'Sarah Mitchell'),
    ('DEMO-02', 9102, 'Lot 14 · Refinish main level', 'scheduled', 'scheduled', '2201 Blake St, Denver, CO 80205', 1, 2, 15, 860, 4.75, 'Sand & refinish — 3 coats', 'Daniel Ortiz'),
    ('DEMO-03', 9103, 'Lot 7 · LVP basement', 'scheduled', 'scheduled', '875 S Pearl St, Denver, CO 80209', 3, 1, 16, 1020, 3.90, 'LVP 9" click — install', 'Priya Raman'),
    ('DEMO-04', 9104, 'Model home · Stair treads (14)', 'scheduled', 'scheduled', '6120 E 49th Ave, Denver, CO 80216', 6, 1, 15, 14, 185.00, 'Oak stair tread + riser — set', 'K&D Model Home'),
    ('DEMO-05', 9105, 'Lot 3 · Hardwood upstairs', 'scheduled', 'scheduled', '3300 W Colfax Ave, Denver, CO 80204', 9, 2, 15, 980, 9.25, 'White Oak 7" engineered — install', 'Mark & Lisa Chen'),
    ('DEMO-06', 9106, 'Lot 9 · Hardwood + vents', 'draft', 'scheduled', '4410 Tennyson St, Denver, CO 80212', null, null, null, 1310, 9.25, 'White Oak 7" engineered — install', 'Grace Kim'),
    ('DEMO-07', 9107, 'Lot 2 · Refinish + stain match', 'completed', 'done', '1901 Wazee St, Denver, CO 80202', -12, 2, 15, 740, 4.75, 'Sand & refinish — stain match', 'Tom Alvarez'),
    ('DEMO-08', 9108, 'Lot 5 · Stairs + landing', 'completed', 'done', '2650 Walnut St, Denver, CO 80205', -25, 1, 15, 16, 185.00, 'Oak stair tread + riser — set', 'Erin Walsh')
), ins as (
  insert into "WorkOrder"(id, "organizationId", number, title, status, "sourceType", "builderId", address, "scheduledStart", "scheduledEnd", "fieldStatus", "clientRef", "homeownerName", "createdAt", "updatedAt")
  select gen_random_uuid(), :org, num, title, status, 'builder', :bld, address,
         case when start_off is null then null else date_trunc('day', now()) + make_interval(days => start_off, hours => hours) end,
         case when start_off is null then null else date_trunc('day', now()) + make_interval(days => start_off + days - 1, hours => hours + 8) end,
         field, ref, homeowner, now() - interval '30 days', now() - make_interval(hours => num - 9100)
  from jobs
  returning id, "clientRef"
)
insert into "WorkOrderLineItem"("organizationId", "workOrderId", "serviceName", "quantitySqft", "unitPrice", "lineTotal", "sortOrder")
select :org, ins.id, j.svc, j.sqft, j.rate, round(j.sqft * j.rate, 2), 0
from ins join jobs j on j.ref = ins."clientRef";

-- Invoices: one overdue, one due this week, one paid, one partially paid.
insert into "QuoteInvoice"(id, "organizationId", "invoiceNumber", status, amount, "dueDate", "issuedAt", "paidAt", "invoiceType", "workOrderId", "updatedAt")
select gen_random_uuid(), :org, v.inv, v.status, v.amount, now() + make_interval(days => v.due), now() - interval '10 days',
       case when v.status = 'paid' then now() - interval '2 days' end, 'other', w.id, now()
from (values
  ('DEMO-1007', 'DEMO-07', 'sent', 3515.00, -4),
  ('DEMO-1001', 'DEMO-01', 'sent', 5735.00, 5),
  ('DEMO-1008', 'DEMO-08', 'paid', 2960.00, -10),
  ('DEMO-1002', 'DEMO-02', 'partially_paid', 4085.00, 12)
) as v(inv, ref, status, amount, due)
join "WorkOrder" w on w."clientRef" = v.ref and w."organizationId" = :org;

-- Receipts, so the paid invoice has no balance and the partly paid one shows what came in.
insert into "InvoiceReceipt"(id, "organizationId", "invoiceId", amount, "paidAt", method)
select gen_random_uuid(), :org, i.id, v.amount, now() - interval '2 days', 'check'
from (values ('DEMO-1008', 2960.00), ('DEMO-1002', 1500.00)) as v(inv, amount)
join "QuoteInvoice" i on i."invoiceNumber" = v.inv and i."organizationId" = :org;

-- The demo company works in Colorado: job times show in Mountain time everywhere.
update "Organization" set timezone = 'America/Denver' where id = :org::uuid;

-- Agreed prices between K&D and Senior Floors (Settings › Price lists), so quotes and the
-- presentation close with real numbers.
delete from "BuilderPriceItem" where notes = 'demo' and "builderLinkId" in (
  select l.id from "BuilderLink" l join "BuilderAccount" a on a.id = l."builderAccountId"
  where a.name = 'K&D Development' and l."organizationId" = :org::uuid);
insert into "BuilderPriceItem"("builderAccountId", "builderLinkId", name, unit, price, notes, "updatedAt")
select l."builderAccountId", l.id, v.name, v.unit, v.price, 'demo', now()
from "BuilderLink" l join "BuilderAccount" a on a.id = l."builderAccountId",
  (values
    ('Hardwood install - White Oak 7"', 'sq_ft', 4.25),
    ('Sand & finish - floors', 'sq_ft', 3.10),
    ('Stair tread install - White Oak', 'step', 95.00),
    ('Riser install', 'step', 45.00),
    ('Landing - White Oak', 'each', 260.00),
    ('Sand & finish stair treads', 'step', 38.00),
    ('Wood vent - flush', 'each', 28.00),
    ('Stair nosing', 'linear_ft', 14.00)
  ) as v(name, unit, price)
where a.name = 'K&D Development' and l."organizationId" = :org::uuid and l.status = 'active';

-- Showcase measurement: an L-shaped stair (7 + landing + 7, right side open, mitered returns)
-- and 6 vents on the K&D account's "1450 Larimer St" measurement, so the 3D and Present mode
-- have a complete model. Create the measurement in the portal first (Measure → New).
with steps(flight, n) as (
  select f, g from (values (1), (2)) as fl(f), generate_series(1, 7) g
), built as (
  select flight, jsonb_agg(jsonb_build_object(
    'id', 'demo' || flight || '-' || n, 'kind', 'step', 'note', '',
    'tread_w', 36, 'tread_d', 11.25, 'riser_w', 36, 'riser_h', 7.5,
    'open', 'right', 'ret', '45', 'no_riser', false) order by n) as js
  from steps group by flight
)
update "BuilderMeasurement" m set
  "organizationId" = :org,
  notes = 'Main stair turns at the landing. Homeowner wants the treads to match the White Oak floor.',
  community = 'Larimer Square', lot = '12',
  "updatedAt" = now(),
  data = jsonb_build_object(
    'plan', null,
    'measured', jsonb_build_object('on', to_char(now(), 'YYYY-MM-DD'), 'names', jsonb_build_array('Kevin Doyle')),
    'stairs', jsonb_build_array(
      jsonb_build_object('id', 'demo-main', 'name', 'Main stair', 'note', 'Open on the right, mitered returns.', 'turn', 'straight', 'layout', 'straight', 'color', '',
        'species', 'White Oak', 'finish', 'Unfinished (site finished)', 'riser_material', 'same',
        'landing', jsonb_build_object('enabled', true, 'width', 36, 'depth', 36),
        'steps', (select js from built where flight = 1), 'nosings', '[]'::jsonb, 'photos', '[]'::jsonb,
        'round_sweep', '270', 'round_diameter', null, 'round_center_diameter', null, 'starts_on_landing_of', null),
      jsonb_build_object('id', 'demo-upper', 'name', 'Main stair · upper flight', 'note', '', 'turn', 'left', 'layout', 'straight', 'color', '',
        'species', 'White Oak', 'finish', 'Unfinished (site finished)', 'riser_material', 'same',
        'landing', jsonb_build_object('enabled', false, 'width', null, 'depth', null),
        'steps', (select js from built where flight = 2), 'nosings', '[]'::jsonb, 'photos', '[]'::jsonb,
        'round_sweep', '270', 'round_diameter', null, 'round_center_diameter', null, 'starts_on_landing_of', 'demo-main')),
    'vents', jsonb_build_array(
      jsonb_build_object('id', 'demo-v1', 'room', 'Living room', 'size', '4x12', 'type', 'flush', 'species', 'White Oak', 'finish', 'Unfinished (site finished)', 'color', '', 'qty', 2, 'photos', '[]'::jsonb, 'note', ''),
      jsonb_build_object('id', 'demo-v2', 'room', 'Kitchen', 'size', '4x10', 'type', 'flush', 'species', 'White Oak', 'finish', 'Unfinished (site finished)', 'color', '', 'qty', 1, 'photos', '[]'::jsonb, 'note', ''),
      jsonb_build_object('id', 'demo-v3', 'room', 'Primary bedroom', 'size', '4x10', 'type', 'flush', 'species', 'White Oak', 'finish', 'Unfinished (site finished)', 'color', '', 'qty', 2, 'photos', '[]'::jsonb, 'note', ''),
      jsonb_build_object('id', 'demo-v4', 'room', 'Hallway', 'size', '6x14', 'type', 'return_air', 'species', 'White Oak', 'finish', 'Unfinished (site finished)', 'color', '', 'qty', 1, 'photos', '[]'::jsonb, 'note', '')))
from "BuilderAccount" a
where a.id = m."builderAccountId" and a.name = 'K&D Development' and m.address like '1450 Larimer St%';

commit;
