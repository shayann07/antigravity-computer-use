# README media

`launch-film.mp4` and `launch-film.gif` are the beta.5 launch film shown at the top of the README: a real recording edited in HyperFrames, with labelled speed-ups. Provenance, privacy edits and music credits are in [LAUNCH-FILM.md](LAUNCH-FILM.md).

`hero.svg` is original, editable vector branding for this repository. It is not
a screenshot or a product capability demonstration.

`social-preview.png` is the 1280×640 image for GitHub's repository social-preview
field, redrawn for the beta.5 launch on 13 November 2026. Its source is
`social-preview.html`: it uses the pointer shape and glow colours from
`server/native/DesktopVisuals.cs`, was rendered at 2× in headless Microsoft Edge
and scaled down with a Lanczos filter. Consolas and Segoe UI are Windows system
fonts and are not bundled.

The earlier Upscaly 1.0.9 recording, described in
[UPSCALY-DEMO.md](UPSCALY-DEMO.md), is a full-screen excerpt at normal speed,
with actual glow, controls and pointer input. The older v0.2.0 fixture has its
own historical notes in [REAL-DEMO.md](REAL-DEMO.md).

The PNGs are exported by the production `DesktopVisuals` renderer using `node scripts/render-visuals.mjs docs/media`. They are clean interface renders, not captures of the owner's desktop.

`demo.html` is an eight-second illustrated workflow composed with HyperFrames 0.8.186. Render with:

```text
npx hyperframes@0.8.186 render docs/media --composition demo.html --format gif --fps 15 --output docs/media/demo.gif
```

The animation illustrates the interaction sequence and changes between the native active and paused artwork. It is not evidence of live input execution. Real integration verification is documented in ../../VALIDATION.md. Artwork is from this project's MIT implementation. The separate real recording includes the owner-authorized sample photograph; raw desktop footage and credentials are excluded.

`upscaly-demo.mp4` and `upscaly-demo.gif` are the full-screen real stable-app retake described in [UPSCALY-DEMO.md](UPSCALY-DEMO.md).
