/**
 * Returns true when a keyboard event's target is a user-editable field
 * (input, textarea, or any contentEditable element).
 * Prevents global shortcuts from leaking into text-entry contexts.
 */
export function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t instanceof HTMLInputElement) return true;
  if (t instanceof HTMLTextAreaElement) return true;
  if (t instanceof HTMLSelectElement) return true;
  if (t.isContentEditable) return true;
  return false;
}
