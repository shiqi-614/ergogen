const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const ergogen = require('./ergogen')


const app = express();

// binary results (case STLs) cannot go into JSON as they are: send them as base64 strings
const sendResults = (res, results) => res.status(201).type('json').send(JSON.stringify(
    { message: 'Data received', results },
    (key, value) => value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value
))
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// curl -X POST http://localhost:3000/api/ergogen -H "Content-Type: application/json" -d @raw.json
// Example API endpoint
// Helper function for error handling
const handleError = (error, res) => {
    if (error.code === 'ERR_INVALID_ARG_VALUE') {
        res.status(400).json({
            success: false,
            error: {
                message: error.message,
                argumentName: error.argumentName,
                argumentValue: error.argumentValue,
            },
        });
    } else {
        console.error(error);
        res.status(500).json({
            success: false,
            error: {
                message: 'Internal server error',
            },
        });
    }
};

// API endpoint for ergogen.process
app.post('/api/ergogen', async (req, res) => {
    try {
        const data = req.body;
        const results = await ergogen.process(data, true, s => console.log(s));
        sendResults(res, results);
    } catch (error) {
        handleError(error, res);
    }
});

// API endpoint for ergogen.processBasic 
app.post('/api/ergogen/basic', async (req, res) => {
    try {
        const data = req.body;
        const results = await ergogen.processBasic(data, true, s => console.log(s));
        res.status(201).json({ message: 'Data received', results });
    } catch (error) {
        handleError(error, res);
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
