// routes/child.js
const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Child = require('../models/Child');
const Story = require('../models/Story');
const Activity = require('../models/Activity');
const auth = require('../middleware/auth');

const router = express.Router();

// Helper function to check if ID is client-side content
const isClientSideId = (id) => {
  if (!id) return false;
  const str = String(id);
  return str.startsWith('ai-') ||
         str.startsWith('mom-') ||
         str.startsWith('grandma-') ||
         str.startsWith('now-') ||
         str.startsWith('learn-') ||
         str.startsWith('featured-') ||
         str.startsWith('client-');
};

// @route   GET /api/child/:childId/home
// @desc    Get child home screen data (does NOT auto-generate AI stories).
// @access  Private
router.get('/:childId/home', auth, async (req, res) => {
  try {
    const { childId } = req.params;

    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({ status: 'error', message: 'Invalid child ID' });
    }

    const child = await Child.findOne({
      _id: childId,
      parentId: req.parentId,
      isActive: true
    });

    if (!child) {
      return res.status(404).json({ status: 'error', message: 'Child not found' });
    }

    // Query AI categories but DO NOT trigger generation here.
    const [momStories, grandmaStories, nowStories, learnStories] = await Promise.all([
      Story.find({
        generatedForCollection: 'mom-stories',
        isActive: true,
        isAIGenerated: true
      }).sort({ createdAt: -1 }).limit(1).lean(),

      Story.find({
        generatedForCollection: 'grandma-stories',
        isActive: true,
        isAIGenerated: true
      }).sort({ createdAt: -1 }).limit(1).lean(),

      Story.find({
        generatedForCollection: 'now-stories',
        isActive: true,
        isAIGenerated: true
      }).sort({ createdAt: -1 }).limit(1).lean(),

      Story.find({
        generatedForCollection: 'learn-stories',
        isActive: true,
        isAIGenerated: true
      }).sort({ createdAt: -1 }).limit(1).lean()
    ]);

    // Get other content by categories
    const [interactiveStories, audioStories, videos, irlActivities] = await Promise.all([
      Story.find({
        isActive: true,
        category: 'interactive',
        isAIGenerated: { $ne: true },
        'ageRange.min': { $lte: child.age },
        'ageRange.max': { $gte: child.age }
      }).limit(1).lean(),

      Story.find({
        isActive: true,
        category: 'audio',
        isAIGenerated: { $ne: true },
        'ageRange.min': { $lte: child.age },
        'ageRange.max': { $gte: child.age }
      }).limit(1).lean(),

      Story.find({
        isActive: true,
        category: 'video',
        isAIGenerated: { $ne: true },
        'ageRange.min': { $lte: child.age },
        'ageRange.max': { $gte: child.age }
      }).limit(1).lean(),

      Activity.find({
        isActive: true,
        type: 'irl',
        'ageRange.min': { $lte: child.age },
        'ageRange.max': { $gte: child.age }
      }).limit(1).lean()
    ]);

    // If any AI category is missing, do NOT generate here — return initializationPending flag false so the client can choose to initialize.
    const responseData = {
      child: {
        name: child.name,
        age: child.age,
        avatar: child.avatar
      },
      todayTheme: ['Courage and Bravery', 'Kindness Matters', 'Friendship Forever', 'Learning is Fun', 'Creative Adventures', 'Nature Wonders'][new Date().getDate() % 6],
      featuredContent: null,
      contentCategories: {}
    };

    const formatStories = (stories) => stories.map(story => ({
      _id: story._id,
      id: story._id,
      title: story.title,
      description: story.description,
      content: story.content,
      type: 'story',
      category: story.category,
      duration: story.duration || 8,
      thumbnail: story.thumbnail || '📚',
      theme: story.theme,
      ageRange: story.ageRange,
      isNew: story.isNew || false,
      isFavorite: false,
      isAIGenerated: story.isAIGenerated || false,
      voiceType: story.isAIGenerated ? 'AI Voice' : undefined,
      audioUrl: story.audioUrl,
      generatedForCollection: story.generatedForCollection,
      tags: story.tags || []
    }));

    if (momStories.length > 0) responseData.contentCategories['Stories from Mom'] = formatStories(momStories);
    if (grandmaStories.length > 0) responseData.contentCategories['Stories from Grandma'] = formatStories(grandmaStories);
    if (nowStories.length > 0) responseData.contentCategories['Perfect Right Now'] = formatStories(nowStories);
    if (learnStories.length > 0) responseData.contentCategories['Learning Adventures'] = formatStories(learnStories);

    if (interactiveStories.length > 0) responseData.contentCategories['Interactive Stories'] = formatStories(interactiveStories);
    if (audioStories.length > 0) responseData.contentCategories['Audio Stories'] = formatStories(audioStories);
    if (videos.length > 0) responseData.contentCategories['Videos'] = formatStories(videos);
    if (irlActivities.length > 0) {
      responseData.contentCategories['IRL Activities'] = irlActivities.map(activity => ({
        _id: activity._id,
        id: activity._id,
        title: activity.title,
        description: activity.description,
        type: 'activity',
        duration: activity.duration || 15,
        thumbnail: activity.thumbnail || '🎯',
        ageRange: activity.ageRange
      }));
    }

    // determine featured content (prefer now, then mom)
    let featuredStory = null;
    if (responseData.contentCategories['Perfect Right Now'] && responseData.contentCategories['Perfect Right Now'].length) {
      featuredStory = responseData.contentCategories['Perfect Right Now'][0];
    } else if (responseData.contentCategories['Stories from Mom'] && responseData.contentCategories['Stories from Mom'].length) {
      featuredStory = responseData.contentCategories['Stories from Mom'][0];
    } else {
      const fallback = await Story.findOne({
        isActive: true,
        'ageRange.min': { $lte: child.age },
        'ageRange.max': { $gte: child.age }
      }).sort({ 'stats.totalPlays': -1 }).lean();
      if (fallback) featuredStory = {
        _id: fallback._id,
        id: fallback._id,
        title: fallback.title,
        description: fallback.description,
        content: fallback.content,
        type: 'story',
        category: fallback.category,
        duration: fallback.duration,
        thumbnail: fallback.thumbnail,
        isAIGenerated: fallback.isAIGenerated,
        audioUrl: fallback.audioUrl,
        generatedForCollection: fallback.generatedForCollection
      };
    }

    if (featuredStory) responseData.featuredContent = featuredStory;

    // If any AI category had zero stories, include a flag so client can show an "Init categories" action.
    const aiKeys = ['mom-stories', 'grandma-stories', 'now-stories', 'learn-stories'];
    const anyMissingAI = await Promise.any
      ? (await Promise.all(aiKeys.map(async (k) => {
          const c = await Story.countDocuments({ generatedForCollection: k, isActive: true, isAIGenerated: true });
          return c === 0;
        }))).some(Boolean)
      : (await Promise.all(aiKeys.map(async (k) => {
          const c = await Story.countDocuments({ generatedForCollection: k, isActive: true, isAIGenerated: true });
          return c === 0;
        }))).some(Boolean);

    if (anyMissingAI) responseData.initializationPending = false; // missing but not auto-generated

    res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });

    return res.json({ status: 'success', data: responseData });
  } catch (error) {
    console.error('Child home error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// other endpoints (content, play, complete, suggestions, mood, favorites) preserved with same behavior
// GET content
router.get('/:childId/content/:contentId', auth, async (req, res) => {
  try {
    const { childId, contentId } = req.params;
    if (!mongoose.isValidObjectId(childId)) return res.status(400).json({ status: 'error', message: 'Invalid child ID' });
    const child = await Child.findOne({ _id: childId, parentId: req.parentId, isActive: true });
    if (!child) return res.status(404).json({ status: 'error', message: 'Child not found' });

    if (isClientSideId(contentId)) {
      return res.status(400).json({ status: 'error', message: 'Client-side content requires contentData from app', isClientSideContent: true });
    }
    if (!mongoose.isValidObjectId(contentId)) return res.status(400).json({ status: 'error', message: 'Invalid content ID' });

    let content = await Story.findOne({ _id: contentId, isActive: true }).lean();
    if (!content) content = await Activity.findOne({ _id: contentId, isActive: true }).lean();
    if (!content) return res.status(404).json({ status: 'error', message: 'Content not found' });

    return res.json({ status: 'success', data: { content } });
  } catch (error) {
    console.error('Get content error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// POST play
router.post('/:childId/play/:contentId', auth, async (req, res) => {
  try {
    const { childId, contentId } = req.params;
    if (!mongoose.isValidObjectId(childId)) return res.status(400).json({ status: 'error', message: 'Invalid child ID' });

    const child = await Child.findOne({ _id: childId, parentId: req.parentId, isActive: true });
    if (!child) return res.status(404).json({ status: 'error', message: 'Child not found' });

    if (isClientSideId(contentId)) {
      return res.json({ status: 'success', message: 'Client-side content play started', data: { child: child.getPublicProfile(), isClientSideContent: true } });
    }

    if (!mongoose.isValidObjectId(contentId)) return res.status(400).json({ status: 'error', message: 'Invalid content ID' });

    const story = await Story.findOne({ _id: contentId, isActive: true });
    const activity = await Activity.findOne({ _id: contentId, isActive: true });
    const content = story || activity;
    if (!content) return res.status(404).json({ status: 'error', message: 'Content not found' });

    if (story) {
      story.stats = story.stats || {};
      story.stats.totalPlays = (story.stats.totalPlays || 0) + 1;
      await story.save();
    } else if (activity) {
      activity.stats = activity.stats || {};
      activity.stats.totalAttempts = (activity.stats.totalAttempts || 0) + 1;
      await activity.save();
    }

    return res.json({ status: 'success', message: 'Content play started', data: { content, child: child.getPublicProfile() } });
  } catch (error) {
    console.error('Play error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// POST complete
router.post('/:childId/complete/:contentId', auth, async (req, res) => {
  try {
    const { childId, contentId } = req.params;
    const { timeSpent, achievements = [] } = req.body || {};

    if (!mongoose.isValidObjectId(childId))
      return res.status(400).json({ status: 'error', message: 'Invalid child ID' });

    const child = await Child.findOne({ _id: childId, parentId: req.parentId, isActive: true });
    if (!child) return res.status(404).json({ status: 'error', message: 'Child not found' });

    if (isClientSideId(contentId)) {
      if (timeSpent && Number.isInteger(timeSpent) && timeSpent > 0) {
        child.stats = child.stats || {};
        child.stats.totalPlaySeconds = (child.stats.totalPlaySeconds || 0) + timeSpent;
        child.stats.totalTimeSpent = Math.floor(child.stats.totalPlaySeconds / 60);
        await child.save();
      }
      return res.json({
        status: 'success',
        message: 'Client-side content completed successfully',
        data: { child: child.getPublicProfile(), achievements, timeSpent: timeSpent || 0, isClientSideContent: true }
      });
    }

    if (!mongoose.isValidObjectId(contentId))
      return res.status(400).json({ status: 'error', message: 'Invalid content ID' });

    const story = await Story.findOne({ _id: contentId, isActive: true });
    const activity = await Activity.findOne({ _id: contentId, isActive: true });
    const content = story || activity;
    if (!content) return res.status(404).json({ status: 'error', message: 'Content not found' });

    // Update child stats
    if (timeSpent && Number.isInteger(timeSpent) && timeSpent > 0) {
      child.stats = child.stats || {};
      child.stats.totalPlaySeconds = (child.stats.totalPlaySeconds || 0) + timeSpent;
      child.stats.totalTimeSpent = Math.floor(child.stats.totalPlaySeconds / 60);
      await child.save();
    }

    let replacementStory = null;

    if (story) {
      story.stats = story.stats || {};
      story.stats.completions = (story.stats.completions || 0) + 1;

      // If story is AI-generated and belongs to a category, delete it before generating replacement
      if (story.isAIGenerated && story.generatedForCollection) {
        await Story.deleteOne({ _id: story._id }); // delete the completed story

        try {
          // generate replacement (non-blocking)
          const aiRoutes = require('./ai');
          aiRoutes.generateCategoryStories(
            story.generatedForCollection,
            child.name || 'friend',
            child.age || 5,
            1,
            req
          ).catch((e) => console.error('Replacement generation failed:', e && e.message ? e.message : e));
        } catch (e) {
          console.error('Failed to call AI generator for replacement:', e && e.message ? e.message : e);
        }
      } else {
        await story.save(); // save completions for non-AI or un-categorized stories
      }
    } else if (activity) {
      activity.stats = activity.stats || {};
      activity.stats.completions = (activity.stats.completions || 0) + 1;
      await activity.save();
    }

    const responseData = { child: child.getPublicProfile(), achievements, timeSpent: timeSpent || 0 };
    if (replacementStory) responseData.newStory = replacementStory;

    return res.json({ status: 'success', message: 'Content completed successfully', data: responseData });
  } catch (error) {
    console.error('Complete error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});




// @route   GET /api/child/:childId/suggestions
// @desc    Get personalized suggestions for child
// @access  Private
router.get('/:childId/suggestions', auth, async (req, res) => {
  try {
    const { childId } = req.params;

    // Validate childId
    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    const child = await Child.findOne({ 
      _id: childId, 
      parentId: req.parentId, 
      isActive: true 
    });

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    const recentActivity = child.stats ? child.stats.lastActivity : null;
    const favoriteThemes = (child.preferences && child.preferences.interests) || [];

    const suggestions = [
      {
        id: '1',
        title: 'Play Another Story',
        description: 'Continue your adventure with more magical stories!',
        type: 'story',
        icon: '📚',
        color: '#8b5cf6',
        estimatedTime: '10-15 min',
        isRecommended: true,
        reason: 'You loved the interactive story!'
      },
      {
        id: '2',
        title: 'Try a Kindness Quest',
        description: 'Help someone in your family with a small act of kindness',
        type: 'irl',
        icon: '💝',
        color: '#ef4444',
        estimatedTime: '5-10 min',
        isRecommended: true,
        reason: 'Perfect for practicing what you learned!'
      },
      {
        id: '3',
        title: 'Sing Along Songs',
        description: 'Dance and sing to fun, uplifting music',
        type: 'music',
        icon: '🎵',
        color: '#f59e0b',
        estimatedTime: '8-12 min',
        isRecommended: false,
        reason: 'Great for when you feel energetic!'
      },
      {
        id: '4',
        title: 'Art & Craft Time',
        description: 'Create something beautiful with your hands',
        type: 'activity',
        icon: '🎨',
        color: '#10b981',
        estimatedTime: '15-20 min',
        isRecommended: false,
        reason: 'Express your creativity!'
      },
      {
        id: '5',
        title: 'Tell Your Grown-up',
        description: 'Share what you learned from the story',
        type: 'irl',
        icon: '🗣️',
        color: '#06b6d4',
        estimatedTime: '5 min',
        isRecommended: true,
        reason: 'They\'ll love hearing about your adventure!'
      }
    ];

    res.json({
      status: 'success',
      data: {
        suggestions,
        child: child.getPublicProfile(),
        recentActivity
      }
    });
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   POST /api/child/:childId/mood
// @desc    Update child's current mood
// @access  Private
router.post('/:childId/mood', [
  body('mood').isIn(['happy', 'curious', 'excited', 'calm', 'tired', 'frustrated', 'sad']).withMessage('Invalid mood'),
  body('activity').optional().trim().isLength({ max: 100 }).withMessage('Activity description too long'),
  body('notes').optional().trim().isLength({ max: 200 }).withMessage('Notes too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { childId } = req.params;

    // Validate childId
    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    const { mood, activity, notes } = req.body;

    const child = await Child.findOne({ 
      _id: childId, 
      parentId: req.parentId, 
      isActive: true 
    });

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    await child.updateMood(mood, activity || '', notes || '');

    res.json({
      status: 'success',
      message: 'Mood updated successfully',
      data: {
        child: child.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Update mood error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   POST /api/child/:childId/favorite/:contentId
// @desc    Add content to favorites
// @access  Private
router.post('/:childId/favorite/:contentId', auth, async (req, res) => {
  try {
    const { childId, contentId } = req.params;
    const { contentType } = req.body;

    // Validate childId
    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    // Validate contentId
    if (!mongoose.isValidObjectId(contentId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid content ID'
      });
    }

    const child = await Child.findOne({ 
      _id: childId, 
      parentId: req.parentId, 
      isActive: true 
    });

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    await child.addFavorite(contentId, contentType || 'story');

    res.json({
      status: 'success',
      message: 'Added to favorites',
      data: {
        child: child.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Add favorite error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/child/:childId/favorite/:contentId
// @desc    Remove content from favorites
// @access  Private
router.delete('/:childId/favorite/:contentId', auth, async (req, res) => {
  try {
    const { childId, contentId } = req.params;

    // Validate childId
    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    // Validate contentId
    if (!mongoose.isValidObjectId(contentId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid content ID'
      });
    }

    const child = await Child.findOne({ 
      _id: childId, 
      parentId: req.parentId, 
      isActive: true 
    });

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    await child.removeFavorite(contentId);

    res.json({
      status: 'success',
      message: 'Removed from favorites',
      data: {
        child: child.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Remove favorite error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   GET /api/child/:childId/favorites
// @desc    Get all favorite content for child
// @access  Private
router.get('/:childId/favorites', auth, async (req, res) => {
  try {
    const { childId } = req.params;

    // Validate childId
    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    const child = await Child.findOne({ 
      _id: childId, 
      parentId: req.parentId, 
      isActive: true 
    }).populate('favorites.contentId');

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    res.json({
      status: 'success',
      data: {
        favorites: child.favorites || [],
        child: child.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

module.exports = router;
