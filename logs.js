(function () {
  var content = document.getElementById("log-content");
  var lightbox = LogCard.createLightbox();

  function renderProfile(profile) {
    document.getElementById("avatar").src = profile.avatar;
    document.getElementById("avatar").alt = profile.name;
    document.getElementById("profile-name").textContent = profile.name;
    document.getElementById("profile-tagline").textContent = profile.tagline;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function regionHref(region) {
    return "logs.html?region=" + encodeURIComponent(region.id);
  }

  function countEntries(region) {
    return region.groups.reduce(function (total, group) {
      return total + group.entries.length;
    }, 0);
  }

  function renderGroup(group, photoIndex) {
    var wrap = el("div", "log-group");
    // Region-level entries share the region's anchor, so only named areas get one.
    if (group.area) {
      wrap.id = group.id;
      var heading = el("h4", "log-area-heading");
      var link = el("a", "log-anchor", group.area);
      link.href = "#" + group.id;
      heading.appendChild(link);
      wrap.appendChild(heading);
    }

    var thumbs = LogCard.renderThumbs(group, photoIndex, function (photos, i, node) {
      if (lightbox) lightbox.open(photos, i, node);
    });
    if (thumbs) wrap.appendChild(thumbs);

    wrap.appendChild(LogCard.renderEntries(group.entries, group.area));
    return wrap;
  }

  /* ---- Index ---- */

  function renderIndexLink(region) {
    var item = el("li", "log-index-item");
    var link = el("a", "log-index-link");
    link.href = regionHref(region);
    link.appendChild(el("span", "log-index-name", region.name));
    var count = countEntries(region);
    link.appendChild(
      el("span", "log-index-count", count + (count === 1 ? " entry" : " entries"))
    );
    item.appendChild(link);
    return item;
  }

  function renderIndex(countries) {
    document.title = "Saheen Feroz — Logs";
    countries.forEach(function (country) {
      var section = el("section", "log-country");
      if (country.showHeading) {
        section.id = country.id;
        section.appendChild(el("h2", "log-country-heading", country.name));
      }
      var list = el("ul", "log-index-list");
      country.regions.forEach(function (region) {
        list.appendChild(renderIndexLink(region));
      });
      section.appendChild(list);
      content.appendChild(section);
    });
  }

  /* ---- One region ---- */

  function renderRegionNav(regions, position) {
    var previous = regions[position - 1];
    var next = regions[position + 1];
    if (!previous && !next) return null;

    var nav = el("nav", "log-pager");
    nav.setAttribute("aria-label", "Nearby logs");
    [previous, next].forEach(function (region, i) {
      if (!region) {
        // Keeps a lone "next" pinned to the right of the pager.
        nav.appendChild(el("span", "log-pager-link is-empty"));
        return;
      }
      var link = el("a", "log-pager-link");
      link.href = regionHref(region);
      link.appendChild(el("span", "log-pager-label", i === 0 ? "Previous" : "Next"));
      link.appendChild(el("span", "log-pager-name", region.name));
      nav.appendChild(link);
    });
    return nav;
  }

  function renderRegionPage(country, region, photoIndex) {
    document.title = region.name + " — Logs";

    var page = el("div", "log-page");

    var back = el("a", "log-back", "All logs");
    back.href = "logs.html";
    page.appendChild(back);

    var section = el("section", "log-region");
    section.id = region.id;
    if (country.showHeading) {
      section.appendChild(el("p", "log-region-eyebrow", country.name));
    }
    section.appendChild(el("h2", "log-region-heading", region.name));
    region.groups.forEach(function (group) {
      section.appendChild(renderGroup(group, photoIndex));
    });
    page.appendChild(section);

    var pager = renderRegionNav(country.regions, country.regions.indexOf(region));
    if (pager) page.appendChild(pager);

    content.appendChild(page);
  }

  /* ---- Routing ---- */

  function requestedRegion() {
    return new URLSearchParams(window.location.search).get("region") || "";
  }

  function findRegion(countries, slug) {
    var found = null;
    countries.forEach(function (country) {
      country.regions.forEach(function (region) {
        if (region.id === slug) found = { country: country, region: region };
      });
    });
    return found;
  }

  /** Anchors from when every region lived on one page: send "#minneapolis" to
      the region that owns it rather than dropping the visitor on the index. */
  function regionOwningAnchor(countries, anchor) {
    var owner = "";
    countries.forEach(function (country) {
      country.regions.forEach(function (region) {
        if (region.id === anchor) owner = region.id;
        region.groups.forEach(function (group) {
          if (group.id === anchor) owner = region.id;
          group.entries.forEach(function (entry) {
            if (entry.id === anchor) owner = region.id;
          });
        });
      });
    });
    return owner;
  }

  function render(entries, photos) {
    var photoIndex = LogCard.photosByLocation(photos);
    var countries = LogCard.buildTree(entries);
    var anchor = window.location.hash.slice(1);
    content.innerHTML = "";

    var slug = requestedRegion();
    if (!slug && anchor) {
      var owner = regionOwningAnchor(countries, anchor);
      if (owner) {
        window.location.replace("logs.html?region=" + owner + "#" + anchor);
        return;
      }
    }

    var match = slug ? findRegion(countries, slug) : null;
    if (match) {
      renderRegionPage(match.country, match.region, photoIndex);
    } else {
      if (slug) {
        content.appendChild(
          el("p", "log-empty", "No logs for that place yet. Here is everywhere else.")
        );
      }
      renderIndex(countries);
    }

    // A deep link cannot scroll to an anchor that did not exist at load time.
    if (anchor) {
      var target = document.getElementById(anchor);
      if (target) target.scrollIntoView();
    }
  }

  Promise.all([
    fetch("logs.json").then(function (r) { return r.json(); }),
    fetch("photos.json").then(function (r) { return r.json(); }),
  ])
    .then(function (results) {
      renderProfile(results[1].profile);
      render(results[0].entries || [], results[1].photos || []);
    })
    .catch(function (err) {
      console.error("Failed to load logs:", err);
      content.innerHTML =
        '<p class="log-empty">Could not load the logs. Make sure logs.json exists.</p>';
    });
})();
