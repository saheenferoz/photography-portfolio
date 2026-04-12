https://saheenferoz.github.io/photography-portfolio/

## Adding a photo

1. From the repo root:

   ```bash
   python3 upload_photo.py /path/to/image.JPG --date 2026-04-12 --location "Yosemite National Park"
   ```

   Add `--caption "…"` if you want. Naming and thumbnails are handled by the script; see `upload_photo.py` for rules.

2. Commit and push (including `photos.json`, `photos/`, and `photos/thumbs/`).

If you edit `photos.json` by hand, run `python3 sort_photos_json.py` before committing.
