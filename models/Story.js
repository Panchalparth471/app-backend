const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Story title is required'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Story description is required'],
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  content: {
    type: String,
    required: [true, 'Story content is required']
  },
  thumbnail: {
    type: String,
    default: '📚'
  },
  coverImage: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    required: [true, 'Story category is required'],
    enum: ['interactive', 'audio', 'video', 'bedtime', 'educational']
  },
  theme: {
    type: String,
    required: [true, 'Story theme is required'],
    enum: ['kindness', 'courage', 'friendship', 'learning', 'creativity', 'nature', 'family', 'adventure', 'science','ai_generated']
  },
  isAIGenerated: {
    type: Boolean,
    default: false
  },
  // ✅ NEW FIELD: Track which AI collection this story belongs to
  generatedForCollection: {
    type: String,
    enum: ['mom-stories', 'grandma-stories', 'now-stories', 'learn-stories', null],
    default: null,
    index: true
  },
  ageRange: {
    min: {
      type: Number,
      required: [true, 'Minimum age is required'],
      min: [2, 'Minimum age must be at least 2'],
      max: [12, 'Minimum age must be at most 12']
    },
    max: {
      type: Number,
      required: [true, 'Maximum age is required'],
      min: [2, 'Maximum age must be at least 2'],
      max: [12, 'Maximum age must be at most 12']
    }
  },
  duration: {
    type: Number,
    required: [true, 'Story duration is required'],
    min: [1, 'Duration must be at least 1 minute'],
    max: [60, 'Duration must be at most 60 minutes']
  },
  difficulty: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'beginner'
  },
  learningObjectives: [{
    type: String,
    enum: [
      'empathy', 
      'problem_solving', 
      'creativity', 
      'language', 
      'emotional_intelligence', 
      'social_skills', 
      'critical_thinking',
      'kindness',
      'sharing',
      'honesty',
      'respect',
      'patience',
      'cooperation',
      'gratitude',
      'compassion',
      'responsibility',
      'perseverance'
    ]
  }],
  interactiveElements: {
    hasChoices: {
      type: Boolean,
      default: false
    },
    hasVoiceInteraction: {
      type: Boolean,
      default: false
    },
    hasTouchInteraction: {
      type: Boolean,
      default: false
    },
    choices: [{
      id: String,
      text: String,
      consequence: String,
      nextSegment: String
    }]
  },
  segments: [{
    id: String,
    text: String,
    audioUrl: String,
    imageUrl: String,
    isInteractive: Boolean,
    voicePrompt: String,
    choices: [{
      id: String,
      text: String,
      consequence: String
    }]
  }],
  voiceSettings: {
    hasParentVoice: {
      type: Boolean,
      default: false
    },
    voiceCloneId: String,
    defaultVoice: {
      type: String,
      default: 'friendly_female'
    },
    speed: {
      type: Number,
      default: 1.0,
      min: 0.5,
      max: 2.0
    },
    pitch: {
      type: Number,
      default: 1.0,
      min: 0.5,
      max: 2.0
    }
  },
  tags: [{
    type: String,
    trim: true
  }],
  stats: {
    totalPlays: {
      type: Number,
      default: 0
    },
    totalCompletions: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    totalRatings: {
      type: Number,
      default: 0
    },
    lastPlayed: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPremium: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Parent',
    default: null
  },
  // ✅ OPTIONAL: Add audio fields for TTS
  audioUrl: {
    type: String,
    default: null
  },
  audioPending: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for better query performance
storySchema.index({ theme: 1, ageRange: 1 });
storySchema.index({ category: 1, isActive: 1 });
storySchema.index({ 'stats.totalPlays': -1 });
storySchema.index({ createdAt: -1 });
// ✅ NEW INDEX: For querying AI-generated stories by collection
storySchema.index({ generatedForCollection: 1, isActive: 1, isAIGenerated: 1 });

// Virtual for age range display
storySchema.virtual('ageRangeDisplay').get(function() {
  return `${this.ageRange.min}-${this.ageRange.max}`;
});

// Update stats methods
storySchema.methods.incrementPlays = function() {
  this.stats.totalPlays += 1;
  this.stats.lastPlayed = new Date();
  return this.save();
};

storySchema.methods.incrementCompletions = function() {
  this.stats.totalCompletions += 1;
  return this.save();
};

storySchema.methods.addRating = function(rating) {
  const currentTotal = this.stats.averageRating * this.stats.totalRatings;
  this.stats.totalRatings += 1;
  this.stats.averageRating = (currentTotal + rating) / this.stats.totalRatings;
  return this.save();
};

// Get story for specific age
storySchema.statics.getStoriesForAge = function(age, limit = 10) {
  return this.find({
    isActive: true,
    'ageRange.min': { $lte: age },
    'ageRange.max': { $gte: age }
  })
  .sort({ 'stats.totalPlays': -1 })
  .limit(limit);
};

// Get stories by theme
storySchema.statics.getStoriesByTheme = function(theme, age, limit = 10) {
  return this.find({
    isActive: true,
    theme: theme,
    'ageRange.min': { $lte: age },
    'ageRange.max': { $gte: age }
  })
  .sort({ 'stats.totalPlays': -1 })
  .limit(limit);
};

// Get popular stories
storySchema.statics.getPopularStories = function(limit = 10) {
  return this.find({ isActive: true })
    .sort({ 'stats.totalPlays': -1 })
    .limit(limit);
};

// ✅ NEW METHOD: Get stories by collection
storySchema.statics.getStoriesByCollection = function(collectionKey, limit = 10) {
  return this.find({
    generatedForCollection: collectionKey,
    isActive: true,
    isAIGenerated: true
  })
  .sort({ createdAt: -1 })
  .limit(limit);
};

module.exports = mongoose.model('Story', storySchema);