"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const FIELD_DEFS = [
  { key: "service_code", label: "Service code" },
  { key: "service_name", label: "Service name" },
  { key: "document_title", label: "Document title" },
  { key: "ministry", label: "Ministry" },
  { key: "directorate", label: "Directorate" },
  { key: "sub_directorate", label: "Sub directorate" },
  { key: "department", label: "Department" },
  { key: "unit", label: "Unit" },
  { key: "required_documents", label: "Required documents", textarea: true, long: true },
  { key: "file_workflow", label: "File workflow", textarea: true, long: true },
  { key: "processing_time", label: "Processing time" },
  { key: "fees", label: "Fees" },
  { key: "notes", label: "Notes", textarea: true, long: true },
  { key: "relative_file_path", label: "Relative file path" },
  { key: "file_extension", label: "File extension" },
  { key: "extraction_status", label: "Extraction status" },
  { key: "extraction_error_message", label: "Extraction error message" }
];

function replaceRecord(records, nextRecord) {
  return records.map((record) =>
    record.record_index === nextRecord.record_index ? { ...record, ...nextRecord } : record
  );
}

function statusText(record) {
  return record?.qa_status === "saved" ? "Saved" : "Pending";
}

export default function QADashboard() {
  const [records, setRecords] = useState([]);
  const [activeRecordIndex, setActiveRecordIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const timersRef = useRef(new Map());
  const pendingSavesRef = useRef(new Map());

  const stats = useMemo(
    () => ({
      services: records.length,
      pending: records.filter((record) => record.qa_status !== "saved").length
    }),
    [records]
  );

  const activeRecord = useMemo(() => {
    if (!records.length) return null;
    return records.find((record) => record.record_index === activeRecordIndex) ?? records[0];
  }, [records, activeRecordIndex]);

  const activePosition = useMemo(() => {
    if (!activeRecord) return 0;
    return records.findIndex((record) => record.record_index === activeRecord.record_index) + 1;
  }, [records, activeRecord]);

  const postAction = useCallback(async (payload) => {
    const response = await fetch("/api/database", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Could not save the change.");
    }

    return data;
  }, []);

  const flushPendingSave = useCallback(
    async (key) => {
      const pending = pendingSavesRef.current.get(key);
      if (!pending) return;

      const timer = timersRef.current.get(key);
      if (timer) window.clearTimeout(timer);
      timersRef.current.delete(key);
      pendingSavesRef.current.delete(key);

      setMessage("Saving…");
      setError("");

      try {
        const data = await postAction({
          action: "update_record",
          record_index: pending.recordIndex,
          field: pending.field,
          value: pending.value
        });

        if (data.record) {
          setRecords((current) => replaceRecord(current, data.record));
        }
        setMessage("Saved changes.");
      } catch (saveError) {
        setError(saveError.message);
        pendingSavesRef.current.set(key, pending);
      }
    },
    [postAction]
  );

  const scheduleAutosave = useCallback(
    (recordIndex, field, value) => {
      const key = `${recordIndex}:${field}`;
      pendingSavesRef.current.set(key, { recordIndex, field, value });

      const existingTimer = timersRef.current.get(key);
      if (existingTimer) window.clearTimeout(existingTimer);

      const timer = window.setTimeout(() => {
        flushPendingSave(key);
      }, 650);

      timersRef.current.set(key, timer);
    },
    [flushPendingSave]
  );

  const flushRecordSaves = useCallback(
    async (recordIndex) => {
      const prefix = `${recordIndex}:`;
      const keys = Array.from(pendingSavesRef.current.keys()).filter((key) => key.startsWith(prefix));
      await Promise.all(keys.map((key) => flushPendingSave(key)));
    },
    [flushPendingSave]
  );

  const flushAllSaves = useCallback(async () => {
    const keys = Array.from(pendingSavesRef.current.keys());
    await Promise.all(keys.map((key) => flushPendingSave(key)));
  }, [flushPendingSave]);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/database", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not load records.");
      }

      setRecords(data.records ?? []);
      setActiveRecordIndex((current) => current ?? data.records?.[0]?.record_index ?? null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecords();

    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
    };
  }, [loadRecords]);

  function handleFieldChange(field, value) {
    if (!activeRecord) return;

    setRecords((current) =>
      current.map((record) =>
        record.record_index === activeRecord.record_index
          ? { ...record, [field]: value, qa_status: "pending" }
          : record
      )
    );

    scheduleAutosave(activeRecord.record_index, field, value);
  }

  async function handleFieldBlur(field) {
    if (!activeRecord) return;
    await flushPendingSave(`${activeRecord.record_index}:${field}`);
  }

  async function handleSaveRecord() {
    if (!activeRecord) return;

    setBusy(true);
    setMessage("Saving…");
    setError("");

    try {
      await flushRecordSaves(activeRecord.record_index);
      const data = await postAction({ action: "save_qa", record_index: activeRecord.record_index });
      if (data.record) setRecords((current) => replaceRecord(current, data.record));
      setMessage("Record saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetRecord() {
    if (!activeRecord) return;

    setBusy(true);
    setMessage("Resetting…");
    setError("");

    try {
      await flushRecordSaves(activeRecord.record_index);
      const data = await postAction({
        action: "reset_record_edits",
        record_index: activeRecord.record_index
      });
      if (data.record) setRecords((current) => replaceRecord(current, data.record));
      setMessage("Record edits reset.");
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleExportCorrectedJson() {
    setBusy(true);
    setError("");
    setMessage("Preparing export…");

    try {
      await flushAllSaves();
      const response = await fetch("/api/database?export=corrected", { cache: "no-store" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not export corrected JSON.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `economy_and_trade_services_corrected_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setMessage("Export ready.");
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pageShell">
      <header className="topBar">
        <h1>Economy and Trade Services QA</h1>
        <button className="secondaryButton" type="button" onClick={handleExportCorrectedJson} disabled={busy || loading}>
          Export corrected JSON
        </button>
      </header>

      <section className="statsGrid" aria-label="Dashboard statistics">
        <article className="statCard">
          <span>Services</span>
          <strong>{stats.services}</strong>
        </article>
        <article className="statCard">
          <span>Pending</span>
          <strong>{stats.pending}</strong>
        </article>
      </section>

      {error ? <div className="notice errorNotice">{error}</div> : null}
      {message && !error ? <div className="notice">{message}</div> : null}

      {loading ? (
        <section className="emptyState">Loading records…</section>
      ) : !activeRecord ? (
        <section className="emptyState">No service records found.</section>
      ) : (
        <section className="workspace">
          <aside className="recordList" aria-label="Service records">
            {records.map((record) => (
              <button
                key={record.record_index}
                type="button"
                className={`recordListItem ${record.record_index === activeRecord.record_index ? "active" : ""}`}
                onClick={() => {
                  if (activeRecord) void flushRecordSaves(activeRecord.record_index);
                  setActiveRecordIndex(record.record_index);
                }}
              >
                <span className="recordCode" dir="auto">{record.service_code || `record-${record.record_index}`}</span>
                <span className="recordName" dir="auto">{record.service_name || record.document_title || "Untitled service"}</span>
                <span className={`recordStatus ${record.qa_status === "saved" ? "saved" : "pending"}`}>
                  {statusText(record)}
                </span>
              </button>
            ))}
          </aside>

          <section className="editorPanel">
            <div className="recordHeader">
              <div>
                <p className="eyebrow">Record {activePosition} of {records.length}</p>
                <h2 dir="auto">{activeRecord.service_name || activeRecord.document_title || activeRecord.service_code}</h2>
              </div>
              <div className="recordActions">
                <button className="primaryButton" type="button" onClick={handleSaveRecord} disabled={busy}>
                  Save
                </button>
                <button className="ghostButton" type="button" onClick={handleResetRecord} disabled={busy}>
                  Reset record edits
                </button>
              </div>
            </div>

            <div className="fieldsGrid">
              {FIELD_DEFS.map((fieldDef) => {
                const value = activeRecord[fieldDef.key] ?? "";
                const className = `fieldBlock ${fieldDef.long ? "longField" : ""}`;

                return (
                  <label className={className} key={fieldDef.key}>
                    <span>{fieldDef.label}</span>
                    {fieldDef.textarea ? (
                      <textarea
                        dir="auto"
                        value={value}
                        onChange={(event) => handleFieldChange(fieldDef.key, event.target.value)}
                        onBlur={() => handleFieldBlur(fieldDef.key)}
                      />
                    ) : (
                      <input
                        dir="auto"
                        value={value}
                        onChange={(event) => handleFieldChange(fieldDef.key, event.target.value)}
                        onBlur={() => handleFieldBlur(fieldDef.key)}
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
