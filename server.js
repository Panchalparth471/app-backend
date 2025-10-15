// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './config.env' });

// Import Routes
const authRoutes = require('./routes/auth');
const parentRoutes = require('./routes/parent');
const childRoutes = require('./routes/child');
const storyRoutes = require('./routes/stories');
const activityRoutes = require('./routes/activities');
const voiceRoutes = require('./routes/voice');
const aiRoutes = require('./routes/ai');
const chatRoutes = require('./routes/chat');
// after other requires
const transcribeRoute = require('./routes/transcribe');

const plannerRoutes = require('./routes/planner');

const app = express();


// ------------------- Ensure directories exist -------------------
const uploadsDir = path.join(__dirname, 'uploads');
const voiceUploadsDir = path.join(uploadsDir, 'voice');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(voiceUploadsDir)) fs.mkdirSync(voiceUploadsDir);

// ------------------- Security Middleware -------------------
app.use(helmet());
app.use(compression());

// ------------------- Rate Limiting -------------------
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// ------------------- CORS Configuration -------------------

app.use(cors({
  origin: '*',

  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ------------------- Body Parser -------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ------------------- Serve Static Files -------------------
// Serve uploads folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve public/ai-audio folder
app.use('/ai-audio', express.static(path.join(__dirname, 'public/ai-audio')));

// ------------------- Logging -------------------
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ------------------- MongoDB Connection -------------------
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/kindpilot';
mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB');
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
  process.exit(1);
});

// ------------------- Health Check -------------------
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'KindPilot API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ------------------- API Routes -------------------
app.use('/api/auth', authRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/child', childRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/planner', plannerRoutes);
app.use('/api/transcribe', transcribeRoute);
app.use('/api/chat', chatRoutes);


// ------------------- Error Handling -------------------
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (res.headersSent) return next(err);

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      status: 'error',
      message: 'Validation Error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid ID format'
    });
  }

  if (err.code === 11000) {
    return res.status(400).json({
      status: 'error',
      message: 'Duplicate field value'
    });
  }

  res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

// ------------------- 404 Handler -------------------
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Route ${req.originalUrl} not found`
  });
});

// ------------------- Start Server -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 KindPilot API server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
