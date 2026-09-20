export type FieldEvidenceNote = {
  text: string;
  by?: string;
  at?: string;
};

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function extractFieldEvidenceNotes(state: Record<string, any>): FieldEvidenceNote[] {
  const notes: FieldEvidenceNote[] = [];
  const seen = new Set<string>();

  const addNote = (text: unknown, by?: unknown, at?: unknown) => {
    const normalizedText = textValue(text);
    if (!normalizedText || normalizedText.toLowerCase() === "started job") return;

    const dedupeKey = normalizedText.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const author = textValue(by);
    const timestamp = textValue(at);
    notes.push({
      text: normalizedText,
      ...(author ? { by: author } : {}),
      ...(timestamp ? { at: timestamp } : {}),
    });
  };

  addNote(
    state.completionNote,
    state.completedByStaffName || state.assignedTo,
    state.completedAt || state.resolveAt || state.resolvedAt,
  );

  if (Array.isArray(state.updates)) {
    for (const update of state.updates) {
      if (!update || typeof update !== "object") continue;
      addNote(
        update.note || update.update,
        update.by || update.staffName,
        update.at,
      );
    }
  }

  return notes;
}