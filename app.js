(function () {
  const form = document.querySelector("#sheet-form");
  const input = document.querySelector("#card-input");
  const button = document.querySelector("#build-button");
  const statusEl = document.querySelector("#status");
  const meterFill = document.querySelector("#meter-fill");
  const results = document.querySelector("#results");
  const planSummary = document.querySelector("#plan-summary");
  const previewCells = [...document.querySelectorAll("[data-preview-cell]")];
  const tabs = [...document.querySelectorAll("[data-platform]")];
  const panels = {
    wb: document.querySelector("#panel-wb"),
    ozon: document.querySelector("#panel-ozon")
  };
  const bookmarkletLink = document.querySelector("#bookmarklet-link");
  const bookmarkletCode = document.querySelector("#bookmarklet-code");
  const copyButton = document.querySelector("#copy-button");
  const copyStatus = document.querySelector("#copy-status");
  const bookmarkletStatus = document.querySelector("#bookmarklet-status");

  const BASKET_MIN = 1;
  const BASKET_MAX = 80;
  const PHOTOS_PER_SHEET = 9;
  const COLS = 3;
  const CELL_W = 520;
  const CELL_H = 694;
  const PAD = 28;
  const GAP = 18;
  const HEADER_H = 82;
  const LABEL_H = 34;
  const MAX_BYTES = 2_500_000;

  let currentUrls = [];
  let bookmarkletText = "";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await buildSheets();
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectPlatform(tab.dataset.platform));
  });

  setupBookmarklet();
  if (window.location.hash.toLowerCase() === "#ozon") {
    selectPlatform("ozon");
  }
  renderPreview([]);

  function selectPlatform(platform) {
    tabs.forEach((tab) => {
      const active = tab.dataset.platform === platform;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    Object.entries(panels).forEach(([key, panel]) => {
      const active = key === platform;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });

    if (platform === "ozon") {
      setStatus("Для Ozon откройте карточку товара и нажмите кнопку-закладку на самой странице.");
      setProgress(0, 0);
      planSummary.textContent = "Ozon-листы появятся в окне, которое откроется поверх карточки товара.";
    } else {
      setStatus("Готово к сборке.");
      setProgress(0, 0);
      planSummary.textContent = "Здесь появятся первые фото и количество листов.";
    }
  }

  function setStatus(message, isError = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  }

  function setProgress(done, total) {
    const value = total > 0 ? Math.round((done / total) * 100) : 0;
    meterFill.style.width = `${Math.min(100, Math.max(0, value))}%`;
  }

  function formatSheets(total) {
    const chunks = [];
    for (let remaining = total; remaining > 0; remaining -= PHOTOS_PER_SHEET) {
      chunks.push(Math.min(PHOTOS_PER_SHEET, remaining));
    }
    return chunks.join(" + ");
  }

  function renderPreview(images) {
    previewCells.forEach((cell, index) => {
      cell.replaceChildren();
      const image = images[index];
      if (image) {
        const thumbnail = document.createElement("img");
        thumbnail.src = image.currentSrc || image.src;
        thumbnail.alt = `Фото ${index + 1}`;
        cell.append(thumbnail);
      } else {
        cell.textContent = String(index + 1).padStart(2, "0");
      }
    });
  }

  async function setupBookmarklet() {
    if (!bookmarkletLink || !bookmarkletCode) return;

    try {
      const response = await fetch("ozon-bookmarklet-source.js", { cache: "no-store" });
      if (!response.ok) throw new Error("source unavailable");
      const source = await response.text();
      bookmarkletText = `javascript:${encodeURIComponent(source.replace(/^\uFEFF/, ""))}`;
      bookmarkletLink.href = bookmarkletText;
      bookmarkletCode.value = bookmarkletText;
      bookmarkletStatus.textContent = "Перетащите кнопку на панель закладок. Она запускается только на открытой карточке Ozon.";
    } catch (_) {
      bookmarkletStatus.textContent = "Не удалось подготовить кнопку Ozon. Обновите страницу и попробуйте ещё раз.";
      bookmarkletStatus.classList.add("error");
    }
  }

  copyButton?.addEventListener("click", async () => {
    if (!bookmarkletText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(bookmarkletText);
      } else {
        bookmarkletCode.focus();
        bookmarkletCode.select();
        document.execCommand("copy");
      }
      copyStatus.textContent = "Код скопирован. Создайте закладку и вставьте его в поле адреса.";
    } catch (_) {
      bookmarkletCode.focus();
      bookmarkletCode.select();
      copyStatus.textContent = "Код выделен. Скопируйте его вручную.";
    }
  });

  function parseNmId(value) {
    const trimmed = value.trim();
    const catalogMatch = trimmed.match(/catalog\/(\d{5,})/i);
    if (catalogMatch) return Number(catalogMatch[1]);

    const plainMatch = trimmed.match(/\b(\d{5,})\b/);
    if (plainMatch) return Number(plainMatch[1]);

    return null;
  }

  function pathsFor(nmId, basket, imageIndex) {
    const vol = Math.floor(nmId / 100000);
    const part = Math.floor(nmId / 1000);
    const base = `https://basket-${String(basket).padStart(2, "0")}.wbbasket.ru/vol${vol}/part${part}/${nmId}`;
    return {
      cardJson: `${base}/info/ru/card.json`,
      image: `${base}/images/big/${imageIndex}.webp`
    };
  }

  async function discoverCard(nmId) {
    for (let basket = BASKET_MIN; basket <= BASKET_MAX; basket += 1) {
      const { cardJson } = pathsFor(nmId, basket, 1);
      try {
        const response = await fetch(cardJson, { cache: "no-store" });
        if (!response.ok) continue;
        const card = await response.json();
        const count = Number(card?.media?.photo_count || card?.media?.photos_count || 0);
        if (count > 0) {
          return { basket, count, card, cardJson };
        }
      } catch (_) {
        continue;
      }
    }
    throw new Error("Не получилось найти фото этой карточки WB. Проверьте артикул или ссылку.");
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Не получилось загрузить одно из фото WB.`));
      image.src = url;
    });
  }

  async function canvasToBlob(canvas) {
    for (const quality of [0.88, 0.82, 0.76, 0.7, 0.64]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_BYTES) return blob;
      if (quality === 0.64 && blob) return blob;
    }
    throw new Error("Браузер не смог создать итоговый JPG.");
  }

  function drawCover(ctx, image, x, y, w, h) {
    const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (image.naturalWidth - sw) / 2;
    const sy = (image.naturalHeight - sh) / 2;
    ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  }

  async function createSheetBlob(nmId, images, sheetIndex, totalSheets, startIndex) {
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
    ctx.fillText(`WB ${nmId} · лист ${sheetIndex + 1} из ${totalSheets}`, PAD, 46);
    ctx.fillStyle = "#62685f";
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillText(`Фото ${startIndex + 1}-${startIndex + images.length}`, PAD, 76);

    images.forEach((image, offset) => {
      const row = Math.floor(offset / COLS);
      const col = offset % COLS;
      const x = PAD + col * (CELL_W + GAP);
      const y = PAD + HEADER_H + row * (CELL_H + LABEL_H + GAP);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, CELL_W, CELL_H);
      drawCover(ctx, image, x, y, CELL_W, CELL_H);
      ctx.strokeStyle = "#d8ddd2";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, CELL_W, CELL_H);

      ctx.fillStyle = "#20231f";
      ctx.font = "700 24px system-ui, sans-serif";
      ctx.fillText(String(startIndex + offset + 1).padStart(2, "0"), x, y + CELL_H + 26);
    });

    return canvasToBlob(canvas);
  }

  function makeDownload(blob) {
    const url = URL.createObjectURL(blob);
    currentUrls.push(url);
    return url;
  }

  function clearResults() {
    currentUrls.forEach((url) => URL.revokeObjectURL(url));
    currentUrls = [];
    results.replaceChildren();
    setProgress(0, 0);
    renderPreview([]);
    planSummary.textContent = "Здесь появятся первые фото и количество листов.";
  }

  function renderSheets(nmId, sheetEntries) {
    results.replaceChildren();

    if (sheetEntries.length > 1) {
      const allButton = document.createElement("button");
      allButton.className = "primary-action download-all";
      allButton.type = "button";
      allButton.textContent = "Скачать все листы";
      allButton.addEventListener("click", () => {
        sheetEntries.forEach((entry, index) => {
          window.setTimeout(() => entry.link.click(), index * 250);
        });
      });
      results.append(allButton);
    }

    sheetEntries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "sheet-card";

      const header = document.createElement("header");
      const text = document.createElement("div");
      const title = document.createElement("p");
      title.className = "sheet-title";
      title.textContent = entry.title;
      const meta = document.createElement("p");
      meta.className = "sheet-meta";
      meta.textContent = `${entry.photoCount} фото · ${entry.sizeMb} МБ`;
      text.append(title, meta);

      const link = document.createElement("a");
      link.className = "download-link";
      link.href = entry.url;
      link.download = entry.fileName;
      link.textContent = `Скачать лист ${entry.index + 1}`;

      const image = document.createElement("img");
      image.src = entry.url;
      image.alt = `${entry.title} для артикула ${nmId}`;

      header.append(text, link);
      card.append(header, image);
      results.append(card);
      entry.link = link;
    });
  }

  async function buildSheets() {
    clearResults();
    const nmId = parseNmId(input.value);
    if (!nmId) {
      setStatus("Не вижу артикул. Вставьте число или ссылку на карточку WB.", true);
      return;
    }

    button.disabled = true;
    input.disabled = true;

    try {
      setStatus(`Ищу карточку ${nmId} на серверах WB...`);
      const cardInfo = await discoverCard(nmId);
      const total = cardInfo.count;
      const sheetCount = Math.ceil(total / PHOTOS_PER_SHEET);
      const urls = Array.from({ length: total }, (_, index) => pathsFor(nmId, cardInfo.basket, index + 1).image);
      const images = [];

      planSummary.textContent = `Нашёл ${total} фото. Будет ${sheetCount} лист(а): ${formatSheets(total)}.`;
      setStatus(`Нашёл ${total} фото. Загружаю крупные изображения...`);
      for (let index = 0; index < urls.length; index += 1) {
        const image = await loadImage(urls[index]);
        images.push(image);
        setProgress(index + 1, total);
        if (images.length <= PHOTOS_PER_SHEET) renderPreview(images);
        setStatus(`Загружено ${index + 1} из ${total} фото.`);
      }

      const sheetChunks = [];
      for (let index = 0; index < images.length; index += PHOTOS_PER_SHEET) {
        sheetChunks.push(images.slice(index, index + PHOTOS_PER_SHEET));
      }

      const entries = [];
      for (let index = 0; index < sheetChunks.length; index += 1) {
        const start = index * PHOTOS_PER_SHEET;
        setStatus(`Собираю лист ${index + 1} из ${sheetChunks.length}...`);
        const blob = await createSheetBlob(nmId, sheetChunks[index], index, sheetChunks.length, start);
        const fileName = `wb-${nmId}-sheet-${String(index + 1).padStart(2, "0")}.jpg`;
        entries.push({
          index,
          title: `Лист ${index + 1}`,
          photoCount: sheetChunks[index].length,
          sizeMb: (blob.size / 1024 / 1024).toFixed(2),
          fileName,
          url: makeDownload(blob)
        });
      }

      renderSheets(nmId, entries);
      setProgress(1, 1);
      setStatus(`Готово: ${total} фото разложены на ${entries.length} лист(а).`);
    } catch (error) {
      setStatus(error.message || "Сборка не удалась. Проверьте ссылку и попробуйте ещё раз.", true);
    } finally {
      button.disabled = false;
      input.disabled = false;
    }
  }
})();
