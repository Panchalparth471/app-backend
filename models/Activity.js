const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Activity title is required'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Activity description is required'],
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  type: {
    type: String,
    required: [true, 'Activity type is required'],
    enum: ['irl', 'craft', 'game', 'exercise', 'learning', 'music', 'art', 'science']
  },
  category: {
    type: String,
    required: [true, 'Activity category is required'],
    enum: ['physical', 'creative', 'educational', 'social', 'emotional', 'sensory']
  },
  thumbnail: {
    type: String,
    default: '🎨'
  },
  coverImage: {
    type: String,
    default: ''
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
    estimated: {
      type: Number,
      required: [true, 'Estimated duration is required'],
      min: [1, 'Duration must be at least 1 minute'],
      max: [120, 'Duration must be at most 120 minutes']
    },
    actual: {
      type: Number,
      default: 0
    }
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'easy'
  },
  materials: [{
    name: {
      type: String,
      required: true
    },
    quantity: String,
    isOptional: {
      type: Boolean,
      default: false
    }
  }],
  instructions: [{
    step: {
      type: Number,
      required: true
    },
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    imageUrl: String,
    audioUrl: String,
    tips: [String]
  }],
  learningObjectives: [{
    type: String,
    enum: ['motor_skills', 'creativity', 'problem_solving', 'social_skills', 'language', 'math', 'science', 'emotional_intelligence']
  }],
  skills: [{
    type: String,
    enum: ['fine_motor', 'gross_motor', 'cognitive', 'social', 'emotional', 'language', 'creativity', 'coordination']
  }],
  safetyNotes: [{
    type: String,
    trim: true
  }],
  variations: [{
    title: String,
    description: String,
    ageRange: {
      min: Number,
      max: Number
    },
    difficulty: String
  }],
  parentTips: [{
    type: String,
    trim: true
  }],
  stats: {
    totalAttempts: {
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
    lastAttempted: Date
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
  }
}, {
  timestamps: true
});

// Indexes for better query performance
activitySchema.index({ type: 1, category: 1 });
activitySchema.index({ 'ageRange.min': 1, 'ageRange.max': 1 });
activitySchema.index({ 'stats.totalAttempts': -1 });
activitySchema.index({ createdAt: -1 });

// Virtual for age range display
activitySchema.virtual('ageRangeDisplay').get(function() {
  return `${this.ageRange.min}-${this.ageRange.max}`;
});

// Update stats methods
activitySchema.methods.incrementAttempts = function() {
  this.stats.totalAttempts += 1;
  this.stats.lastAttempted = new Date();
  return this.save();
};

activitySchema.methods.incrementCompletions = function() {
  this.stats.totalCompletions += 1;
  return this.save();
};

activitySchema.methods.addRating = function(rating) {
  const currentTotal = this.stats.averageRating * this.stats.totalRatings;
  this.stats.totalRatings += 1;
  this.stats.averageRating = (currentTotal + rating) / this.stats.totalRatings;
  return this.save();
};

// Get activities for specific age
activitySchema.statics.getActivitiesForAge = function(age, limit = 10) {
  return this.find({
    isActive: true,
    'ageRange.min': { $lte: age },
    'ageRange.max': { $gte: age }
  })
  .sort({ 'stats.totalAttempts': -1 })
  .limit(limit);
};

// Get activities by type
activitySchema.statics.getActivitiesByType = function(type, age, limit = 10) {
  return this.find({
    isActive: true,
    type: type,
    'ageRange.min': { $lte: age },
    'ageRange.max': { $gte: age }
  })
  .sort({ 'stats.totalAttempts': -1 })
  .limit(limit);
};

// Get popular activities
activitySchema.statics.getPopularActivities = function(limit = 10) {
  return this.find({ isActive: true })
    .sort({ 'stats.totalAttempts': -1 })
    .limit(limit);
};

module.exports = mongoose.model('Activity', activitySchema);