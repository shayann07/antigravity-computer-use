# Observe, act, verify

H/F/N are real returned handles, one-use frame IDs and indexes. Every action
consumes its frame and returns a new tree/frame. Reuse that reply directly;
an extra snapshot is unnecessary unless the state or visual evidence requires it.

Open the actual `image.path` in the host image viewer at visual checkpoints.
Agent Manager's `read_file` can view JPEGs. JSON, a reconstructed image or an
accessibility label is not visual verification; report an unavailable viewer.
Pixel coordinates require a fresh viewed image. The runtime maps screenshot
pixels to the desktop; do not manually rescale them or guess unseen pixels.

Prefer an observed index or exact unique name/role/automation-id. Names resolve
only against the bounded native snapshot for that frame, not a live unbounded
search. Ambiguous/missing controls refuse: observe rather than guess.

`snapshot --hwnd H --query 'Export format' --reason TEXT` returns a matching
section and its children, tree-only by default. Add `--image` for visual work.
Queries are literal substrings, not regex. `--max-nodes 500` requests more rows;
`--settle-ms 600` allows a known animation to settle, at most 2000 ms.

`tree_incomplete:true` means known omissions in native/rendered/terminal output,
not proof all errors or controls were seen. Brief replies keep whole head/tail
rows and original indexes within a terminal budget. `terminal_tree_truncated`
marks that display reduction. Query one relevant section rather than repeating
full captures. A partial tree may still contain a valid specific target; it
cannot establish absence of a failure or successful completion by itself.

An oversized non-tree reply may return `terminal_reply_incomplete:true` and
`terminal_reply_error`. Input may already have completed. Follow the retained
delivery evidence and inspect the app; never rerun input to obtain `--json`.
Intentional full CLI reads use `COMMAND --json ...` before execution; ordinary agent
tasks use brief named arguments. Do not create per-action plan/result files or
copy screenshots; the runtime already retains bounded receipts/images.

Clicks move the real animated pointer by default, even for named/index targets.
Only use `--physical false` when a control needs a semantic action; it may leave
the cursor stationary. `set_value`, invoke and other semantic actions need not
move it. Do not claim pointer motion from those operations.

`observe_pending`, `input_completed:true` or verification failure after launch
means discover the existing process, never relaunch blindly. Native worker
changes invalidate old frames. For testing, also read
[application verification](app-verification.md).
