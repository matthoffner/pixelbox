---
name: pixelbox-video-review
description: |
  Analyze Pixelbox visual-loop recordings after Playwright or screenshot-loop
  runs. Use this when a user asks whether a recorded Pixelbox video proves that
  a UI workflow, screenshot loop, preview resize, terminal behavior, or visual
  change actually worked.
---

# Pixelbox Video Review

Use this skill when:
- a Pixelbox `.webm`, `.mp4`, or recorded visual-loop artifact exists
- the user asks whether the video demonstrates that something works
- the answer should be based on frame inspection, not only test logs

## Inputs

- Video path, usually under `/Users/matthoffner/workspace/pxcode/screenshots/`
- Optional expected behavior, such as "panel minimizes", "preview region updates",
  "Codex relaunch appears", or "terminal accepts keyboard input"
- Optional sibling artifacts such as `visual-loop-01.png`, metadata JSON, or test
  output JSON

## Workflow

1. Inspect video metadata:

```bash
ffprobe -v error \
  -show_entries format=duration,size \
  -show_entries stream=codec_name,width,height,nb_frames,r_frame_rate \
  -of json \
  /path/to/video.webm
```

2. Extract representative frames. Prefer at least start, middle, and end. If the
   video is short, use frame numbers; if it is longer, use timestamps.

```bash
mkdir -p /path/to/artifact-dir/frames
ffmpeg -y -i /path/to/video.webm \
  -vf "select='eq(n,0)+eq(n,20)+eq(n,45)'" \
  -fps_mode passthrough \
  /path/to/artifact-dir/frames/frame-%02d.png
```

3. View the extracted frames with the image viewer before answering.
4. Compare the frames against the expected behavior.
5. Check sibling screenshots or metadata when they clarify state changes that are
   hard to infer visually.
6. Report a direct verdict: `works`, `partially works`, or `does not prove it`.

## What To Look For

- The video is valid, has a non-zero duration, and has the expected dimensions.
- The important UI state appears in the frames, not only in logs.
- The visual transition actually happens: panel opens/closes, preview resizes,
  terminal changes, app reloads, or screenshot region shifts.
- The recording does not hide a problem such as gray padding, blank screens,
  stale UI, clipped chrome, overlaid panels, or missing keyboard input.
- The test assertion matches what the viewer can see.

## Answer Format

Keep the response short and evidence-based:

- Verdict: one sentence.
- Evidence: video duration, dimensions, extracted frame observations, and any
  relevant metadata deltas.
- Caveat: explicitly say what the video does not prove.
- Link paths: include the video and frame/screenshot paths that support the
  conclusion.

## Rules

- Do not claim a workflow works from logs alone if the user asked about video.
- Do not overfit to a single frame when the behavior is temporal.
- If the video is too short or misses the critical moment, say it does not prove
  the behavior and recommend a better recording.
- If the final frame has gray padding from a fixed video canvas after viewport
  resize, call that out as a recording artifact unless the actual app surface is
  visibly broken.
- Prefer extracting frames into the same artifact directory as the video.
