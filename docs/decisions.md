# Architecture Decisions

## Firebase Functions legacy code

**Status: proposed; approval required before removal.**

The current deployment configuration does not deploy Firebase Functions: `firebase.json` only points to Firestore rules, and the application API is served by Cloudflare Workers/Pages Functions. A workspace search found no active runtime or deployment references to `functions/` outside the legacy directory itself (excluding archival scripts and backup material).

Proposal: remove the legacy `functions/` directory and its separate package manifest after explicit approval. Keep it in the repository until that approval is given.
