import pg from "pg";
import { EDITABLE_FIELDS, readSeedRecords } from "./excel";

const { Pool } = pg;

export { EDITABLE_FIELDS };

const SOURCE_FIELDS = EDITABLE_FIELDS.map((field) => `source_${field}`);

function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function valueToString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Add a hosted Postgres connection string to your environment variables.");
  }

  if (!globalThis.__economyTradeQaPool) {
    const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    const ssl = process.env.DATABASE_SSL === "false" || isLocal ? false : { rejectUnauthorized: false };

    globalThis.__economyTradeQaPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl
    });
  }

  return globalThis.__economyTradeQaPool;
}

async function migrateServices(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS services (
      id BIGSERIAL PRIMARY KEY,
      record_index INTEGER UNIQUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS id BIGSERIAL`);
  await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS record_index INTEGER`);
  await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS services_record_index_idx ON services(record_index)`);

  for (const column of SOURCE_FIELDS) {
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS ${ident(column)} TEXT`);
  }

  for (const column of EDITABLE_FIELDS) {
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS ${ident(column)} TEXT`);
  }
}

async function migrateQaReviews(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS qa_reviews (
      id BIGSERIAL PRIMARY KEY,
      record_index INTEGER UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`ALTER TABLE qa_reviews ADD COLUMN IF NOT EXISTS id BIGSERIAL`);
  await client.query(`ALTER TABLE qa_reviews ADD COLUMN IF NOT EXISTS record_index INTEGER`);
  await client.query(`ALTER TABLE qa_reviews ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`);
  await client.query(`ALTER TABLE qa_reviews ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS qa_reviews_record_index_idx ON qa_reviews(record_index)`);
}

async function migrateAuditLog(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      record_index INTEGER,
      action TEXT,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS id BIGSERIAL`);
  await client.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS record_index INTEGER`);
  await client.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS action TEXT`);
  await client.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS field TEXT`);
  await client.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS old_value TEXT`);
  await client.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS new_value TEXT`);
  await client.query(`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`CREATE INDEX IF NOT EXISTS audit_log_record_index_idx ON audit_log(record_index)`);
}

