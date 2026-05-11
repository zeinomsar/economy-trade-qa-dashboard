import { NextResponse } from "next/server";
import {
  ensureDatabase,
  getCorrectedJsonRecords,
  getServices,
  getStats,
  resetRecordEdits,
  saveQaReview,
  updateRecordField
} from "../../../lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error, status = 500) {
  return NextResponse.json(
    {
      ok: false,
      error: error?.message ?? "Unexpected server error"
    },
    { status }
  );
}

export async function GET(request) {
  try {
    await ensureDatabase();

    const url = new URL(request.url);
    const exportMode = url.searchParams.get("export");

    if (exportMode === "corrected") {
      const records = await getCorrectedJsonRecords();
      return new NextResponse(JSON.stringify(records, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"economy_and_trade_services_corrected.json\""
        }
      });
    }

    const [records, stats] = await Promise.all([getServices(), getStats()]);
    return NextResponse.json({ ok: true, records, stats });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    await ensureDatabase();

    const body = await request.json();
    const action = body?.action;
    let record;

    if (action === "update_record") {
      record = await updateRecordField({
        recordIndex: body.record_index,
        field: body.field,
        value: body.value
      });
    } else if (action === "save_qa") {
      record = await saveQaReview(body.record_index);
    } else if (action === "reset_record_edits") {
      record = await resetRecordEdits(body.record_index);
    } else {
      return errorResponse(new Error(`Unsupported action '${action}'.`), 400);
    }

    const stats = await getStats();
    return NextResponse.json({ ok: true, record, stats });
  } catch (error) {
    return errorResponse(error);
  }
}
