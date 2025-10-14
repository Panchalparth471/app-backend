// middleware/auth.js
const jwt = require('jsonwebtoken');
const Parent = require('../models/Parent');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization') || req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        status: 'error',
        message: 'No token provided, authorization denied'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer '
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ status: 'error', message: 'Token expired' });
      }
      return res.status(401).json({ status: 'error', message: 'Invalid token' });
    }

    const parent = await Parent.findById(decoded.parentId);
    if (!parent || !parent.isActive) {
      return res.status(401).json({
        status: 'error',
        message: 'Token is no longer valid'
      });
    }

    // Attach both parentId and parent doc for convenience
    req.parentId = parent._id;
    req.parent = parent;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
};

module.exports = auth;
