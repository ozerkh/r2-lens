export function isControl(target: EventTarget) {
  return Boolean((target as Element).closest("button, input, label, a, [role=checkbox], [role=menu]"));
}
