const { Router } = require('express');
const router = Router();
const db = require('../db');
const { addLog } = require('./log_helper');

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
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
  const adminId = req.session.user.user_id;

  try {
    if (!item_name || !category) return res.status(400).send('Missing required fields');

    let newItemId = item_id;

    if (item_id) {
      // ---------------- UPDATE INVENTORY ----------------
      await db.query(
        `UPDATE inventory_tbl 
         SET item_name = ?, category = ?, default_price = ?, total_plots = ?, available_plots = ?, last_update = NOW()
         WHERE item_id = ?`,
        [item_name, category, default_price || 0, total_plots || 0, available_plots || 0, item_id]
      );

      // ---------------- SAFE UPDATE PLOTS ----------------
      const [existingPlots] = await db.query(
        'SELECT plot_id FROM plot_map_tbl WHERE item_id = ?',
        [item_id]
      );

      // Fetch plots that are referenced in notifications
      const [usedPlots] = await db.query(
        'SELECT plot_id FROM notification_tbl WHERE plot_id IN (?)',
        [existingPlots.map(p => p.plot_id)]
      );
      const usedPlotIds = usedPlots.map(p => p.plot_id);

      // Delete only plots that are NOT referenced
      const plotsToDelete = existingPlots
        .filter(p => !usedPlotIds.includes(p.plot_id))
        .map(p => p.plot_id);

      if (plotsToDelete.length) {
        await db.query('DELETE FROM plot_map_tbl WHERE plot_id IN (?)', [plotsToDelete]);
      }

      // Insert new plots if total_plots increased
      const currentCount = existingPlots.length;
      const additionalPlots = total_plots - currentCount;
      if (additionalPlots > 0) {
        const plotInserts = [];
        for (let i = currentCount + 1; i <= total_plots; i++) {
          const plotNumber = `${item_name.toUpperCase().substring(0,1)}-${String(i).padStart(3,'0')}`;
          plotInserts.push([plotNumber, category, 'available', default_price || 0, item_id]);
        }
        const placeholders = plotInserts.map(() => '(?, ?, ?, ?, ?)').join(',');
        await db.query(
          `INSERT INTO plot_map_tbl (plot_number, location, type, price, item_id) VALUES ${placeholders}`,
          plotInserts.flat()
        );
      }

      await addLog({
        user_id: adminId,
        user_role: 'admin',
        action: 'Update Inventory',
        details: `Admin updated inventory item: ${item_name} (ID: ${item_id})`
      });

    } else {
      // ---------------- ADD NEW ITEM ----------------
      const [result] = await db.query(
        `INSERT INTO inventory_tbl (item_name, category, default_price, total_plots, available_plots, last_update)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [item_name, category, default_price || 0, total_plots || 0, total_plots || 0]
      );
      newItemId = result.insertId;

      // Insert plots
      if (total_plots > 0) {
        const plotInserts = [];
        for (let i = 1; i <= total_plots; i++) {
          const plotNumber = `${item_name.toUpperCase().substring(0,1)}-${String(i).padStart(3,'0')}`;
          plotInserts.push([plotNumber, category, 'available', default_price || 0, newItemId]);
        }
        const placeholders = plotInserts.map(() => '(?, ?, ?, ?, ?)').join(',');
        await db.query(
          `INSERT INTO plot_map_tbl (plot_number, location, type, price, item_id) VALUES ${placeholders}`,
          plotInserts.flat()
        );
      }

      await addLog({
        user_id: adminId,
        user_role: 'admin',
        action: 'Add Inventory',
        details: `Admin added new inventory item: ${item_name} (ID: ${newItemId})`
      });
    }

    res.redirect('/admin_inventory');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to add/update item');
  }
});

// ---------------- DELETE ITEM ----------------
router.post('/delete/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const adminId = req.session.user.user_id;

  try {
    // Check if any plots are referenced in notification_tbl
    const [referenced] = await db.query(
      `SELECT COUNT(*) AS count 
       FROM plot_map_tbl p
       JOIN notification_tbl n ON p.plot_id = n.plot_id
       WHERE p.item_id = ?`,
      [id]
    );
    if (referenced[0].count > 0) return res.status(400).send('Cannot delete: some plots are referenced in notifications.');

    // Delete plots
    await db.query('DELETE FROM plot_map_tbl WHERE item_id = ?', [id]);

    // Get item name for logging
    const [rows] = await db.query('SELECT item_name FROM inventory_tbl WHERE item_id = ?', [id]);
    const itemName = rows.length ? rows[0].item_name : 'Unknown';

    // Delete inventory
    await db.query('DELETE FROM inventory_tbl WHERE item_id = ?', [id]);

    await addLog({
      user_id: adminId,
      user_role: 'admin',
      action: 'Delete Inventory',
      details: `Admin deleted inventory item: ${itemName} (ID: ${id})`
    });

    res.redirect('/admin_inventory');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to delete item');
  }
});

module.exports = router;
