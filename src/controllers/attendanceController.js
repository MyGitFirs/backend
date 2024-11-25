const sql = require('mssql');
const config = require('../database/database');
const QRCode = require('qrcode');

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

    // Generate QR code as data URL with increased size
    QRCode.toDataURL(JSON.stringify(qrData), { width: 400, height: 400 }, (err, url) => {
      if (err) return res.status(500).send('Failed to generate QR code');
      res.json({ sessionId, qrCode: url });
    });

    // Insert initial attendance records for all students in the specified courses, section, and year level
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

    // Set the session to inactive after 10 minutes
    setTimeout(async () => {
      try {
        await pool.request()
          .input('sessionId', sql.Int, sessionId)
          .query('UPDATE sessions SET active = 0 WHERE id = @sessionId');
        console.log(`Session ${sessionId} set to inactive after 10 minutes.`);
      } catch (error) {
        console.error(`Error setting session ${sessionId} to inactive:`, error);
      }
    }, 10 * 60 * 1000); // 10 minutes in milliseconds

  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating session');
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

const checkAttendance = async (req, res) => {
  const { qrData, studentId, studentLat, studentLon } = req.body;

  // Parse session_id from `qrData`
  let sessionId;
  try {
    if (qrData.startsWith('{')) {
      const parsedQrData = JSON.parse(qrData);
      sessionId = parseInt(parsedQrData.session_id, 10);
    } else {
      sessionId = parseInt(qrData, 10); // Treat qrData as plain session ID
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid QR code format' });
  }

  const maxDistanceKm = 0.1;
  const teacherLat = 15.145370; // Example teacher latitude
  const teacherLon = 120.596070; // Example teacher longitude

  try {
    const pool = await sql.connect(config);

    // Retrieve session details
    const sessionResult = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .query('SELECT * FROM sessions WHERE id = @sessionId AND active = 1');

    if (sessionResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Session does not exist or is inactive' });
    }

    const session = sessionResult.recordset[0];
    const sessionCreatedAt = new Date(session.created_at);
    const expiresAt = session.expires_at 
      ? new Date(session.expires_at) 
      : new Date(sessionCreatedAt.getTime() + 10 * 60 * 1000);

    // Calculate distance between student and teacher
    const distance = haversineDistance(studentLat, studentLon, teacherLat, teacherLon);
    if (distance > maxDistanceKm) {
      return res.status(400).json({ error: 'Student is not within the allowed proximity' });
    }

    // Mark attendance as present
    const attendanceResult = await pool.request()
      .input('sessionId', sql.Int, sessionId)
      .input('studentId', sql.Int, studentId)
      .query('SELECT * FROM attendance_status WHERE session_id = @sessionId AND student_id = @studentId');

    if (attendanceResult.recordset.length > 0) {
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
      return res.json({ message: 'Attendance confirmed' });
    } else {
      return res.status(404).json({ error: 'Attendance record not found' });
    }
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
};





const getAttendanceByCriteria = async (req, res) => {
  const { courses, year_level, section, date } = req.body;
  console.log(req.body);

  try {
    const pool = await sql.connect(config);

    // Query to get attendance details based on the specified criteria
    const result = await pool.request()
      .input('courses', sql.NVarChar, courses)
      .input('year_level', sql.NVarChar, year_level)
      .input('section', sql.NVarChar, section)
      .input('date', sql.Date, date)
      .query(`
        SELECT 
          u.id AS user_id,
          u.full_name,
          u.year_level,
          u.section,
          u.courses,
          a.date,
          a.status,
          a.timestamp
        FROM attendance_status a
        JOIN users u ON a.student_id = u.id
        WHERE u.courses = @courses
          AND u.year_level = @year_level
          AND u.section = @section
          AND a.date = @date
      `);

    if (result.recordset.length > 0) {
      res.status(200).json({
        success: true,
        data: result.recordset,
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'No attendance records found for the specified criteria.',
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


module.exports = {
    createSession,
    checkAttendance,
    getAttendanceByCriteria,
    getActiveSessionStudents,
    getAttendanceBySessionId
};