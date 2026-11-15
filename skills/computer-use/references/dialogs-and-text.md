# Text entry and file dialogs

Read this before typing long text, pasting, exact Unicode work or driving an Open/Save picker.

`type` is limited to 400 UTF-16 units. Explicit `paste` accepts up to 20,000 and requires an observed editor target; it preserves supported clipboard formats and refuses if preservation is impossible.
`clipboard` is for intentionally reading/leaving clipboard contents. Review clipboard access under the installed policy.

For exact Unicode text, preserve the original string or an authorized UTF-8
source file; do not reconstruct emoji or mixed-script text from visible glyphs.
Joiners (U+200D/U+200C), combining marks and emoji modifiers are content. Verify
the saved text against the original code points, allowing only explicitly
requested line-ending/encoding differences. A screenshot, byte count or hex dump
without comparison does not prove exact content. Report a mismatch honestly.

If the app opens with leftover state that blocks the requested task and holds nothing the user could lose, such as an old processing queue, use its single visible clear control once, then continue.
If the leftover could be the user's work (an unsaved document, a half-filled form), do not clear it: say what you found and stop. Do not hunt through menus to tidy an app.

Click the actual Open/Browse/Save control first. In a batch, put `file_dialog` only behind the app's visible, labelled Open/Browse/Choose control; never behind a guessed control, such as an unlabelled `+` or a menu you have not seen open.
If you are unsure the control opens a picker, click it alone, look, then fill the dialog. `file_dialog` fills an **already-open picker** using the **owner app's hwnd and fresh owner frame**, exact path and `--action open`/`save`.
Prefer explicit `--entry-method clipboard` for authorized temporary clipboard use: atomic filename entry must match readback before confirmation. The compatibility keyboard method can lose characters through Windows text services;
`file_dialog_path_mismatch` means confirmation was refused. Never blindly send Enter/replay. Owner screenshots can omit a separate modal; discover and inspect the actual dialog if needed, while keeping file_dialog bound to its owner.
Dialog closure alone does not prove import/save completed.

Examples only: replace handles, frames, indexes and paths with values from the current task.

```powershell
DESKTOP_COMMAND run --hwnd 123 --observation-id FRAME --reason 'Choose observed settings' --step click --name JPEG --role Button --risk routine --step click --name 'Close settings' --role Button --risk routine
DESKTOP_COMMAND run --hwnd 123 --observation-id FRAME --reason 'Import the sample' --step click --index 7 --risk routine --step file_dialog --path 'D:\Samples\cat.jpg' --action open --entry-method clipboard --settle-ms 600
DESKTOP_COMMAND run --hwnd 123 --observation-id FRAME --reason 'Save the document' --step click --index 8 --risk routine --step file_dialog --path 'D:\Samples\result.txt' --action save --entry-method clipboard --settle-ms 600
```
