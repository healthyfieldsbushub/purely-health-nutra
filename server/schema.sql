-- Manus-managed MySQL schema. The application creates these tables idempotently at startup.
-- app_records stores application rows as JSON behind a server-only API so the browser
-- never receives DATABASE_URL. schema_migrations makes startup preparation repeatable.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS app_records (
  table_name VARCHAR(64) NOT NULL,
  record_id VARCHAR(64) NOT NULL,
  data_json JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (table_name, record_id),
  INDEX idx_app_records_table_updated (table_name, updated_at)
);

INSERT IGNORE INTO schema_migrations (version) VALUES ('0001_manus_records');
