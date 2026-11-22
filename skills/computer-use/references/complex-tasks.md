# Complex tasks

Use this for work that takes dozens or hundreds of steps: recreating an image in
a paint program, filling many rows of a form or spreadsheet, applying the same
edit to many items. The model is the slow part of desktop control: each model
turn costs seconds, while the controller runs a step in a fraction of that. So
think once, compute the steps with a script, and let `plan` run them.

## 1. Look and measure before planning

Never assume a size, a position or a colour. Measure it.

- **Coordinates.** Take one `snapshot --image --max-nodes 500` and read
  positions from that image: the work area (canvas, grid, list) and every
  control you will use. Scripts work in the same screenshot pixels as
  `click --x --y` and `drag --points`.
- **Scale.** Screenshot pixels are usually not the app's own pixels. Work out
  the ratio from something whose real size you know, such as a canvas reported
  as `1152 × 648px` but drawn 832 screenshot pixels wide.
- **Controls with values.** For sliders, read the value from the tree
  (`Slider "Size" {value=7}`). Focused sliders usually step by exactly one
  with arrow keys, and `home`/`end` jump to the ends. A thumb drag is linear
  in position: drag twice, read the value each time, and fit the line.
  Clicking a slider's middle changes its value, so drag the thumb instead.
- **Effects.** When the result depends on how the app renders (brush width,
  opacity, blending), do a small test, capture it, and measure the pixels. One
  test stroke per setting is cheap; a wrong assumption ruins hundreds of steps.

## 2. Plan offline, with a preview

Write a script (Python with Pillow and NumPy, or Node) that:

1. reads the goal (an image, a table, a list of edits);
2. turns it into steps using only the measurements above;
3. **renders a preview** of what those steps will produce, using the measured
   behaviour, and scores it against the goal. For images, a mean colour
   difference in Lab works well.

Improve the script until the preview is good. Iterating offline is free;
every step on screen costs time and budget. Keep the step count sensible:
several hundred is fine, and the preview score shows what each extra step buys.

For images in a paint program, what worked:

- **Use the whole canvas.** Rotate a portrait image to fit a landscape canvas,
  and rotate the canvas at the end.
- **Paint dark to light in nested layers.** Layer k covers every pixel at
  least as light as itself, so each area stays large and connected.
- **Fill each area with one zig-zag stroke per connected part,** kept inside
  the area. The row spacing must be under the measured brush width (about 0.6×)
  or bands show.
- **Mix colours with opacity.** A colour at opacity a over colour b gives
  a·colour + (1−a)·b. Choose each layer's swatch and opacity so it lands on the
  colour you want from the layer beneath. In Paint a single stroke does not
  darken where it overlaps itself, but separate strokes do.

## 3. Run it with `plan`

Write the steps as a JSON array of `run` steps (the same objects `--steps-file`
takes) and run, with DESKTOP_COMMAND being the installed command from SKILL.md:

```powershell
DESKTOP_COMMAND plan --hwnd H --observation-id F --plan-file D:\work\steps.json --ledger D:\work\ledger.json --reason 'Paint the image' --checkpoint-every 6
```

At each checkpoint, look at the returned image. If it is right, run the same
command again with the new `observation_id`. If something is wrong, stop and fix
the plan; a changed plan needs a new ledger file. Tell the human how many steps
there are and roughly how long they will take (about 1–1.5 s per step) before
starting a long plan.

If `plan` halts with `plan_batch_unconfirmed`, a batch was sent but its outcome
was never recorded (the CLI was interrupted). Take a snapshot and check whether
those steps took effect, then run the same command with `--resolve-pending
landed` (they did) or `--resolve-pending none` (they did not). Never guess.

## 4. Compare with the goal

When the plan finishes, capture the result and compare it with the goal in the
same way you scored the preview. A gap between the result and the preview means
your measurements were wrong; a gap between the preview and the goal means the
plan is wrong. If a second pass is worth it, plan only the worst regions, and
stop when the score stops improving.
