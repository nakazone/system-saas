/**
 * Example React component (Tailwind) — port of public/quote-builder.js “Add product” modal.
 * Wire to GET /api/erp/products, GET /api/erp/products/preview/:id, POST /api/quotes/:id/full.
 */
import { useState, useEffect, useCallback } from 'react';

function sellFromCostMarkup(cost, mPct) {
  const c = Number(cost) || 0;
  const m = Math.max(0, Number(mPct) || 0);
  return Math.round(c * (1 + m / 100) * 10000) / 10000;
}

export function QuoteLineProductModal({ open, onClose, onAddLine, apiFetch }) {
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [preview, setPreview] = useState(null);
  const [markup, setMarkup] = useState('');
  const [sell, setSell] = useState('');
  const [qty, setQty] = useState(1);
  const [warn, setWarn] = useState([]);

  useEffect(() => {
    if (!open) return;
    apiFetch('/api/erp/products?limit=500').then((r) => setProducts(r.data || []));
  }, [open, apiFetch]);

  const loadPreview = useCallback(
    async (id) => {
      if (!id) {
        setPreview(null);
        return;
      }
      const r = await apiFetch('/api/erp/products/preview/' + id);
      setPreview(r.data);
      setMarkup(String(r.data.default_markup_percentage));
      setSell(String(r.data.suggested_sell_price));
      setWarn(r.data.warnings || []);
    },
    [apiFetch]
  );

  useEffect(() => {
    if (productId) loadPreview(productId);
  }, [productId, loadPreview]);

  const onMarkupChange = (v) => {
    setMarkup(v);
    if (!preview) return;
    setSell(String(sellFromCostMarkup(preview.product.cost_price, parseFloat(v) || 0)));
  };

  const onSellChange = (v) => {
    setSell(v);
    if (!preview) return;
    const cost = Number(preview.product.cost_price);
    const s = parseFloat(v);
    if (cost > 0 && Number.isFinite(s)) {
      setMarkup(String(Math.round(((s - cost) / cost) * 10000) / 100));
    }
  };

  const confirm = () => {
    const m = parseFloat(markup);
    if (!preview || !Number.isFinite(m) || m < 0) return;
    if (m < 15 && !window.confirm('Margin below 15%. Add anyway?')) return;
    const s = parseFloat(sell);
    if (!Number.isFinite(s) || s < 0) return;
    const pr = preview.product;
    onAddLine({
      item_type: 'product',
      product_id: pr.id,
      description: pr.name,
      unit_type: pr.unit_type,
      quantity: qty,
      rate: s,
      cost_price: pr.cost_price,
      markup_percentage: m,
      sell_price: s,
      service_type: null,
      notes: null,
      service_catalog_id: null,
      catalog_customer_notes: null,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold">Add product line</h2>
        <select
          className="mt-3 w-full rounded border px-3 py-2 text-sm"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        >
          <option value="">— Product —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.supplier_name}: {p.name}
            </option>
          ))}
        </select>
        {preview && (
          <div className="mt-3 space-y-2 text-sm">
            <div>Cost: {Number(preview.product.cost_price).toFixed(4)}</div>
            <label className="block">
              Markup %
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded border px-2 py-1"
                value={markup}
                onChange={(e) => onMarkupChange(e.target.value)}
              />
            </label>
            <label className="block">
              Sell (unit)
              <input
                type="number"
                min={0}
                step="0.01"
                className="mt-1 w-full rounded border px-2 py-1"
                value={sell}
                onChange={(e) => onSellChange(e.target.value)}
              />
            </label>
            <label className="block">
              Qty
              <input
                type="number"
                min={0.01}
                step="0.01"
                className="mt-1 w-full rounded border px-2 py-1"
                value={qty}
                onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
              />
            </label>
            {warn.length > 0 && <p className="text-amber-700 text-xs">{warn.join(' ')}</p>}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border px-4 py-2 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-amber-200 px-4 py-2 text-sm font-bold text-slate-900"
            onClick={confirm}
          >
            Add line
          </button>
        </div>
      </div>
    </div>
  );
}
