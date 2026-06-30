(async function () {
  const link = document.querySelector("#bookmarklet-link");
  const textarea = document.querySelector("#bookmarklet-code");
  const copyButton = document.querySelector("#copy-button");
  const copyStatus = document.querySelector("#copy-status");

  const source = await fetch("ozon-bookmarklet-source.js", { cache: "no-store" }).then((response) => response.text());
  const code = `javascript:${encodeURIComponent(source.replace(/^\uFEFF/, ""))}`;

  link.href = code;
  textarea.value = code;

  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(code);
    copyStatus.textContent = "Код скопирован. Создайте закладку и вставьте его в поле URL.";
  });
})();
