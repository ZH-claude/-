CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING', 'SETTLED', 'CANCELED');

CREATE TABLE "referral_rewards" (
  "id" UUID NOT NULL,
  "inviter_user_id" UUID NOT NULL,
  "invitee_user_id" UUID NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
  "source" TEXT,
  "settled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_rewards_amount_cents_non_negative_check" CHECK ("amount_cents" >= 0),
  CONSTRAINT "referral_rewards_not_self_check" CHECK ("inviter_user_id" <> "invitee_user_id")
);

CREATE INDEX "referral_rewards_inviter_status_created_at_idx"
  ON "referral_rewards"("inviter_user_id", "status", "created_at");

CREATE INDEX "referral_rewards_invitee_created_at_idx"
  ON "referral_rewards"("invitee_user_id", "created_at");

ALTER TABLE "referral_rewards"
  ADD CONSTRAINT "referral_rewards_inviter_user_id_fkey"
  FOREIGN KEY ("inviter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "referral_rewards"
  ADD CONSTRAINT "referral_rewards_invitee_user_id_fkey"
  FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
