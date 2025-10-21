  // --- Popup/modal for section plots ---
  function showPopup(sectionName, plots) {
    let modal = document.getElementById('sectionPopup');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sectionPopup';
      modal.style.position = 'fixed';
      modal.style.top = '20%';
      modal.style.left = '50%';
      modal.style.transform = 'translate(-50%, 0)';
      modal.style.background = '#fff';
      modal.style.border = '1px solid #333';
      modal.style.padding = '20px';
      modal.style.zIndex = 1000;
      modal.style.maxHeight = '60vh';
      modal.style.overflowY = 'auto';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `<h3>${sectionName}</h3>
      <ul>${plots.map(p => `<li>Plot #${p.plot_number} (${p.coord_x}, ${p.coord_y})</li>`).join('')}</ul>
      <button onclick="document.getElementById('sectionPopup').remove()">Close</button>`;
  }
/**
 * Coordinate Helper Overlay
 * -------------------------
 * Visualize and verify plot section boundaries directly over a static map image.
 * Shows rectangles for each section based on known coordinates.
 * Clicking copies the coordinate (X, Y).
 */

document.addEventListener("DOMContentLoaded", () => {

  const img = document.querySelector("#mapImage");
  if (!img) return console.error("❌ #mapImage not found. Add id='mapImage' to your map image.");
  const container = img.parentElement;
  container.style.position = "relative";
  img.style.display = "block";

  // --- Section polygons (replace with your actual data if needed) ---
  const sections = {
    "Family Estates": {
      coords: [[
        { lat: 285.9296875, lng: 344.625 },
        { lat: 326.9296875, lng: 473.625 },
        { lat: 214.1796875, lng: 499.875 },
        { lat: 172.1796875, lng: 372.625 }
      ]], color: "#4A90E2"
    },
    "Family Estates ": {
      coords: [[
        { lat: 284.4296875, lng: 377.5 },
        { lat: 290.4296875, lng: 397 },
        { lat: 257.6796875, lng: 404.75 },
        { lat: 250.6796875, lng: 384.5 }
      ]], color: "#E24A90"
    },
    "LEVEL 1": {
      coords: [[
        { lat: 338.4296875, lng: 588.125 },
        { lat: 344.1796875, lng: 603.625 },
        { lat: 315.9296875, lng: 610.625 },
        { lat: 311.1796875, lng: 595.125 }
      ]], color: "#904AE2"
    },
    "LEVEL 2": {
      coords: [[
        { lat: 302.6796875, lng: 596.625 },
        { lat: 308.1796875, lng: 613.125 },
        { lat: 279.1796875, lng: 619.625 },
        { lat: 274.6796875, lng: 602.625 }
      ]], color: "#904AE2"
    },
    "LEVEL 3": {
      coords: [[
        { lat: 266.9296875, lng: 604.875 },
        { lat: 271.9296875, lng: 620.875 },
        { lat: 243.6796875, lng: 628.875 },
        { lat: 239.4296875, lng: 612.375 }
      ]], color: "#904AE2"
    },
    "Heritage Garden A": {
      coords: [[
        { lat: 433.58984375, lng: 636.1875 },
        { lat: 453.08984375, lng: 636.1875 },
        { lat: 453.08984375, lng: 663.0625 },
        { lat: 433.58984375, lng: 663.0625 }
      ]], color: "#E24A90"
    },
    "Heritage Garden B": {
      coords: [[
        { lat: 432.33984375, lng: 669.9375 },
        { lat: 452.96484375, lng: 669.9375 },
        { lat: 452.96484375, lng: 696.6875 },
        { lat: 432.33984375, lng: 696.6875 }
      ]], color: "#E2904A"
    },
    "Veterans Memorial A": {
      coords: [[
        { lat: 448.96484375, lng: 793.8125 },
        { lat: 468.33984375, lng: 793.8125 },
        { lat: 468.33984375, lng: 820.9375 },
        { lat: 448.96484375, lng: 820.9375 }
      ]], color: "#90E24A"
    },
    "Veterans Memorial B": {
      coords: [[
        { lat: 448.08984375, lng: 890.5625 },
        { lat: 468.83984375, lng: 890.5625 },
        { lat: 468.83984375, lng: 918.0625 },
        { lat: 448.08984375, lng: 918.0625 }
      ]], color: "#E24A90"
    },
    "Serenity Columbarium A": {
      coords: [[
        { lat: 194.1796875, lng: 795.375 },
        { lat: 212.6796875, lng: 795.375 },
        { lat: 212.6796875, lng: 821.375 },
        { lat: 194.1796875, lng: 821.375 }
      ]], color: "#4A90E2"
    },
    "Serenity Columbarium B": {
      coords: [[
        { lat: 193.9296875, lng: 888.875 },
        { lat: 212.1796875, lng: 888.875 },
        { lat: 212.1796875, lng: 916.125 },
        { lat: 193.9296875, lng: 916.125 }
      ]], color: "#904AE2"
    },
    "OPEN SPACE": {
      coords: [[
        { lat: 129.359375, lng: 538.75 },
        { lat: 151.359375, lng: 759.25 },
        { lat: 91.859375, lng: 762.25 },
        { lat: 71.859375, lng: 543.75 }
      ]], color: "#904AE2"
    },
    "CHAPEL": {
      coords: [[
        { lat: 91.58984375, lng: 283.9375 },
        { lat: 98.21484375, lng: 343.9375 },
        { lat: 45.4296875, lng: 349.875 },
        { lat: 38.1796875, lng: 289.125 }
      ]], color: "#E24A90"
    },
    "OFFICE": {
      coords: [[
        { lat: 101.9296875, lng: 362.375 },
        { lat: 108.9296875, lng: 423.125 },
        { lat: 57.1796875, lng: 427.875 },
        { lat: 48.9296875, lng: 366.875 }
      ]], color: "#90E24A"
    },
    "CREMATORIUM": {
      coords: [[
        { lat: 114.9296875, lng: 441.125 },
        { lat: 122.6796875, lng: 518.375 },
        { lat: 70.4296875, lng: 522.875 },
        { lat: 62.6796875, lng: 445.875 }
      ]], color: "#E2904A"
    },
    "Memorial Chapel & Administration": {
      coords: [[
        { lat: 317.9296875, lng: 498.875 },
        { lat: 352.6796875, lng: 607.125 },
        { lat: 238.6796875, lng: 635.375 },
        { lat: 205.1796875, lng: 526.625 }
      ]], color: "#E24A90"
    },
    "Heritage Gardens": {
      coords: [[
        { lat: 427.859375, lng: 631.25 },
        { lat: 608.859375, lng: 631.25 },
        { lat: 608.859375, lng: 701.75 },
        { lat: 427.859375, lng: 701.75 }
      ]], color: "#90E24A"
    },
    "Veterans Memorial": {
      coords: [[
        { lat: 444.359375, lng: 753.25 },
        { lat: 624.359375, lng: 753.25 },
        { lat: 624.359375, lng: 920.25 },
        { lat: 444.359375, lng: 920.25 }
      ]], color: "#E2904A"
    },
    "Serenity Columbarium": {
      coords: [[
        { lat: 186.359375, lng: 754.25 },
        { lat: 368.859375, lng: 754.25 },
        { lat: 368.859375, lng: 921.25 },
        { lat: 186.359375, lng: 921.25 }
      ]], color: "#904AE2"
    },
    "ENTRANCE": {
      coords: [[
        { lat: 145.359375, lng: 189.25 },
        { lat: 172.359375, lng: 229.75 },
        { lat: 110.859375, lng: 261.25 },
        { lat: 87.859375, lng: 219.25 }
      ]], color: "#4A90E2"
    }
  };
  // --- Draw section polygons and add click event ---
  function drawSections() {
    const { scaleX, scaleY } = getScale();
    Object.entries(sections).forEach(([name, section]) => {
      const points = section.coords[0];
      // Convert lat/lng to image X/Y
      const xyPoints = points.map(pt => [pt.lng * scaleX, pt.lat * scaleY]);
      // Get bounding box for overlay div
      const xs = xyPoints.map(p => p[0]);
      const ys = xyPoints.map(p => p[1]);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      const width = Math.max(...xs) - left;
      const height = Math.max(...ys) - top;

      // Section overlay (transparent box)
      const box = document.createElement("div");
      box.classList.add("coord-section");
      box.style.position = "absolute";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.border = `2px solid ${section.color}`;
      box.style.background = section.color + '22'; // semi-transparent
      box.style.cursor = "pointer";
      box.style.borderRadius = "6px";
      box.title = name;

      // Label
      const label = document.createElement("div");
      label.innerText = name;
      label.style.position = "absolute";
      label.style.top = "-18px";
      label.style.left = "0";
      label.style.background = section.color;
      label.style.color = "#fff";
      label.style.fontSize = "11px";
      label.style.padding = "2px 4px";
      label.style.borderRadius = "3px";
      box.appendChild(label);

      // Click: fetch plots in bounds and show popup
      box.addEventListener('click', () => {
        const lats = points.map(pt => pt.lat);
        const lngs = points.map(pt => pt.lng);
        const latMin = Math.min(...lats);
        const latMax = Math.max(...lats);
        const lngMin = Math.min(...lngs);
        const lngMax = Math.max(...lngs);
        fetch(`/plots/in-bounds?latMin=${latMin}&latMax=${latMax}&lngMin=${lngMin}&lngMax=${lngMax}`)
          .then(res => res.json())
          .then(plots => {
            showPopup(name, plots);
          });
      });

      container.appendChild(box);
    });
  }

  // --- Popup/modal for section plots ---
  function showPopup(sectionName, plots) {
    let modal = document.getElementById('sectionPopup');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'sectionPopup';
      modal.style.position = 'fixed';
      modal.style.top = '20%';
      modal.style.left = '50%';
      modal.style.transform = 'translate(-50%, 0)';
      modal.style.background = '#fff';
      modal.style.border = '1px solid #333';
      modal.style.padding = '20px';
      modal.style.zIndex = 1000;
      modal.style.maxHeight = '60vh';
      modal.style.overflowY = 'auto';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `<h3>${sectionName}</h3>
      <ul>${plots.map(p => `<li>Plot #${p.plot_number} (${p.coord_x}, ${p.coord_y})</li>`).join('')}</ul>
      <button onclick="document.getElementById('sectionPopup').remove()">Close</button>`;
  }

  // 🧩 Create coordinate box display
  const coordBox = document.createElement("div");
  coordBox.style.position = "fixed";
  coordBox.style.top = "16px";
  coordBox.style.right = "16px";
  coordBox.style.background = "rgba(255,255,255,0.9)";
  coordBox.style.border = "1px solid #ccc";
  coordBox.style.borderRadius = "6px";
  coordBox.style.padding = "6px 10px";
  coordBox.style.fontSize = "13px";
  coordBox.style.fontFamily = "monospace";
  coordBox.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
  coordBox.innerHTML = "Lng: -, Lat: -";
  document.body.appendChild(coordBox);


  // 📏 Calculate overlay scale to match rendered image
  function getScale() {
    const rect = img.getBoundingClientRect();
    return {
      scaleX: rect.width / img.naturalWidth,
      scaleY: rect.height / img.naturalHeight,
      rect
    };
  }

  // 🟩 Draw plot markers from backend
  function drawPlots(plots) {
    const { scaleX, scaleY } = getScale();
    plots.forEach(plot => {
      if (plot.coord_x == null || plot.coord_y == null) return;
      // Convert DB coords (lng, lat) to image X/Y
      const x = plot.coord_x * scaleX;
      const y = plot.coord_y * scaleY;

      // Marker overlay
      const marker = document.createElement("div");
      marker.classList.add("coord-section");
      marker.style.position = "absolute";
      marker.style.left = `${x - 6}px`;
      marker.style.top = `${y - 6}px`;
      marker.style.width = `12px`;
      marker.style.height = `12px`;
      marker.style.background = plot.color || "#0078d7";
      marker.style.border = "2px solid #fff";
      marker.style.borderRadius = "50%";
      marker.style.cursor = "pointer";
      marker.title = plot.section_name || plot.plot_number || "Plot";

      // Hover shows live coords
      marker.addEventListener("mousemove", (e) => {
        coordBox.innerHTML = `Lng: ${plot.coord_x}, Lat: ${plot.coord_y}`;
      });
      marker.addEventListener("mouseleave", () => {
        coordBox.innerHTML = "Lng: -, Lat: -";
      });

      // Click copies coord
      marker.addEventListener("click", () => {
        const text = `${plot.coord_x}, ${plot.coord_y}`;
        navigator.clipboard.writeText(text).then(() => {
          coordBox.innerHTML = `✅ Copied: ${text}`;
          setTimeout(() => (coordBox.innerHTML = `Lng: ${plot.coord_x}, Lat: ${plot.coord_y}`), 1000);
        });
      });

      container.appendChild(marker);
    });
  }

  // Fetch plot data from backend and draw
  function loadPlots() {
    fetch("/plots")
      .then(res => res.json())
      .then(data => {
        document.querySelectorAll(".coord-section").forEach(e => e.remove());
        drawPlots(data);
      })
      .catch(err => {
        console.error("Failed to load plot coordinates:", err);
      });
  }

  // Initial draw
  document.querySelectorAll(".coord-section").forEach(e => e.remove());
  drawSections();
  loadPlots();
  // Redraw on resize (to keep scale correct)
  window.addEventListener("resize", () => {
    document.querySelectorAll(".coord-section").forEach(e => e.remove());
    drawSections();
    loadPlots();
  });

  console.log("📍 Section overlays active. Click a section to view plots in that area. Hover or click markers to inspect coordinates.");
});
