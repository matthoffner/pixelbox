---
name: pixelbox-window-screenshot
description: |
  Capture the actual current Pixelbox window while iterating on UI work. Use this
  instead of guessing from CSS diffs when the app is already hot reloading inside
  Pixelbox.
---

# Pixelbox Window Screenshot

Use this skill when:
- a project is being edited inside Pixelbox
- the preview is already live in the current window
- you need to verify visual changes against the real rendered result

## Workflow

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

## Outputs

- Screenshot: `/Users/matthoffner/workspace/pxcode/screenshots/current-window.png`
- Metadata: `/Users/matthoffner/workspace/pxcode/screenshots/current-window.json`

## Notes

- macOS only
- requires Screen Recording permission for the terminal/app invoking `screencapture`
- requires Accessibility permission for `System Events` to read the front window id
