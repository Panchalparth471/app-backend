// routes/chat.js
const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const Parent = require('../models/Parent');

// NOTE: In production protect these routes with auth middleware and use req.user.id.
// For now we accept parentId in params/body (you can adapt to your auth middleware).

/**
 * GET /api/chat/:parentId
 * Return chat doc for parent (or empty messages array if none)
 */
router.get('/:parentId', async (req, res, next) => {
  try {
    const { parentId } = req.params;
    if (!parentId) return res.status(400).json({ status: 'error', message: 'parentId required' });

    const chat = await Chat.findOne({ parent: parentId });
    if (!chat) {
      return res.json({ status: 'success', data: { messages: [] } });
    }
    return res.json({ status: 'success', data: { chat } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/append
 * body: { parentId, message: { text, isUser (bool), timestamp?, suggestions? } }
 * Appends a single message (user or ai) to the parent's chat (creates chat doc if missing).
 */
router.post('/append', async (req, res, next) => {
  try {
    const { parentId, message } = req.body;
    if (!parentId || !message || !message.text) {
      return res.status(400).json({ status: 'error', message: 'parentId and message.text required' });
    }

    const safeMsg = {
      text: message.text,
      isUser: !!message.isUser,
      timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
      suggestions: Array.isArray(message.suggestions) ? message.suggestions : []
    };

    const updated = await Chat.findOneAndUpdate(
      { parent: parentId },
      { $push: { messages: safeMsg }, $set: { lastUpdated: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Optionally, attach chat reference to parent if not present
    try {
      await Parent.updateOne({ _id: parentId, chats: { $ne: updated._id } }, { $push: { chats: updated._id } });
    } catch (e) {
      // don't fail the whole request if parent update fails
      console.warn('Could not add chat reference to parent:', e.message || e);
    }

    return res.json({ status: 'success', data: { chat: updated } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/chat/create
 * body: { parentId, initialMessages?: [ { text, isUser, timestamp, suggestions } ] }
 * Create a chat doc (if none).
 */
router.post('/create', async (req, res, next) => {
  try {
    const { parentId, initialMessages } = req.body;
    if (!parentId) return res.status(400).json({ status: 'error', message: 'parentId required' });

    const existing = await Chat.findOne({ parent: parentId });
    if (existing) return res.status(400).json({ status: 'error', message: 'Chat already exists' });

    const messages = Array.isArray(initialMessages) ? initialMessages.map(m => ({
      text: m.text,
      isUser: !!m.isUser,
      timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
      suggestions: Array.isArray(m.suggestions) ? m.suggestions : []
    })) : [];

    const created = await Chat.create({ parent: parentId, messages, lastUpdated: new Date() });
    try {
      await Parent.updateOne({ _id: parentId }, { $push: { chats: created._id } });
    } catch (e) { /* ignore */ }

    return res.json({ status: 'success', data: { chat: created } });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/chat/:parentId
 * Delete chat for parent (admin-only in real app)
 */
router.delete('/:parentId', async (req, res, next) => {
  try {
    const { parentId } = req.params;
    if (!parentId) return res.status(400).json({ status: 'error', message: 'parentId required' });
    const deleted = await Chat.findOneAndDelete({ parent: parentId });
    return res.json({ status: 'success', data: { deleted } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
