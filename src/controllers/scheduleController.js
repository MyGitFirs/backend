// controllers/schedule.controller.js
const sql = require('mssql');
const config = require('../database/database'); // Database configuration file

// Get all schedules
const getAllSchedules = async (req, res) => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT * FROM Schedules');
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};
const getScheduleByLinkedStudentDetails = async (req, res) => {
  const { parentId } = req.params;

  try {
    const pool = await sql.connect(config);

    // Retrieve linked student details
    const studentDetails = await pool.request()
      .input('ParentID', sql.Int, parentId)
      .query(`
        SELECT 
          u2.year_level,
          u2.section,
          u2.courses
        FROM users u1
        INNER JOIN users u2 ON u1.linked_student_id = u2.id
        WHERE u1.id = @ParentID AND u1.user_role = 'parent'
      `);

    if (studentDetails.recordset.length === 0) {
      return res.status(404).json({ message: 'No linked student found for this parent' });
    }

    const { year_level, section, courses } = studentDetails.recordset[0];

    // Retrieve schedule based on linked student's details
    const result = await pool.request()
      .input('YearLevel', sql.NVarChar, year_level)
      .input('Section', sql.NVarChar, section)
      .input('Courses', sql.NVarChar, courses)
      .query(`
        SELECT 
          Schedules.ScheduleID,
          Schedules.SubjectCode,
          Schedules.SubjectName,
          Schedules.InstructorID,
          users.full_name AS InstructorName,
          Schedules.YearLevel,
          Schedules.Section,
          Schedules.DayOfWeek,
          Schedules.StartTime,
          Schedules.EndTime,
          Schedules.Room,
          Schedules.Courses
        FROM Schedules
        LEFT JOIN users ON Schedules.InstructorID = users.id
        WHERE Schedules.YearLevel = @YearLevel
          AND Schedules.Section = @Section
          AND Schedules.Courses = @Courses
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'No schedules found for the linked student' });
    }

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};


const getScheduleById = async (req, res) => {
  const { instructorId } = req.params;
  console.log(req.body);
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('InstructorID', sql.Int, instructorId)
      .query(`
        SELECT 
          Schedules.ScheduleID,
          Schedules.SubjectCode,
          Schedules.SubjectName,
          Schedules.InstructorID,
          users.full_name AS InstructorName,
          Schedules.YearLevel,
          Schedules.Section,
          Schedules.DayOfWeek,
          Schedules.StartTime,
          Schedules.EndTime,
          Schedules.Room,
          Schedules.Courses
        FROM Schedules
        LEFT JOIN users ON Schedules.InstructorID = users.id
        WHERE Schedules.InstructorID = @InstructorID
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'No schedules found for this instructor' });
    }
    
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};

const getScheduleBySectionAndYearLevel = async (req, res) => {
  const { section, year_level, course } = req.query; // Added 'course' to query parameters

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('Section', sql.NVarChar, section)
      .input('YearLevel', sql.NVarChar, year_level)
      .input('Course', sql.NVarChar, course) // Added input for course
      .query(
        `SELECT 
           Schedules.ScheduleID,
           Schedules.SubjectCode,
           Schedules.SubjectName,
           Schedules.InstructorID,
           users.full_name AS InstructorName, -- Joined full_name from Users table
           Schedules.YearLevel,
           Schedules.Section,
           Schedules.DayOfWeek,
           Schedules.StartTime,
           Schedules.EndTime,
           Schedules.Room,
           Schedules.Courses
         FROM Schedules
         LEFT JOIN users ON Schedules.InstructorID = users.id
         WHERE Schedules.Section = @Section 
           AND Schedules.YearLevel = @YearLevel 
           AND Schedules.Courses = @Course`
      );

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'No schedules found for this section, year level, and course' });
    }

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};

