const { Router } = require('express');
const router = Router();
const db = require('../db');
const { addLog } = require('../routes/log_helper'); // ✅ Import logs helper

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// ---------------- GET inventory ----------------
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [plots] = await db.query(`
      SELECT 
        i.item_id,
        i.item_name,
        i.category,
        i.default_price,
        COUNT(p.item_id) AS total_plots,
        SUM(CASE WHEN p.availability = 'available' THEN 1 ELSE 0 END) AS available_plots,
        i.last_update
      FROM inventory_tbl i
      LEFT JOIN plot_map_tbl p ON i.item_id = p.item_id
      GROUP BY i.item_id, i.item_name, i.category, i.default_price, i.last_update
    `);

    res.render('admin_inventory', { plots });
  } catch (err) {
    console.error(err);
    res.send('Failed to load inventory');
  }
});

// ---------------- Add or Update Item ----------------
router.post('/add', requireAdmin, async (req, res) => {
  const { item_id, item_name, category, default_price, total_plots, available_plots } = req.body;

  try {
    if (!item_name || !category) return res.status(400).send('Missing required fields');

    let newItemId = item_id;

    if (item_id) {
      // Update existing item
      await db.query(
        `UPDATE inventory_tbl
         SET item_name = ?, category = ?, default_price = ?, total_plots = ?, available_plots = ?, last_update = NOW()
         WHERE item_id = ?`,
        [item_name, category, default_price || 0, total_plots || 0, available_plots || 0, item_id]
      );

      // Delete old plots for this item
      await db.query(`DELETE FROM plot_map_tbl WHERE item_id = ?`, [item_id]);

      // ✅ Log update action
      await addLog(0, 'admin', 'Update', `Admin updated inventory item: ${item_name} (ID: ${item_id})`);
    } else {
      // Insert new item
      const [result] = await db.query(
        `INSERT INTO inventory_tbl 
         (item_name, category, default_price, total_plots, available_plots, last_update)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [item_name, category, default_price || 0, total_plots || 0, total_plots || 0]
      );
      newItemId = result.insertId;

      // ✅ Log add action
      await addLog(0, 'admin', 'Add', `Admin added new inventory item: ${item_name} (ID: ${newItemId})`);
    }

    // Insert plots into plot_map_tbl
    if (total_plots > 0) {
      const plotInserts = [];
      for (let i = 1; i <= total_plots; i++) {
        const plotNumber = `${item_name.toUpperCase().substring(0,1)}-${String(i).padStart(3,'0')}`;
        plotInserts.push([plotNumber, category, 'available', default_price || 0, newItemId]);
      }

      const placeholders = plotInserts.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
      await db.query(
        `INSERT INTO plot_map_tbl (plot_number, location, type, price, item_id, availability) VALUES ${placeholders}`,
        plotInserts.flat()
      );
    }

    res.redirect('/admin_inventory');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to add/update item');
  }
});

// ---------------- Delete Item ----------------
router.post('/delete/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Get item name before deleting (for logging)
    const [rows] = await db.query('SELECT item_name FROM inventory_tbl WHERE item_id = ?', [id]);
    const itemName = rows.length ? rows[0].item_name : 'Unknown';

    // Check if item is still referenced in plot_map_tbl
    const [related] = await db.query('SELECT COUNT(*) AS count FROM plot_map_tbl WHERE item_id = ?', [id]);
    if (related[0].count > 0) {
      // If related plots exist, stop deletion and show message
      return res.status(400).send('Cannot delete: item is still used in plot_map_tbl.');
    }

    // ✅ Delete from inventory_tbl AFTER verifying dependencies
    await db.query('DELETE FROM inventory_tbl WHERE item_id = ?', [id]);

    // ✅ Log delete action
    await addLog(0, 'admin', 'Delete', `Admin deleted inventory item: ${itemName} (ID: ${id})`);

    res.redirect('/admin_inventory');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to delete item');
  }
});

module.exports = router;