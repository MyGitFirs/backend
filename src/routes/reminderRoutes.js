const express = require('express');
const {
  getAllReminders,
  getRemindersByUserId,
  createReminder,
  updateReminder,
  deleteReminder,
} = require('../controllers/reminderController');

const router = express.Router();

// Define routes for reminders

// Get all reminders
router.get('/get_all', getAllReminders);

// Get reminders by user ID
router.get('/user/:userId', getRemindersByUserId);

// Create a new reminder
router.post('/create', createReminder);

// Update an existing reminder
router.put('/update/:id', updateReminder);

// Delete a reminder
router.delete('/delete/:id', deleteReminder);



module.exports = router;
