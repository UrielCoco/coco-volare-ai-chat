ALTER TABLE "WebSessionThread"
  ADD COLUMN IF NOT EXISTS "kommoLeadId" varchar(64),
  ADD COLUMN IF NOT EXISTS "kommoContactId" varchar(64);