// Create a new schedule
const createSchedule = async (req, res) => {
  const { 
    SubjectCode, 
    SubjectName, 
    InstructorID, 
    YearLevel, 
    Courses, 
    Section, 
    DayOfWeek, 
    StartTime, 
    EndTime, 
    Room 
  } = req.body;

  try {
    const pool = await sql.connect(config);

    // Check if SubjectCode already exists
    const { recordset: subjectCheck } = await pool.request()
      .input('SubjectCode', sql.NVarChar, SubjectCode)
      .query(`
        SELECT COUNT(*) AS Count 
        FROM Schedules 
        WHERE SubjectCode = @SubjectCode
      `);

    if (subjectCheck[0].Count > 0) {
      return res.status(400).json({ 
        message: 'Subject code already exists. Please use a unique subject code.' 
      });
    }

    // Check for schedule conflicts
    const { recordset: conflictCheck } = await pool.request()
      .input('InstructorID', sql.Int, InstructorID)
      .input('DayOfWeek', sql.NVarChar, DayOfWeek)
      .input('StartTime', sql.Time, StartTime)
      .input('EndTime', sql.Time, EndTime)
      .query(`
        SELECT COUNT(*) AS ConflictCount
        FROM Schedules
        WHERE InstructorID = @InstructorID
          AND DayOfWeek = @DayOfWeek
          AND NOT (
            EndTime <= @StartTime OR StartTime >= @EndTime
          )
      `);

    if (conflictCheck[0].ConflictCount > 0) {
      return res.status(400).json({ 
        message: 'Schedule conflict detected. The instructor already has a schedule during this time.' 
      });
    }

    // Insert the new schedule
    const { recordset: insertResult } = await pool.request()
      .input('SubjectCode', sql.NVarChar, SubjectCode)
      .input('SubjectName', sql.NVarChar, SubjectName)
      .input('InstructorID', sql.Int, InstructorID)
      .input('YearLevel', sql.NVarChar, YearLevel)
      .input('Courses', sql.NVarChar, Courses)
      .input('Section', sql.NVarChar, Section)
      .input('DayOfWeek', sql.NVarChar, DayOfWeek)
      .input('StartTime', sql.Time, StartTime)
      .input('EndTime', sql.Time, EndTime)
      .input('Room', sql.NVarChar, Room)
      .query(`
        INSERT INTO Schedules (
          SubjectCode, SubjectName, InstructorID, YearLevel, 
          Courses, Section, DayOfWeek, StartTime, EndTime, Room
        ) 
        OUTPUT INSERTED.ScheduleID 
        VALUES (
          @SubjectCode, @SubjectName, @InstructorID, @YearLevel, 
          @Courses, @Section, @DayOfWeek, @StartTime, @EndTime, @Room
        )
      `);

    res.status(201).json({ 
      ScheduleID: insertResult[0].ScheduleID, 
      message: 'Schedule created successfully.' 
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ message: 'An error occurred while creating the schedule.' });
  }
};



const updateSchedule = async (req, res) => {
  const { id } = req.params;
  const { SubjectCode, SubjectName, InstructorName, StartTime, EndTime, Room } = req.body;

  const convertTo24HourFormat = (time12h) => {
    const [time, modifier] = time12h.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (modifier.toUpperCase() === 'PM' && hours !== 12) hours += 12;
    if (modifier.toUpperCase() === 'AM' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`; // Ensure HH:MM:SS format
  };

  let startTime24, endTime24; // Define variables outside blocks

  try {
    const pool = await sql.connect(config);
    const request = pool.request();
    request.input('ScheduleID', sql.Int, id);

    let setClauses = [];
    if (SubjectCode) {
      setClauses.push('SubjectCode = @SubjectCode');
      request.input('SubjectCode', sql.NVarChar, SubjectCode);
    }
    if (SubjectName) {
      setClauses.push('SubjectName = @SubjectName');
      request.input('SubjectName', sql.NVarChar, SubjectName);
    }
    if (InstructorName) {
      setClauses.push('InstructorName = @InstructorName');
      request.input('InstructorName', sql.NVarChar, InstructorName);
    }
    if (StartTime) {
      startTime24 = convertTo24HourFormat(StartTime);
      console.log('Converted StartTime:', startTime24); // Logs HH:MM:SS
      setClauses.push('StartTime = @StartTime');
      request.input('StartTime', sql.Time, startTime24); // TIME expects HH:MM:SS
    }
    if (EndTime) {
      endTime24 = convertTo24HourFormat(EndTime);
      console.log('Converted EndTime:', endTime24); // Logs HH:MM:SS
      setClauses.push('EndTime = @EndTime');
      request.input('EndTime', sql.Time, endTime24); // TIME expects HH:MM:SS
    }
    if (Room) {
      setClauses.push('Room = @Room');
      request.input('Room', sql.NVarChar, Room);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const query = `UPDATE Schedules SET ${setClauses.join(', ')} WHERE ScheduleID = @ScheduleID`;
    console.log('Generated Query:', query);
    console.log('Parameters:', { StartTime: startTime24 || 'N/A', EndTime: endTime24 || 'N/A' });

    const result = await request.query(query);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    res.status(200).json({ message: 'Schedule updated successfully' });
  } catch (error) {
    console.error('Error updating schedule:', {
      params: req.params,
      body: req.body,
      errorMessage: error.message,
      stack: error.stack,
    });

    if (error.code === 'EPARAM') {
      return res.status(400).json({ message: `Invalid parameter: ${error.message}` });
    }
    res.status(500).json({ message: 'An error occurred while updating the schedule.' });
  }
};




// Delete a schedule
const deleteSchedule = async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('ScheduleID', sql.Int, id)
      .query('DELETE FROM Schedules WHERE ScheduleID = @ScheduleID');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    res.status(200).json({ message: 'Schedule deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};

module.exports = {
  getScheduleByLinkedStudentDetails,
  getAllSchedules,
  getScheduleById,
  getScheduleBySectionAndYearLevel,
  createSchedule,
  updateSchedule,
  deleteSchedule
};
