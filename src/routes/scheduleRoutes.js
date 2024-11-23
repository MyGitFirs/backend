// routes/schedule.routes.js
const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/scheduleController');

// Define the routes for schedules
router.get('/all', scheduleController.getAllSchedules); // Get all schedules
router.get('/by_id/:instructorId', scheduleController.getScheduleById); // Get a single schedule by ID
router.get('/bySectionAndYear', scheduleController.getScheduleBySectionAndYearLevel);
router.post('/new', scheduleController.createSchedule); // Create a new schedule
router.put('/update/:id', scheduleController.updateSchedule); // Update an existing schedule
router.delete('/delete/:id', scheduleController.deleteSchedule); // Delete a schedule by ID
// Route for getting schedule by linked student's year_level, section, and courses
router.get('/linked-student/:parentId', scheduleController.getScheduleByLinkedStudentDetails);

module.exports = router;
