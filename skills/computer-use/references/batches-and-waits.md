# Bounded batches and waits

Use the installed command prefix with these suffixes. Substitute observed
handles/frames/names; never guess future indexes across a layout change.

```text
run --hwnd H --observation-id F --reason TEXT --step click --name JPEG --role Button --risk routine --step click --name 'Close settings' --role Button --risk routine
run --hwnd H --observation-id F --reason TEXT --step click --index N --risk routine --step file_dialog --path FILE --action open --entry-method clipboard --settle-ms 600
```

Root owner/frame/reason precede the first step. At most eight steps run
sequentially; each uses fresh observed state. Failure stops the rest without
replay. The last step returns an image by default; `--no-image` omits it.
Save can similarly combine the observed Save click and an already-opening
picker, using `--action save`. Discover unfamiliar shapes with one `describe`.

For processing:

```text
wait --hwnd H --until 'ACTUAL EXPECTED TEXT' --timeout-ms 30000 --reason TEXT
wait_change --hwnd H --observation-id F --timeout-ms 30000 --reason TEXT
```

Use actual observed labels. `--abort-on 'Failed,Cancelled'` checks known failure
labels; failure wins if success also appears. Do not combine it with `--query`,
which could hide failures. Known incomplete trees stop failure-aware waits;
even an unfiltered tree may omit inaccessible/offscreen errors. Verify the app.

A step wait may follow input; combined wait budgets are at most 30 seconds.
An unmet/aborted/incomplete wait skips later input. Intermediate text waits
omit screenshots when followed by accessible actions. Final waits capture an
image by default; a section query defaults to text only. Pixel actions after
a wait in the same batch are refused because that image has not been viewed:
end the batch and inspect a fresh image before pixel input.

`wait_change` compares the current frame's query/node view and returns a fresh
text-only frame. Known truncation cannot prove change. Canvas-only changes may
be inaccessible, and unrelated changes may occur. A change is not success.

The polling budget is not a hard deadline for an in-flight provider/capture.
Do not start another request until delivery is known. Timeout means inspect,
never repeat the submission. A known output may be watched with ordinary
authorized file tools under a bounded deadline, then checked independently
and against the GUI. Preserve failures and unknown delivery honestly.
