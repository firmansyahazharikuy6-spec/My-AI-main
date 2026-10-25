# Architecture Decisions

## Firebase Functions legacy code

**Status: proposed; approval required before removal.**

The current deployment configuration does not deploy Firebase Functions: `firebase.json` only points to Firestore rules, and the application API is served by Cloudflare Workers/Pages Functions. A workspace search found no active runtime or deployment references to `functions/` outside the legacy directory itself (excluding archival scripts and backup material).

Proposal: remove the legacy `functions/` directory and its separate package manifest after explicit approval. Keep it in the repository until that approval is given.

## Split the frontend application entry point

**Status: backlog; defer until feature-level integration tests exist.**

`js/app.js` is the frontend orchestration entry point. Splitting it into feature modules without tests that cover the current initialization, event wiring, and cross-feature behavior would make regressions difficult to detect. Add targeted integration coverage for those seams first; then split the entry point incrementally by feature while preserving the existing UI behavior.
