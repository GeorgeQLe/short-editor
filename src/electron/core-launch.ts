export function resolveCoreExecutable(
  isPackaged: boolean,
  electronExecutable: string,
  npmNodeExecutable: string | undefined
): string {
  return !isPackaged && npmNodeExecutable
    ? npmNodeExecutable
    : electronExecutable;
}
