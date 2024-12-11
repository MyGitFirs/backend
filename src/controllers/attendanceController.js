const sql = require('mssql');
const config = require('../database/database');
const QRCode = require('qrcode');
const { createReminderBackend } = require('../controllers/reminderController');
const generateRandomSessionId = () => {
  return Math.floor(100000 + Math.random() * 900000);
};

const isSessionIdUnique = async (sessionId, pool) => {
  const result = await pool.request()
    .input('sessionId', sql.Int, sessionId)
    .query('SELECT id FROM sessions WHERE id = @sessionId');
  return result.recordset.length === 0;
};

const createSession = async (req, res) => {
  const { sessionName, date, teacherId, courses, section, year_level } = req.body;

  try {
    const pool = await sql.connect(config);

    // Verify the teacher's role in the users table
    const userCheck = await pool.request()
      .input('teacherId', sql.Int, teacherId)
      .query('SELECT user_role FROM users WHERE id = @teacherId');

    if (userCheck.recordset.length === 0 || userCheck.recordset[0].user_role !== 'teacher') {
      return res.status(403).send('Unauthorized: Only teachers can create sessions');
    }

    // Generate a unique 6-digit session ID
    let sessionId;
    let isUnique = false;
    do {
      sessionId = generateRandomSessionId();
      isUnique = await isSessionIdUnique(sessionId, pool);
    } while (!isUnique);

    // Insert session data into the database
    const result = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .input('sessionName', sql.NVarChar, sessionName)
      .input('date', sql.DateTime, date)
      .input('teacherId', sql.Int, teacherId)
      .query(
        `INSERT INTO sessions (id, name, date, teacher_id, active) 
         OUTPUT INSERTED.id AS sessionId 
         VALUES (@sessionId, @sessionName, @date, @teacherId, 1)`
      );

    const expirationTime = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    const qrData = { session_id: sessionId, date: date, expiresAt: expirationTime.toISOString() };

    // Generate QR code and send the response
    QRCode.toDataURL(JSON.stringify(qrData), { width: 400, height: 400 }, async (err, url) => {
      if (err) {
        console.error('Failed to generate QR code:', err);
        return res.status(500).send('Failed to generate QR code');
      }

      res.json({ sessionId, qrCode: url }); // Send response here

      // Insert initial attendance records for all students
      try {
        const studentsInSection = await pool.request()
          .input('courses', sql.NVarChar, courses)
          .input('section', sql.NVarChar, section)
          .input('year_level', sql.NVarChar, year_level)
          .query(`
            SELECT id FROM users 
            WHERE courses = @courses AND section = @section AND year_level = @year_level
          `);

        for (const student of studentsInSection.recordset) {
          await pool.request()
            .input('studentId', sql.Int, student.id)
            .input('sessionId', sql.Int, sessionId)
            .input('date', sql.Date, new Date())
            .input('status', sql.NVarChar, 'absent')
            .input('timestamp', sql.DateTime, new Date())
            .query(`
              INSERT INTO attendance_status (student_id, session_id, date, status, timestamp) 
              VALUES (@studentId, @sessionId, @date, @status, @timestamp)
            `);
        }

        console.log(`Initial attendance records created for session ${sessionId}.`);
      } catch (attendanceError) {
        console.error(`Error creating attendance records:`, attendanceError);
      }

      // Set the session to inactive after 10 minutes
      setTimeout(async () => {
        try {
          await pool.request()
            .input('sessionId', sql.Int, sessionId)
            .query('UPDATE sessions SET active = 0 WHERE id = @sessionId');
          console.log(`Session ${sessionId} set to inactive after 10 minutes.`);
      
          const absentStudents = await pool.request()
            .input('sessionId', sql.Int, sessionId)
            .query(`
              SELECT u1.id AS parentId, u2.full_name AS studentName
              FROM attendance_status a
              INNER JOIN users u2 ON a.student_id = u2.id
              INNER JOIN users u1 ON u1.linked_student_id = u2.id
              WHERE a.session_id = @sessionId AND a.status = 'absent'
            `);
      
          for (const { parentId, studentName } of absentStudents.recordset) {
            const reminderData = {
              Title: `Attendance Update for ${studentName}`,
              Description: `${studentName} has been marked absent for session: ${sessionName}.`,
              UserID: parentId,
              ReminderDate: new Date(),
              IsCompleted: false,
            };
      
            const reminderResponse = await createReminderBackend(reminderData);
            if (!reminderResponse.success) {
              console.error(`Failed to create reminder for parent ID: ${parentId}`, reminderResponse.error);
            }
          }
      
          console.log(`Reminders created for absent students in session ${sessionId}.`);
        } catch (reminderError) {
          console.error(`Error handling reminders for session ${sessionId}:`, reminderError);
        }
      }, 10 * 60 * 1000);      
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating session');
  }
};

const addStudentToSession = async (req, res) => {
  const { sessionId, studentId } = req.body;
  console.log(sessionId);
  try {
    const pool = await sql.connect(config);

    // Check if the session exists
    const sessionCheck = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .query('SELECT id FROM sessions WHERE id = @sessionId');

    if (sessionCheck.recordset.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Check if the student is already in the session
    const studentCheck = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .input('studentId', sql.Int, studentId)
      .query(`
        SELECT id FROM attendance_status 
        WHERE session_id = @sessionId AND student_id = @studentId
      `);

    if (studentCheck.recordset.length > 0) {
      return res.status(400).json({ message: 'Student is already in the session' });
    }

    // Add the student to the session
    await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .input('studentId', sql.Int, studentId)
      .input('date', sql.Date, new Date())
      .input('status', sql.NVarChar, 'absent')
      .input('timestamp', sql.DateTime, new Date())
      .query(`
        INSERT INTO attendance_status (student_id, session_id, date, status, timestamp)
        VALUES (@studentId, @sessionId, @date, @status, @timestamp)
      `);

    res.status(201).json({ message: 'Student added to session successfully' });
  } catch (error) {
    console.error('Error adding student to session:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
const removeStudentFromSession = async (req, res) => {
  console.log(req.body);
  const { sessionId, studentId } = req.body;

  try {
    const pool = await sql.connect(config);

    // Check if the session exists
    const sessionCheck = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .query('SELECT id FROM sessions WHERE id = @sessionId');

    if (sessionCheck.recordset.length === 0) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // Check if the student is in the session
    const studentCheck = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .input('studentId', sql.Int, studentId)
      .query(`
        SELECT id FROM attendance_status 
        WHERE session_id = @sessionId AND student_id = @studentId
      `);

    if (studentCheck.recordset.length === 0) {
      return res.status(404).json({ message: 'Student not found in the session' });
    }

    // Remove the student from the session
    await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .input('studentId', sql.Int, studentId)
      .query(`
        DELETE FROM attendance_status 
        WHERE session_id = @sessionId AND student_id = @studentId
      `);

    res.status(200).json({ message: 'Student removed from session successfully' });
  } catch (error) {
    console.error('Error removing student from session:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};


const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Radius of Earth in kilometers

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in kilometers
};

// Utility function to create a reminder
const createReminder = async (reminderData) => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('Title', sql.NVarChar, reminderData.Title)
      .input('Description', sql.NVarChar, reminderData.Description)
      .input('UserID', sql.Int, reminderData.UserID)
      .input('ReminderDate', sql.DateTime, reminderData.ReminderDate)
      .input('IsCompleted', sql.Bit, reminderData.IsCompleted)
      .query(`
        INSERT INTO reminders (Title, Description, UserID, ReminderDate, IsCompleted) 
        OUTPUT INSERTED.ReminderID
        VALUES (@Title, @Description, @UserID, @ReminderDate, @IsCompleted)
      `);

    return { success: true, reminderId: result.recordset[0].ReminderID };
  } catch (error) {
    console.error('Error creating reminder:', error.message);
    return { success: false, error: error.message };
  }
};

const checkAttendance = async (req, res) => {
  const { qrData, studentId, studentLat, studentLon } = req.body;
  console.log(req.body);

  let sessionId;
  try {
    if (qrData.startsWith('{')) {
      const parsedQrData = JSON.parse(qrData);
      sessionId = parseInt(parsedQrData.session_id, 10);
    } else {
      sessionId = parseInt(qrData, 10); // Treat qrData as plain session ID
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid QR code format. Please scan a valid QR code.' });
  }

  const maxDistanceKm = 0.2;
  const teacherLat = 15.04158003384158;
  const teacherLon = 120.6832389006157;

  try {
    const pool = await sql.connect(config);

    // Retrieve session details
    const sessionResult = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .query('SELECT * FROM sessions WHERE id = @sessionId AND active = 1');

    if (sessionResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Session does not exist or is inactive.' });
    }

    // Calculate distance
    const distance = haversineDistance(studentLat, studentLon, teacherLat, teacherLon);
    if (distance > maxDistanceKm) {
      return res.status(400).json({ error: 'You are not within the allowed proximity to check in.' });
    }

    // Check existing attendance
    const attendanceResult = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .input('studentId', sql.Int, studentId)
      .query('SELECT * FROM attendance_status WHERE session_id = @sessionId AND student_id = @studentId');

    let attendanceMessage = '';
    if (attendanceResult.recordset.length > 0) {
      // Update attendance
      await pool.request()
        .input('studentId', sql.Int, studentId)
        .input('sessionId', sql.Int, sessionId)
        .input('status', sql.NVarChar, 'present')
        .input('timestamp', sql.DateTime, new Date())
        .query(`
          UPDATE attendance_status 
          SET status = @status, timestamp = @timestamp 
          WHERE session_id = @sessionId AND student_id = @studentId
        `);

      attendanceMessage = 'present';
    } else {
      return res.status(404).json({ error: 'Attendance record not found. Please contact the teacher.' });
    }

    // Retrieve parent's ID
    const parentResult = await pool.request()
      .input('studentId', sql.Int, studentId)
      .query(`
        SELECT u1.id AS parentId, u2.full_name AS studentName
        FROM users u1
        INNER JOIN users u2 ON u1.linked_student_id = u2.id
        WHERE u2.id = @studentId AND u1.user_role = 'parent'
      `);

    if (parentResult.recordset.length === 0) {
      console.error(`No parent found for student ID: ${studentId}`);
      return res.status(200).json({ message: 'Attendance updated, but no parent notification sent.' });
    }

    const { parentId, studentName } = parentResult.recordset[0];

    // Prepare reminder data
    const reminderData = {
      Title: `Attendance Update for ${studentName}`,
      Description: `${studentName} has been marked ${attendanceMessage} for session ID: ${sessionId}.`,
      UserID: parentId,
      ReminderDate: new Date(),
      IsCompleted: false,
    };

    // Create reminder
    const reminderResult = await createReminderBackend(reminderData);

    if (!reminderResult.success) {
      console.error('Error creating reminder:', reminderResult.error);
      return res.status(500).json({ error: 'Attendance updated, but failed to notify the parent.' });
    }

    res.json({ message: `Attendance updated and notification sent to the parent of ${studentName}.` });
  } catch (err) {
    console.error('Database error:', err.message);
    return res.status(500).json({ error: 'An internal server error occurred. Please try again later.' });
  }
};


const getAttendanceByCriteria = async (req, res) => {
  const { startDate, endDate, sessionName } = req.body;
  console.log(req.body);

  try {
    const pool = await sql.connect(config);

    // Query to get attendance details based on date range and session name
    const result = await pool.request()
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate)
      .input('sessionName', sql.NVarChar, sessionName)
      .query(`
        SELECT 
          u.id AS user_id,
          u.full_name,
          u.year_level,
          u.section,
          u.courses,
          a.date,
          a.status,
          a.timestamp,
          s.name AS session_name
        FROM attendance_status a
        JOIN users u ON a.student_id = u.id
        JOIN sessions s ON a.session_id = s.id
        WHERE a.date BETWEEN @startDate AND @endDate
          AND s.name = @sessionName
      `);

    if (result.recordset.length > 0) {
      res.status(200).json({
        success: true,
        data: result.recordset,
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No attendance records found for the specified criteria and session name.',
      });
    }
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.',
    });
  }
};


const getActiveSessionStudents = async (req, res) => {
  const { sessionId } = req.params;
  console.log(req.body);

  try {
    const pool = await sql.connect(config);

    // Check if the session is active
    const activeSessionCheck = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .query('SELECT * FROM sessions WHERE id = @sessionId AND active = 1');

    if (activeSessionCheck.recordset.length === 0) {
      return res.status(404).json({ error: 'No active session found with this ID.' });
    }

    // Get the list of students for the active session
    const studentsResult = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .query(`
        SELECT 
          u.id AS student_id,
          u.full_name,
          u.year_level,
          u.section,
          u.courses,
          a.status AS attendance_status
        FROM attendance_status a
        JOIN users u ON a.student_id = u.id
        WHERE a.session_id = @sessionId
      `);

    if (studentsResult.recordset.length > 0) {
      res.status(200).json({
        success: true,
        data: studentsResult.recordset,
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No students found for this session.',
      });
    }
  } catch (error) {
    console.error('Error fetching students for the active session:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.',
    });
  }
};

const getAttendanceBySessionId = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const pool = await sql.connect(config);

    // Query to get attendance details for the given session ID
    const result = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .query(`
        SELECT 
          u.id AS student_id,
          u.full_name,
          u.year_level,
          u.section,
          u.courses,
          a.status AS attendance_status,
          a.date,
          a.timestamp
        FROM attendance_status a
        JOIN users u ON a.student_id = u.id
        WHERE a.session_id = @sessionId
      `);

    if (result.recordset.length > 0) {
      res.status(200).json({
        success: true,
        data: result.recordset,
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No attendance records found for the specified session ID.',
      });
    }
  } catch (error) {
    console.error('Error fetching attendance by session ID:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.',
    });
  }
};

const getSessionNames = async (req, res) => {
  try {
    const pool = await sql.connect(config);

    // Query to fetch all session names
    const result = await pool.request().query(`
      SELECT id AS sessionId, name AS sessionName, date, active 
      FROM sessions
      ORDER BY date DESC
    `);

    if (result.recordset.length > 0) {
      res.status(200).json({
        success: true,
        data: result.recordset,
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No sessions found.',
      });
    }
  } catch (error) {
    console.error('Error fetching session names:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error. Please try again later.',
    });
  }
};

module.exports = {
    createSession,
    checkAttendance,
    getAttendanceByCriteria,
    getActiveSessionStudents,
    getAttendanceBySessionId,
    getSessionNames,
    addStudentToSession,
    removeStudentFromSession
};