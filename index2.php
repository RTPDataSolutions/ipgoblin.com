<!DOCTYPE html>
<html>
<head>
<!-- Add Clipboard.js -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/clipboard.js/2.0.8/clipboard.min.js"></script>
<!-- Add FontAwesome -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta2/css/all.min.css">

<style>
@keyframes flashing {
    0%   {background-color: pink;}
    50%  {background-color: lime;}
    100% {background-color: pink;}
}

#banner {
    position: fixed;
    top: 0;
    width: 100%;
    color: white;
    text-align: center;
    padding: 20px 0;
    font-size: 2em;
    animation: flashing 1s linear infinite;
    z-index: 9999;
}

#ip-address-container, #details-container {
    display: flex;
    align-items: center;
    gap: 10px;
}
#ip-address {
    font-size: 24px;
    font-family: 'Courier New', monospace;
    flex-grow: 1;
}
#details {
    font-size: 12px;
    font-family: 'Courier New', monospace;
    width: 300px;
    height: auto;
    overflow: auto;
}
.copy-btn {
    display: inline-block;
}
#command {
    font-family: 'Courier New', monospace;
    color: green;
    background-color: black;
    padding: 10px;
    display: inline-block;
}
#command-container {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
}
.center-text {
    text-align: center;
}
</style>
</head>

<body>
<div id="banner">
    Your IP is: <?php
    $ip = $_SERVER['REMOTE_ADDR'];
    echo $ip;
    ?>
</div>

<center style="padding-top: 70px;">
<?php
$details = json_decode(file_get_contents("http://ipinfo.io/{$ip}/json"));
?>

<h1>~ IP GOBLIN ~</h1>

        <table>
            <tr>
                <td>
                    <img src="https://ipgoblin.com/ColossalSophisticatedGreatdane-max-1mb.gif">
                </td>
                <td>

                   <h2>Your IP Address:</h2>

                    <div id="ip-address-container">
                        <input type="text" value="<?php echo $ip; ?>" id="ip-address" readonly>

                       <!-- Add button to copy content to clipboard -->

                       <button class="copy-btn" data-clipboard-target="#ip-address">
                         <i class="fas fa-clipboard"></i>
                       </button>
                    </div>

                    <hr>

                    <h2>More Details:</h2>

                    <div id="details-container">
                        <textarea id="details" readonly><?php 
                            echo "Hostname: $details->hostname \r\n";
                            echo "IP Address: $details->ip \r\n";
                            echo "City: $details->city \r\n";
                            echo "State or Province: $details->region \r\n";
                            echo "Country: $details->country \r\n";
                            echo "Coordinates: $details->loc \r\n";
                            echo "Your ISP: $details->org \r\n";
                        ?></textarea>
                        
                        <!-- Add button to copy content to clipboard -->

                        <button class="copy-btn" data-clipboard-target="#details">
                            <i class="fas fa-clipboard"></i>
                        </button>
                    </div>

                </td>
                <td>
                    <img src="https://ipgoblin.com/CreepyAnotherFrillneckedlizard-max-1mb.gif">
                </td>
            </tr>
        </table>

Use the API to get your IP address:

<div class="center-text">
    <div id="command-container">
        <span id="command">curl -L api.ipgoblin.com</span> 
        <button class="copy-btn" data-clipboard-target="#command">
          <i class="fas fa-clipboard"></i>
        </button>
    </div>
</div>

<hr>

</center>


<!-- Initialize Clipboard -->
<script>
var clipboard = new ClipboardJS('.copy-btn');
</script>

</body>
</html>
