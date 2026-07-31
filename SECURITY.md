# Security policy

## Supported versions

Until the first stable release, security fixes are made on the latest `master`
revision and the newest published beta only.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or exposed
credential. Use GitHub's **Security → Report a vulnerability** flow to submit a
private report with:

- affected version or commit;
- reproduction steps and impact;
- relevant logs with credentials, paths, transcripts, and source media removed;
  and
- any suggested mitigation.

You should receive an acknowledgement within seven days. Coordinated disclosure
timing will be agreed with the reporter after triage.

## Scope

Security-sensitive areas include credential storage, cloud authorization,
diagnostic redaction, archive extraction, model verification, source-file
immutability, Electron IPC, the local HTTP/MCP boundary, and release integrity.
