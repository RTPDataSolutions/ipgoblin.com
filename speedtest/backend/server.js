const express = require('express');
const cors = require('cors');
const speedTest = require('speedtest-net');

const app = express();
const port = 3000;

// Enable CORS
app.use(cors());

// Speed test endpoint
app.get('/speedtest', async (req, res) => {
    try {
        const options = {
            acceptLicense: true,
            acceptGdpr: true,
        };

        console.log('Starting speed test...');
        const result = await speedTest(options);

        console.log('Speed test result:', result);

        // Extract and convert results
        const ping = result.ping.latency; // Ping in ms
        const download = result.download.bandwidth / 125000; // Convert to Mbps
        const upload = result.upload.bandwidth / 125000; // Convert to Mbps

        // Send results as JSON
        res.json({ ping, download, upload });
    } catch (error) {
        console.error('Error running speed test:', error);
        res.status(500).json({ error: 'Speed test failed' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Speed test server running on http://localhost:${port}`);
});

