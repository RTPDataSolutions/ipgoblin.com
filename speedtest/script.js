document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('start-test');
    const speedDisplay = document.getElementById('speed-display');
    const pingElement = document.getElementById('ping');
    const downloadElement = document.getElementById('download');
    const uploadElement = document.getElementById('upload');
    const goblinImage = document.getElementById('goblin'); // Goblin animation element

    function startSpeedTest() {
        speedDisplay.textContent = 'Testing...';

        // Reset goblin animation
        if (goblinImage) {
            goblinImage.style.transition = ''; // Reset any previous transitions
            goblinImage.style.left = '0'; // Reset to starting position
            goblinImage.classList.add('running'); // Add running class to start animation
        }

        const startTime = performance.now(); // Record start time of the test

        // Fetch the speed test results from the backend
        fetch('/api/speedtest')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                const endTime = performance.now(); // Record end time of the test
                const duration = (endTime - startTime) / 1000; // Duration in seconds

                console.log('Data received:', data);
                console.log(`Speed test duration: ${duration}s`);

                // Adjust goblin animation to match the test duration
                if (goblinImage) {
                    goblinImage.style.transition = `left ${duration}s linear`;
                    goblinImage.style.left = 'calc(100% - 128px)';
                }

                // Extract and display results
                const { ping, download, upload } = data;

                const pingMs = ping.toFixed(2); // Ping in milliseconds
                const downloadMbps = download.toFixed(2); // Download in Mbps
                const uploadMbps = upload.toFixed(2); // Upload in Mbps

                pingElement.textContent = `${pingMs} ms`;
                downloadElement.textContent = `${downloadMbps} Mbps`;
                uploadElement.textContent = `${uploadMbps} Mbps`;
                speedDisplay.textContent = 'Speed Test Complete!';

                // Stop goblin animation after the test
                setTimeout(() => {
                    if (goblinImage) {
                        goblinImage.classList.remove('running');
                    }
                }, duration * 1000);
            })
            .catch(error => {
                console.error('Error during speed test:', error);
                speedDisplay.textContent = 'Error: Unable to run speed test.';

                // Stop goblin animation on error
                if (goblinImage) {
                    goblinImage.classList.remove('running'); // Remove running class
                    goblinImage.style.transition = ''; // Reset animation
                    goblinImage.style.left = '0'; // Reset to start
                }
            });
    }

    startButton.addEventListener('click', startSpeedTest);
});

