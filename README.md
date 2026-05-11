# Economy and Trade Services QA

Minimal Next.js App Router dashboard for editing and saving normalized Economy and Trade service records in Postgres.

## What is included

- `app/page.js` — dashboard page
- `app/layout.js` — app metadata and layout
- `app/globals.css` — minimalist UI styling with RTL-friendly editable fields
- `app/api/database/route.js` — database API with `GET` and `POST`
- `components/QADashboard.js` — client editing dashboard
- `lib/database.js` — Postgres migration, seeding, updates, QA save, reset, audit log, export
- `lib/excel.js` — Excel/header normalization and seed loading
- `scripts/convert-excel.js` — converts the workbook into normalized JSON
- `data/Economy and trade.xlsx` — source workbook
- `data/economy_and_trade_services.json` — normalized seed records generated from the `Extracted` sheet
- `.env.example` — environment variable template

## Data shape

Each editable service record uses this shape:

```json
{
  "service_code": "",
  "service_name": "",
  "document_title": "",
  "ministry": "",
  "directorate": "",
  "sub_directorate": "",
  "department": "",
  "unit": "",
  "required_documents": "",
  "file_workflow": "",
  "processing_time": "",
  "fees": "",
  "notes": "",
  "relative_file_path": "",
  "file_extension": "",
  "extraction_status": "",
  "extraction_error_message": ""
}
```

`service_code` is generated from the last segment of `relative_file_path`, with the file extension removed.

## Database tables

The app auto-creates and migrates these tables on first load:

- `services`
- `qa_reviews`
- `audit_log`

Existing editable values are not overwritten during seed refreshes. Source columns are refreshed from the seed file, and newly added nullable editable columns can be populated from source values.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create a local environment file:

```bash
cp .env.example .env.local
```

3. Add a hosted Postgres connection string:

```bash
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
```

4. Run the app:

```bash
npm run dev
```

5. Open the dashboard:

```text
http://localhost:3000
```

6. Check the database API directly:

```text
http://localhost:3000/api/database
```

## Regenerate normalized JSON

The generated seed file is already included. To regenerate it from the workbook:

```bash
npm run convert:excel
```

You can also pass custom paths:

```bash
node scripts/convert-excel.js "data/Economy and trade.xlsx" "data/economy_and_trade_services.json"
```

## API

### `GET /api/database`

- Connects to Postgres using `DATABASE_URL`
- Creates/migrates required tables
- Seeds records from `data/economy_and_trade_services.json`, falling back to `data/Economy and trade.xlsx`
- Returns service records and QA status

### `GET /api/database?export=corrected`

Returns corrected JSON with only editable service fields.

### `POST /api/database`

Supported actions:

```json
{
  "action": "update_record",
  "record_index": 1,
  "field": "service_name",
  "value": "Updated value"
}
```

```json
{
  "action": "save_qa",
  "record_index": 1
}
```

```json
{
  "action": "reset_record_edits",
  "record_index": 1
}
```

## Deploy to Vercel with Neon Postgres

1. Push this project to GitHub.
2. Import the GitHub repo into Vercel.
3. Create or connect a Neon Postgres database.
4. Add `DATABASE_URL` in Vercel Project Settings → Environment Variables.
5. Redeploy after adding the environment variable.
6. Test:
   - Open `/api/database` and confirm records load.
   - Edit a field in the dashboard.
   - Refresh the page and confirm the edit remains.
   - Click `Save` and confirm the record leaves the pending count.
   - Click `Export corrected JSON` and confirm all editable fields are exported.

## Notes

- The app uses Postgres through `pg`.
- It does not use SQLite or `better-sqlite3`.
- It does not use browser `localStorage` as a persistence layer.
- The dashboard is intentionally minimal: title, one export button, two stats cards, record list, editable fields, `Save`, and optional `Reset record edits`.
