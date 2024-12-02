// sessionRoutes.js
const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/attendanceController'); // Import the controller

// Route for creating a new session
router.post('/create-session', sessionController.createSession);

// Route for checking attendance
router.post('/check-attendance', sessionController.checkAttendance);

router.post('/get-attendance', sessionController.getAttendanceByCriteria);

router.get('/active-session-students/:sessionId', sessionController.getActiveSessionStudents);

router.get('/session/:sessionId', sessionController.getAttendanceBySessionId);


router.get('/names', sessionController.getSessionNames);
module.exports = router;
