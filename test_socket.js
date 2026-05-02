const { io } = require('socket.io-client');
const fetch = require('node-fetch');

(async () => {
    try {
        const resp = await fetch('http://localhost:4000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'namanunacademy2004@gmail.com', password: 'naman_2004' })
        });
        const data = await resp.json();
        const token = data.token;
        console.log('Got token:', token ? 'yes' : 'no');

        const socket = io('http://localhost:4000', { auth: { token } });
        socket.on('connect', () => {
            console.log('Socket connected');
            socket.emit('send-message', {
                conversationId: '69f4ec58cb4144506c6c315d',
                content: 'Hello from student script!'
            }, (res) => {
                console.log('Send callback:', res);
                process.exit(0);
            });
        });
        socket.on('connect_error', (err) => {
            console.log('Connect error:', err.message);
            process.exit(1);
        });
    } catch(e) {
        console.log('Script error', e);
        process.exit(1);
    }
})();
