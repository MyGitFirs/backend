const sql = require('mssql');
const config = require('../database/database'); // Database configuration file

// Get all reminders
const getAllReminders = async (req, res) => {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT * FROM Reminders');
    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};

// Get reminders by user ID
const getRemindersByUserId = async (req, res) => {
  const { userId } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('UserID', sql.Int, userId)
      .query('SELECT * FROM Reminders WHERE UserID = @UserID');

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'No reminders found for this user' });
    }

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};

// Create a new reminder
const createReminder = async (req, res) => {
  console.log(req.body);
  const { Title, Description, UserID, ReminderDate, IsCompleted } = req.body;

  try {
    const pool = await sql.connect(config);

    const result = await pool.request()
      .input('Title', sql.NVarChar, Title)
      .input('Description', sql.NVarChar, Description)
      .input('UserID', sql.Int, UserID)
      .input('ReminderDate', sql.DateTime, ReminderDate)
      .input('IsCompleted', sql.Bit, IsCompleted || false)
      .query(`
        INSERT INTO Reminders (Title, Description, UserID, ReminderDate, IsCompleted)
        OUTPUT INSERTED.ReminderID
        VALUES (@Title, @Description, @UserID, @ReminderDate, @IsCompleted)
      `);

    res.status(201).json({ ReminderID: result.recordset[0].ReminderID, message: 'Reminder created successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};

// Update an existing reminder
const updateReminder = async (req, res) => {
  const { id } = req.params;
  const { Title, Description, ReminderDate, IsCompleted } = req.body;

  try {
    const pool = await sql.connect(config);
    const request = pool.request();
    request.input('ReminderID', sql.Int, id);

    let setClauses = [];
    if (Title) {
      setClauses.push('Title = @Title');
      request.input('Title', sql.NVarChar, Title);
    }
    if (Description) {
      setClauses.push('Description = @Description');
      request.input('Description', sql.NVarChar, Description);
    }
    if (ReminderDate) {
      setClauses.push('ReminderDate = @ReminderDate');
      request.input('ReminderDate', sql.DateTime, ReminderDate);
    }
    if (typeof IsCompleted !== 'undefined') {
      setClauses.push('IsCompleted = @IsCompleted');
      request.input('IsCompleted', sql.Bit, IsCompleted);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ message: 'No valid fields provided for update' });
    }

    const query = `UPDATE Reminders SET ${setClauses.join(', ')} WHERE ReminderID = @ReminderID`;
    const result = await request.query(query);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Reminder not found' });
    }

    res.status(200).json({ message: 'Reminder updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};

// Delete a reminder
const deleteReminder = async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input('ReminderID', sql.Int, id)
      .query('DELETE FROM Reminders WHERE ReminderID = @ReminderID');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Reminder not found' });
    }

    res.status(200).json({ message: 'Reminder deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Database error' });
  }
};

module.exports = {
  getAllReminders,
  getRemindersByUserId,
  createReminder,
  updateReminder,
  deleteReminder,
};
