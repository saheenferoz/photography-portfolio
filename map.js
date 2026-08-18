(function () {
  var PIN_RADIUS = 14;
  var MIN_ZOOM = 1;
  // High enough to fully separate pins a few km apart (e.g. different sights
  // across a city); pins under ~1km apart are merged at the data level
  // instead, since no reasonable zoom pulls those apart on a world map.
  var MAX_ZOOM = 200;

  var mapWrap = document.getElementById("map");
  var tooltip = document.getElementById("map-tooltip");

  var lightbox = LogCard.createLightbox();
  var thumbSrcFor = LogCard.thumbSrcFor;

  var modeToggle = document.querySelector(".map-mode");
  var modePhotosBtn = document.getElementById("mode-photos");
  var modeLogsBtn = document.getElementById("mode-logs");
  var panel = document.getElementById("log-panel");
  var panelTitle = document.getElementById("log-panel-title");
  var panelSubtitle = document.getElementById("log-panel-subtitle");
  var panelBody = document.getElementById("log-panel-body");
  var panelCloseBtn = document.getElementById("log-panel-close");

  var timelineEl = document.getElementById("map-timeline");
  var playBtn = document.getElementById("timeline-play");
  var startInput = document.getElementById("timeline-start");
  var endInput = document.getElementById("timeline-end");
  var fillEl = document.getElementById("timeline-fill");
  var labelStartEl = document.getElementById("timeline-label-start");
  var labelEndEl = document.getElementById("timeline-label-end");

  // "photos" shows one thumbnail pin per photographed place; "logs" shows a
  // marker per logged place, whose click opens the log panel instead.
  var mode = "photos";
  var photoPins = [];
  var logPins = [];
  var photoIndex = new Map();
  var world = null;
  var lastFocusedPin = null;
  var timelineAvailable = false;
  // Survives the redraw when switching modes so the view does not jump home.
  var currentTransform = null;

  // Year-range filter state; pinFilterFn is (re)created by each drawMap call.
  var minYear = null;
  var maxYear = null;
  var selStartYear = null;
  var selEndYear = null;
  var playTimeout = null;
  var playRaf = null;
  var pinFilterFn = null;

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

  /* ---- Log panel ---- */

  function openPanel(pin, node) {
    lastFocusedPin = node || null;
    panelTitle.textContent = LogCard.groupTitle(pin.group);
    panelSubtitle.textContent = LogCard.groupSubtitle(pin.group);

    panelBody.innerHTML = "";
    var thumbs = LogCard.renderThumbs(pin.group, photoIndex, function (photos, i, el) {
      if (lightbox) lightbox.open(photos, i, el);
    });
    if (thumbs) panelBody.appendChild(thumbs);
    panelBody.appendChild(LogCard.renderEntries(pin.group.entries));

    panel.classList.add("is-open");
    panelCloseBtn.focus();
  }

  function closePanel() {
    if (!panel.classList.contains("is-open")) return;
    panel.classList.remove("is-open");
    if (lastFocusedPin) lastFocusedPin.focus();
    lastFocusedPin = null;
  }

  panelCloseBtn.addEventListener("click", closePanel);

  document.addEventListener("keydown", function (e) {
    // The lightbox opens on top of the panel and owns Escape while it is up.
    if (e.key !== "Escape" || (lightbox && lightbox.isOpen())) return;
    closePanel();
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

  /** Log entries carry no dates, so the year filter only applies to photo mode. */
  function syncTimelineVisibility() {
    timelineEl.style.display =
      timelineAvailable && mode === "photos" ? "" : "none";
  }

  function initTimeline(photos) {
    var years = [];
    photos.forEach(function (p) {
      var y = photoYear(p);
      if (y !== null) years.push(y);
    });
    if (!years.length) {
      syncTimelineVisibility();
      return;
    }
    minYear = Math.min.apply(null, years);
    maxYear = Math.max.apply(null, years);
    if (minYear === maxYear) {
      syncTimelineVisibility();
      return;
    }
    timelineAvailable = true;
    syncTimelineVisibility();
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

  /** Log markers grow with how much is logged there, but stay small enough
      that neighbouring places stay distinguishable. */
  function logPinRadius(count) {
    return Math.min(11, 5 + Math.sqrt(count) * 2.2);
  }

  function drawMap(options) {
    options = options || {};
    var reduced = prefersReducedMotion();
    var animatePins = !!options.animatePins && !reduced;
    var animateWireframe = !!options.animateWireframe && !reduced;
    var isLogMode = mode === "logs";
    var pins = isLogMode ? logPins : photoPins;
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

    if (animateWireframe) {
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

    // Pins wait out the wireframe fade on first load; on a mode switch the
    // wireframe is already up, so they pop straight away.
    var popDelay = animateWireframe ? 500 : 0;

    // Toggling modes rebuilds the SVG, so carry the zoom over or the view snaps
    // back to the whole world. Known before the pins are laid out because their
    // counter-scale depends on it.
    var restoreTransform = options.preserveTransform ? currentTransform : null;
    var currentK = restoreTransform ? restoreTransform.k : 1;

    pins.forEach(function (pin, i) {
      var p = projection([pin.lng, pin.lat]);
      if (!p) return;
      pin.x = p[0];
      pin.y = p[1];

      if (isLogMode) {
        pin.visible = true;
      } else {
        pin.visiblePhotos = pin.photos.filter(photoInRange);
        pin.visible = pin.visiblePhotos.length > 0;
      }

      var g = pinLayer
        .append("g")
        .attr("class", isLogMode ? "map-pin map-log-pin" : "map-pin")
        .classed("is-hidden", !pin.visible)
        .attr(
          "transform",
          !pin.visible || animatePins
            ? "translate(" + pin.x + "," + pin.y + ") scale(0)"
            : pinTransform(pin)
        )
        .attr("role", "button")
        .attr("tabindex", pin.visible ? 0 : -1);

      if (animatePins && pin.visible) {
        g.transition()
          .delay(popDelay + pin.popRank * 45)
          .duration(550)
          .ease(d3.easeBackOut.overshoot(2.2))
          .attr("transform", pinTransform(pin));
      }

      if (isLogMode) {
        var radius = logPinRadius(pin.group.entries.length);
        g.attr("aria-label", pin.label);
        g.append("circle")
          .attr("class", "map-log-dot")
          .attr("r", radius * 0.55);
        g.append("circle").attr("class", "map-pin-ring").attr("r", radius);
      } else {
        var clipId = "pin-clip-" + i;
        defs
          .append("clipPath")
          .attr("id", clipId)
          .append("circle")
          .attr("r", PIN_RADIUS);

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
      }

      var node = g.node();
      node.__pin__ = pin;

      function activate() {
        hideTooltip();
        if (isLogMode) openPanel(pin, node);
        else if (lightbox) lightbox.open(pin.visiblePhotos, 0, node);
      }

      node.addEventListener("click", activate);
      node.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
      node.addEventListener("pointerenter", function (e) {
        showTooltip(pin.label || pin.name, e.clientX, e.clientY);
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

    // Log pins carry no photos, so the year filter has nothing to act on.
    pinFilterFn = isLogMode ? null : applyYearFilter;

    var zoom = d3
      .zoom()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .translateExtent([
        [0, 0],
        [width, height],
      ])
      .on("zoom", function (event) {
        currentTransform = event.transform;
        root.attr("transform", event.transform);
        applyPinScale(event.transform.k);
        hideTooltip();
      });

    svg.call(zoom);

    if (restoreTransform) {
      // Seed d3-zoom's stored state rather than replaying the transform, which
      // would fire the handler and interrupt the pins mid-pop.
      svg.node().__zoom = restoreTransform;
      root.attr("transform", restoreTransform);
    }

    if (!animatePins) applyPinScale(currentK);
  }

  /* ---- Mode toggle ---- */

  /** One marker per geocoded log location; entries whose location never
      geocoded are dropped here but still show on the logs page. */
  function buildLogPins(entries, locations) {
    var pins = [];
    LogCard.groupByLocation(entries).forEach(function (group) {
      var coords = locations[group.location];
      if (!coords) return;
      var count = group.entries.length;
      pins.push({
        name: LogCard.groupTitle(group),
        label:
          LogCard.groupTitle(group) +
          " — " +
          count +
          (count === 1 ? " entry" : " entries"),
        lat: coords.lat,
        lng: coords.lng,
        group: group,
        popRank: pins.length,
      });
    });
    return pins;
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    closePanel();
    stopPlayback(true);
    hideTooltip();
    syncTimelineVisibility();

    modePhotosBtn.classList.toggle("is-active", mode === "photos");
    modeLogsBtn.classList.toggle("is-active", mode === "logs");
    modePhotosBtn.setAttribute("aria-pressed", String(mode === "photos"));
    modeLogsBtn.setAttribute("aria-pressed", String(mode === "logs"));
    mapWrap.setAttribute(
      "aria-label",
      mode === "logs" ? "World map of logged places" : "World map of photo locations"
    );

    drawMap({ animatePins: true, preserveTransform: true });
  }

  modePhotosBtn.addEventListener("click", function () { setMode("photos"); });
  modeLogsBtn.addEventListener("click", function () { setMode("logs"); });

  /* ---- Boot ---- */

  Promise.all([
    fetch("photos.json").then(function (r) { return r.json(); }),
    fetch("locations.json").then(function (r) { return r.json(); }),
    fetch("vendor/countries-50m.json").then(function (r) { return r.json(); }),
    // Logs are additive: a missing logs.json should not take the map down.
    fetch("logs.json")
      .then(function (r) { return r.json(); })
      .catch(function () { return { entries: [] }; }),
  ])
    .then(function (results) {
      var data = results[0];
      var locations = results[1];
      world = results[2];

      renderProfile(data.profile);

      photoIndex = LogCard.photosByLocation(data.photos);
      photoPins = groupByLocation(data.photos, locations);
      logPins = buildLogPins(results[3].entries || [], locations);
      if (!logPins.length) modeToggle.style.display = "none";
      computePopOrder(photoPins);
      initTimeline(data.photos);
      drawMap({ animatePins: true, animateWireframe: true });

      var resizeTimer = null;
      window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          drawMap({});
        }, 150);
      });
    })
    .catch(function (err) {
      console.error("Failed to load map data:", err);
      mapWrap.innerHTML =
        '<p style="color:var(--text-secondary);text-align:center;padding:40px;">Could not load the map. Make sure photos.json and locations.json exist.</p>';
    });
})();
