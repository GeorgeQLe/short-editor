import { isAbsolute } from "node:path";
import { AppError } from "../shared/errors.js";

export function validateOwnedRelativePath(path: string): string {
  if (!path || isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path) || path.includes("\0")) {
    throw new AppError("VALIDATION_ERROR", "Owned artifact paths must be relative", 422);
  }
  const portable = path.replaceAll("\\", "/");
  const segments = portable.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments[0] !== "artifacts"
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Owned artifact paths must be normalized paths below artifacts",
      422
    );
  }
  return segments.join("/");
}
