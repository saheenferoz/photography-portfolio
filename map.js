(function () {
  var PIN_RADIUS = 14;
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 40;

  var mapWrap = document.getElementById("map");
  var tooltip = document.getElementById("map-tooltip");

  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var lightboxCaption = document.getElementById("lightbox-caption");
  var lightboxLocationText = document.getElementById("lightbox-location-text");
  var lightboxLocation = document.getElementById("lightbox-location");
  var lightboxDate = document.getElementById("lightbox-date");
  var closeBtn = document.getElementById("lightbox-close");
  var prevBtn = document.getElementById("lightbox-prev");
  var nextBtn = document.getElementById("lightbox-next");

  var timelineEl = document.getElementById("map-timeline");
  var playBtn = document.getElementById("timeline-play");
  var startInput = document.getElementById("timeline-start");
  var endInput = document.getElementById("timeline-end");
  var fillEl = document.getElementById("timeline-fill");
  var labelStartEl = document.getElementById("timeline-label-start");
  var labelEndEl = document.getElementById("timeline-label-end");

  // Photos for the currently open pin; lightbox nav cycles within these only.
  var activePhotos = [];
  var currentIndex = 0;
  var lightboxLoadId = 0;
  var lastFocusedPin = null;

  // Year-range filter state; pinFilterFn is (re)created by each drawMap call.
  var minYear = null;
  var maxYear = null;
  var selStartYear = null;
  var selEndYear = null;
  var playTimeout = null;
  var playRaf = null;
  var pinFilterFn = null;

  function formatDate(dateStr) {
    if (!dateStr) return "";
    var d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function photoYear(photo) {
    var y = photo.date ? parseInt(photo.date.slice(0, 4), 10) : NaN;
    return isNaN(y) ? null : y;
  }

  /** Photos without a parseable date are never filtered out. */
  function photoInRange(photo) {
    if (selStartYear === null) return true;
    var y = photoYear(photo);
    if (y === null) return true;
    return y >= selStartYear && y <= selEndYear;
  }

  function mapUrlFor(photo) {
    if (photo.map) return photo.map;
    return (
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(photo.location)
    );
  }

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

  /** One entry per unique location that has coordinates; photos sorted newest first. */
  function groupByLocation(photos, locations) {
    var byName = new Map();
    photos.forEach(function (photo) {
      var name = (photo.location || "").trim();
      if (!name) return;
      var coords = locations[name];
      if (!coords) return;
      if (!byName.has(name)) {
        byName.set(name, {
          name: name,
          lat: coords.lat,
          lng: coords.lng,
          photos: [],
        });
      }
      byName.get(name).photos.push(photo);
    });
    return Array.from(byName.values());
  }

  /* ---- Lightbox (same DOM/CSS as the gallery, scoped to one pin's photos) ---- */

  function openLightbox(photosForPin, pinNode) {
    activePhotos = photosForPin;
    currentIndex = 0;
    lastFocusedPin = pinNode || null;
    updateLightboxContent();
    lightbox.classList.add("active");
    document.body.classList.add("lightbox-open");
    closeBtn.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove("active");
    document.body.classList.remove("lightbox-open");
    if (lastFocusedPin) lastFocusedPin.focus();
  }

  function navigate(direction) {
    currentIndex =
      (currentIndex + direction + activePhotos.length) % activePhotos.length;
    updateLightboxContent();
  }

  function updateLightboxContent() {
    var loadId = ++lightboxLoadId;
    function stale() {
      return loadId !== lightboxLoadId;
    }

    var photo = activePhotos[currentIndex];
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

    prevBtn.style.display = activePhotos.length > 1 ? "block" : "none";
    nextBtn.style.display = activePhotos.length > 1 ? "block" : "none";
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

  /* ---- Tooltip ---- */

  function showTooltip(text, clientX, clientY) {
    tooltip.textContent = text;
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
    moveTooltip(clientX, clientY);
  }

  function moveTooltip(clientX, clientY) {
    var pad = 14;
    var rect = tooltip.getBoundingClientRect();
    var x = clientX + pad;
    var y = clientY - rect.height - pad;
    if (x + rect.width > window.innerWidth - 8) {
      x = clientX - rect.width - pad;
    }
    if (y < 8) y = clientY + pad;
    tooltip.style.transform = "translate(" + x + "px," + y + "px)";
  }

  function hideTooltip() {
    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden", "true");
  }

  /* ---- Timeline (year-range filter + playback) ---- */

  var playbackEndYear = null;

  function renderSlider(s, e) {
    labelStartEl.textContent = s;
    labelEndEl.textContent = e;
    var span = maxYear - minYear;
    var left = ((s - minYear) / span) * 100;
    var right = ((e - minYear) / span) * 100;
    fillEl.style.left = left + "%";
    fillEl.style.width = right - left + "%";
  }

  function updateSliderUI() {
    renderSlider(selStartYear, selEndYear);
  }

  function onSliderInput(isStart) {
    stopPlayback(false);
    var s = parseInt(startInput.value, 10);
    var e = parseInt(endInput.value, 10);
    // Thumbs may not cross; the one being dragged pushes the other's value.
    if (s > e) {
      if (isStart) {
        e = s;
        endInput.value = e;
      } else {
        s = e;
        startInput.value = s;
      }
    }
    selStartYear = s;
    selEndYear = e;
    updateSliderUI();
    if (pinFilterFn) pinFilterFn(false);
  }

  function isPlaying() {
    return timelineEl.classList.contains("is-playing");
  }

  /** Clears the stage, then replays the whole range as one continuous
      oldest-first stagger — the same feel as the intro animation. The
      slider fill and end label glide along for the duration. */
  function startPlayback() {
    if (!pinFilterFn || isPlaying()) return;
    var startY = selStartYear;
    var endY = selEndYear;
    playbackEndYear = endY;
    timelineEl.classList.add("is-playing");
    playBtn.setAttribute("aria-label", "Stop timeline playback");

    selEndYear = startY - 1;
    pinFilterFn(false);

    // Give the hide animation a beat to finish before the reveal starts.
    playTimeout = setTimeout(function () {
      playTimeout = null;
      selEndYear = endY;
      var appearing = pinFilterFn(true);
      var duration = Math.max(600, (appearing - 1) * 45 + 550);
      var t0 = performance.now();

      function frame(now) {
        var progress = Math.min(1, (now - t0) / duration);
        var year = Math.round(startY + (endY - startY) * progress);
        endInput.value = year;
        renderSlider(startY, year);
        if (progress < 1) {
          playRaf = requestAnimationFrame(frame);
        } else {
          playRaf = null;
          stopPlayback(true);
        }
      }
      playRaf = requestAnimationFrame(frame);
    }, 350);
  }

  function stopPlayback(restoreEnd) {
    if (playTimeout !== null) {
      clearTimeout(playTimeout);
      playTimeout = null;
    }
    if (playRaf !== null) {
      cancelAnimationFrame(playRaf);
      playRaf = null;
    }
    if (!isPlaying()) return;
    timelineEl.classList.remove("is-playing");
    playBtn.setAttribute("aria-label", "Play timeline");
    if (restoreEnd && playbackEndYear !== null) {
      selEndYear = playbackEndYear;
      endInput.value = selEndYear;
      updateSliderUI();
      if (pinFilterFn) pinFilterFn(false);
    }
    playbackEndYear = null;
  }

  function initTimeline(photos) {
    var years = [];
    photos.forEach(function (p) {
      var y = photoYear(p);
      if (y !== null) years.push(y);
    });
    if (!years.length) {
      timelineEl.style.display = "none";
      return;
    }
    minYear = Math.min.apply(null, years);
    maxYear = Math.max.apply(null, years);
    if (minYear === maxYear) {
      timelineEl.style.display = "none";
      return;
    }
    selStartYear = minYear;
    selEndYear = maxYear;

    [startInput, endInput].forEach(function (input) {
      input.min = minYear;
      input.max = maxYear;
      input.step = 1;
    });
    startInput.value = minYear;
    endInput.value = maxYear;
    updateSliderUI();

    startInput.addEventListener("input", function () {
      onSliderInput(true);
    });
    endInput.addEventListener("input", function () {
      onSliderInput(false);
    });
    playBtn.addEventListener("click", function () {
      if (isPlaying()) stopPlayback(true);
      else startPlayback();
    });
  }

  /* ---- Map ---- */

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Stagger rank per pin: oldest photo location pops first, replaying the travel history. */
  function computePopOrder(pins) {
    var sorted = pins.slice().sort(function (a, b) {
      var da = a.photos[a.photos.length - 1].date || "";
      var db = b.photos[b.photos.length - 1].date || "";
      return da < db ? -1 : da > db ? 1 : 0;
    });
    sorted.forEach(function (pin, rank) {
      pin.popRank = rank;
    });
  }

  function drawMap(world, pins, animate) {
    animate = animate && !prefersReducedMotion();
    mapWrap.innerHTML = "";

    var width = mapWrap.clientWidth;
    var height = mapWrap.clientHeight;

    var projection = d3.geoNaturalEarth1();
    projection.fitExtent(
      [
        [8, 8],
        [width - 8, height - 8],
      ],
      { type: "Sphere" }
    );
    var path = d3.geoPath(projection);

    var svg = d3
      .select(mapWrap)
      .append("svg")
      .attr("class", "map-svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", "0 0 " + width + " " + height);

    var root = svg.append("g");

    var wireframe = root.append("g").attr("class", "map-wireframe");

    wireframe
      .append("path")
      .attr("class", "map-sphere")
      .attr("d", path({ type: "Sphere" }));

    var countries = topojson.mesh(world, world.objects.countries);
    wireframe
      .append("path")
      .attr("class", "map-borders")
      .attr("d", path(countries));

    if (animate) {
      wireframe
        .attr("opacity", 0)
        .transition()
        .duration(900)
        .ease(d3.easeCubicOut)
        .attr("opacity", 1);
    }

    var defs = svg.append("defs");

    var pinLayer = root.append("g").attr("class", "map-pins");

    /** Refresh thumbnail, badge, and label from the pin's filtered photos. */
    function updatePinAppearance(sel, pin) {
      var photos = pin.visiblePhotos;
      if (!photos.length) return;
      sel.attr(
        "aria-label",
        pin.name +
          " — " +
          photos.length +
          (photos.length === 1 ? " photo" : " photos")
      );
      var image = sel.select("image");
      var thumb = thumbSrcFor(photos[0]);
      if (image.attr("href") !== thumb) image.attr("href", thumb);
      var badge = sel.select("g.map-pin-badge");
      badge.style("display", photos.length > 1 ? null : "none");
      badge
        .select("text")
        .text(photos.length > 99 ? "99+" : String(photos.length));
    }

    pins.forEach(function (pin, i) {
      var p = projection([pin.lng, pin.lat]);
      if (!p) return;
      pin.x = p[0];
      pin.y = p[1];

      var clipId = "pin-clip-" + i;
      defs
        .append("clipPath")
        .attr("id", clipId)
        .append("circle")
        .attr("r", PIN_RADIUS);

      pin.visiblePhotos = pin.photos.filter(photoInRange);
      pin.visible = pin.visiblePhotos.length > 0;

      var g = pinLayer
        .append("g")
        .attr("class", "map-pin")
        .classed("is-hidden", !pin.visible)
        .attr(
          "transform",
          "translate(" + pin.x + "," + pin.y + ")" +
            (!pin.visible || animate ? " scale(0)" : "")
        )
        .attr("role", "button")
        .attr("tabindex", pin.visible ? 0 : -1);

      if (animate && pin.visible) {
        g.transition()
          .delay(500 + pin.popRank * 45)
          .duration(550)
          .ease(d3.easeBackOut.overshoot(2.2))
          .attr("transform", "translate(" + pin.x + "," + pin.y + ") scale(1)");
      }

      var newestThumb = thumbSrcFor(pin.visiblePhotos[0] || pin.photos[0]);
      var image = g
        .append("image")
        .attr("href", newestThumb)
        .attr("x", -PIN_RADIUS)
        .attr("y", -PIN_RADIUS)
        .attr("width", PIN_RADIUS * 2)
        .attr("height", PIN_RADIUS * 2)
        .attr("preserveAspectRatio", "xMidYMid slice")
        .attr("clip-path", "url(#" + clipId + ")");

      image.node().addEventListener("error", function () {
        // Thumb missing: fall back to the full-size photo.
        var full = (pin.visiblePhotos[0] || pin.photos[0]).src;
        if (image.attr("href") !== full) image.attr("href", full);
      });

      g.append("circle")
        .attr("class", "map-pin-ring")
        .attr("r", PIN_RADIUS);

      var badge = g.append("g").attr("class", "map-pin-badge");
      badge
        .append("circle")
        .attr("cx", PIN_RADIUS * 0.75)
        .attr("cy", -PIN_RADIUS * 0.75)
        .attr("r", 7.5);
      badge
        .append("text")
        .attr("x", PIN_RADIUS * 0.75)
        .attr("y", -PIN_RADIUS * 0.75);
      updatePinAppearance(g, pin);

      var node = g.node();
      node.__pin__ = pin;
      node.addEventListener("click", function () {
        hideTooltip();
        openLightbox(pin.visiblePhotos, node);
      });
      node.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          hideTooltip();
          openLightbox(pin.visiblePhotos, node);
        }
      });
      node.addEventListener("pointerenter", function (e) {
        showTooltip(pin.name, e.clientX, e.clientY);
      });
      node.addEventListener("pointermove", function (e) {
        moveTooltip(e.clientX, e.clientY);
      });
      node.addEventListener("pointerleave", hideTooltip);
    });

    /* Zoom/pan: the root group scales, pins counter-scale so they stay a
       constant screen size and dense clusters separate as you zoom in.
       Filtered-out pins keep scale(0). interrupt() cancels any still-running
       pop transitions so they can't overwrite the zoom-adjusted transforms. */
    var currentK = 1;

    function pinTransform(pin) {
      return (
        "translate(" + pin.x + "," + pin.y + ") scale(" +
        (pin.visible ? 1 / currentK : 0) + ")"
      );
    }

    function applyPinScale(k) {
      currentK = k;
      pinLayer.selectAll("g.map-pin").interrupt().attr("transform", function () {
        return pinTransform(this.__pin__);
      });
    }

    function showPin(node, pin, delay) {
      var sel = d3
        .select(node)
        .classed("is-hidden", false)
        .attr("tabindex", 0);
      if (prefersReducedMotion()) {
        sel.interrupt().attr("transform", pinTransform(pin));
        return;
      }
      sel
        .interrupt()
        .attr("transform", "translate(" + pin.x + "," + pin.y + ") scale(0)")
        .transition()
        .delay(delay)
        .duration(550)
        .ease(d3.easeBackOut.overshoot(2.2))
        .attr("transform", pinTransform(pin));
    }

    function hidePin(node, pin) {
      var sel = d3
        .select(node)
        .classed("is-hidden", true)
        .attr("tabindex", -1);
      var target = "translate(" + pin.x + "," + pin.y + ") scale(0)";
      if (prefersReducedMotion()) {
        sel.interrupt().attr("transform", target);
        return;
      }
      sel
        .interrupt()
        .transition()
        .duration(250)
        .ease(d3.easeCubicIn)
        .attr("transform", target);
    }

    function oldestVisibleDate(pin) {
      // Photos are sorted newest first, so the oldest is last.
      var ps = pin.visiblePhotos;
      return ps.length ? ps[ps.length - 1].date || "" : "";
    }

    /** Re-evaluate every pin against the year range; animate the ones that
        changed. When staggered, newly visible pins pop oldest-first.
        Returns how many pins appeared so playback can size its duration. */
    function applyYearFilter(staggered) {
      var appearing = [];
      pinLayer.selectAll("g.map-pin").each(function () {
        var pin = this.__pin__;
        var wasVisible = pin.visible;
        pin.visiblePhotos = pin.photos.filter(photoInRange);
        pin.visible = pin.visiblePhotos.length > 0;
        updatePinAppearance(d3.select(this), pin);
        if (pin.visible === wasVisible) return;
        if (pin.visible) appearing.push(this);
        else hidePin(this, pin);
      });
      appearing.sort(function (a, b) {
        var da = oldestVisibleDate(a.__pin__);
        var db = oldestVisibleDate(b.__pin__);
        return da < db ? -1 : da > db ? 1 : 0;
      });
      appearing.forEach(function (node, i) {
        showPin(node, node.__pin__, staggered ? i * 45 : 0);
      });
      return appearing.length;
    }

    pinFilterFn = applyYearFilter;

    var zoom = d3
      .zoom()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      .on("zoom", function (event) {
        root.attr("transform", event.transform);
        applyPinScale(event.transform.k);
        hideTooltip();
      });

    svg.call(zoom);

    if (!animate) applyPinScale(1);
  }

  /* ---- Boot ---- */

  Promise.all([
    fetch("photos.json").then(function (r) { return r.json(); }),
    fetch("locations.json").then(function (r) { return r.json(); }),
    fetch("vendor/countries-110m.json").then(function (r) { return r.json(); }),
  ])
    .then(function (results) {
      var data = results[0];
      var locations = results[1];
      var world = results[2];

      renderProfile(data.profile);

      var pins = groupByLocation(data.photos, locations);
      computePopOrder(pins);
      initTimeline(data.photos);
      drawMap(world, pins, true);

      var resizeTimer = null;
      window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          drawMap(world, pins, false);
        }, 150);
      });
    })
    .catch(function (err) {
      console.error("Failed to load map data:", err);
      mapWrap.innerHTML =
        '<p style="color:var(--text-secondary);text-align:center;padding:40px;">Could not load the map. Make sure photos.json and locations.json exist.</p>';
    });
})();
