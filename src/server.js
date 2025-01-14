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

// curl -X POST http://localhost:3000/api/ergogen -H "Content-Type: application/json" -d @raw.json
// Example API endpoint
app.post('/api/ergogen', async (req, res) => {
    try {
    const data = req.body;
    // Process the data as needed
        results = await ergogen.process(data, true, s => console.log(s))
        res.status(201).json({ message: 'Data received', results });
    } catch (error) {
        if (error.code === 'ERR_INVALID_ARG_VALUE') {
            // Handle the error and send a 400 HTTP response
            res.status(400).json({
                success: false,
                error: {
                    message: error.message,
                    argumentName: error.argumentName,
                    argumentValue: error.argumentValue,
                },
            });
        } else {
            // Handle other errors (e.g., server errors)
            console.error(error);
            res.status(500).json({
                success: false,
                error: {
                    message: 'Internal server error',
                },
            });
        }
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
