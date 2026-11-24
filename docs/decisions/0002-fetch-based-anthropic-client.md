# 0002. Anthropic client uses fetch, not the SDK

Status: accepted.

The live client in `shared/ts/src/anthropic.ts` calls the Messages API with `fetch`. This keeps
runtime dependencies to `zod` only, makes the client trivially fakeable (inject `fetch`), and
keeps every piece's dependency review small. Cost: we maintain a small request/response shape
ourselves. Revisit if we need streaming or tool use.

The client reports HTTP status on failure and never echoes response bodies or the API key.
