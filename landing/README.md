# Pixelbox Landing

This directory is the standalone marketing site for Pixelbox.

## Deploy on Vercel

1. Import the `matthoffner/pixelbox` repo into Vercel.
2. Set the project root directory to `landing`.
3. Leave the framework preset as `Other`.
4. No build command is required.
5. No output directory is required.

## Local preview

```bash
cd landing
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173
```

## Updating the changelog

Edit `changelog.json` and add a new entry at the top of the `entries` array.
