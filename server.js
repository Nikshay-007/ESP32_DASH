// server.js
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

// Sensor data storage
let sensorData = { moisture: 0, lastUpdate: null };

// ============= ROUTES =============

// Update sensor data (called by ESP32)
app.get('/update', (req, res) => {
    if (req.query.moisture) {
        sensorData.moisture = req.query.moisture;
        sensorData.lastUpdate = new Date().toISOString();
        console.log('📊 Moisture:', req.query.moisture + '%');
    }
    res.send('OK');
});

// Get sensor data (called by frontend)
app.get('/data', (req, res) => {
    res.json(sensorData);
});

// Capture image from ESP32-CAM
app.get('/capture', async (req, res) => {
    console.log('📸 Capture requested');

    try {
        const capturesDir = path.join(__dirname, 'captures');
        if (!fs.existsSync(capturesDir)) {
            fs.mkdirSync(capturesDir);
            console.log('📁 Created captures folder');
        }

        const camURL = 'http://192.168.0.118/capture';

        const response = await axios({
            method: 'GET',
            url: camURL,
            responseType: 'stream',
            timeout: 8000
        });

        const fileName = `image_${Date.now()}.jpg`;
        const filePath = path.join(capturesDir, fileName);

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        writer.on('finish', () => {
            console.log('✅ Image saved:', fileName);
            res.json({
                success: true,
                message: 'Image captured successfully!',
                filename: fileName
            });
        });

        writer.on('error', (err) => {
            console.error('❌ Save error:', err);
            res.status(500).json({
                success: false,
                message: 'Failed to save image: ' + err.message
            });
        });

    } catch (error) {
        console.error('❌ Camera error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Camera not reachable. Check connection.'
        });
    }
});

// Test camera connection
app.get('/test-camera', async (req, res) => {
    console.log('🔍 Testing camera connection...');

    try {
        const camURL = 'http://192.168.0.118/capture';

        const response = await axios({
            method: 'GET',
            url: camURL,
            timeout: 5000,
            validateStatus: false
        });

        if (response.status === 200) {
            res.json({
                success: true,
                message: 'Camera is reachable',
                status: response.status
            });
        } else {
            res.json({
                success: false,
                message: `Camera returned status ${response.status}`
            });
        }
    } catch (error) {
        res.json({
            success: false,
            message: 'Camera not reachable: ' + error.message
        });
    }
});

// Get list of captured images
app.get('/images', (req, res) => {
    const capturesDir = path.join(__dirname, 'captures');
    
    if (!fs.existsSync(capturesDir)) {
        return res.json([]);
    }
    
    fs.readdir(capturesDir, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read directory' });
        }
        
        const images = files
            .filter(file => file.match(/\.(jpg|jpeg|png)$/i))
            .map(file => ({
                filename: file,
                path: `/captures/${file}`,
                timestamp: fs.statSync(path.join(capturesDir, file)).mtime
            }))
            .sort((a, b) => b.timestamp - a.timestamp);
        
        res.json(images);
    });
});

// Serve captured images
app.use('/captures', express.static(path.join(__dirname, 'captures')));

// Simple test route
app.get('/test', (req, res) => {
    res.send('✅ Server is running!');
});

// Serve static files from 'public' folder
app.use(express.static('public'));

// Handle 404
app.use((req, res) => {
    res.status(404).send('404 - Not Found');    
});

// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log('\n🚀 ESP32 Dashboard Server');
    console.log('📡 Running on: http://localhost:' + PORT);
    console.log('📝 Routes:');
    console.log('   • Dashboard:   http://localhost:' + PORT);
    console.log('   • Capture:     http://localhost:' + PORT + '/capture');
    console.log('   • Test camera: http://localhost:' + PORT + '/test-camera');
    console.log('   • Sensor data: http://localhost:' + PORT + '/data');
    console.log('   • Images list: http://localhost:' + PORT + '/images');
    console.log('   • Captures:    http://localhost:' + PORT + '/captures/[filename]');
    console.log('\n📁 Captures folder: ' + path.join(__dirname, 'captures'));
    console.log('===============================================\n');
}); 