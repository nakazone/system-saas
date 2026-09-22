/**
 * Suppliers, products, category margins — ERP materials for quotes.
 */
import { getDBConnection } from '../config/db.js';
import * as suppliersRepo from '../modules/erp/suppliersRepo.js';
import * as productsRepo from '../modules/erp/productsRepo.js';
import * as cmRepo from '../modules/erp/categoryMarginsRepo.js';
import {
  sellPriceFromCostAndMarkup,
  defaultMarginForCategory,
  validateMarkup,
} from '../modules/pricing/marginPricing.js';

function mysqlText(e) {
  return String(e?.sqlMessage || e?.message || '');
}

function erpTableMissing(e) {
  const t = mysqlText(e).toLowerCase();
  return (
    t.includes("doesn't exist") ||
    t.includes("unknown table") ||
    (e && e.code === 'ER_NO_SUCH_TABLE')
  );
}

function migrateMsg() {
  return { success: false, error: 'Run: npm run migrate:supplier-product-erp' };
}

export const ERP_CATEGORIES = ['Hardwood', 'LVP', 'Engineered', 'Accessories'];
export const ERP_PRODUCT_UNITS = ['sq_ft', 'box', 'piece'];

export async function getCategoryMargins(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const rows = await cmRepo.listCategoryMargins(pool);
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('getCategoryMargins:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putCategoryMargin(req, res) {
  try {
    const category = String(req.body.category || req.params.category || '').trim();
    const pct = Number(req.body.margin_percentage);
    if (!category || !ERP_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: 'Invalid category' });
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 500) {
      return res.status(400).json({ success: false, error: 'margin_percentage must be 0–500' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await cmRepo.upsertCategoryMargin(pool, category, pct);
    res.json({ success: true });
  } catch (e) {
    console.error('putCategoryMargin:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listSuppliersApi(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const all = req.query.all === '1';
    const rows = await suppliersRepo.listSuppliers(pool, { activeOnly: !all });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listSuppliersApi:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postSupplier(req, res) {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = await suppliersRepo.insertSupplier(pool, {
      name: name.slice(0, 255),
      contact_name: req.body.contact_name || null,
      phone: req.body.phone || null,
      email: req.body.email || null,
      address: req.body.address || null,
      notes: req.body.notes || null,
      active: req.body.active !== false,
    });
    res.status(201).json({ success: true, data: { id } });
  } catch (e) {
    console.error('postSupplier:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putSupplier(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await suppliersRepo.updateSupplier(pool, id, {
      name: name.slice(0, 255),
      contact_name: req.body.contact_name || null,
      phone: req.body.phone || null,
      email: req.body.email || null,
      address: req.body.address || null,
      notes: req.body.notes || null,
      active: req.body.active !== false,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('putSupplier:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteSupplier(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await suppliersRepo.softDeleteSupplier(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteSupplier:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listProductsApi(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const supplierId = req.query.supplier_id ? parseInt(req.query.supplier_id, 10) : null;
    const q = req.query.q || req.query.search;
    const all = req.query.all === '1';
    const rows = await productsRepo.listProducts(pool, {
      supplierId: supplierId || undefined,
      q,
      activeOnly: !all,
      limit: parseInt(req.query.limit, 10) || 200,
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listProductsApi:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getProductPricingPreview(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const product = await productsRepo.getProduct(pool, id);
    if (!product) return res.status(404).json({ success: false, error: 'Not found' });
    const marginRow = await cmRepo.getCategoryMargin(pool, product.category);
    const defaultMarkup = defaultMarginForCategory(product.category, marginRow);
    const suggestedSell = sellPriceFromCostAndMarkup(product.cost_price, defaultMarkup);
    const v = validateMarkup(defaultMarkup);
    res.json({
      success: true,
      data: {
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
          unit_type: product.unit_type,
          cost_price: Number(product.cost_price),
          sku: product.sku,
          description: product.description != null ? String(product.description) : '',
          supplier_id: product.supplier_id,
          supplier_name: product.supplier_name,
        },
        default_markup_percentage: defaultMarkup,
        suggested_sell_price: suggestedSell,
        warnings: v.warnings || [],
      },
    });
  } catch (e) {
    console.error('getProductPricingPreview:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postProduct(req, res) {
  try {
    const supplierId = parseInt(req.body.supplier_id, 10);
    if (!supplierId) return res.status(400).json({ success: false, error: 'supplier_id required' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const category = String(req.body.category || '').trim();
    if (!ERP_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: 'Invalid category', allowed: ERP_CATEGORIES });
    }
    const unit_type = String(req.body.unit_type || 'sq_ft').trim();
    if (!ERP_PRODUCT_UNITS.includes(unit_type)) {
      return res.status(400).json({ success: false, error: 'Invalid unit_type', allowed: ERP_PRODUCT_UNITS });
    }
    const cost = Number(req.body.cost_price);
    if (!Number.isFinite(cost) || cost < 0) {
      return res.status(400).json({ success: false, error: 'cost_price must be ≥ 0' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const sup = await suppliersRepo.getSupplier(pool, supplierId);
    if (!sup) return res.status(400).json({ success: false, error: 'Supplier not found' });
    const id = await productsRepo.insertProduct(pool, {
      supplier_id: supplierId,
      name: name.slice(0, 255),
      category,
      unit_type,
      cost_price: cost,
      sku: req.body.sku || null,
      description: req.body.description || null,
      stock_qty: req.body.stock_qty,
      active: req.body.active !== false,
    });
    res.status(201).json({ success: true, data: { id } });
  } catch (e) {
    console.error('postProduct:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putProduct(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const supplierId = parseInt(req.body.supplier_id, 10);
    if (!supplierId) return res.status(400).json({ success: false, error: 'supplier_id required' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const category = String(req.body.category || '').trim();
    if (!ERP_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: 'Invalid category' });
    }
    const unit_type = String(req.body.unit_type || 'sq_ft').trim();
    if (!ERP_PRODUCT_UNITS.includes(unit_type)) {
      return res.status(400).json({ success: false, error: 'Invalid unit_type' });
    }
    const cost = Number(req.body.cost_price);
    if (!Number.isFinite(cost) || cost < 0) {
      return res.status(400).json({ success: false, error: 'cost_price must be ≥ 0' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const sup = await suppliersRepo.getSupplier(pool, supplierId);
    if (!sup) return res.status(400).json({ success: false, error: 'Supplier not found' });
    await productsRepo.updateProduct(pool, id, {
      supplier_id: supplierId,
      name: name.slice(0, 255),
      category,
      unit_type,
      cost_price: cost,
      sku: req.body.sku || null,
      description: req.body.description || null,
      stock_qty: req.body.stock_qty,
      active: req.body.active !== false,
    });
    res.json({ success: true });
  } catch (e) {
    console.error('putProduct:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteProduct(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await productsRepo.softDeleteProduct(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteProduct:', e);
    if (erpTableMissing(e)) return res.status(503).json(migrateMsg());
    res.status(500).json({ success: false, error: e.message });
  }
}
