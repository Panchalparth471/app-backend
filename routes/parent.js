// routes/parent.js - Complete Fixed Version without mongoose.Types.ObjectId()
const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Parent = require('../models/Parent');
const Child = require('../models/Child');
const Story = require('../models/Story');
const Activity = require('../models/Activity');
const auth = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/parent/dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    const parent = await Parent.findById(req.parentId);
    const children = await Child.find({ 
      parentId: req.parentId, 
      isActive: true 
    });

    const recentActivity = [];
    for (const child of children) {
      if (child.mood && child.mood.history && Array.isArray(child.mood.history)) {
        const recent = child.mood.history.slice(-3).map(entry => ({
          childName: child.name,
          mood: entry.mood,
          activity: entry.activity,
          timestamp: entry.timestamp
        }));
        recentActivity.push(...recent);
      }
    }
    recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const topActivity = recentActivity.slice(0, 10);

    const parentingRhythmScore = Math.floor(Math.random() * 40) + 60;
    const totalStreak = children.reduce((sum, child) => 
      sum + ((child.stats && child.stats.currentStreak) || 0), 0);
    const longestStreak = children.length 
      ? Math.max(...children.map(child => (child.stats && child.stats.longestStreak) || 0)) 
      : 0;

    const nudges = [
      "Try 5 mins of eye-contact play today!",
      "Practice gratitude with your child before bedtime",
      "Ask your child about their favorite part of the day",
      "Do a kindness activity together",
      "Read a story and discuss the characters' feelings"
    ];
    const todayNudge = nudges[Math.floor(Math.random() * nudges.length)];

    res.json({
      status: 'success',
      data: {
        parent: parent.getPublicProfile ? parent.getPublicProfile() : { 
          id: parent._id, 
          name: parent.name 
        },
        children: children.map(child => child.getPublicProfile()),
        dashboard: {
          parentingRhythmScore,
          currentStreak: totalStreak,
          longestStreak,
          todayNudge,
          recentActivity: topActivity,
          totalPlayTime: children.reduce((sum, child) => 
            sum + ((child.stats && child.stats.totalPlayTime) || 0), 0),
          storiesCompleted: children.reduce((sum, child) => 
            sum + ((child.stats && child.stats.storiesCompleted) || 0), 0)
        }
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   GET /api/parent/children
router.get('/children', auth, async (req, res) => {
  try {
    const children = await Child.find({ 
      parentId: req.parentId, 
      isActive: true 
    }).sort({ createdAt: -1 });

    res.json({
      status: 'success',
      data: {
        children: children.map(child => child.getPublicProfile())
      }
    });
  } catch (error) {
    console.error('Get children error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   POST /api/parent/children
router.post('/children', [
  auth,
  body('name').trim().isLength({ min: 2, max: 30 }),
  body('age').isInt({ min: 2, max: 12 }),
  body('dateOfBirth').optional().isISO8601()
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

    const { name, age, dateOfBirth, avatar, preferences } = req.body;

    const child = new Child({
      parentId: req.parentId,
      name,
      age,
      dateOfBirth,
      avatar: avatar || '👶',
      preferences: preferences || {}
    });

    await child.save();

    res.status(201).json({
      status: 'success',
      message: 'Child profile created successfully',
      data: {
        child: child.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Create child error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   PUT /api/parent/children/:childId
router.put('/children/:childId', [
  auth,
  body('name').optional().trim().isLength({ min: 2, max: 30 }),
  body('age').optional().isInt({ min: 2, max: 12 })
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
    
    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    const updateData = req.body;

    const child = await Child.findOneAndUpdate(
      { 
        _id: childId, 
        parentId: req.parentId 
      },
      updateData,
      { new: true, runValidators: true }
    );

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    res.json({
      status: 'success',
      message: 'Child profile updated successfully',
      data: {
        child: child.getPublicProfile()
      }
    });
  } catch (error) {
    console.error('Update child error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   DELETE /api/parent/children/:childId
router.delete('/children/:childId', auth, async (req, res) => {
  try {
    const { childId } = req.params;

    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    const child = await Child.findOneAndUpdate(
      { 
        _id: childId, 
        parentId: req.parentId 
      },
      { isActive: false },
      { new: true }
    );

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    res.json({
      status: 'success',
      message: 'Child profile deleted successfully'
    });
  } catch (error) {
    console.error('Delete child error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   GET /api/parent/progress/:childId
router.get('/progress/:childId', auth, async (req, res) => {
  try {
    const { childId } = req.params;

    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    const child = await Child.findOne({ 
      _id: childId, 
      parentId: req.parentId 
    });

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    const moodHistory = (child.mood && child.mood.history) 
      ? child.mood.history.slice(-30) 
      : [];

    const engagementScore = Math.floor(Math.random() * 40) + 60;

    const favoriteContent = (child.stats && child.stats.favoriteContent)
      ? child.stats.favoriteContent
          .sort((a, b) => b.playCount - a.playCount)
          .slice(0, 5)
      : [];

    res.json({
      status: 'success',
      data: {
        child: child.getPublicProfile(),
        progress: {
          engagementScore,
          moodHistory,
          favoriteContent,
          totalPlayTime: (child.stats && child.stats.totalPlayTime) || 0,
          storiesCompleted: (child.stats && child.stats.storiesCompleted) || 0,
          currentStreak: (child.stats && child.stats.currentStreak) || 0,
          longestStreak: (child.stats && child.stats.longestStreak) || 0
        }
      }
    });
  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @route   GET /api/parent/suggestions/:childId
router.get('/suggestions/:childId', auth, async (req, res) => {
  try {
    const { childId } = req.params;

    if (!mongoose.isValidObjectId(childId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid child ID'
      });
    }

    const child = await Child.findOne({ 
      _id: childId, 
      parentId: req.parentId 
    });

    if (!child) {
      return res.status(404).json({
        status: 'error',
        message: 'Child not found'
      });
    }

    let stories = [];
    let activities = [];

    if (Story.getStoriesForAge) {
      stories = await Story.getStoriesForAge(child.age, 5);
    } else {
      stories = await Story.find({
        isActive: true,
        'ageRange.min': { $lte: child.age },
        'ageRange.max': { $gte: child.age }
      }).limit(1);
    }

    if (Activity.getActivitiesForAge) {
      activities = await Activity.getActivitiesForAge(child.age, 5);
    } else {
      activities = await Activity.find({
        isActive: true,
        'ageRange.min': { $lte: child.age },
        'ageRange.max': { $gte: child.age }
      }).limit(1);
    }

    const suggestions = [
      {
        type: 'story',
        title: 'Continue Learning',
        description: `Based on ${child.name}'s interests, here are some recommended stories`,
        content: stories.slice(0, 3)
      },
      {
        type: 'activity',
        title: 'Hands-on Fun',
        description: `Try these activities that match ${child.name}'s learning style`,
        content: activities.slice(0, 3)
      },
      {
        type: 'irl',
        title: 'Real-world Connection',
        description: 'Connect the story to real-life experiences',
        content: [
          {
            title: 'Practice Kindness',
            description: 'Do something kind for someone today',
            type: 'irl'
          }
        ]
      }
    ];

    res.json({
      status: 'success',
      data: {
        suggestions,
        childProfile: child.getPublicProfile()
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

module.exports = router;