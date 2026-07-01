(function () {
  const APP_ID = "ozon-photo-sheet-bookmarklet";
  const MAX_BYTES = 2_800_000;
  const PHOTOS_PER_SHEET = 9;
  const COLS = 3;
  const CELL_W = 520;
  const CELL_H = 694;
  const PAD = 28;
  const GAP = 18;
  const HEADER_H = 82;
  const LABEL_H = 34;

  const existing = document.getElementById(APP_ID);
  if (existing) existing.remove();

  const state = {
    loaded: [],
    objectUrls: []
  };

  function text(value) {
    return document.createTextNode(value);
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === "class") node.className = value;
      else if (key === "style") node.setAttribute("style", value);
      else node.setAttribute(key, value);
    });
    (children || []).forEach((child) => node.append(child));
    return node;
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.style.color = isError ? "#9f2418" : "#62685f";
  }

  function cleanupObjectUrls() {
    state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.objectUrls = [];
  }

  function normalizeEscapedUrl(value) {
    return value
      .replace(/\\u0026/g, "&")
      .replace(/\\u002F/g, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");
  }

  function isOzonImage(url) {
    return /^https:\/\/(?:ir(?:-\d+)?|cdn\d+)\.ozone\.ru\/s3\/multimedia/i.test(url)
      && /\.(?:jpe?g|webp|png)(?:[?#].*)?$/i.test(url)
      && !/abt-challenge|sprite|icon|logo|avatar/i.test(url);
  }

  function stripSizeSegment(url) {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      const parts = parsed.pathname.split("/").filter(Boolean);
      const cleaned = parts.filter((part) => !/^(?:w|wc|c|cw|h|ch)\d{2,5}$/i.test(part));
      parsed.pathname = "/" + cleaned.join("/");
      return parsed.href;
    } catch (_) {
      return url.split("?")[0];
    }
  }

  function keyFor(url) {
    return stripSizeSegment(url)
      .replace(/^https:\/\/ir-\d+\.ozone\.ru/i, "https://ir.ozone.ru")
      .replace(/^https:\/\/cdn\d+\.ozone\.ru/i, "https://cdn.ozone.ru")
      .toLowerCase();
  }

  function preferredCandidates(url) {
    const original = stripSizeSegment(url);
    const candidates = [original];
    try {
      const parsed = new URL(original);
      const parts = parsed.pathname.split("/");
      const file = parts.pop();
      const base = parts.join("/");
      candidates.push(`${parsed.origin}${base}/c1000/${file}`);
      candidates.push(`${parsed.origin}${base}/wc1000/${file}`);
      candidates.push(url.split("?")[0]);
    } catch (_) {
      candidates.push(url);
    }
    return [...new Set(candidates)];
  }

  function addUrl(map, url) {
    const clean = normalizeEscapedUrl(url || "").split(/[ "'<>)]/)[0];
    if (!isOzonImage(clean)) return null;
    const key = keyFor(clean);
    if (!map.has(key)) map.set(key, clean);
    return clean;
  }

  function collectUrls() {
    const map = new Map();
    const domEntries = [];

    document.querySelectorAll("img, source").forEach((node, nodeIndex) => {
      [node.currentSrc, node.src, node.getAttribute("src"), node.getAttribute("data-src")]
        .filter(Boolean)
        .forEach((url) => {
          const clean = addUrl(map, url);
          if (clean) domEntries.push({ node, nodeIndex, url: clean });
        });

      const srcset = node.getAttribute("srcset") || "";
      srcset.split(",").forEach((part) => {
        const url = part.trim().split(/\s+/)[0] || "";
        const clean = addUrl(map, url);
        if (clean) domEntries.push({ node, nodeIndex, url: clean });
      });
    });

    const galleryMap = selectLikelyGallery(domEntries);
    if (galleryMap.size >= 3) {
      return { urls: [...galleryMap.values()], confident: true };
    }

    try {
      performance.getEntriesByType("resource").forEach((entry) => addUrl(map, entry.name));
    } catch (_) {
      // Resource timing can be unavailable in restricted contexts.
    }

    const html = document.documentElement.innerHTML;
    const patterns = [
      /https:\\?\/\\?\/(?:ir(?:-\d+)?|cdn\d+)\.ozone\.ru\\?\/s3\\?\/multimedia[^"'<>\\\s]+?\.(?:jpg|jpeg|webp|png)/gi,
      /https:\/\/(?:ir(?:-\d+)?|cdn\d+)\.ozone\.ru\/s3\/multimedia[^"'<>\\\s]+?\.(?:jpg|jpeg|webp|png)/gi
    ];
    patterns.forEach((pattern) => {
      const matches = html.match(pattern) || [];
      matches.forEach((url) => addUrl(map, url));
    });

    return { urls: [...map.values()], confident: false };
  }

  function selectLikelyGallery(entries) {
    const groups = new Map();

    entries.forEach((entry) => {
      const clean = normalizeEscapedUrl(entry.url || "").split(/[ "'<>)]/)[0];
      if (!isOzonImage(clean)) return;
      const key = keyFor(clean);
      const node = entry.node;
      const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
      const nearest = node.closest ? node.closest("div[class], section[class], article[class]") : null;
      const groupKey = nearest ? `${nearest.tagName}:${nearest.className}` : "ungrouped";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({
        key,
        url: clean,
        nodeIndex: entry.nodeIndex,
        alt: node.getAttribute ? (node.getAttribute("alt") || "") : "",
        x: rect.x || 0,
        y: rect.y || 0,
        width: rect.width || node.width || 0,
        height: rect.height || node.height || 0
      });
    });

    const candidates = [...groups.values()]
      .map((items) => {
        const unique = new Map();
        items.forEach((item) => {
          if (!unique.has(item.key)) unique.set(item.key, item);
        });
        const values = [...unique.values()];
        const avgX = values.reduce((sum, item) => sum + item.x, 0) / Math.max(1, values.length);
        const avgW = values.reduce((sum, item) => sum + item.width, 0) / Math.max(1, values.length);
        const emptyAltShare = values.filter((item) => !item.alt).length / Math.max(1, values.length);
        const recommendationShare = values.filter((item) => /рекомендуем|похожие|покупают/i.test(item.alt)).length / Math.max(1, values.length);
        const firstIndex = Math.min(...values.map((item) => item.nodeIndex));
        const verticalSpread = Math.max(...values.map((item) => item.y)) - Math.min(...values.map((item) => item.y));
        const looksLikeMainGallery =
          values.length >= 3
          && emptyAltShare > 0.75
          && recommendationShare === 0
          && avgX < 240
          && avgW <= 160
          && firstIndex <= 30
          && verticalSpread > 120;
        const score =
          (looksLikeMainGallery ? 1000 : 0)
          + Math.min(values.length, 24) * 4
          + (emptyAltShare > 0.8 ? 120 : 0)
          + (recommendationShare > 0 ? -300 : 0)
          + (avgX < 220 ? 120 : -80)
          + (avgW <= 130 ? 80 : -40)
          + (verticalSpread > 250 ? 25 : 0)
          - Math.max(0, firstIndex - 20) * 8;
        return { values, score, firstIndex, looksLikeMainGallery };
      })
      .filter((group) => group.values.length >= 3)
      .sort((a, b) => Number(b.looksLikeMainGallery) - Number(a.looksLikeMainGallery) || b.score - a.score || a.firstIndex - b.firstIndex);

    const map = new Map();
    (candidates[0]?.values || [])
      .sort((a, b) => a.nodeIndex - b.nodeIndex)
      .forEach((item) => {
        if (!map.has(item.key)) map.set(item.key, item.url);
      });
    return map;
  }

  function loadImageFromCandidates(candidates) {
    return new Promise((resolve, reject) => {
      let index = 0;
      const tryNext = () => {
        if (index >= candidates.length) {
          reject(new Error("image failed"));
          return;
        }
        const url = candidates[index];
        index += 1;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => {
          if (image.naturalWidth < 260 || image.naturalHeight < 260) {
            tryNext();
            return;
          }
          resolve({ image, url, selected: true });
        };
        image.onerror = tryNext;
        image.src = url;
      };
      tryNext();
    });
  }

  function drawCover(ctx, image, x, y, w, h) {
    const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (image.naturalWidth - sw) / 2;
    const sy = (image.naturalHeight - sh) / 2;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  async function canvasToBlob(canvas) {
    for (const quality of [0.88, 0.82, 0.76, 0.7, 0.64]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BYTES) return blob;
      if (quality === 0.64 && blob) return blob;
    }
    throw new Error("Не удалось создать JPG.");
  }

  async function createSheetBlob(images, sheetIndex, totalSheets, startIndex) {
    const rows = Math.ceil(images.length / COLS);
    const width = PAD * 2 + COLS * CELL_W + (COLS - 1) * GAP;
    const height = PAD + HEADER_H + rows * (CELL_H + LABEL_H) + (rows - 1) * GAP + PAD;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#f5f6f3";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#20231f";
    ctx.font = "700 36px system-ui, sans-serif";
    ctx.fillText(`Ozon · лист ${sheetIndex + 1} из ${totalSheets}`, PAD, 46);
    ctx.fillStyle = "#62685f";
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillText(`Фото ${startIndex + 1}-${startIndex + images.length}`, PAD, 76);

    images.forEach((item, offset) => {
      const row = Math.floor(offset / COLS);
      const col = offset % COLS;
      const x = PAD + col * (CELL_W + GAP);
      const y = PAD + HEADER_H + row * (CELL_H + LABEL_H + GAP);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, CELL_W, CELL_H);
      drawCover(ctx, item.image, x, y, CELL_W, CELL_H);
      ctx.strokeStyle = "#d8ddd2";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, CELL_W, CELL_H);
      ctx.fillStyle = "#20231f";
      ctx.font = "700 24px system-ui, sans-serif";
      ctx.fillText(String(startIndex + offset + 1).padStart(2, "0"), x, y + CELL_H + 26);
    });

    return canvasToBlob(canvas);
  }

  function renderSelection(items) {
    selection.replaceChildren();
    if (!items.length) return;

    selection.append(el("div", {
      style: "grid-column:1/-1;color:#20231f;font-weight:900;"
    }, [text("Проверьте фото перед сборкой")]));

    items.forEach((item, index) => {
      const checkbox = el("input", {
        type: "checkbox",
        checked: "checked",
        "data-photo-index": String(index),
        style: "position:absolute;left:8px;top:8px;width:18px;height:18px;accent-color:#176b5b;"
      });
      checkbox.addEventListener("change", () => {
        item.selected = checkbox.checked;
      });
      const label = el("label", {
        style: "position:relative;display:grid;gap:6px;cursor:pointer;"
      }, [
        checkbox,
        el("img", {
          src: item.url,
          alt: `Фото ${index + 1}`,
          style: "width:100%;aspect-ratio:3/4;object-fit:cover;border:1px solid #d8ddd2;border-radius:6px;background:#fff;"
        }),
        el("span", {
          style: "font:700 12px/1 ui-monospace,Consolas,monospace;color:#62685f;"
        }, [text(String(index + 1).padStart(2, "0"))])
      ]);
      selection.append(label);
    });
  }

  async function scan() {
    cleanupObjectUrls();
    results.replaceChildren();
    selection.replaceChildren();
    state.loaded = [];
    findButton.disabled = true;
    buildButton.disabled = true;

    const found = collectUrls();
    if (!found.urls.length) {
      setStatus("Не получилось уверенно найти фото. Пролистайте галерею Ozon и нажмите «Найти фото» ещё раз. Если не помогло, пришлите ссылку на товар.", true);
      findButton.disabled = false;
      return;
    }

    setStatus(`Нашёл ${found.urls.length} возможных фото. Загружаю крупные версии...`);
    for (let index = 0; index < found.urls.length; index += 1) {
      try {
        const item = await loadImageFromCandidates(preferredCandidates(found.urls[index]));
        state.loaded.push(item);
      } catch (_) {
        // Skip unavailable or tiny images.
      }
      setStatus(`Загружено ${state.loaded.length} фото из ${found.urls.length} найденных ссылок...`);
    }

    findButton.disabled = false;

    if (!state.loaded.length) {
      setStatus("Ссылки нашлись, но браузер не смог загрузить крупные фото. Пролистайте карточку и попробуйте ещё раз.", true);
      return;
    }

    renderSelection(state.loaded);
    buildButton.disabled = false;
    if (found.confident) {
      setStatus(`Нашёл ${state.loaded.length} фото. Проверьте выбор и нажмите «Собрать выбранные».`);
    } else {
      setStatus(`Не получилось точно отделить галерею от остальных картинок. Оставьте галочки только на фото товара.`);
    }
  }

  async function buildSelected() {
    const selected = state.loaded.filter((item) => item.selected);
    if (!selected.length) {
      setStatus("Не выбрано ни одного фото. Оставьте галочки на нужных фото товара.", true);
      return;
    }

    cleanupObjectUrls();
    results.replaceChildren();
    buildButton.disabled = true;
    findButton.disabled = true;

    const chunks = [];
    for (let index = 0; index < selected.length; index += PHOTOS_PER_SHEET) {
      chunks.push(selected.slice(index, index + PHOTOS_PER_SHEET));
    }

    const links = [];
    for (let index = 0; index < chunks.length; index += 1) {
      setStatus(`Собираю лист ${index + 1} из ${chunks.length}...`);
      const blob = await createSheetBlob(chunks[index], index, chunks.length, index * PHOTOS_PER_SHEET);
      const url = URL.createObjectURL(blob);
      state.objectUrls.push(url);
      const name = `ozon-sheet-${String(index + 1).padStart(2, "0")}.jpg`;
      const link = el("a", {
        href: url,
        download: name,
        style: "display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 14px;border-radius:7px;background:#176b5b;color:#fff;font-weight:900;text-decoration:none;"
      }, [text(`Скачать лист ${index + 1}`)]);
      links.push(link);
      results.append(el("div", {
        style: "display:grid;gap:8px;padding:10px;border:1px solid #d8ddd2;border-radius:8px;background:#fff;"
      }, [
        el("div", { style: "display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;" }, [
          el("div", { style: "font-weight:800;" }, [text(`Лист ${index + 1}: ${chunks[index].length} фото, ${(blob.size / 1024 / 1024).toFixed(2)} МБ`)]),
          link
        ]),
        el("img", { src: url, style: "width:100%;height:auto;border:1px solid #d8ddd2;border-radius:6px;" })
      ]));
    }

    if (links.length > 1) {
      const all = el("button", {
        type: "button",
        style: "min-height:42px;padding:0 14px;border:0;border-radius:7px;background:#20231f;color:#fff;font-weight:900;cursor:pointer;"
      }, [text("Скачать все")]);
      all.addEventListener("click", () => links.forEach((link, index) => setTimeout(() => link.click(), index * 250)));
      results.prepend(all);
    }

    setStatus(`Готово: ${selected.length} фото разложены на ${chunks.length} лист(а).`);
    buildButton.disabled = false;
    findButton.disabled = false;
  }

  const root = el("div", {
    id: APP_ID,
    style: "position:fixed;inset:16px;z-index:2147483647;overflow:auto;padding:16px;border:1px solid #d8ddd2;border-radius:10px;background:#f5f6f3;color:#20231f;font:15px/1.45 Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 25px 100px rgba(0,0,0,.28);"
  });
  const status = el("div", { style: "color:#62685f;" }, [text("Готово к поиску фото.")]);
  const selection = el("div", {
    style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px;margin-top:14px;"
  });
  const results = el("div", { style: "display:grid;gap:12px;margin-top:14px;" });
  const findButton = el("button", {
    type: "button",
    style: "min-height:44px;padding:0 16px;border:0;border-radius:7px;background:#176b5b;color:#fff;font-weight:900;cursor:pointer;"
  }, [text("Найти фото")]);
  const buildButton = el("button", {
    type: "button",
    disabled: "disabled",
    style: "min-height:44px;padding:0 16px;border:0;border-radius:7px;background:#20231f;color:#fff;font-weight:900;cursor:pointer;"
  }, [text("Собрать выбранные")]);
  const closeButton = el("button", {
    type: "button",
    style: "min-height:44px;padding:0 16px;border:1px solid #d8ddd2;border-radius:7px;background:#fff;color:#20231f;font-weight:900;cursor:pointer;"
  }, [text("Закрыть")]);

  findButton.addEventListener("click", scan);
  buildButton.addEventListener("click", buildSelected);
  closeButton.addEventListener("click", () => {
    cleanupObjectUrls();
    root.remove();
  });

  root.append(
    el("div", { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;flex-wrap:wrap;" }, [
      el("div", { style: "min-width:min(100%,360px);" }, [
        el("div", { style: "font-size:22px;font-weight:900;margin-bottom:4px;" }, [text("Ozon фото в листы")]),
        el("div", { style: "color:#62685f;" }, [text("Сначала пролистайте галерею товара. Потом найдите фото, проверьте галочки и соберите листы 3×3.")])
      ]),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;" }, [findButton, buildButton, closeButton])
    ]),
    status,
    selection,
    results
  );

  document.body.append(root);
  setStatus("Нажмите «Найти фото». Если фото мало, пролистайте галерею Ozon и нажмите ещё раз.");
})();
