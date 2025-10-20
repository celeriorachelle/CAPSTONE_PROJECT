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

  // 🧭 Coordinates for each section (top-left to bottom-right style)
  const sections = {
    "Family Estates": [
      [278, 455], [380, 410], [300, 573], [401, 529]
    ],
    "Memorial": [
      [402, 421], [488, 381], [510, 503], [423, 538]
    ],
    "Heritage": [
      [508, 99], [563, 99], [507, 298], [562, 295]
    ],
    "Veterans": [
      [606, 83], [740, 83], [606, 276], [740, 278]
    ],
    "Serenity": [
      [608, 366], [741, 362], [606, 558], [738, 559]
    ],
    "Chapel": [
      [230, 665], [276, 657], [278, 711], [231, 717]
    ],
    "Office": [
      [293, 654], [338, 648], [343, 701], [296, 708]
    ],
    "Crematorium": [
      [416, 633], [419, 686], [358, 694], [355, 638]
    ]
  };

  // 🧱 Make the image container relative
  const container = img.parentElement;
  container.style.position = "relative";
  img.style.display = "block";

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
  coordBox.innerHTML = "X: -, Y: -";
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

  // 🟩 Draw polygon overlays
  function drawOverlays() {
    const { scaleX, scaleY } = getScale();

    Object.entries(sections).forEach(([name, points]) => {
      // Get bounding box
      const xs = points.map(p => p[0]);
      const ys = points.map(p => p[1]);
      const left = Math.min(...xs) * scaleX;
      const top = Math.min(...ys) * scaleY;
      const width = (Math.max(...xs) - Math.min(...xs)) * scaleX;
      const height = (Math.max(...ys) - Math.min(...ys)) * scaleY;

      // Box overlay
      const box = document.createElement("div");
      box.classList.add("coord-section");
      box.style.position = "absolute";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      box.style.border = "2px dashed #0078d7";
      box.style.background = "rgba(0,120,215,0.15)";
      box.style.cursor = "crosshair";
      box.style.borderRadius = "6px";

      // Label
      const label = document.createElement("div");
      label.innerText = name;
      label.style.position = "absolute";
      label.style.top = "-18px";
      label.style.left = "0";
      label.style.background = "#0078d7";
      label.style.color = "#fff";
      label.style.fontSize = "11px";
      label.style.padding = "2px 4px";
      label.style.borderRadius = "3px";
      box.appendChild(label);

      // Hover shows live coords
      box.addEventListener("mousemove", (e) => {
        const rect = img.getBoundingClientRect();
        const x = Math.round((e.clientX - rect.left) / scaleX);
        const y = Math.round((e.clientY - rect.top) / scaleY);
        coordBox.innerHTML = `X: ${x}, Y: ${y}`;
      });

      // Click copies coord
      box.addEventListener("click", (e) => {
        const rect = img.getBoundingClientRect();
        const x = Math.round((e.clientX - rect.left) / scaleX);
        const y = Math.round((e.clientY - rect.top) / scaleY);
        const text = `${x}, ${y}`;
        navigator.clipboard.writeText(text).then(() => {
          coordBox.innerHTML = `✅ Copied: ${text}`;
          setTimeout(() => (coordBox.innerHTML = `X: ${x}, Y: ${y}`), 1000);
        });
      });

      container.appendChild(box);
    });
  }

  // Initial draw
  drawOverlays();
  // Redraw on resize (to keep scale correct)
  window.addEventListener("resize", () => {
    document.querySelectorAll(".coord-section").forEach(e => e.remove());
    drawOverlays();
  });

  console.log("📍 Coordinate Helper Overlay active. Hover or click boxes to inspect coordinates.");
});
