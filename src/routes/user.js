const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sql } = require('../database/database'); // Custom SQL module import
const router = express.Router();

const JWT_SECRET  = 'secret key'; // Store secrets securely

// Login route
router.post('/login', async (req, res) => {
    const { email, password, role: selectedRole } = req.body;
    
    // Validate request body
    if (!email || !password || !selectedRole) {
        return res.status(400).json({
            success: false,
            error: 'Email, password, and role are required.',
        });
    }

    try {
        // Connect to the SQL database
        const result = await sql.query`SELECT * FROM users WHERE email = ${email}`;
        const user = result.recordset[0];

        // Check if the user exists
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials.',
            });
        }

        // Verify the password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials.',
            });
        }

        console.log('User role from DB:', user.user_role);
        console.log('Selected role from request:', selectedRole);
    
        // Generate JWT token with full user information
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.user_role, 
                full_name: user.full_name, 
                student_id: user.student_id,
                linked_student_id: user.linked_student_id,
                year_level: user.year_level,
                section: user.section,
                courses: user.courses,
                contact_number: user.contact_number,
                gender: user.gender
            },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        const message =
            user.user_role === 'admin'
                ? 'Login successful. You are logged in as an admin.'
                : 'Login successful. Role verified.';

        // Respond with user data and token
        return res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                role: user.user_role,
                name: user.full_name, 
                student_id: user.student_id,
                linked_student_id: user.linked_student_id,
                year_level: user.year_level,
                section: user.section,
                courses: user.courses,
                contact_number: user.contact_number,
                gender: user.gender
            },
            token,
            message,
        });        
    } catch (error) {
        console.error('Error during login:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error. Please try again later.',
        });
    }
});


router.post('/logout', async (req, res) => {
    const { userId } = req.body;

    console.log(userId);
    if (!userId) {
        return res.status(400).json({
            success: false,
            error: 'User ID is required to log out.',
        });
    }

    try {
        // Update the logged_in status to false
        await sql.query`UPDATE users SET logged_in = 0 WHERE id = ${userId}`;
        
        return res.json({
            success: true,
            message: 'Logout successful.',
        });
    } catch (error) {
        console.error('Error during logout:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error. Please try again later.',
        });
    }
});
router.post('/signup', async (req, res) => {
    console.log(req.body);
    const { full_name, email, password, role, student_id, linked_student_id, year_level, section, courses, contact_number, gender } = req.body;

    // Validate request body
    if (!full_name || !email || !password || !role) {
        return res.status(400).json({
            success: false,
            error: 'Full name, email, password, and role are required.',
        });
    }

    try {
        // Check if the email is already registered
        const emailCheckResult = await sql.query`SELECT * FROM users WHERE email = ${email}`;
        if (emailCheckResult.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Email is already registered. Please log in.',
            });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create a new SQL request
        const request = new sql.Request();

        // Insert user into the Users table with additional fields
        request.input('full_name', sql.VarChar, full_name);
        request.input('email', sql.VarChar, email);
        request.input('password', sql.VarChar, hashedPassword);
        request.input('user_role', sql.VarChar, role);
        request.input('student_id', sql.Int, student_id || null);
        request.input('linked_student_id', sql.Int, linked_student_id || null);
        request.input('year_level', sql.VarChar, year_level || null);
        request.input('courses', sql.VarChar, courses || null);
        request.input('section', sql.VarChar, section || null);
        request.input('contact_number', sql.VarChar, contact_number || null);
        request.input('gender', sql.VarChar, gender || null);

        const query = `
            INSERT INTO users (full_name, email, password, user_role, student_id, linked_student_id, year_level, courses, section, contact_number, gender, created_at)
            VALUES (@full_name, @email, @password, @user_role, @student_id, @linked_student_id, @year_level, @courses, @section, @contact_number, @gender, GETDATE())
        `;

        // Execute the query
        const result = await request.query(query);

        if (result.rowsAffected[0] > 0) {
            // Respond with success
            return res.status(201).json({
                success: true,
                message: 'User registered successfully!',
            });
        } else {
            return res.status(500).json({
                success: false,
                error: 'Failed to register user. Please try again.',
            });
        }

    } catch (error) {
        console.error('Error during signup:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error. Please try again later.',
        });
    }
});


