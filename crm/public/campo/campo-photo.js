/**
 * Campo — compressão de foto única para Meu dia (dia.js?v=20261105-apps3), Ticket (ticket.js?v=20261105-apps3) e Stain (stain.js?v=20261105-apps3).
 *
 *   window.CampoPhoto.compress(file, { maxSide?: 1600, quality?: 0.74 }) → Promise<string>  (data URL JPEG)
 *
 * Hora, GPS e câmera (EXIF) continuam sendo lidos pelos chamadores com photo-exif.js direto do
 * arquivo original, antes de comprimir — o canvas descarta o EXIF. Aqui só a orientação da foto é
 * aplicada (createImageBitmap com imageOrientation "from-image"; o <img> de reserva já faz isso).
 */
(function (global) {
  "use strict";
  if (global.CampoPhoto) return;

  const MAX_SIDE = 1600;
  const QUALITY = 0.74;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Não deu para ler a foto. Tente de novo."));
      };
      img.src = url;
    });
  }

  async function decode(file) {
    if (typeof global.createImageBitmap === "function") {
      try {
        const bmp = await global.createImageBitmap(file, { imageOrientation: "from-image" });
        return { source: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close && bmp.close() };
      } catch (_) {
        /* formato ou opção sem suporte: segue pelo <img> */
      }
    }
    const { img, url } = await loadImage(file);
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  }

  async function compress(file, opts) {
    const o = opts || {};
    const maxSide = o.maxSide || MAX_SIDE;
    const quality = o.quality || QUALITY;
    if (!file) throw new Error("Nenhuma foto escolhida.");
    if (file.type && !/^image\//.test(file.type)) throw new Error("Selecione uma imagem.");
    const d = await decode(file);
    try {
      const k = Math.min(1, maxSide / Math.max(d.w || 1, d.h || 1));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(d.w * k));
      c.height = Math.max(1, Math.round(d.h * k));
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("Não deu para preparar a foto.");
      ctx.drawImage(d.source, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", quality);
    } finally {
      d.done();
    }
  }

  global.CampoPhoto = { compress, MAX_SIDE, QUALITY };
})(window);
