// models/Planner.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PlannerSchema = new Schema({
  parentId: { type: Schema.Types.ObjectId, ref: 'Parent', required: true },
  name: { type: String, default: 'Weekly Plan' },
  plan: { type: Schema.Types.Mixed, required: true }, // store days array etc
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
});

PlannerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.models.Planner || mongoose.model('Planner', PlannerSchema);
