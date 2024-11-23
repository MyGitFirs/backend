const sql = require('mssql'); // Use 'sql' instead of 'mysql' for clarity

const config = {
    user: 'admin',
    password: 'qwerty',
    server: 'localhost',
    database: 'capstone',
    port: 1433,
    options: {
        encrypt: false, // Set to true if using Azure, otherwise false for local SQL Server
        enableArithAbort: true,
        trustServerCertificate: true 
    }
};

// Connect to the database
async function connectDB() {
    try {
        await sql.connect(config);
        console.log('Connected to database');
    } catch (err) {
        console.log('Database connection failed:', err);
    }
}

module.exports = {
    sql, // Export the sql object
    connectDB
};
