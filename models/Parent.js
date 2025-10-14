const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const parentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Parent name is required'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  phone: {
    type: String,
    trim: true
  },
  profileImage: {
    type: String,
    default: ''
  },
  preferences: {
    language: {
      type: String,
      default: 'en',
      enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko']
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      },
      dailyReminders: {
        type: Boolean,
        default: true
      }
    },
    contentPreferences: {
      themes: [{
        type: String,
        enum: ['kindness', 'courage', 'friendship', 'learning', 'creativity', 'nature', 'family']
      }],
      ageAppropriate: {
        type: Boolean,
        default: true
      },
      educationalFocus: [{
        type: String,
        enum: ['language', 'math', 'science', 'art', 'music', 'social', 'emotional']
      }]
    }
  },
  voiceSettings: {
    hasVoiceClone: {
      type: Boolean,
      default: false
    },
    voiceCloneId: {
      type: String,
      default: ''
    },
    voicePreferences: {
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
    }
  },
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'premium', 'family'],
      default: 'free'
    },
    startDate: {
      type: Date,
      default: Date.now
    },
    endDate: Date,
    isActive: {
      type: Boolean,
      default: true
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for better query performance
parentSchema.index({ email: 1 });
parentSchema.index({ createdAt: -1 });

// Hash password before saving
parentSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
parentSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Update last login
parentSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save();
};

// Get public profile (without sensitive data)
parentSchema.methods.getPublicProfile = function() {
  const parentObject = this.toObject();
  delete parentObject.password;
  delete parentObject.__v;
  return parentObject;
};

module.exports = mongoose.model('Parent', parentSchema);