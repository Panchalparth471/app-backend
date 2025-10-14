// routes/stories.js
const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Story = require('../models/Story');
const auth = require('../middleware/auth');

const router = express.Router();
const aiRoutes = require('./ai');

const isClientSideId = (id) => {
  const str = String(id || '');
  return str.startsWith('ai-') || str.startsWith('mom-') || str.startsWith('grandma-') || str.startsWith('now-') || str.startsWith('learn-') || str.startsWith('featured-');
};

router.get('/', async (req, res) => {
  try {
    const { age, theme, category, limit = 20, page = 1, sort = 'popular' } = req.query;
    const query = { isActive: true };
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    let sortOptions = {};

    if (age) {
      const childAge = parseInt(age, 10);
      query['ageRange.min'] = { $lte: childAge };
      query['ageRange.max'] = { $gte: childAge };
    }
    if (theme) query.theme = theme;
    if (category) query.category = category;

    switch (sort) {
      case 'newest':
        sortOptions = { createdAt: -1 };
        break;
      case 'rating':
        sortOptions = { 'stats.averageRating': -1 };
        break;
      case 'popular':
      default:
        sortOptions = { 'stats.totalPlays': -1 };
    }

    const stories = await Story.find(query).sort(sortOptions).skip(skip).limit(parseInt(limit, 10));
    const total = await Story.countDocuments(query);

    res.json({
      status: 'success',
      data: {
        stories,
        pagination: {
          current: parseInt(page, 10),
          total: Math.ceil(total / parseInt(limit, 10)),
          count: stories.length,
          totalStories: total,
        },
      },
    });
  } catch (error) {
    console.error('Get stories error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.get('/featured', async (req, res) => {
  try {
    const { age, limit = 5 } = req.query;
    const query = { isActive: true };
    if (age) {
      const childAge = parseInt(age, 10);
      query['ageRange.min'] = { $lte: childAge };
      query['ageRange.max'] = { $gte: childAge };
    }
    const stories = await Story.find(query).sort({ 'stats.totalPlays': -1 }).limit(parseInt(limit, 10));
    res.json({ status: 'success', data: { stories } });
  } catch (error) {
    console.error('Get featured stories error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.get('/themes/list', async (req, res) => {
  try {
    const themes = await Story.distinct('theme', { isActive: true });
    res.json({ status: 'success', data: { themes } });
  } catch (error) {
    console.error('Get themes error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.get('/categories/list', async (req, res) => {
  try {
    const categories = await Story.distinct('category', { isActive: true });
    res.json({ status: 'success', data: { categories } });
  } catch (error) {
    console.error('Get categories error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// get story by id
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || id === 'undefined') return res.status(400).json({ status: 'error', message: 'Story ID is required' });

    if (isClientSideId(id)) {
      return res.status(400).json({ status: 'error', message: 'Client-side content. Please pass contentData from the app.', isClientSideContent: true });
    }
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ status: 'error', message: 'Invalid story id format' });

    const story = await Story.findById(id);
    if (!story || !story.isActive) return res.status(404).json({ status: 'error', message: 'Story not found' });

    res.json({ status: 'success', data: { story } });
  } catch (error) {
    console.error('Get story error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/:id/play', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || id === 'undefined') return res.status(400).json({ status: 'error', message: 'Story ID is required' });

    if (isClientSideId(id)) {
      return res.json({ status: 'success', message: 'Client-side content play tracked', isClientSideContent: true });
    }
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ status: 'error', message: 'Invalid story id' });

    const story = await Story.findById(id);
    if (!story || !story.isActive) return res.status(404).json({ status: 'error', message: 'Story not found' });

    story.stats = story.stats || {};
    story.stats.totalPlays = (story.stats.totalPlays || 0) + 1;
    await story.save();

    res.json({ status: 'success', message: 'Play count updated' });
  } catch (error) {
    console.error('Update play count error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || id === 'undefined') return res.status(400).json({ status: 'error', message: 'Story ID is required' });

    if (isClientSideId(id)) {
      return res.json({ status: 'success', message: 'Client-side content completion tracked', isClientSideContent: true });
    }
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ status: 'error', message: 'Invalid story id' });

    const story = await Story.findById(id);
    if (!story || !story.isActive) return res.status(404).json({ status: 'error', message: 'Story not found' });

    story.stats = story.stats || {};
    story.stats.completions = (story.stats.completions || 0) + 1;
    await story.save();

    // If AI-generated, mark inactive and attempt non-blocking replacement
    try {
      if (story.isAIGenerated && story.generatedForCollection) {
        story.isActive = false;
        await story.save();

        const childAge = (story.ageRange && Number.isInteger(story.ageRange.min)) ? Math.max(3, story.ageRange.min) : 5;
        aiRoutes.generateCategoryStories(story.generatedForCollection, 'friend', childAge, 1, req)
          .catch((e) => console.error('Auto-regeneration failed:', e && e.message ? e.message : e));
      }
    } catch (e) {
      console.error('Auto-regenerate error (non-fatal):', e && e.message ? e.message : e);
    }

    res.json({ status: 'success', message: 'Story marked as completed' });
  } catch (error) {
    console.error('Complete story error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/:id/rate', [body('rating').exists().isFloat({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });

    const { rating } = req.body;
    const id = req.params.id;
    if (!id || id === 'undefined') return res.status(400).json({ status: 'error', message: 'Story ID is required' });
    if (isClientSideId(id)) return res.json({ status: 'success', message: 'Client-side content rating saved', isClientSideContent: true });
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ status: 'error', message: 'Invalid story id' });

    const story = await Story.findById(id);
    if (!story || !story.isActive) return res.status(404).json({ status: 'error', message: 'Story not found' });

    story.stats = story.stats || {};
    story.stats.totalRatings = (story.stats.totalRatings || 0) + 1;
    story.stats.averageRating = ((story.stats.averageRating || 0) * (story.stats.totalRatings - 1) + rating) / story.stats.totalRatings;
    await story.save();

    res.json({ status: 'success', message: 'Rating added successfully', data: { averageRating: story.stats.averageRating, totalRatings: story.stats.totalRatings } });
  } catch (error) {
    console.error('Rate story error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/from-ai', [
  auth, 
  body('title').trim().isLength({ min: 1, max: 200 }), 
  body('content').trim().isLength({ min: 1 }),
  body('generatedForCollection').trim().notEmpty().withMessage('generatedForCollection is required') // ✅ REQUIRED
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });

    const { 
      title, 
      description = '', 
      content, 
      duration = 10, 
      ageRange, 
      thumbnail = '🤖', 
      audioUrl, 
      theme = 'AI Generated', 
      category = 'audio',
      generatedForCollection // ✅ REQUIRED - no default
    } = req.body;

    // ✅ Double-check it exists
    if (!generatedForCollection) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'generatedForCollection is required for AI stories' 
      });
    }

    const storyData = {
      title,
      description,
      content,
      duration,
      ageRange: ageRange || { min: 3, max: 7 },
      thumbnail,
      audioUrl,
      theme,
      category,
      isAIGenerated: true,
      isActive: true,
      createdBy: req.parentId || null,
      generatedForCollection // ✅ Always set from request
    };

    const story = new Story(storyData);
    await story.save();
    
    console.log(`✅ AI story saved with collection: ${story.generatedForCollection}`);
    
    res.status(201).json({ status: 'success', message: 'AI story saved', data: { story } });
  } catch (error) {
    console.error('Save AI story error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

router.post('/', [auth, body('title').trim().isLength({ min: 1, max: 100 }), body('description').trim().isLength({ min: 1, max: 500 }), body('content').trim().isLength({ min: 1 })], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });

    const storyData = { ...req.body, createdBy: req.parentId };
    const story = new Story(storyData);
    await story.save();
    res.status(201).json({ status: 'success', message: 'Story created successfully', data: { story } });
  } catch (error) {
    console.error('Create story error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

module.exports = router;
