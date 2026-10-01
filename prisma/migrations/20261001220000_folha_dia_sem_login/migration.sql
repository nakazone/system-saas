-- Dia de trabalho lançado pelo escritório para funcionário sem login: o dia não tem usuário dono.
ALTER TABLE "CampoShift" ALTER COLUMN "userId" DROP NOT NULL;

-- Um dia por funcionário por data (além do um dia por usuário por data que já existe).
CREATE UNIQUE INDEX IF NOT EXISTS "CampoShift_organizationId_employeeId_workDate_key"
  ON "CampoShift" ("organizationId", "employeeId", "workDate")
  WHERE "employeeId" IS NOT NULL;
