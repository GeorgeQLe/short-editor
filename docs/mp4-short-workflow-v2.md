# MP4-to-Short workflow (MCP v2)

The v2 MCP entrypoint exposes the complete, unchanged v1 granular tool set plus five
workflow tools listed in `mcp-v2-tools.json`.

`workflows.create_short_from_mp4` persists a workflow before importing the source. It
defaults to `review_required` and pauses at `awaiting_review` with stable Episode,
Candidate, Short, and composition data. Call `workflows.resume` with the current
revision and `approve_draft` to preflight and render. `auto_approve` must be explicit;
it continues through validation, rendering, and optional export without review.

Workflow progress and job IDs survive process restarts. Failures retain their stage,
safe message, and retryability. Retry and approval use optimistic workflow revisions.
Cancellation retains every project and artifact. Export accepts only validated,
successful renders, requires an existing destination directory, rejects path-bearing
filenames, and uses exclusive creation so existing files are never overwritten.

Graphics are typed composition layers with the fixed `hook`, `lower_third`, and
`end_card` presets. Timing and copy are bounded by schemas; placement, easing, colors,
fonts, and FFmpeg construction remain application-owned and snapshot-derived. The
renderer executes no caller-authored code or filter expressions. Inter is packaged
with the application. Static v1 compositions remain valid.

Remotion is intentionally not included. If future authored animation requirements
outgrow these native presets, Motion Canvas is the preferred MIT-licensed candidate
for a separately reviewed renderer extension.
