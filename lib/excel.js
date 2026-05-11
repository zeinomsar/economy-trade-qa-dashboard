import fs from "fs";
import path from "path";

export const EDITABLE_FIELDS = [
  "service_code",
  "service_name",
  "document_title",
  "ministry",
  "directorate",
  "sub_directorate",
  "department",
  "unit",
  "required_documents",
  "file_workflow",
  "processing_time",
  "fees",
  "notes",
  "relative_file_path",
  "file_extension",
  "extraction_status",
  "extraction_error_message"
];

export const FIELD_ALIASES = {
  service_code: ["Code", "Service code", "Service Code"],
  service_name: ["Name of transaction", "Transaction name", "Title", "Title "],
  document_title: ["Title of document", "Document title"],
  ministry: ["Name of ministry", "Ministry"],
  directorate: ["Department", "Directorate"],
  sub_directorate: ["Sub Directorate", "Sub-directorate", "Sub directorate"],
  department: ["Sub department", "Department name"],
  unit: ["Sub Sub department", "Unit"],
  required_documents: [
    "Required documents / attachments",
    "Required Docs",
    "Required Docs ",
    "Required Documents"
  ],
  file_workflow: ["File workflow"],
  processing_time: ["Processing time"],
  fees: ["Fees"],
  notes: ["Notes"],
  relative_file_path: ["Relative file path", "File path", "Path"],
  file_extension: ["File extension", "Extension"],
  extraction_status: ["Status"],
  extraction_error_message: ["Error message", "Error"]
};

const DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_JSON_PATH = path.join(DATA_DIR, "economy_and_trade_services.json");
const DEFAULT_EXCEL_PATH = path.join(DATA_DIR, "Economy and trade.xlsx");
const DEFAULT_SHEET_NAME = "Extracted";

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cellToString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function serviceCodeFromRelativePath(relativeFilePath, fallback = "") {
  const cleanPath = String(relativeFilePath ?? "").trim();
  if (!cleanPath) return fallback;

  const lastSegment = cleanPath.split(/[\\/]+/).pop()?.trim() ?? "";
  const withoutExtension = lastSegment.replace(/\.[^.]*$/, "").trim();
  return withoutExtension || fallback;
}

function extensionFromRelativePath(relativeFilePath) {
  const cleanPath = String(relativeFilePath ?? "").trim();
  if (!cleanPath) return "";
  const match = cleanPath.match(/(\.[^./\\]+)$/);
  return match ? match[1] : "";
}

function buildHeaderIndex(headers) {
  const byHeader = new Map();

  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !byHeader.has(key)) byHeader.set(key, index);
  });

  const byField = new Map();

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const aliasKey = normalizeHeader(alias);
      if (byHeader.has(aliasKey)) {
        byField.set(field, byHeader.get(aliasKey));
        break;
      }
    }
  }

  return byField;
}

export function normalizeWorksheetRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const headers = rows[0] ?? [];
  const headerIndex = buildHeaderIndex(headers);
  const records = [];

  for (let rowOffset = 1; rowOffset < rows.length; rowOffset += 1) {
    const row = rows[rowOffset] ?? [];
    const hasValue = row.some((value) => cellToString(value) !== "");
    if (!hasValue) continue;

    const record = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, ""]));

    for (const field of EDITABLE_FIELDS) {
      const columnIndex = headerIndex.get(field);
      if (columnIndex !== undefined) {
        record[field] = cellToString(row[columnIndex]);
      }
    }

    if (!record.sub_directorate) record.sub_directorate = "";
    if (!record.file_extension) {
      record.file_extension = extensionFromRelativePath(record.relative_file_path);
    }

    record.service_code = serviceCodeFromRelativePath(
      record.relative_file_path,
      record.service_code || `record-${records.length + 1}`
    );

    for (const field of EDITABLE_FIELDS) {
      record[field] = cellToString(record[field]);
    }

    records.push(record);
  }

  return records;
}

export async function readExcelRecords(excelPath = DEFAULT_EXCEL_PATH) {
  if (!fs.existsSync(excelPath)) return [];

  const XLSXModule = await import("xlsx");
  const XLSX = XLSXModule.default ?? XLSXModule;
  const workbook = XLSX.readFile(excelPath, { cellDates: false });
  const worksheet = workbook.Sheets[DEFAULT_SHEET_NAME];

  if (!worksheet) {
    throw new Error(`Sheet named '${DEFAULT_SHEET_NAME}' was not found in ${excelPath}.`);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    blankrows: false
  });

  return normalizeWorksheetRows(rows);
}

export async function readSeedRecords() {
  if (fs.existsSync(DEFAULT_JSON_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(DEFAULT_JSON_PATH, "utf8"));
    if (Array.isArray(parsed)) {
      return parsed.map((record, index) => {
        const normalized = Object.fromEntries(
          EDITABLE_FIELDS.map((field) => [field, cellToString(record?.[field])])
        );

        normalized.sub_directorate = normalized.sub_directorate || "";
        normalized.file_extension = normalized.file_extension || extensionFromRelativePath(normalized.relative_file_path);
        normalized.service_code = serviceCodeFromRelativePath(
          normalized.relative_file_path,
          normalized.service_code || `record-${index + 1}`
        );

        return normalized;
      });
    }
  }

  return readExcelRecords(DEFAULT_EXCEL_PATH);
}
