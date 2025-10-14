// models/Child.js - Complete Fixed Version
const mongoose = require('mongoose');

const childSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  age: {
    type: Number,
    required: true,
    min: 2,
    max: 12
  },
  dateOfBirth: {
    type: Date
  },
  avatar: {
    type: String,
    default: '👶'
  },
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Parent',
    required: true,
    index: true
  },
  preferences: {
    favoriteThemes: [String],
    favoriteCategories: [String],
    voicePreference: {
      type: String,
      enum: ['parent', 'ai', 'both'],
      default: 'both'
    },
    bedtime: String,
    interests: [String]
  },
  stats: {
    totalStoriesCompleted: { type: Number, default: 0 },
    totalActivitiesCompleted: { type: Number, default: 0 },
    totalTimeSpent: { type: Number, default: 0 },
    totalPlaySeconds: { type: Number, default: 0 },
    totalPlayTime: { type: Number, default: 0 },
    storiesCompleted: { type: Number, default: 0 },
    lastActive: Date,
    lastActivity: Date,
    streakDays: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    favoriteContent: [{
      contentId: mongoose.Schema.Types.ObjectId,
      contentType: String,
      playCount: { type: Number, default: 0 }
    }]
  },
  completedStories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Story'
  }],
  completedActivities: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Activity'
  }],
  favorites: [{
    contentType: {
      type: String,
      enum: ['story', 'activity']
    },
    contentId: mongoose.Schema.Types.ObjectId,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  mood: {
    current: {
      type: String,
      enum: ['happy', 'curious', 'excited', 'calm', 'tired', 'frustrated', 'sad']
    },
    history: [{
      mood: {
        type: String,
        enum: ['happy', 'curious', 'excited', 'calm', 'tired', 'frustrated', 'sad']
      },
      activity: String,
      notes: String,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }]
  },
  achievements: [{
    name: String,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
childSchema.index({ parentId: 1, isActive: 1 });
childSchema.index({ 'stats.lastActive': -1 });

// Instance Methods
childSchema.methods.completeStory = async function(storyId) {
  if (!this.completedStories) this.completedStories = [];
  if (!this.completedStories.includes(storyId)) {
    this.completedStories.push(storyId);
    this.stats = this.stats || {};
    this.stats.totalStoriesCompleted = (this.stats.totalStoriesCompleted || 0) + 1;
    this.stats.storiesCompleted = (this.stats.storiesCompleted || 0) + 1;
    this.stats.lastActive = new Date();
    this.stats.lastActivity = new Date();
    await this.save();
  }
};

childSchema.methods.updatePlayTime = async function(seconds) {
  if (!this.stats) this.stats = {};
  this.stats.totalPlaySeconds = (this.stats.totalPlaySeconds || 0) + seconds;
  this.stats.totalTimeSpent = Math.floor(this.stats.totalPlaySeconds / 60);
  this.stats.totalPlayTime = this.stats.totalTimeSpent;
  this.stats.lastActive = new Date();
  this.stats.lastActivity = new Date();
  await this.save();
};

childSchema.methods.addAchievement = async function(achievement) {
  if (!this.achievements) this.achievements = [];
  const exists = this.achievements.some(a => a.name === achievement);
  if (!exists) {
    this.achievements.push({ name: achievement, addedAt: new Date() });
    await this.save();
  }
};

childSchema.methods.updateMood = async function(mood, activity = '', notes = '') {
  if (!this.mood) this.mood = { history: [] };
  if (!this.mood.history) this.mood.history = [];
  
  this.mood.current = mood;
  this.mood.history.push({
    mood,
    activity,
    notes,
    timestamp: new Date()
  });
  
  if (this.mood.history.length > 50) {
    this.mood.history = this.mood.history.slice(-50);
  }
  
  this.stats.lastActive = new Date();
  this.stats.lastActivity = new Date();
  await this.save();
};

childSchema.methods.addFavorite = async function(contentId, contentType) {
  if (!this.favorites) this.favorites = [];
  const existing = this.favorites.find(
    f => f.contentId.toString() === contentId.toString()
  );
  
  if (!existing) {
    this.favorites.push({ contentType, contentId, addedAt: new Date() });
    await this.save();
  }
};

childSchema.methods.removeFavorite = async function(contentId) {
  if (!this.favorites) this.favorites = [];
  this.favorites = this.favorites.filter(
    f => f.contentId.toString() !== contentId.toString()
  );
  await this.save();
};

childSchema.methods.getPublicProfile = function() {
  return {
    id: this._id,
    name: this.name,
    age: this.age,
    dateOfBirth: this.dateOfBirth,
    avatar: this.avatar,
    preferences: this.preferences || {},
    stats: this.stats || {
      totalStoriesCompleted: 0,
      totalActivitiesCompleted: 0,
      totalTimeSpent: 0,
      totalPlaySeconds: 0,
      totalPlayTime: 0,
      storiesCompleted: 0,
      streakDays: 0,
      currentStreak: 0,
      longestStreak: 0
    },
    ageGroup: this.ageGroup,
    isActive: this.isActive,
    createdAt: this.createdAt,
    completedStoriesCount: (this.completedStories || []).length,
    completedActivitiesCount: (this.completedActivities || []).length,
    favoritesCount: (this.favorites || []).length,
    mood: this.mood
  };
};

// Virtual for age group
childSchema.virtual('ageGroup').get(function() {
  if (this.age <= 4) return 'toddler';
  if (this.age <= 7) return 'early-childhood';
  if (this.age <= 10) return 'middle-childhood';
  return 'pre-teen';
});

// Ensure virtuals are included
childSchema.set('toJSON', { virtuals: true });
childSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Child', childSchema);