const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const ergogen = require('./ergogen')


const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.send('Welcome to My Node Service!');
});

// curl -X POST http://localhost:3000/api/ergogen -H "Content-Type: application/json" -d @raw.json
// Example API endpoint
app.post('/api/ergogen', async (req, res) => {
    const data = req.body;
    // Process the data as needed
    results = await ergogen.process(data, true, s => console.log(s))
    res.status(201).json({ message: 'Data received', results });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
