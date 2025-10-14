// routes/planner.js
const express = require('express');
const { body, validationResult, query } = require('express-validator');
const auth = require('../middleware/auth');
const Planner = require('../models/Planner');

const router = express.Router();

/**
 * POST /api/planner
 * Save a weekly plan (creates a new planner doc)
 * Body:
 *  - plan: required (array or object) - the plan payload
 *  - planName: optional string
 */
router.post(
  '/',
  [
    auth,
    body('plan').exists().withMessage('Plan object is required'),
    body('planName').optional().isString().trim().isLength({ min: 1, max: 200 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });
      }

      const { plan, planName } = req.body;

      // Basic sanity: plan should be object or array
      if (typeof plan !== 'object' || plan === null) {
        return res.status(400).json({ status: 'error', message: 'Plan must be an object or array' });
      }

      const planner = new Planner({
        parentId: req.parentId,
        name: planName || 'Weekly Plan',
        plan
      });

      await planner.save();

      return res.status(201).json({
        status: 'success',
        message: 'Planner saved',
        data: { plannerId: planner._id, createdAt: planner.createdAt }
      });
    } catch (error) {
      console.error('Save planner error:', error);
      return res.status(500).json({ status: 'error', message: 'Server error' });
    }
  }
);

/**
 * POST /api/planner/suggestion
 * Save a single suggestion (from AI) — accumulates suggestions in a "Saved Suggestions" planner doc for the parent.
 * Body:
 *  - suggestion: required string
 */
router.post(
  '/suggestion',
  [
    auth,
    body('suggestion').trim().isLength({ min: 1 }).withMessage('Suggestion text is required'),
    body('meta').optional().isObject().withMessage('Meta, if provided, must be an object')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });
      }

      const { suggestion, meta } = req.body;

      // Try to find an existing "Saved Suggestions" doc for this parent
      const filter = { parentId: req.parentId, name: 'Saved Suggestions', isActive: true };
      const update = {
        $push: { 'plan.suggestions': { text: suggestion, meta: meta || null, savedAt: new Date() } },
        $set: { updatedAt: new Date() }
      };
      const options = { upsert: true, new: true, setDefaultsOnInsert: true };

      // If upsert creates a new doc, ensure it has the proper initial shape.
      // Use findOneAndUpdate to push or create with initial plan structure
      const planner = await Planner.findOne(filter);

      if (planner) {
        // existing -> push
        planner.plan = planner.plan || {};
        planner.plan.suggestions = planner.plan.suggestions || [];
        planner.plan.suggestions.push({ text: suggestion, meta: meta || null, savedAt: new Date() });
        planner.updatedAt = new Date();
        await planner.save();

        return res.status(201).json({ status: 'success', message: 'Suggestion saved', data: { plannerId: planner._id } });
      } else {
        // create new doc
        const newPlanner = new Planner({
          parentId: req.parentId,
          name: 'Saved Suggestions',
          plan: { suggestions: [{ text: suggestion, meta: meta || null, savedAt: new Date() }] }
        });
        await newPlanner.save();
        return res.status(201).json({ status: 'success', message: 'Suggestion saved', data: { plannerId: newPlanner._id } });
      }
    } catch (error) {
      console.error('Save suggestion error:', error);
      return res.status(500).json({ status: 'error', message: 'Server error' });
    }
  }
);

/**
 * GET /api/planner
 * Fetch recent plans for the authenticated parent.
 * Query:
 *  - page (optional, default 1)
 *  - limit (optional, default 10)
 *  - includeInactive (optional, boolean) - include isActive: false items
 */
router.get(
  '/',
  [
    auth,
    query('page').optional().toInt(),
    query('limit').optional().toInt(),
    query('includeInactive').optional().isBoolean().toBoolean()
  ],
  async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page || '1', 10), 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);
      const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === true;

      const filter = { parentId: req.parentId };
      if (!includeInactive) filter.isActive = true;

      const total = await Planner.countDocuments(filter);
      const pages = Math.max(Math.ceil(total / limit), 1);
      const skip = (page - 1) * limit;

      const plans = await Planner.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      // sanitize/shape response: avoid sending huge plan payloads unless requested
      const sanitized = plans.map(p => ({
        _id: p._id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        isActive: p.isActive,
        // include plan but keep it — caller can request specific plan by id if they need full data
        plan: p.plan
      }));

      return res.json({
        status: 'success',
        data: {
          pagination: { page, limit, pages, total },
          plans: sanitized
        }
      });
    } catch (error) {
      console.error('Get planner error:', error);
      return res.status(500).json({ status: 'error', message: 'Server error' });
    }
  }
);

/**
 * Optional: GET /api/planner/:id
 * Return single planner by id (if belongs to parent)
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const planner = await Planner.findOne({ _id: req.params.id, parentId: req.parentId });
    if (!planner) return res.status(404).json({ status: 'error', message: 'Planner not found' });

    return res.json({ status: 'success', data: { planner } });
  } catch (error) {
    console.error('Get planner by id error:', error);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

/**
 * Optional: PUT /api/planner/:id
 * Update an existing planner (replace plan or name)
 */
router.put(
  '/:id',
  [
    auth,
    body('plan').optional(),
    body('name').optional().isString().trim().isLength({ min: 1, max: 200 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });
      }

      const planner = await Planner.findOne({ _id: req.params.id, parentId: req.parentId });
      if (!planner) return res.status(404).json({ status: 'error', message: 'Planner not found' });

      if (req.body.plan !== undefined) planner.plan = req.body.plan;
      if (req.body.name) planner.name = req.body.name;
      planner.updatedAt = new Date();

      await planner.save();
      return res.json({ status: 'success', message: 'Planner updated', data: { plannerId: planner._id } });
    } catch (error) {
      console.error('Update planner error:', error);
      return res.status(500).json({ status: 'error', message: 'Server error' });
    }
  }
);

/**
 * Optional: DELETE /api/planner/:id
 * Soft-delete planner (set isActive = false)
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const planner = await Planner.findOne({ _id: req.params.id, parentId: req.parentId });
    if (!planner) return res.status(404).json({ status: 'error', message: 'Planner not found' });

    planner.isActive = false;
    planner.updatedAt = new Date();
    await planner.save();

    return res.json({ status: 'success', message: 'Planner removed' });
  } catch (error) {
    console.error('Delete planner error:', error);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

module.exports = router;
