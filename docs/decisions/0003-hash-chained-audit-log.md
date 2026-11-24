# 0003. Audit log is hash-chained JSONL

Status: accepted.

The spec requires an append-only JSONL log with timestamp, actor, action, input hash and
decision. We add a `prevHash` field (SHA-256 of the previous line). Editing or deleting a line
in the middle breaks the chain and `verifyAuditChain` reports the first broken line.

Limits: truncating the tail is not detectable from the file alone, and anyone who can rewrite
the whole file can recompute the chain. Ship logs to storage the writer cannot modify (for
example a workflow artifact or an object-locked bucket) when tamper evidence matters.
The input itself is never stored, only its hash.
