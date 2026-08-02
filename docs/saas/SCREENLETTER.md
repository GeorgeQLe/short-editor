# Screenletter hosted integration

Screenletter is a separate iOS capture product that uses SiftCut Cloud for
identity, tenancy, upload, ingest, editing, rendering, and private delivery.
It does not change SiftCut Desktop's local-only source-in-place contract.

## Implemented contract

- Hosted projects expose `kind` and `origin`; existing projects migrate to
  `episode_to_shorts` and `siftcut_web`.
- `screenletter_recordings` owns the stable UUID share token, share revision,
  recording state, and source/proxy/published asset references.
- Creation inserts the Screenletter project and recording in one tenant-scoped
  transaction.
- Anonymous share lookup is limited to ready, nondeleted recordings and returns
  only the currently selected private object to the API signer.
- Publish and rollback are compare-and-swap mutations. Each successful request
  increments `share_revision` once; stale requests fail with HTTP 409.
- Abuse reports enter through a narrow security-definer function. Raw reporter
  addresses are not persisted.
- `screen-demo-v1` is the vertical composition preset for fit/fill screen video,
  safe areas, captions, automatic/manual crop tracks, and original source audio.
- New Clerk users receive an idempotently named personal Screenletter
  organization. Clerk organization and membership webhooks remain the canonical
  local synchronization source.

## Production gate

`ScreenletterService` and its routes are deliberately dependency-injected.
Do not enable them in the hosted server until M3 supplies the production
`ArtifactStorage` implementation for S3 multipart operations and short-lived
CloudFront signing. An unsigned S3 URL, public bucket, proxy copy, or separate
media vendor is not an acceptable fallback.

The iOS client may run against a mock service before this gate. Production
configuration requires Clerk, the SiftCut API/editor base URLs, the registered
App Group, and an invited physical-device beta.
