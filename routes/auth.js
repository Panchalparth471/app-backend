const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Parent = require('../models/Parent');
const Child = require('../models/Child');

const router = express.Router();

/**
 * Utility: Validate email with a permissive regex
 */
const isValidEmail = (email = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Helper: approximate Date of Birth from age
 */
const approximateDobFromAge = (ageYears) => {
  const now = new Date();
  const birthYear = now.getFullYear() - ageYears;
  return new Date(birthYear, 0, 1);
};

/**
 * POST /api/auth/onboard
 * Body:
 * {
 *   name, email?, child?: { name, age, dateOfBirth, avatar?, preferences? },
 *   interests?, avoidNote?, traits?, profileImage?
 * }
 */
router.post('/onboard', async (req, res) => {
  try {
    const {
      name,
      email: providedEmail,
      child,
      interests,
      avoidNote,
      traits,
      profileImage,
    } = req.body;

    /** ---- 1. Basic Validation ---- **/
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({
        status: 'error',
        message: 'Name is required and must be at least 2 characters long.',
      });
    }

    let emailToUse = null;
    if (providedEmail) {
      if (typeof providedEmail !== 'string' || !isValidEmail(providedEmail.trim())) {
        return res.status(400).json({
          status: 'error',
          message: 'Provided email is invalid. Please provide a valid email address.',
        });
      }
      emailToUse = providedEmail.trim().toLowerCase();
    }

    /** ---- 2. Find or Create Parent ---- **/
    let parent = null;
    if (emailToUse) {
      parent = await Parent.findOne({ email: { $regex: `^${emailToUse}$`, $options: 'i' } });
    }

    if (!parent) {
      // Create a guest parent with a safe generated email
      const guestLocal = `guest-${crypto.randomBytes(6).toString('hex')}`;
      const generatedEmail = emailToUse || `${guestLocal}@example.com`;
      const randomPassword = crypto.randomBytes(12).toString('hex');

      parent = new Parent({
        name: name.trim(),
        email: generatedEmail,
        password: randomPassword,
        isGuest: !emailToUse, // true if guest, false if registered
        isActive: true,
        preferences: {
          interests: Array.isArray(interests) ? interests : [],
          avoidNote: avoidNote || '',
          traits: Array.isArray(traits) ? traits : [],
        },
        profileImage: profileImage || null,
      });

      try {
        await parent.save();
      } catch (err) {
        console.warn('Parent save error (onboard):', err);
        if (err.name === 'ValidationError') {
          const errors = Object.keys(err.errors).map((k) => ({
            field: k,
            message: err.errors[k].message,
            value: err.errors[k].value,
          }));
          return res.status(400).json({
            status: 'error',
            message: 'Validation error while creating parent',
            errors,
          });
        }
        return res.status(500).json({
          status: 'error',
          message: 'Error saving parent during onboarding',
        });
      }
    } else {
      // Update existing parent preferences
      parent.preferences = parent.preferences || {};
      if (Array.isArray(interests)) parent.preferences.interests = interests;
      if (typeof avoidNote === 'string') parent.preferences.avoidNote = avoidNote;
      if (Array.isArray(traits)) parent.preferences.traits = traits;
      if (profileImage) parent.profileImage = profileImage;

      try {
        await parent.save();
      } catch (err) {
        console.warn('Parent update error (onboard):', err);
        if (err.name === 'ValidationError') {
          const errors = Object.keys(err.errors).map((k) => ({
            field: k,
            message: err.errors[k].message,
            value: err.errors[k].value,
          }));
          return res.status(400).json({
            status: 'error',
            message: 'Validation error while updating parent',
            errors,
          });
        }
        return res.status(500).json({
          status: 'error',
          message: 'Error updating parent during onboarding',
        });
      }
    }

    /** ---- 3. Create Child ---- **/
    let createdChild = null;

    if (child && child.name) {
      let ageNumber = null;

      if (typeof child.age === 'number' && !isNaN(child.age)) {
        ageNumber = Math.floor(child.age);
      } else if (typeof child.age === 'string') {
        const match = child.age.match(/(\d+)/);
        if (match) ageNumber = parseInt(match[1], 10);
      }

      let dobToUse = null;
      if (child.dateOfBirth) {
        const parsedDate = new Date(child.dateOfBirth);
        if (!isNaN(parsedDate.getTime())) dobToUse = parsedDate;
      }
      if (!dobToUse && Number.isInteger(ageNumber) && ageNumber > 0) {
        dobToUse = approximateDobFromAge(ageNumber);
      }

      const childPayload = {
        parentId: parent._id,
        name: child.name.trim(),
        age: ageNumber || null,
        dateOfBirth: dobToUse || null,
        avatar: child.avatar || null,
        preferences: child.preferences || {},
        isActive: true,
      };

      try {
        createdChild = new Child(childPayload);
        await createdChild.save();
      } catch (err) {
        console.warn('Child create error (onboard):', err);
        if (err.name === 'ValidationError') {
          const errors = Object.keys(err.errors).map((k) => ({
            field: k,
            message: err.errors[k].message,
            value: err.errors[k].value,
          }));
          return res.status(400).json({
            status: 'error',
            message: 'Validation error while creating child',
            errors,
          });
        }
        return res.status(500).json({
          status: 'error',
          message: 'Error creating child during onboarding',
        });
      }
    }

    /** ---- 4. Generate JWT ---- **/
    const token = jwt.sign(
      { parentId: parent._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    /** ---- 5. Respond ---- **/
    return res.status(201).json({
      status: 'success',
      message: 'Onboarding completed successfully',
      data: {
        parent:
          typeof parent.getPublicProfile === 'function'
            ? parent.getPublicProfile()
            : {
                id: parent._id,
                name: parent.name,
                email: parent.email,
                isGuest: parent.isGuest,
              },
        child:
          createdChild && typeof createdChild.getPublicProfile === 'function'
            ? createdChild.getPublicProfile()
            : createdChild,
        token,
      },
    });
  } catch (error) {
    console.error('Onboard route error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message).join('; ');
      return res.status(400).json({
        status: 'error',
        message: `Validation error: ${messages}`,
      });
    }
    return res.status(500).json({
      status: 'error',
      message: 'Server error during onboarding',
    });
  }
});

module.exports = router;
