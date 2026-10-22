-- Mate is the office's general manager. Rename only the untouched default title.
UPDATE "VirtualAgent"
SET "title" = 'Gerente Geral',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'mate'
  AND "title" = 'Coordenador virtual';
