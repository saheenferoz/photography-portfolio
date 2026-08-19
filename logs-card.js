/* Shared between the logs page and the map's log mode, so a place renders the
   same in a page section and in a map panel. Exposes window.LogCard. */
(function () {
  var TYPE_ORDER = ["sight", "trail", "activity", "event", "food", "drive", "wildlife", "note"];
  var TYPE_LABELS = {
    sight: "Sights",
    trail: "Trails",
    activity: "Activities",
    event: "Events",
    food: "Food",
    drive: "Drives",
    wildlife: "Wildlife",
    note: "Notes",
  };
  var VERDICT_LABELS = { repeat: "Would repeat", fine: "Fine", skip: "Skip" };
  var MAX_THUMBS = 10;

  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /* ---- Photo helpers (same rules as the gallery) ---- */

  function thumbSrcFor(photo) {
    if (photo.thumb) return photo.thumb;
    var s = photo.src;
    if (s.indexOf("photos/") === 0) {
      return "photos/thumbs/" + s.slice("photos/".length);
    }
    return s;
  }

  function mapUrlFor(photo) {
    if (photo.map) return photo.map;
    return (
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(photo.location)
    );
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function photosByLocation(photos) {
    var byName = new Map();
    (photos || []).forEach(function (photo) {
      var name = (photo.location || "").trim();
      if (!name) return;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(photo);
    });
    return byName;
  }

  /* ---- Lightbox ---- */

  /** Binds the standard lightbox markup; open() scopes navigation to one set. */
  function createLightbox() {
    var lightbox = document.getElementById("lightbox");
    if (!lightbox) return null;

    var img = document.getElementById("lightbox-img");
    var caption = document.getElementById("lightbox-caption");
    var locationLink = document.getElementById("lightbox-location");
    var locationText = document.getElementById("lightbox-location-text");
    var dateEl = document.getElementById("lightbox-date");
    var closeBtn = document.getElementById("lightbox-close");
    var prevBtn = document.getElementById("lightbox-prev");
    var nextBtn = document.getElementById("lightbox-next");

    var active = [];
    var index = 0;
    var loadId = 0;
    var restoreFocusTo = null;

    function update() {
      var thisLoad = ++loadId;
      var photo = active[index];
      var thumb = thumbSrcFor(photo);

      img.alt = photo.caption || "";
      if (thumb !== photo.src) {
        img.src = thumb;
        var hi = new Image();
        hi.onload = hi.onerror = function () {
          if (thisLoad !== loadId) return;
          img.src = photo.src;
        };
        hi.src = photo.src;
      } else {
        img.src = photo.src;
      }

      var captionText = (photo.caption || "").trim();
      caption.textContent = captionText;
      caption.classList.toggle("is-empty", !captionText);

      if (photo.location) {
        locationLink.style.display = "inline-flex";
        locationLink.href = mapUrlFor(photo);
        locationText.textContent = photo.location;
      } else {
        locationLink.style.display = "none";
      }

      dateEl.textContent = formatDate(photo.date);
      prevBtn.style.display = active.length > 1 ? "block" : "none";
      nextBtn.style.display = active.length > 1 ? "block" : "none";
    }

    function open(photos, startIndex, focusTarget) {
      if (!photos || !photos.length) return;
      active = photos;
      index = startIndex || 0;
      restoreFocusTo = focusTarget || null;
      update();
      lightbox.classList.add("active");
      document.body.classList.add("lightbox-open");
      closeBtn.focus();
    }

    function close() {
      lightbox.classList.remove("active");
      document.body.classList.remove("lightbox-open");
      if (restoreFocusTo) restoreFocusTo.focus();
    }

    function navigate(direction) {
      index = (index + direction + active.length) % active.length;
      update();
    }

    function isOpen() {
      return lightbox.classList.contains("active");
    }

    closeBtn.addEventListener("click", close);
    prevBtn.addEventListener("click", function () { navigate(-1); });
    nextBtn.addEventListener("click", function () { navigate(1); });
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) close();
    });
    document.addEventListener("keydown", function (e) {
      if (!isOpen()) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") navigate(-1);
      if (e.key === "ArrowRight") navigate(1);
    });

    return { open: open, close: close, isOpen: isOpen };
  }

  /* ---- Grouping ---- */

  function byName(a, b) {
    return a.name.localeCompare(b.name);
  }

  /** Country > region > area, alphabetized by name at the country and region
      level (areas and entries keep source YAML order). A country holding one
      identically named region (Switzerland) keeps only the region heading. */
  function buildTree(entries) {
    var countries = [];
    var countryIndex = new Map();

    entries.forEach(function (entry) {
      if (!countryIndex.has(entry.country)) {
        var country = {
          name: entry.country,
          id: slugify(entry.country),
          regions: [],
          regionIndex: new Map(),
        };
        countryIndex.set(entry.country, country);
        countries.push(country);
      }
      var c = countryIndex.get(entry.country);

      if (!c.regionIndex.has(entry.region)) {
        var region = {
          name: entry.region,
          id: slugify(entry.region),
          groups: [],
          groupIndex: new Map(),
        };
        c.regionIndex.set(entry.region, region);
        c.regions.push(region);
      }
      var r = c.regionIndex.get(entry.region);

      if (!r.groupIndex.has(entry.area)) {
        var group = {
          area: entry.area,
          region: entry.region,
          country: entry.country,
          id: r.id + (entry.area ? "-" + slugify(entry.area) : ""),
          entries: [],
        };
        r.groupIndex.set(entry.area, group);
        r.groups.push(group);
      }
      r.groupIndex.get(entry.area).entries.push(entry);
    });

    countries.forEach(function (c) {
      c.showHeading = !(c.regions.length === 1 && c.regions[0].name === c.name);
      delete c.regionIndex;
      c.regions.forEach(function (r) {
        delete r.groupIndex;
      });
      c.regions.sort(byName);
    });
    countries.sort(byName);
    return countries;
  }

  /** One group per geocoded location; each becomes a marker in the map's log mode. */
  function groupByLocation(entries) {
    var byLocation = new Map();
    entries.forEach(function (entry) {
      if (!entry.location) return;
      if (!byLocation.has(entry.location)) {
        byLocation.set(entry.location, {
          location: entry.location,
          region: entry.region,
          country: entry.country,
          area: entry.area,
          entries: [],
        });
      }
      var group = byLocation.get(entry.location);
      group.entries.push(entry);
      if (group.area !== entry.area) group.area = "";
    });
    return byLocation;
  }

  /** Prefer the area name; otherwise trim the region or country suffix off the
      location key, so "Cascade Falls, Minnesota" titles as "Cascade Falls". */
  function groupTitle(group) {
    if (group.area) return group.area;
    var title = group.location || group.region;
    [group.region, group.country].forEach(function (suffix) {
      if (suffix && title !== suffix && title.endsWith(", " + suffix)) {
        title = title.slice(0, -(suffix.length + 2));
      }
    });
    return title;
  }

  function groupSubtitle(group) {
    var parts = [group.region];
    if (group.country && group.country !== group.region) parts.push(group.country);
    return parts.filter(Boolean).join(", ");
  }

  function entriesByType(entries) {
    return TYPE_ORDER.map(function (type) {
      return {
        type: type,
        label: TYPE_LABELS[type],
        entries: entries.filter(function (e) {
          return e.type === type;
        }),
      };
    }).filter(function (section) {
      return section.entries.length > 0;
    });
  }

  /* ---- Rendering ---- */

  function renderVerdict(verdict) {
    if (!VERDICT_LABELS[verdict]) return null;
    return el("span", "log-verdict is-" + verdict, VERDICT_LABELS[verdict]);
  }

  function renderEntry(entry, hideName) {
    var li = el("li", "log-entry");
    li.id = entry.id;

    var verdict = renderVerdict(entry.verdict);
    if (!hideName || verdict) {
      var head = el("div", "log-entry-head");
      if (!hideName) head.appendChild(el("span", "log-entry-name", entry.name));
      if (verdict) head.appendChild(verdict);
      li.appendChild(head);
    }

    (entry.notes || []).forEach(function (note) {
      li.appendChild(el("p", "log-entry-note", note));
    });

    if ((entry.items || []).length) {
      var list = el("ul", "log-items");
      entry.items.forEach(function (item) {
        var itemLi = el("li", "log-item");
        var itemHead = el("div", "log-item-head");
        itemHead.appendChild(el("span", "log-item-name", item.name));
        var itemVerdict = renderVerdict(item.verdict);
        if (itemVerdict) itemHead.appendChild(itemVerdict);
        itemLi.appendChild(itemHead);
        (item.notes || []).forEach(function (note) {
          itemLi.appendChild(el("p", "log-item-note", note));
        });
        list.appendChild(itemLi);
      });
      li.appendChild(list);
    }
    return li;
  }

  /** Type sections for one group. A lone sights section goes unlabelled, so a
      plain list reads as places and a label always means food or drives.
      When the group is a single entry that already titled the group (a bare
      area naming one sight), its name is dropped here to avoid repeating the
      heading right above it. */
  function renderEntries(entries, groupTitle) {
    var fragment = document.createDocumentFragment();
    var sections = entriesByType(entries);
    var labelSights = sections.length > 1;
    var hideName = entries.length === 1 && entries[0].name === groupTitle;

    sections.forEach(function (section) {
      // A section rather than a heading, so the label reads correctly in both
      // the page's heading hierarchy and the map panel's.
      var wrap = el("section", "log-section");
      wrap.setAttribute("aria-label", section.label);
      if (section.type !== "sight" || labelSights) {
        wrap.appendChild(el("p", "log-section-label", section.label));
      }
      var list = el("ul", "log-entries");
      section.entries.forEach(function (entry) {
        list.appendChild(renderEntry(entry, hideName));
      });
      wrap.appendChild(list);
      fragment.appendChild(wrap);
    });
    return fragment;
  }

  /** Photos for the group's locations, deduped and capped; onOpen(photos, index, node). */
  function renderThumbs(group, photoIndex, onOpen) {
    var seen = new Set();
    var photos = [];
    group.entries.forEach(function (entry) {
      if (seen.has(entry.location)) return;
      seen.add(entry.location);
      (photoIndex.get(entry.location) || []).forEach(function (photo) {
        photos.push(photo);
      });
    });
    if (!photos.length) return null;

    var strip = el("div", "log-thumbs");
    photos.slice(0, MAX_THUMBS).forEach(function (photo, i) {
      var button = el("button", "log-thumb");
      button.type = "button";
      button.setAttribute(
        "aria-label",
        photo.caption || photo.location || "Photo " + (i + 1)
      );

      var img = document.createElement("img");
      img.src = thumbSrcFor(photo);
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () {
        if (img.src !== photo.src) img.src = photo.src;
      });
      button.appendChild(img);

      button.addEventListener("click", function () {
        onOpen(photos, i, button);
      });
      strip.appendChild(button);
    });

    if (photos.length > MAX_THUMBS) {
      strip.appendChild(
        el("span", "log-thumbs-more", "+" + (photos.length - MAX_THUMBS))
      );
    }
    return strip;
  }

  window.LogCard = {
    slugify: slugify,
    thumbSrcFor: thumbSrcFor,
    mapUrlFor: mapUrlFor,
    formatDate: formatDate,
    photosByLocation: photosByLocation,
    createLightbox: createLightbox,
    buildTree: buildTree,
    groupByLocation: groupByLocation,
    groupTitle: groupTitle,
    groupSubtitle: groupSubtitle,
    renderEntries: renderEntries,
    renderThumbs: renderThumbs,
  };
})();
