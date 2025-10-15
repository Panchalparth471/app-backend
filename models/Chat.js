// models/Chat.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  text: { type: String, required: true },
  isUser: { type: Boolean, required: true, default: true },
  timestamp: { type: Date, required: true, default: Date.now },
  suggestions: [{ type: String }]
}, { _id: false });

// Chat document for a parent
const ChatSchema = new mongoose.Schema({
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Parent', required: true, index: true },
  messages: { type: [MessageSchema], default: [] },
  lastUpdated: { type: Date, default: Date.now }
}, {
  timestamps: true
});

ChatSchema.index({ parent: 1, lastUpdated: -1 });

module.exports = mongoose.model('Chat', ChatSchema);
