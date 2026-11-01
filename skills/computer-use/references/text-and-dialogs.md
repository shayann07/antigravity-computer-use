# Text and file dialogs

`type` accepts at most 400 UTF-16 units. Explicit `paste` accepts up to 20,000
into an observed editor; it preserves supported clipboard formats and refuses
when preservation is impossible. `clipboard` intentionally reads/leaves content
and must follow the installed permission policy.

Use the exact original Unicode string or authorized UTF-8 text file (`--text-file`).
Do not reconstruct emoji or mixed scripts from visible glyphs. U+200D/U+200C,
combining marks and emoji modifiers are content. Verify saved code points
against the original, allowing only requested encoding/line-ending differences.
A screenshot, byte count or hex dump without comparison does not prove equality.

```text
set_value --hwnd H --observation-id F --index N --text VALUE --risk routine --reason TEXT
file_dialog --hwnd OWNER --observation-id F --path FILE --action open --entry-method clipboard --reason TEXT
```

Click the real Open/Browse/Save control first. `file_dialog` fills an already-open
picker using the OWNER app's handle and fresh owner frame, exact path and
`--action open` or `save`. Clipboard entry is explicit temporary clipboard use:
the filename must match readback before confirmation. Compatibility keyboard
entry can lose characters through Windows text services; path mismatch means
confirmation was refused. Never blindly send Enter or replay the operation.

Owner screenshots can omit a separate modal. Discover/inspect the actual dialog
when needed, while keeping file_dialog bound to its owner. Dialog closure alone
does not prove import/save completed. Verify the resulting GUI and artifact.
