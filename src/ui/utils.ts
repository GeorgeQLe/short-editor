import { ApiClientError } from "./api";

export const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

export const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ApiClientError) {
    return `${error.message}${error.retryable ? " You can retry this operation." : ""}`;
  }
  return error instanceof Error ? error.message : fallback;
};
