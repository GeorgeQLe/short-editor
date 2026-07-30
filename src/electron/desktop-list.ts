export function desktopListItems<T>(value: unknown, label: string): T[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("items" in value) ||
    !Array.isArray(value.items)
  ) {
    throw new Error(`${label} response is invalid`);
  }
  return value.items as T[];
}
