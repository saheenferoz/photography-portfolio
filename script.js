(function () {
  let photos = [];
  let currentIndex = 0;

  const grid = document.getElementById("photo-grid");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxCaption = document.getElementById("lightbox-caption");
  const lightboxLocationText = document.getElementById("lightbox-location-text");
  const lightboxLocation = document.getElementById("lightbox-location");
  const lightboxDate = document.getElementById("lightbox-date");
  const closeBtn = document.getElementById("lightbox-close");
  const prevBtn = document.getElementById("lightbox-prev");
  const nextBtn = document.getElementById("lightbox-next");

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function renderProfile(profile) {
    document.getElementById("avatar").src = profile.avatar;
    document.getElementById("avatar").alt = profile.name;
    document.getElementById("profile-name").textContent = profile.name;
    document.getElementById("profile-tagline").textContent = profile.tagline;
    document.title = profile.name + " — Photography";
  }

  function renderGrid(photoList) {
    grid.innerHTML = "";
    photoList.forEach(function (photo, index) {
      const item = document.createElement("div");
      item.className = "grid-item";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-label", photo.caption || "Photo " + (index + 1));

      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = photo.caption || "";
      img.loading = "lazy";

      function markImageLoaded() {
        item.classList.add("is-loaded");
      }
      img.addEventListener("load", markImageLoaded);
      img.addEventListener("error", markImageLoaded);
      if (img.complete && img.naturalWidth > 0) {
        markImageLoaded();
      }

      item.appendChild(img);
      item.addEventListener("click", function () {
        openLightbox(index);
      });
      item.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openLightbox(index);
        }
      });
      grid.appendChild(item);
    });
  }

  function openLightbox(index) {
    currentIndex = index;
    updateLightboxContent();
    lightbox.classList.add("active");
    document.body.classList.add("lightbox-open");
    closeBtn.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove("active");
    document.body.classList.remove("lightbox-open");
    const items = grid.querySelectorAll(".grid-item");
    if (items[currentIndex]) items[currentIndex].focus();
  }

  function navigate(direction) {
    currentIndex =
      (currentIndex + direction + photos.length) % photos.length;
    updateLightboxContent();
  }

  function updateLightboxContent() {
    const photo = photos[currentIndex];
    lightboxImg.src = photo.src;
    lightboxImg.alt = photo.caption || "";
    var captionText = (photo.caption || "").trim();
    lightboxCaption.textContent = captionText;
    lightboxCaption.classList.toggle("is-empty", !captionText);

    if (photo.location) {
      lightboxLocation.style.display = "inline-flex";
      lightboxLocationText.textContent = photo.location;
    } else {
      lightboxLocation.style.display = "none";
    }

    lightboxDate.textContent = formatDate(photo.date);

    prevBtn.style.display = photos.length > 1 ? "block" : "none";
    nextBtn.style.display = photos.length > 1 ? "block" : "none";
  }

  closeBtn.addEventListener("click", closeLightbox);
  prevBtn.addEventListener("click", function () { navigate(-1); });
  nextBtn.addEventListener("click", function () { navigate(1); });

  lightbox.addEventListener("click", function (e) {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener("keydown", function (e) {
    if (!lightbox.classList.contains("active")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") navigate(-1);
    if (e.key === "ArrowRight") navigate(1);
  });

  fetch("photos.json")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var cols = Math.max(1, Math.min(4, data.gridColumns || 3));
      document.documentElement.style.setProperty("--cols", cols);
      document.documentElement.style.setProperty("--cols-cfg", cols);

      renderProfile(data.profile);
      photos = data.photos;
      renderGrid(photos);
    })
    .catch(function (err) {
      console.error("Failed to load photos.json:", err);
      grid.innerHTML =
        '<p style="color:var(--text-secondary);text-align:center;grid-column:1/-1;padding:40px;">Could not load photos. Make sure photos.json exists.</p>';
    });
})();
