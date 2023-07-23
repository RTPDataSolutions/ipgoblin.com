
<html>
<head>

<style>

body {
background-color: #00;
}

div.boxed {
  font-family: "Comic Sans MS", cursive, sans-serif;
  background-color: #5b8249;
  width: 600px;
  text-align: center;
}
.divTable.boxed .divTableCell, .divTable.boxed .divTableHead {
}
.divTable.boxed .divTableBody .divTableCell {
  font-size: 20px;
  font-weight: bold;
  color: #FFFFFF;
}
.boxed .tableFootStyle {
  font-size: 14px;
}
.boxed .tableFootStyle .links {
     text-align: right;
}
.boxed .tableFootStyle .links a{
  display: inline-block;
  background: #1C6EA4;
  color: #FFFFFF;
  padding: 2px 8px;
  border-radius: 5px;
}
.boxed.outerTableFooter {
  border-top: none;
}
.boxed.outerTableFooter .tableFootStyle {
  padding: 3px 5px; 
}
.divTable{ display: table; }
.divTableRow { display: table-row; }
.divTableHeading { display: table-header-group;}
.divTableCell, .divTableHead { display: table-cell;}
.divTableHeading { display: table-header-group;}
.divTableFoot { display: table-footer-group;}
.divTableBody { display: table-row-group;}

.p {
color: #00;
font-family: Verdana;
font-size: 20px;

}

.h1 {
color: #00;
font-family: Arial;
font-size: 40px;
}

.ipstyle {
color: #0099FF;
font-size: 50px;
border-radius: 5px;
font-family: "Comic Sans MS";
}

.btn {
  -webkit-border-radius: 5;
  -moz-border-radius: 5;
  border-radius: 5px;
  -webkit-box-shadow: 0px 1px 3px #666666;
  -moz-box-shadow: 0px 1px 3px #666666;
  box-shadow: 0px 1px 3px #666666;
  font-family: Arial;
  color: #25b800;
  font-size: 60px;
  background: #000000;
  padding: 10px 20px 10px 20px;
  border: dashed #ff0000 10px;
  text-decoration: none;
}

.btn:hover {
  background: #ffd500;
  text-decoration: none;
}

.terminal-style {
  background-color: #000000;
  color: #00FF00;
  font-family: 'Courier New', Courier, monospace;
}

</style>

</head>

<body>
<center>

<?php
$ip = $_SERVER['REMOTE_ADDR'];
$details = json_decode(file_get_contents("http://ipinfo.io/{$ip}/json"));
?>

<h1>IP GOBLIN ~</h1>
<h2>

<div class="btn">
<?php
echo $ip;
?>
</div>
</h2>
 
<div align="center">

<img src="https://ipgoblin.com/ColossalSophisticatedGreatdane-max-1mb.gif">
<img src="https://ipgoblin.com/CreepyAnotherFrillneckedlizard-max-1mb.gif">


<div class="divTableBody">

<div class="divTableRow">
Use the API to get your IP address
</div>
<div class="divTableRow">
<div class="terminal-style"> 
  curl -L api.ipgoblin.com 
</div>
</div> 
</div>

<div class="divTable boxed">
<div class="divTableBody">
<div class="divTableRow">

<?php 
echo nl2br("Hostname: $details->hostname \r\n");
echo nl2br("IP Address: $details->ip \r\n");
echo nl2br("City: $details->city \r\n");
echo nl2br("State or Province: $details->region \r\n");
echo nl2br("Country: $details->country \r\n");
echo nl2br("Coordinates: $details->loc \r\n");
echo nl2br("Your ISP: $details->org \r\n");
?>

</div></div>
</div>
</div>

</center>
&nbsp;
&nbsp;


</body>
</html>

