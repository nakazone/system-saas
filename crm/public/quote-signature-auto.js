/**
 * Auto-generate a script-style signature image from a name on canvas.
 */
(function (global) {
  const SIGNATURE_FONTS =
    '"Brush Script MT", "Segoe Script", "Snell Roundhand", "Apple Chancery", "Lucida Handwriting", cursive';

  function measureText(ctx, text, fontSize) {
    ctx.font = `italic ${fontSize}px ${SIGNATURE_FONTS}`;
    return ctx.measureText(text);
  }

  function renderAutoSignatureOnCanvas(canvas, name, opts = {}) {
    const text = String(name || '').trim();
    if (!text || text.length < 2 || !canvas) return false;

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const w = canvas.width;
    const h = canvas.height;
    const padX = opts.padX ?? 16;
    const padY = opts.padY ?? 12;
    const maxW = w - padX * 2;
    const maxH = h - padY * 2;
    const color = opts.color || '#1a2036';

    ctx.clearRect(0, 0, w, h);

    let fontSize = Math.min(maxH * 0.72, 44);
    let metrics = measureText(ctx, text, fontSize);
    while (fontSize > 14 && metrics.width > maxW) {
      fontSize -= 1;
      metrics = measureText(ctx, text, fontSize);
    }

    ctx.fillStyle = color;
    ctx.font = `italic ${fontSize}px ${SIGNATURE_FONTS}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const x = padX + Math.max(0, (maxW - metrics.width) / 2);
    const y = h / 2;
    ctx.fillText(text, x, y);
    return true;
  }

  function autoSignatureDataUrl(canvas, name, opts) {
    if (!renderAutoSignatureOnCanvas(canvas, name, opts)) return null;
    return canvas.toDataURL('image/png');
  }

  global.QuoteSignatureAuto = {
    renderAutoSignatureOnCanvas,
    autoSignatureDataUrl,
  };
})(typeof window !== 'undefined' ? window : globalThis);
