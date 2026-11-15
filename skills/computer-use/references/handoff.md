# Physical handoff boundary

Read this when the task asks a human to press Esc, take over, or re-arm.

For a task that asks a human to press Esc, take over, or re-arm, perform at
most one bounded input attempt that reaches the requested handoff state. Then
stop issuing controller calls and wait for the human's report. Do not poll,
repeat `run`, retry a drag, or start another batch while waiting. A completed
drag is not evidence that the human pressed Esc; a `control_stopped` reply is
not evidence of who stopped it. Resume only after the human explicitly reports
the physical action, and take a fresh observation before any next input.
