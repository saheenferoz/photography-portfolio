(function () {
  let photos = [];
  let currentIndex = 0;
  let lightboxLoadId = 0;

  const gallery = document.getElementById("photo-gallery");
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

  /** Optional per-photo `map` in JSON overrides the Google Maps name search. */
  function mapUrlFor(photo) {
    if (photo.map) return photo.map;
    return (
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(photo.location)
    );
  }

  /** Smaller file for the grid; optional per-photo `thumb` in JSON overrides. */
  function thumbSrcFor(photo) {
    if (photo.thumb) return photo.thumb;
    var s = photo.src;
    if (s.indexOf("photos/") === 0) {
      return "photos/thumbs/" + s.slice("photos/".length);
    }
    return s;
  }

  function renderProfile(profile) {
    document.getElementById("avatar").src = profile.avatar;
    document.getElementById("avatar").alt = profile.name;
    document.getElementById("profile-name").textContent = profile.name;
    document.getElementById("profile-tagline").textContent = profile.tagline;
    document.title = profile.name + " — Travel";
  }

  function yearFromPhoto(photo) {
    if (!photo.date) return "Unknown";
    return photo.date.slice(0, 4);
  }

  function groupPhotosByYear(photoList) {
    var groups = [];
    var byYear = new Map();
    photoList.forEach(function (photo, index) {
      var year = yearFromPhoto(photo);
      if (!byYear.has(year)) {
        var group = { year: year, items: [] };
        byYear.set(year, group);
        groups.push(group);
      }
      byYear.get(year).items.push({ photo: photo, index: index });
    });
    return groups;
  }

  function setupGridScrollReveal() {
    var items = gallery.querySelectorAll(".grid-item");
    if (!items.length) return;

    function revealAll() {
      items.forEach(function (el) {
        el.classList.add("is-revealed");
      });
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealAll();
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          io.unobserve(entry.target);
        });
      },
      { root: null, rootMargin: "60px 0px 60px 0px", threshold: 0.01 }
    );

    items.forEach(function (item) {
      io.observe(item);
    });
  }

  function gridItemAriaLabel(photo, index) {
    var parts = [];
    if (photo.caption) parts.push(photo.caption);
    if (photo.location) parts.push(photo.location);
    var dateLabel = formatDate(photo.date);
    if (dateLabel) parts.push(dateLabel);
    if (parts.length) return parts.join(", ");
    return "Photo " + (index + 1);
  }

  function createGridItem(photo, index) {
    const item = document.createElement("div");
    item.className = "grid-item";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-label", gridItemAriaLabel(photo, index));

    const img = document.createElement("img");
    var thumb = thumbSrcFor(photo);
    img.src = thumb;
    img.alt = photo.caption || "";
    img.loading = "lazy";

    function markImageLoaded() {
      item.classList.add("is-loaded");
    }
    img.addEventListener("load", markImageLoaded);
    img.addEventListener("error", function () {
      if (img.dataset.fallback === "1") {
        markImageLoaded();
        return;
      }
      if (thumb !== photo.src) {
        img.dataset.fallback = "1";
        img.src = photo.src;
        return;
      }
      markImageLoaded();
    });
    if (img.complete && img.naturalWidth > 0) {
      markImageLoaded();
    }

    item.appendChild(img);

    var locationText = (photo.location || "").trim();
    var dateText = formatDate(photo.date);
    if (locationText || dateText) {
      const overlay = document.createElement("div");
      overlay.className = "grid-item-overlay";
      overlay.setAttribute("aria-hidden", "true");

      const meta = document.createElement("div");
      meta.className = "grid-item-meta";

      if (locationText) {
        const locationEl = document.createElement("a");
        locationEl.className = "grid-item-location";
        locationEl.href = mapUrlFor(photo);
        locationEl.target = "_blank";
        locationEl.rel = "noopener";
        locationEl.title = "Open in Google Maps";
        // Overlay is aria-hidden, so keep the link out of the tab order;
        // keyboard users can open the map from the lightbox instead.
        locationEl.tabIndex = -1;
        locationEl.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        locationEl.innerHTML =
          '<svg class="grid-pin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
          "<span></span>";
        locationEl.lastElementChild.textContent = locationText;
        meta.appendChild(locationEl);
      }

      if (dateText) {
        const dateEl = document.createElement("span");
        dateEl.className = "grid-item-date";
        dateEl.textContent = dateText;
        meta.appendChild(dateEl);
      }

      overlay.appendChild(meta);
      item.appendChild(overlay);
    }

    item.addEventListener("click", function () {
      openLightbox(index);
    });
    item.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openLightbox(index);
      }
    });
    return item;
  }

  function renderGrid(photoList) {
    gallery.innerHTML = "";
    groupPhotosByYear(photoList).forEach(function (group) {
      const section = document.createElement("section");
      section.className = "year-section";
      section.setAttribute("aria-labelledby", "year-" + group.year);

      const heading = document.createElement("h2");
      heading.className = "year-heading";
      heading.id = "year-" + group.year;
      heading.textContent = group.year;
      section.appendChild(heading);

      const yearGrid = document.createElement("div");
      yearGrid.className = "photo-grid";
      group.items.forEach(function (entry) {
        yearGrid.appendChild(createGridItem(entry.photo, entry.index));
      });
      section.appendChild(yearGrid);
      gallery.appendChild(section);
    });
    setupGridScrollReveal();
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
    const items = gallery.querySelectorAll(".grid-item");
    if (items[currentIndex]) items[currentIndex].focus();
  }

  function navigate(direction) {
    currentIndex =
      (currentIndex + direction + photos.length) % photos.length;
    updateLightboxContent();
  }

  function updateLightboxContent() {
    var loadId = ++lightboxLoadId;
    function stale() {
      return loadId !== lightboxLoadId;
    }

    const photo = photos[currentIndex];
    var fullSrc = photo.src;
    var thumb = thumbSrcFor(photo);

    lightboxImg.alt = photo.caption || "";

    if (thumb !== fullSrc) {
      lightboxImg.src = thumb;
      var hi = new Image();
      hi.onload = function () {
        if (stale()) return;
        lightboxImg.src = fullSrc;
      };
      hi.onerror = function () {
        if (stale()) return;
        lightboxImg.src = fullSrc;
      };
      hi.src = fullSrc;
    } else {
      lightboxImg.src = fullSrc;
    }

    var captionText = (photo.caption || "").trim();
    lightboxCaption.textContent = captionText;
    lightboxCaption.classList.toggle("is-empty", !captionText);

    if (photo.location) {
      lightboxLocation.style.display = "inline-flex";
      lightboxLocation.href = mapUrlFor(photo);
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
      gallery.innerHTML =
        '<p style="color:var(--text-secondary);text-align:center;padding:40px;">Could not load photos. Make sure photos.json exists.</p>';
    });
})();
