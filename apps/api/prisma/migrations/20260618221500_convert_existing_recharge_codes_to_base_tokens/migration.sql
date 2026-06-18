UPDATE "recharge_codes"
SET "amount_cents" = LEAST(
  2000000000::numeric,
  GREATEST(1::numeric, ROUND(("face_value_cny_cents"::numeric * 1000000) / 800))
)::integer
WHERE "face_value_cny_cents" > 0
  AND "amount_cents" = "face_value_cny_cents";
