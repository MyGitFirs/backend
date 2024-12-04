const express = require('express');
const app = express();
const { connectDB } = require('./src/database/database');
const userRoutes = require('./src/routes/user'); 
const attenRoutes = require('./src/routes/attendanceRoute');
const scheduleRoutes = require('./src/routes/scheduleRoutes');
const reminderRoutes = require('./src/routes/reminderRoutes');

const cors = require('cors');

app.set('port', process.env.PORT || 4000);

// Middlewares
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  }));
connectDB();
// Routes
app.use('/api/auth', userRoutes);
app.use('/api/attendance', attenRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/reminders', reminderRoutes)
// Starting the server
app.listen(app.get('port'), () => {
    console.log('Server on port', app.get('port'));
});