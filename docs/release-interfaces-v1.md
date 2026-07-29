# Short Editor v1 release interfaces

This document is generated. The checked-in JSON artifacts are the exact
machine-readable compatibility boundary:

- [HTTP route inventory](api-v1-routes.json) — 60 operations, SHA-256 `d77fb06e4d1156606c17ef95c838d7752725af8569af62b23ba25ce3cd32773a`
- [MCP tool schemas](mcp-v1-tools.json) — 44 tools with Draft-07 input/output schemas, SHA-256 `bc3585035d5e3532876a50622e9b99ea1c5bfcd5a1b6c20d4d17edf307c283e9`
- [Compatibility manifest](release-interface-v1.json) — policy, artifact digests, and exact MCP-to-HTTP mappings

## Compatibility policy

The v1 interface is additive-only. Removing or renaming an operation, tool,
field, enum value, or changing its meaning requires a new major interface
version. Mutation bodies and query strings are strict: unknown fields are
rejected. Successes use `{apiVersion:"v1",data}`; failures use
`{apiVersion:"v1",error:{code,message,details,retryable}}`.

All 10 unbounded HTTP collections return
`{items,nextCursor}`; 8 of them are exposed through MCP
with the same page contract. The default limit is 100 and the accepted range is
1–1,000. Cursors are opaque, bound to the operation and active filters, and
continue after a stable item ID. Invalid, stale, cross-operation, and
cross-filter cursors return `VALIDATION_ERROR`.

Diagnostic exports follow `diagnostic-export-v1`. Credential
fields and recognizable credential strings are always removed. Transcript,
source, and path fields are excluded by default and appear only after explicit
sensitive-detail opt-in.

## HTTP v1

The core binds to `127.0.0.1` by default. 54 operations are public
to the loopback client and 6 credential/cloud-security operations
also require the per-launch desktop token. No durable-entity deletion operation
is exposed.

| Operation ID | Method | Path | Access | Revision required | Long-running |
| --- | --- | --- | --- | --- | --- |
| `analysis.getTranscript` | GET | `/v1/analysis/:episodeId/transcript` | public | false | false |
| `analysis.listArtifacts` | GET | `/v1/analysis/:episodeId/artifacts` | public | false | false |
| `analysis.localTranscriptionStatus` | GET | `/v1/analysis/local-transcription/status` | public | false | false |
| `analysis.ollamaStatus` | GET | `/v1/analysis/ollama/status` | public | false | false |
| `analysis.start` | POST | `/v1/analysis/start` | public | false | true |
| `analysis.startOllama` | POST | `/v1/analysis/ollama/start` | public | false | true |
| `analysis.startOpenAi` | POST | `/v1/analysis/openai/start` | public | false | true |
| `analysis.updateTranscript` | PUT | `/v1/analysis/:episodeId/transcript` | public | true | false |
| `assets.import` | POST | `/v1/assets/import` | public | false | false |
| `assets.list` | GET | `/v1/assets` | public | false | false |
| `candidates.acceptContentPackage` | PUT | `/v1/candidates/:id/content-package` | public | true | false |
| `candidates.generate` | POST | `/v1/candidates/generate` | public | false | false |
| `candidates.getContentPackage` | GET | `/v1/candidates/:id/content-package` | public | false | false |
| `candidates.list` | GET | `/v1/candidates` | public | false | false |
| `candidates.review` | POST | `/v1/candidates/:id/review` | public | true | false |
| `desktop.credentialRemoved` | POST | `/v1/desktop/credentials/:handle/removed` | desktop-token | false | false |
| `desktop.grantCloudAuthorization` | POST | `/v1/desktop/cloud-authorizations` | desktop-token | false | false |
| `desktop.listCloudAuthorizations` | GET | `/v1/desktop/cloud-authorizations` | desktop-token | false | false |
| `desktop.revokeCloudAuthorization` | POST | `/v1/desktop/cloud-authorizations/:id/revoke` | desktop-token | false | false |
| `desktop.synchronizeCredentials` | POST | `/v1/desktop/credentials/synchronize` | desktop-token | false | false |
| `desktop.validateCloudAuthorization` | POST | `/v1/desktop/cloud-authorizations/validate` | desktop-token | false | false |
| `jobs.cancel` | POST | `/v1/jobs/:id/cancel` | public | false | false |
| `jobs.list` | GET | `/v1/jobs` | public | false | false |
| `library.configureWatchedFolder` | POST | `/v1/library/watched-folders/configure` | public | false | false |
| `library.confirmRelink` | POST | `/v1/library/episodes/:id/relink/confirm` | public | false | false |
| `library.getEpisode` | GET | `/v1/library/episodes/:id` | public | false | false |
| `library.importPaths` | POST | `/v1/library/import` | public | false | false |
| `library.listEpisodes` | GET | `/v1/library/episodes` | public | false | false |
| `library.listWatchedFolders` | GET | `/v1/library/watched-folders` | public | false | false |
| `library.relinkSource` | POST | `/v1/library/episodes/:id/relink` | public | false | false |
| `library.rescanWatchedFolder` | POST | `/v1/library/watched-folders/:id/rescan` | public | false | true |
| `providers.getStatus` | GET | `/v1/providers/status` | public | false | false |
| `providers.listCapabilities` | GET | `/v1/providers/capabilities` | public | false | false |
| `renders.list` | GET | `/v1/renders` | public | false | false |
| `renders.preflight` | POST | `/v1/renders/preflight` | public | true | false |
| `renders.retry` | POST | `/v1/renders/:renderId/retry` | public | false | true |
| `renders.start` | POST | `/v1/renders/start` | public | true | true |
| `renders.validate` | POST | `/v1/renders/validate` | public | false | false |
| `schedule.draft` | POST | `/v1/schedule/draft` | public | true | false |
| `schedule.getRules` | GET | `/v1/schedule/rules` | public | false | false |
| `schedule.list` | GET | `/v1/schedule` | public | false | false |
| `schedule.markPublished` | POST | `/v1/schedule/:id/published` | public | true | false |
| `schedule.move` | POST | `/v1/schedule/:id/move` | public | true | false |
| `schedule.updateRules` | PUT | `/v1/schedule/rules` | public | after-initial-creation | false |
| `shorts.addManualCropControl` | POST | `/v1/shorts/:id/layers/:layerId/crops/manual` | public | true | false |
| `shorts.approve` | POST | `/v1/shorts/:id/approve` | public | true | false |
| `shorts.create` | POST | `/v1/shorts` | public | false | false |
| `shorts.get` | GET | `/v1/shorts/:id` | public | false | false |
| `shorts.moveManualCropControl` | PUT | `/v1/shorts/:id/layers/:layerId/crops/manual/:controlId` | public | true | false |
| `shorts.reanalyzeCrops` | POST | `/v1/shorts/:id/crops/reanalyze` | public | true | true |
| `shorts.removeManualCropControl` | DELETE | `/v1/shorts/:id/layers/:layerId/crops/manual/:controlId` | public | true | false |
| `shorts.updateAudio` | PUT | `/v1/shorts/:id/audio` | public | true | false |
| `shorts.updateCaptions` | PUT | `/v1/shorts/:id/captions` | public | true | false |
| `shorts.updateComposition` | PUT | `/v1/shorts/:id/composition` | public | true | false |
| `shorts.updateCopy` | PUT | `/v1/shorts/:id/copy` | public | true | false |
| `shorts.updateTimeline` | PUT | `/v1/shorts/:id/timeline` | public | true | false |
| `system.health` | GET | `/v1/health` | public | false | false |
| `templates.clone` | POST | `/v1/templates/:id/clone` | public | false | false |
| `templates.list` | GET | `/v1/templates` | public | false | false |
| `templates.update` | PUT | `/v1/templates/:id` | public | true | false |