router.get('/get_users', async (req, res) => {
    try {
        const result = await sql.query`SELECT id, full_name, email, created_at, user_role FROM Users ;`;
        return res.json({
            success: true,
            users: result.recordset,
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while fetching users.',
        });
    }
});
router.post('/admin', async (req, res) => {
    const { name, email, password, user_role } = req.body;

    try {
        // Check if the user already exists
        const result = await sql.query`SELECT * FROM users WHERE email = ${email}`;
        if (result.recordset.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash the password
        const password_hash = await bcrypt.hash(password, 10);

        // Insert the new user into the database and retrieve the inserted user ID and fields
        const newUserResult = await sql.query`
            INSERT INTO users (full_name, email, password, user_role, created_at, updated_at) 
            OUTPUT inserted.id, inserted.full_name, inserted.email, inserted.user_role
            VALUES (${name}, ${email}, ${password_hash}, ${user_role}, GETDATE(), GETDATE())`;

        // Retrieve the inserted user details
        const newUser = newUserResult.recordset[0];

        // Generate token and send response
        const token = jwt.sign(
            { id: newUser.id, email: newUser.email, role: newUser.user_role }, 
            JWT_SECRET, 
            { expiresIn: '1h' }
        );

        res.status(201).json({ 
            user: newUser, 
            token, 
            message: 'User created successfully' 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
router.get('/get_user/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await sql.query`SELECT * FROM users WHERE id = ${id}`;
        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found.',
            });
        }
        return res.json({
            success: true,
            user: result.recordset[0],
        });
    } catch (error) {
        console.error('Error fetching user details by ID:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while fetching user details.',
        });
    }
});
    router.put('/update_user/:id', async (req, res) => {
        const userId = req.params.id;
        const { full_name, email, password, role, student_id, year_level, section, courses, contact_number, gender } = req.body;

        try {
            // Check if the email is already registered by another user
            const emailCheckResult = await sql.query`
                SELECT * FROM Users WHERE email = ${email} AND id <> ${userId}
            `;
            if (emailCheckResult.recordset.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is already registered by another user.',
                });
            }

            // Hash the password if it is provided
            let hashedPassword;
            if (password) {
                hashedPassword = await bcrypt.hash(password, 10);
            }

            // Dynamically build the update query and parameters
            let updateFields = [];
            let parameters = {};

            if (full_name) {
                updateFields.push('full_name = @full_name');
                parameters.full_name = full_name;
            }
            if (email) {
                updateFields.push('email = @email');
                parameters.email = email;
            }
            if (role) {
                updateFields.push('user_role = @user_role');
                parameters.user_role = role;
            }
            if (student_id) {
                updateFields.push('student_id = @student_id');
                parameters.student_id = student_id;
            }
            if (year_level) {
                updateFields.push('year_level = @year_level');
                parameters.year_level = year_level;
            }
            if (section) {
                updateFields.push('section = @section');
                parameters.section = section;
            }
            if (courses) {
                updateFields.push('courses = @courses');
                parameters.courses = courses;
            }
            if (contact_number) {
                updateFields.push('contact_number = @contact_number');
                parameters.contact_number = contact_number;
            }
            if (gender) {
                updateFields.push('gender = @gender');
                parameters.gender = gender;
            }
            if (hashedPassword) {
                updateFields.push('password = @password');
                parameters.password = hashedPassword;
            }

            // Construct the dynamic SQL query
            const query = `
                UPDATE Users
                SET ${updateFields.join(', ')}
                WHERE id = @id
            `;

            const request = new sql.Request();
            Object.keys(parameters).forEach(param => {
                request.input(param, sql.VarChar, parameters[param]);
            });
            request.input('id', sql.Int, userId);

            // Execute the query
            const result = await request.query(query);

            if (result.rowsAffected[0] > 0) {
                return res.status(200).json({
                    success: true,
                    message: 'User updated successfully!',
                });
            } else {
                return res.status(404).json({
                    success: false,
                    error: 'User not found or no changes were made.',
                });
            }
        } catch (error) {
            console.error('Error updating user:', error);
            return res.status(500).json({
                success: false,
                error: 'Internal server error. Please try again later.',
            });
        }
    });
router.delete('/delete_user/:id', async (req, res) => {
    const userId = req.params.id;

    try {
        // Check if the user exists before attempting to delete
        const checkUserResult = await sql.query`SELECT * FROM Users WHERE id = ${userId}`;
        if (checkUserResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        // If user exists, proceed to delete
        const request = new sql.Request();
        request.input('id', sql.Int, userId);

        const result = await request.query`DELETE FROM Users WHERE id = @id`;

        if (result.rowsAffected[0] > 0) {
            return res.status(200).json({
                success: true,
                message: 'User deleted successfully',
            });
        } else {
            return res.status(500).json({
                success: false,
                message: 'Failed to delete user. Please try again.',
            });
        }
    } catch (error) {
        console.error('Error deleting user:', error);

        // Check if the error is related to the SAME TABLE REFERENCE constraint
        if (error.message.includes("SAME TABLE REFERENCE constraint") && error.message.includes("fk_linked_student_id")) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete this student as they are associated with a parent.',
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Internal server error. Please try again later.',
        });
    }
});

module.exports = router;
