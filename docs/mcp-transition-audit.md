# HTTP-to-MCP and UI transition audit

API-02 freezes the 44 tools in `SPEC.md` section 7.2 as the complete v1 MCP
inventory. `src/mcp/registry.ts` is authoritative for discovery, runtime
registration, HTTP mappings, and generated documentation.

Every primary persisted, non-destructive UI transition has one of these
classifications:

- **Typed MCP parity:** library import/configuration/relink; analysis start and
  transcript replacement; job cancellation; Candidate generation/review;
  Short creation, composition, timeline, copy, caption, audio, crop, and
  approval mutations; render preflight/start/retry/validation; schedule
  rules/draft/move/publication; template clone/update; and asset import.
- **User-only security gate:** desktop credential creation, editing, selection,
  synchronization, and removal, plus cloud-authorization grant and revocation.
  These operations require the authenticated desktop boundary and are
  intentionally unavailable to MCP. MCP cloud requests rely only on persisted
  core authorization; caller booleans cannot authorize work.
- **Diagnostic/read-only helper outside the primary transition inventory:**
  health, local-transcription status, Ollama status, analysis-artifact listing,
  render-preflight history, cloud-authorization inspection/validation, and
  relink confirmation. These HTTP helpers do not represent an uncovered
  primary UI state transition.

The Candidate content-package HTTP reads/writes remain available, but Candidate
review and Short copy operations are the frozen v1 MCP workflow. The former
experimental MCP aliases `candidates.get_content_package` and
`candidates.accept_content_package` are therefore intentionally absent, as are
the provider-specific `analysis.openai_start` and diagnostic
`analysis.local_transcription_status` tools.
