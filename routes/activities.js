// routes/activities.js - UPDATED
const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Activity = require('../models/Activity');
const auth = require('../middleware/auth');

const router = express.Router();

// Helper to check if ID is client-side content
const isClientSideId = (id) => {
  const str = String(id);
  return str.startsWith('ai-') || 
         str.startsWith('mom-') || 
         str.startsWith('grandma-') || 
         str.startsWith('now-') || 
         str.startsWith('learn-') ||
         str.startsWith('featured-');
};

router.get('/', async (req, res) => {
  try {
    const { age, type, category, limit = 20, page = 1, sort = 'popular' } = req.query;
    let query = { isActive: true };
    let sortOptions = {};

    if (age) {
      const childAge = parseInt(age);
      query['ageRange.min'] = { $lte: childAge };
      query['ageRange.max'] = { $gte: childAge };
    }
    if (type) query.type = type;
    if (category) query.category = category;

    switch (sort) {
      case 'popular': sortOptions = { 'stats.totalAttempts': -1 }; break;
      case 'newest': sortOptions = { createdAt: -1 }; break;
      case 'rating': sortOptions = { 'stats.averageRating': -1 }; break;
      default: sortOptions = { 'stats.totalAttempts': -1 };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const activities = await Activity.find(query).sort(sortOptions).skip(skip).limit(parseInt(limit));
    const total = await Activity.countDocuments(query);

    res.json({
      status: 'success',
      data: {
        activities,
        pagination: {
          current: parseInt(page),
          total: Math.ceil(total / parseInt(limit)),
          count: activities.length,
          totalActivities: total
        }
      }
    });
  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.get('/featured', async (req, res) => {
  try {
    const { age, limit = 5 } = req.query;
    let query = { isActive: true };
    
    if (age) {
      const childAge = parseInt(age);
      query['ageRange.min'] = { $lte: childAge };
      query['ageRange.max'] = { $gte: childAge };
    }

    const activities = await Activity.find(query).sort({ 'stats.totalAttempts': -1 }).limit(parseInt(limit));
    res.json({ status: 'success', data: { activities } });
  } catch (error) {
    console.error('Get featured activities error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    if (isClientSideId(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Client-side content. Please pass contentData from the app.',
        isClientSideContent: true
      });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ status: 'error', message: 'Invalid activity id' });
    }

    const activity = await Activity.findById(id);
    if (!activity || !activity.isActive) {
      return res.status(404).json({ status: 'error', message: 'Activity not found' });
    }

    res.json({ status: 'success', data: { activity } });
  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/:id/attempt', async (req, res) => {
  try {
    const id = req.params.id;

    if (isClientSideId(id)) {
      return res.json({
        status: 'success',
        message: 'Client-side content attempt tracked',
        isClientSideContent: true
      });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ status: 'error', message: 'Invalid activity id' });
    }

    const activity = await Activity.findById(id);
    if (!activity || !activity.isActive) {
      return res.status(404).json({ status: 'error', message: 'Activity not found' });
    }

    await activity.incrementAttempts();
    res.json({ status: 'success', message: 'Attempt count updated' });
  } catch (error) {
    console.error('Update attempt count error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const id = req.params.id;

    if (isClientSideId(id)) {
      return res.json({
        status: 'success',
        message: 'Client-side content completion tracked',
        isClientSideContent: true
      });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ status: 'error', message: 'Invalid activity id' });
    }

    const activity = await Activity.findById(id);
    if (!activity || !activity.isActive) {
      return res.status(404).json({ status: 'error', message: 'Activity not found' });
    }

    await activity.incrementCompletions();
    res.json({ status: 'success', message: 'Activity marked as completed' });
  } catch (error) {
    console.error('Complete activity error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/:id/rate', [
  body('rating').isFloat({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });
    }

    const { rating } = req.body;
    const id = req.params.id;

    if (isClientSideId(id)) {
      return res.json({
        status: 'success',
        message: 'Client-side content rating saved',
        isClientSideContent: true
      });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ status: 'error', message: 'Invalid activity id' });
    }

    const activity = await Activity.findById(id);
    if (!activity || !activity.isActive) {
      return res.status(404).json({ status: 'error', message: 'Activity not found' });
    }

    await activity.addRating(rating);
    res.json({
      status: 'success',
      message: 'Rating added successfully',
      data: {
        averageRating: activity.stats.averageRating,
        totalRatings: activity.stats.totalRatings
      }
    });
  } catch (error) {
    console.error('Rate activity error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.get('/types/list', async (req, res) => {
  try {
    const types = await Activity.distinct('type', { isActive: true });
    res.json({ status: 'success', data: { types } });
  } catch (error) {
    console.error('Get types error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.get('/categories/list', async (req, res) => {
  try {
    const categories = await Activity.distinct('category', { isActive: true });
    res.json({ status: 'success', data: { categories } });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/', [
  auth,
  body('title').trim().isLength({ min: 1, max: 100 }).withMessage('Title is required'),
  body('description').trim().isLength({ min: 1, max: 500 }).withMessage('Description is required'),
  body('type').isIn(['irl', 'craft', 'game', 'exercise', 'learning', 'music', 'art', 'science']).withMessage('Invalid type'),
  body('category').isIn(['physical', 'creative', 'educational', 'social', 'emotional', 'sensory']).withMessage('Invalid category'),
  body('ageRange.min').isInt({ min: 2, max: 12 }).withMessage('Minimum age must be between 2 and 12'),
  body('ageRange.max').isInt({ min: 2, max: 12 }).withMessage('Maximum age must be between 2 and 12'),
  body('duration.estimated').isInt({ min: 1, max: 120 }).withMessage('Estimated duration must be between 1 and 120 minutes')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });
    }

    const activityData = { ...req.body, createdBy: req.parentId };
    const activity = new Activity(activityData);
    await activity.save();

    res.status(201).json({ status: 'success', message: 'Activity created successfully', data: { activity } });
  } catch (error) {
    console.error('Create activity error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

module.exports = router;