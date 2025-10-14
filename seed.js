const mongoose = require('mongoose');
const Story = require('./models/Story');
const Activity = require('./models/Activity');
require('dotenv').config({ path: './config.env' });

const sampleStories = [
  {
    title: 'The Brave Little Mouse',
    description: 'A story about courage and helping others',
    content: 'Once upon a time, there was a little mouse who was afraid of everything. But when his friend needed help, he found the courage to be brave...',
    category: 'interactive',
    theme: 'courage',
    ageRange: { min: 3, max: 8 },
    duration: 8,
    thumbnail: '🐭',
    learningObjectives: ['courage', 'empathy'],
    interactiveElements: {
      hasChoices: true,
      hasVoiceInteraction: true,
      choices: [
        { id: 'help', text: 'Help the bird', consequence: 'The mouse helps and feels proud' },
        { id: 'run', text: 'Run away', consequence: 'The mouse feels sad for not helping' }
      ]
    },
    segments: [
      {
        id: '1',
        text: 'Once upon a time, there was a little mouse who was afraid of everything.',
        isInteractive: false
      },
      {
        id: '2',
        text: 'One day, he heard a bird crying for help. What should the mouse do?',
        isInteractive: true,
        voicePrompt: 'Should I help the bird or run away?'
      }
    ]
  },
  {
    title: 'The Kindness Tree',
    description: 'A story about spreading kindness',
    content: 'In a magical forest, there was a tree that grew kindness fruits. Every time someone did something kind, a new fruit would appear...',
    category: 'audio',
    theme: 'kindness',
    ageRange: { min: 4, max: 10 },
    duration: 12,
    thumbnail: '🌳',
    learningObjectives: ['kindness', 'empathy'],
    interactiveElements: {
      hasChoices: false,
      hasVoiceInteraction: false
    }
  }
];

const sampleActivities = [
  {
    title: 'Kindness Jar',
    description: 'Create a jar to collect acts of kindness',
    type: 'craft',
    category: 'creative',
    ageRange: { min: 3, max: 8 },
    duration: { estimated: 20 },
    thumbnail: '🏺',
    materials: [
      { name: 'Empty jar', quantity: '1', isOptional: false },
      { name: 'Colored paper', quantity: 'Several sheets', isOptional: false },
      { name: 'Markers', quantity: 'Set', isOptional: false },
      { name: 'Stickers', quantity: 'Various', isOptional: true }
    ],
    instructions: [
      {
        step: 1,
        title: 'Decorate the jar',
        description: 'Use markers and stickers to decorate your kindness jar',
        tips: ['Let your child be creative', 'Talk about what kindness means']
      },
      {
        step: 2,
        title: 'Write kindness notes',
        description: 'Write or draw acts of kindness on small pieces of paper',
        tips: ['Help younger children write', 'Encourage specific examples']
      },
      {
        step: 3,
        title: 'Fill the jar',
        description: 'Put the kindness notes in the jar',
        tips: ['Read them together', 'Celebrate each act of kindness']
      }
    ],
    learningObjectives: ['kindness', 'creativity'],
    skills: ['fine_motor', 'creativity', 'social']
  }
];

async function seedDatabase() {
  try {
    console.log('🌱 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('📚 Seeding stories...');
    await Story.insertMany(sampleStories);
    console.log(`✅ Added ${sampleStories.length} stories`);

    console.log('🎨 Seeding activities...');
    await Activity.insertMany(sampleActivities);
    console.log(`✅ Added ${sampleActivities.length} activities`);

    console.log('🎉 Database seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
  }
}

seedDatabase();
