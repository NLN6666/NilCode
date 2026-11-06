// FILE: KanbanNewTaskDialog.logic.ts
// Purpose: Pure helpers for the kanban new-task composer dialog.
// Layer: Kanban UI logic (no React/store side effects)
// Exports: transcript merge and task preview helpers.

export function appendKanbanTaskTranscript(current: string, transcript: string): string {
  const trimmed = transcript.trim();
  if (trimmed.length === 0) {
    return current;
  }
  if (current.trim().length === 0) {
    return trimmed;
  }
  return `${current.trimEnd()} ${trimmed}`;
}

export function buildKanbanTaskPreview(
  input: {
    readonly trimmedPrompt: string;
    readonly firstImageName?: string | null | undefined;
    readonly assistantSelectionCount: number;
  },
  translate: (key: string, values?: Record<string, unknown>) => string,
): string {
  if (input.trimmedPrompt.length > 0) {
    return input.trimmedPrompt;
  }
  if (input.firstImageName) {
    return translate("common:kanban_imagePreview", { value0: input.firstImageName });
  }
  if (input.assistantSelectionCount > 0) {
    return translate("common:referencedAssistantSelection");
  }
  return translate("common:kanban_newTask");
}

export function truncateKanbanTaskPreview(preview: string, maxLength = 80): string {
  return preview.length > maxLength ? `${preview.slice(0, maxLength)}…` : preview;
}
