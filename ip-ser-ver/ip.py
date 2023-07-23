from flask import Flask, request

app = Flask(__name__)

@app.route('/get_ip', methods=['GET'])
def get_client_ip():
    client_ip = request.remote_addr
    return f"Your public IP address is: {client_ip}\n"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8084)

