# Launch film (beta.5)

`launch-film.mp4` (40 s, 1280×720, with sound) and `launch-film.gif` (the first
33 s, silent, 640 px) come from one real screen recording, made on 13 November
2026.

## What was recorded
- The Antigravity Agent Manager App running Gemini 4 Hydrogen at High effort,
  with this project's beta.5 build `f5a02d01` installed through the sidecar.
- One prompt: open the Upscaly 1.1.0 desktop app, add a photo with the app's
  own open button, keep the saved settings, upscale it and report the output
  path.
- The agent launched Upscaly, clicked **Choose files**, filled in the native
  file dialog, started the upscale and waited for it. The input was 736×1308
  and the output 2944×5232 (4×, PNG). Upscaly reported "Done in 25 s".
- The blue edge glow, control bar and cursor are the real native UI, captured
  with the bar's "Show glow and controls in screen recordings" option on.

## How it was edited
- **Built with HyperFrames:** titles, cuts and the before/after split were added
  in HyperFrames, using the recording, the real input photo and the real output.
- **Speed:** clips play at real speed except the upscale countdown, which is
  shown at 8× and labelled on screen.
- **Not shown:** about five minutes of the run are left out. In that time the
  agent cleared a photo left in Upscaly's queue from an earlier run, and
  re-armed after a Stop from an earlier attempt.
- **Real numbers:** the "Original 736×1308, enlarged" side of the split is the
  real input scaled up by the browser; the other side is the real 2944×5232
  output.
- **Privacy:** in the file dialog, folder names and the other thumbnails are
  blurred. The Antigravity model picker and logo are cropped out.
- **Honest timing:** the film is not a speed benchmark. The same kind of task
  takes several minutes end to end today; see
  [#74](https://github.com/shayann07/antigravity-computer-use/issues/74).

## Rights and credits
- **Photos and recording:** the owner holds the rights to the photo and the
  screen recording.
- **Music:** "Upbeat124" by BaDoink, CC0 1.0 (public domain dedication).
  Source: https://freesound.org/people/BaDoink/sounds/573986
- **Sound effects:** click, pop and whoosh sounds from Pixabay, under the
  Pixabay Content License, used inside this video.
- **Not affiliated:** no Google or Antigravity logos are used. This project is
  not affiliated with or endorsed by Google.
