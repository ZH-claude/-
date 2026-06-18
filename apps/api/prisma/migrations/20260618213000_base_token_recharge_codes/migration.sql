ALTER TABLE "recharge_codes"
  ADD COLUMN "face_value_cny_cents" INTEGER NOT NULL DEFAULT 0;

UPDATE "recharge_codes"
SET "face_value_cny_cents" = "amount_cents"
WHERE "face_value_cny_cents" = 0;
