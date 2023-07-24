<?php
// Define the maximum number of requests and the time period
define('MAX_REQUESTS', 5);
define('TIME_PERIOD', 3600);

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $target = $_POST['target'];

    // Validate the target as an IP address or domain
    if (filter_var($target, FILTER_VALIDATE_IP) || filter_var(gethostbyname($target), FILTER_VALIDATE_IP)) {
        // Get the client IP
        $clientIp = $_SERVER['REMOTE_ADDR'];

        // Get the file for the client's IP
        $filename = "rate_limit/{$clientIp}.txt";

        // Read the request data for the client
        $requestData = @file_get_contents($filename);
        $data = $requestData ? json_decode($requestData, true) : null;

        // If there's no data or the data is old, reset the request count
        if (!$data || $data['time'] < time() - TIME_PERIOD) {
            $data = ['count' => 0, 'time' => time()];
        }

        // If the request count is over the maximum, deny the request
        if ($data['count'] >= MAX_REQUESTS) {
            echo 'Rate limit exceeded!';
        } else {
            // Increment the request count and save the data
            $data['count']++;
            file_put_contents($filename, json_encode($data));

            // Sanitize the target
            $sanitized_target = escapeshellarg($target);

            // Run the traceroute command
            $output = shell_exec('traceroute ' . $sanitized_target);

            // Output the results
            echo '<pre>' . htmlspecialchars($output, ENT_QUOTES) . '</pre>';
        }
    } else {
        echo 'Invalid target!';
    }
} else {
    // The form to capture the target IP or domain
    echo '<form action="" method="post">
        Target: <input type="text" name="target"><br>
        <input type="submit">
    </form>';
}
?>
