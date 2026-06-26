CREATE TABLE IF NOT EXISTS "translation_glossary_terms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_term" TEXT NOT NULL,
  "replacement_term" TEXT NOT NULL,
  "note" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_admin_id" UUID,
  "updated_by_admin_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "translation_glossary_terms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "translation_glossary_terms_source_term_key" UNIQUE ("source_term"),
  CONSTRAINT "translation_glossary_terms_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "translation_glossary_terms_updated_by_admin_id_fkey"
    FOREIGN KEY ("updated_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "translation_glossary_terms_active_source_idx"
  ON "translation_glossary_terms" ("is_active", "source_term");

CREATE INDEX IF NOT EXISTS "translation_glossary_terms_created_by_admin_idx"
  ON "translation_glossary_terms" ("created_by_admin_id");

CREATE INDEX IF NOT EXISTS "translation_glossary_terms_updated_by_admin_idx"
  ON "translation_glossary_terms" ("updated_by_admin_id");
