-- Consolidate Contractor into Builder for Customer and Builder cadastros.
UPDATE "Customer" SET "customerType" = 'builder' WHERE "customerType" = 'contractor';
UPDATE "Builder" SET "type" = 'builder' WHERE "type" = 'contractor';