async function seedServices(client) {
  const seedRecords = await readSeedRecords();
  if (!seedRecords.length) return;

  const insertColumns = ["record_index", ...SOURCE_FIELDS, ...EDITABLE_FIELDS];
  const insertColumnSql = insertColumns.map(ident).join(", ");
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`).join(", ");

  const updateSourceSql = SOURCE_FIELDS
    .map((field) => `${ident(field)} = EXCLUDED.${ident(field)}`)
    .join(", ");

  const updateEditableSql = EDITABLE_FIELDS
    .map((field) => `${ident(field)} = COALESCE(services.${ident(field)}, EXCLUDED.${ident(field)})`)
    .join(", ");

  const updateSql = [updateSourceSql, updateEditableSql].filter(Boolean).join(", ");

  for (let index = 0; index < seedRecords.length; index += 1) {
    const record = seedRecords[index];
    const recordIndex = index + 1;
    const sourceValues = EDITABLE_FIELDS.map((field) => valueToString(record[field]));
    const editableValues = EDITABLE_FIELDS.map((field) => valueToString(record[field]));

    await client.query(
      `
        INSERT INTO services (${insertColumnSql})
        VALUES (${placeholders})
        ON CONFLICT (record_index) DO UPDATE SET
          ${updateSql}
      `,
      [recordIndex, ...sourceValues, ...editableValues]
    );

    await client.query(
      `
        INSERT INTO qa_reviews (record_index, status, updated_at)
        VALUES ($1, 'pending', NOW())
        ON CONFLICT (record_index) DO NOTHING
      `,
      [recordIndex]
    );
  }
}

export async function ensureDatabase() {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await migrateServices(client);
    await migrateQaReviews(client);
    await migrateAuditLog(client);
    await seedServices(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function selectServicesSql(whereClause = "") {
  const sourceSql = SOURCE_FIELDS
    .map((field) => `COALESCE(s.${ident(field)}, '') AS ${ident(field)}`)
    .join(",\n      ");
  const editableSql = EDITABLE_FIELDS
    .map((field) => `COALESCE(s.${ident(field)}, '') AS ${ident(field)}`)
    .join(",\n      ");

  return `
    SELECT
      s.id,
      s.record_index,
      ${sourceSql},
      ${editableSql},
      COALESCE(q.status, 'pending') AS qa_status,
      s.updated_at,
      q.updated_at AS qa_updated_at
    FROM services s
    LEFT JOIN qa_reviews q ON q.record_index = s.record_index
    WHERE s.record_index IS NOT NULL
    ${whereClause}
    ORDER BY s.record_index ASC
  `;
}

export async function getServices() {
  const result = await getPool().query(selectServicesSql());
  return result.rows;
}

export async function getStats() {
  const result = await getPool().query(`
    SELECT
      COUNT(*)::INTEGER AS services,
      COUNT(*) FILTER (WHERE COALESCE(q.status, 'pending') <> 'saved')::INTEGER AS pending
    FROM services s
    LEFT JOIN qa_reviews q ON q.record_index = s.record_index
    WHERE s.record_index IS NOT NULL
  `);

  return result.rows[0] ?? { services: 0, pending: 0 };
}

export async function getServiceByRecordIndex(recordIndex) {
  const result = await getPool().query(selectServicesSql("AND s.record_index = $1"), [recordIndex]);
  return result.rows[0] ?? null;
}

export async function updateRecordField({ recordIndex, field, value }) {
  if (!EDITABLE_FIELDS.includes(field)) {
    throw new Error(`Field '${field}' is not editable.`);
  }

  const cleanRecordIndex = Number(recordIndex);
  if (!Number.isInteger(cleanRecordIndex) || cleanRecordIndex < 1) {
    throw new Error("record_index must be a positive integer.");
  }

  const cleanValue = valueToString(value);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT COALESCE(${ident(field)}, '') AS ${ident(field)} FROM services WHERE record_index = $1 FOR UPDATE`,
      [cleanRecordIndex]
    );

    if (!existing.rowCount) throw new Error(`Record ${cleanRecordIndex} was not found.`);

    const oldValue = existing.rows[0][field] ?? "";

    await client.query(
      `UPDATE services SET ${ident(field)} = $2, updated_at = NOW() WHERE record_index = $1`,
      [cleanRecordIndex, cleanValue]
    );

    await client.query(
      `
        INSERT INTO qa_reviews (record_index, status, updated_at)
        VALUES ($1, 'pending', NOW())
        ON CONFLICT (record_index) DO UPDATE SET status = 'pending', updated_at = NOW()
      `,
      [cleanRecordIndex]
    );

    if (oldValue !== cleanValue) {
      await client.query(
        `
          INSERT INTO audit_log (record_index, action, field, old_value, new_value, created_at)
          VALUES ($1, 'update_record', $2, $3, $4, NOW())
        `,
        [cleanRecordIndex, field, oldValue, cleanValue]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getServiceByRecordIndex(cleanRecordIndex);
}

export async function saveQaReview(recordIndex) {
  const cleanRecordIndex = Number(recordIndex);
  if (!Number.isInteger(cleanRecordIndex) || cleanRecordIndex < 1) {
    throw new Error("record_index must be a positive integer.");
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT COALESCE(status, 'pending') AS status FROM qa_reviews WHERE record_index = $1 FOR UPDATE`,
      [cleanRecordIndex]
    );
    const oldStatus = existing.rows[0]?.status ?? "pending";

    await client.query(
      `
        INSERT INTO qa_reviews (record_index, status, updated_at)
        VALUES ($1, 'saved', NOW())
        ON CONFLICT (record_index) DO UPDATE SET status = 'saved', updated_at = NOW()
      `,
      [cleanRecordIndex]
    );

    await client.query(
      `
        INSERT INTO audit_log (record_index, action, field, old_value, new_value, created_at)
        VALUES ($1, 'save_qa', 'status', $2, 'saved', NOW())
      `,
      [cleanRecordIndex, oldStatus]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getServiceByRecordIndex(cleanRecordIndex);
}

export async function resetRecordEdits(recordIndex) {
  const cleanRecordIndex = Number(recordIndex);
  if (!Number.isInteger(cleanRecordIndex) || cleanRecordIndex < 1) {
    throw new Error("record_index must be a positive integer.");
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const selectFields = EDITABLE_FIELDS.flatMap((field) => [
      `COALESCE(${ident(field)}, '') AS ${ident(field)}`,
      `COALESCE(${ident(`source_${field}`)}, '') AS ${ident(`source_${field}`)}`
    ]).join(", ");

    const existing = await client.query(
      `SELECT ${selectFields} FROM services WHERE record_index = $1 FOR UPDATE`,
      [cleanRecordIndex]
    );

    if (!existing.rowCount) throw new Error(`Record ${cleanRecordIndex} was not found.`);

    const row = existing.rows[0];
    const setSql = EDITABLE_FIELDS
      .map((field) => `${ident(field)} = COALESCE(${ident(`source_${field}`)}, '')`)
      .join(", ");

    await client.query(
      `UPDATE services SET ${setSql}, updated_at = NOW() WHERE record_index = $1`,
      [cleanRecordIndex]
    );

    await client.query(
      `
        INSERT INTO qa_reviews (record_index, status, updated_at)
        VALUES ($1, 'pending', NOW())
        ON CONFLICT (record_index) DO UPDATE SET status = 'pending', updated_at = NOW()
      `,
      [cleanRecordIndex]
    );

    for (const field of EDITABLE_FIELDS) {
      const oldValue = row[field] ?? "";
      const newValue = row[`source_${field}`] ?? "";
      if (oldValue !== newValue) {
        await client.query(
          `
            INSERT INTO audit_log (record_index, action, field, old_value, new_value, created_at)
            VALUES ($1, 'reset_record_edits', $2, $3, $4, NOW())
          `,
          [cleanRecordIndex, field, oldValue, newValue]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getServiceByRecordIndex(cleanRecordIndex);
}

export async function getCorrectedJsonRecords() {
  const services = await getServices();
  return services.map((record) =>
    Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, valueToString(record[field])]))
  );
}
