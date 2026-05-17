---
name: pixelbox-window-screenshot
description: |
  Capture the actual current Pixelbox window while iterating on UI work, then
  loop through screenshot review and code edits until the rendered result matches
  the goal. Use this instead of guessing from CSS diffs when the app is already
  hot reloading inside Pixelbox.
---

# Pixelbox Window Screenshot

Use this skill when:
- a project is being edited inside Pixelbox
- the preview is already live in the current window
- you need to verify visual changes against the real rendered result

## One-Off Capture

1. Make the Pixelbox window frontmost.
2. Run:

```bash
bash /Users/matthoffner/workspace/pxcode/scripts/capture-current-window.sh \
  /Users/matthoffner/workspace/pxcode/screenshots/current-window.png \
  Pixelbox
```

3. To capture only the embedded preview viewport, run:

```bash
bash /Users/matthoffner/workspace/pxcode/scripts/capture-current-window.sh \
  /Users/matthoffner/workspace/pxcode/screenshots/current-preview.png \
  Pixelbox \
  preview
```

4. Inspect the generated image artifact and iterate.
5. Re-run after each meaningful UI change.

## Visual Iteration Loop

Use this loop for frontend polish, layout matching, terminal chrome tweaks, and
any task where the rendered result matters more than the static code diff.

1. Define the visual target in one sentence before editing. Example: "Make the native terminal match the translucent xterm look with no corner bracket helpers."
2. Capture a baseline screenshot. Prefer `preview` scope for embedded web work and `window` scope for native Pixelbox chrome.
3. Inspect the screenshot directly with the image viewer before changing code.
4. Make the smallest code change that should move the screenshot toward the target.
5. Wait for the app's normal hot-reload path instead of restarting unless the change requires it.
6. Capture a new numbered screenshot:

```bash
bash /Users/matthoffner/workspace/pxcode/scripts/capture-current-window.sh \
  /Users/matthoffner/workspace/pxcode/screenshots/visual-loop-01.png \
  Pixelbox \
  preview
```

7. Compare the latest screenshot to the target, then either patch again or stop.
8. Stop when the screenshot satisfies the target or when the remaining gap needs product input.

## Loop Rules

- Do not rely on code inspection alone for visual tasks once this skill is active.
- Keep each screenshot as evidence; do not overwrite loop artifacts unless the user asked for a single current image.
- Prefer `preview` scope for landing pages and project apps because it removes Pixelbox chrome from the review.
- Prefer `window` scope when the task is about Pixelbox itself, native terminal styling, chrome, panels, or app composition.
- If capture fails because Pixelbox is not frontmost, make Pixelbox frontmost and retry once before changing implementation.
- If `preview` scope says the preview region is not visible, switch to `window` scope or open the preview panel before continuing.

## Outputs

- Screenshot: `/Users/matthoffner/workspace/pxcode/screenshots/current-window.png`
- Metadata: `/Users/matthoffner/workspace/pxcode/screenshots/current-window.json`
- Loop screenshots: `/Users/matthoffner/workspace/pxcode/screenshots/visual-loop-*.png`
- Loop metadata: `/Users/matthoffner/workspace/pxcode/screenshots/visual-loop-*.json`

## Notes

- macOS only
- requires Screen Recording permission for the terminal/app invoking `screencapture`
- requires Accessibility permission for `System Events` to read the front window id
