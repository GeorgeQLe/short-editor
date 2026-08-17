export class RepositoryError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "REVISION_CONFLICT" | "INVALID_STATE",
    message: string,
    readonly details: unknown = null
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
