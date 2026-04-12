https://saheenferoz.github.io/photography-portfolio/

## Gallery (GitHub)

Use **`main`**.

### Add

1. Put the image in **`photos/`** with a name like **`2026-04-12_Yosemite_National_Park.JPG`**: `YYYY-MM-DD`, then the location with **underscores** instead of spaces. If you already have that date and location, use **`_2`**, **`_3`**, … before the extension (e.g. `…_Park_2.JPG`).
2. **Commit and push** (GitHub’s “Add file” flow is fine).  
   **GitHub Actions** then updates **`photos.json`**, creates **`photos/thumbs/<same filename>`**, re-sorts the list, and pushes a second commit with **`[skip ci]`**. Captions are empty until you edit them in **`photos.json`**.

### Remove

1. Delete the file from **`photos/`**.
2. **Commit and push.**  
   Actions removes the matching **`photos.json`** entry and deletes **`photos/thumbs/<same filename>`**.

If the filename does not follow the pattern above, Actions skips that file (check the workflow log).