## MCP v1

Every MCP tool calls its mapped HTTP operation and returns the same versioned
domain envelope. The complete concrete request and response JSON Schemas live
in [mcp-v1-tools.json](mcp-v1-tools.json). Security grants and credential
management intentionally remain desktop-only.

| Tool | HTTP operation | Method | Kind |
| --- | --- | --- | --- |
| `analysis.get_transcript` | `analysis.getTranscript` | GET | read |
| `analysis.start` | `analysis.start` | POST | write |
| `analysis.update_transcript` | `analysis.updateTranscript` | PUT | write |
| `assets.import` | `assets.import` | POST | write |
| `assets.list` | `assets.list` | GET | read |
| `candidates.generate` | `candidates.generate` | POST | write |
| `candidates.list` | `candidates.list` | GET | read |
| `candidates.review` | `candidates.review` | POST | write |
| `jobs.cancel` | `jobs.cancel` | POST | write |
| `jobs.list` | `jobs.list` | GET | read |
| `library.configure_watched_folder` | `library.configureWatchedFolder` | POST | write |
| `library.get_episode` | `library.getEpisode` | GET | read |
| `library.import_paths` | `library.importPaths` | POST | write |
| `library.list_episodes` | `library.listEpisodes` | GET | read |
| `library.list_watched_folders` | `library.listWatchedFolders` | GET | read |
| `library.relink_source` | `library.relinkSource` | POST | write |
| `providers.get_status` | `providers.getStatus` | GET | read |
| `providers.list_capabilities` | `providers.listCapabilities` | GET | read |
| `renders.list` | `renders.list` | GET | read |
| `renders.preflight` | `renders.preflight` | POST | write |
| `renders.retry` | `renders.retry` | POST | write |
| `renders.start` | `renders.start` | POST | write |
| `renders.validate` | `renders.validate` | POST | write |
| `schedule.draft` | `schedule.draft` | POST | write |
| `schedule.get` | `schedule.list` | GET | read |
| `schedule.get_rules` | `schedule.getRules` | GET | read |
| `schedule.mark_published` | `schedule.markPublished` | POST | write |
| `schedule.move` | `schedule.move` | POST | write |
| `schedule.update_rules` | `schedule.updateRules` | PUT | write |
| `shorts.add_manual_crop` | `shorts.addManualCropControl` | POST | write |
| `shorts.approve` | `shorts.approve` | POST | write |
| `shorts.create` | `shorts.create` | POST | write |
| `shorts.get` | `shorts.get` | GET | read |
| `shorts.move_manual_crop` | `shorts.moveManualCropControl` | PUT | write |
| `shorts.reanalyze_crops` | `shorts.reanalyzeCrops` | POST | write |
| `shorts.remove_manual_crop` | `shorts.removeManualCropControl` | DELETE | write |
| `shorts.update_audio` | `shorts.updateAudio` | PUT | write |
| `shorts.update_captions` | `shorts.updateCaptions` | PUT | write |
| `shorts.update_composition` | `shorts.updateComposition` | PUT | write |
| `shorts.update_copy` | `shorts.updateCopy` | PUT | write |
| `shorts.update_timeline` | `shorts.updateTimeline` | PUT | write |
| `templates.clone` | `templates.clone` | POST | write |
| `templates.list` | `templates.list` | GET | read |
| `templates.update` | `templates.update` | PUT | write |
