# 0005. Lambda audit records are not hash-chained

Status: accepted, pending maintainer review.

The shared `AuditLogger` writes a hash-chained JSONL file. The secrets guard's Lambda cannot use it:
a Lambda has no durable local file, and parallel invocations would fork a chain.

Instead each record is a DynamoDB item written with a conditional put, so an existing record cannot
be overwritten, and the table is retained when the stack is deleted. The record has the same
top-level fields as the shared `AuditRecord` (timestamp, actor, action, inputHash, decision, detail)
without `prevHash`. It is typed as `LeakAuditEntry` to keep the two shapes from being confused.

Limits: someone with write access to the table can still delete records. For stronger evidence,
enable point-in-time recovery or stream the table to storage the writer cannot modify. The local
pre-commit log is chained and can be checked with `verifyAuditChain`; the Lambda records cannot.
