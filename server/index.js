var process = require('process')

// Handle SIGINT
process.on('SIGINT', () => {
  console.info("SIGINT Received, exiting...")
  process.exit(0)
})

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.info("SIGTERM Received, exiting...")
  process.exit(0)
})

const parser = require('ua-parser-js');
const { uniqueNamesGenerator, animals, colors } = require('unique-names-generator');

// Allowed origins for WebSocket upgrade handshake
const ALLOWED_ORIGINS = [
  'https://velvetdrop.vercel.app',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:52495'
];

class SnapdropServer {

    constructor(port) {
        const WebSocket = require('ws');

        this._wss = new WebSocket.Server({
            port: port,
            // Verify origin on WebSocket upgrade — blocks unauthorized domains
            verifyClient: (info, callback) => {
                const origin = info.origin || info.req.headers.origin;

                // Allow if no origin (e.g. direct WS clients / health checks)
                // or if origin is in the allowed list
                if (!origin || ALLOWED_ORIGINS.indexOf(origin) > -1) {
                    callback(true);
                } else {
                    console.warn('Rejected connection from origin:', origin);
                    callback(false, 403, 'Forbidden');
                }
            }
        });

        this._wss.on('connection', (socket, request) => this._onConnection(new Peer(socket, request)));
        this._wss.on('headers', (headers, response) => this._onHeaders(headers, response));

        this._rooms = {};

        console.log('Snapdrop is running on port', port);
    }

    _onConnection(peer) {
        this._joinRoom(peer);
        peer.socket.on('message', message => this._onMessage(peer, message));
        peer.socket.on('error', console.error);
        this._keepAlive(peer);

        // send displayName
        this._send(peer, {
            type: 'display-name',
            message: {
                displayName: peer.name.displayName,
                deviceName: peer.name.deviceName
            }
        });
    }

    _onHeaders(headers, response) {
        if (response.headers.cookie && response.headers.cookie.indexOf('peerid=') > -1) return;
        response.peerId = Peer.uuid();
        headers.push('Set-Cookie: peerid=' + response.peerId + "; SameSite=None; Secure");
    }

    _onMessage(sender, message) {
        try {
            message = JSON.parse(message);
        } catch (e) {
            return;
        }

        switch (message.type) {
            case 'disconnect':
                this._leaveRoom(sender);
                break;
            case 'pong':
                sender.lastBeat = Date.now();
                break;
        }

        // relay message to recipient
        if (message.to && this._rooms[sender.roomKey]) {
            const recipientId = message.to;
            const recipient = this._rooms[sender.roomKey][recipientId];
            delete message.to;
            message.sender = sender.id;
            this._send(recipient, message);
            return;
        }
    }

    _joinRoom(peer) {
        if (!this._rooms[peer.roomKey]) {
            this._rooms[peer.roomKey] = {};
        }

        for (const otherPeerId in this._rooms[peer.roomKey]) {
            const otherPeer = this._rooms[peer.roomKey][otherPeerId];
            this._send(otherPeer, {
                type: 'peer-joined',
                peer: peer.getInfo()
            });
        }

        const otherPeers = [];
        for (const otherPeerId in this._rooms[peer.roomKey]) {
            otherPeers.push(this._rooms[peer.roomKey][otherPeerId].getInfo());
        }

        this._send(peer, {
            type: 'peers',
            peers: otherPeers
        });

        this._rooms[peer.roomKey][peer.id] = peer;
        console.log(`Peer ${peer.id} joined room ${peer.roomKey}. Total peers in room: ${Object.keys(this._rooms[peer.roomKey]).length}`);
    }

    _leaveRoom(peer) {
        if (!this._rooms[peer.roomKey] || !this._rooms[peer.roomKey][peer.id]) return;
        this._cancelKeepAlive(this._rooms[peer.roomKey][peer.id]);

        delete this._rooms[peer.roomKey][peer.id];

        peer.socket.terminate();

        if (!Object.keys(this._rooms[peer.roomKey]).length) {
            delete this._rooms[peer.roomKey];
        } else {
            for (const otherPeerId in this._rooms[peer.roomKey]) {
                const otherPeer = this._rooms[peer.roomKey][otherPeerId];
                this._send(otherPeer, { type: 'peer-left', peerId: peer.id });
            }
        }
    }

    _send(peer, message) {
        if (!peer) return;
        if (this._wss.readyState !== this._wss.OPEN) return;
        message = JSON.stringify(message);
        peer.socket.send(message, error => '');
    }

    _keepAlive(peer) {
        this._cancelKeepAlive(peer);
        var timeout = 30000;
        if (!peer.lastBeat) {
            peer.lastBeat = Date.now();
        }
        if (Date.now() - peer.lastBeat > 2 * timeout) {
            this._leaveRoom(peer);
            return;
        }
        this._send(peer, { type: 'ping' });
        peer.timerId = setTimeout(() => this._keepAlive(peer), timeout);
    }

    _cancelKeepAlive(peer) {
        if (peer && peer.timerId) {
            clearTimeout(peer.timerId);
        }
    }
}


class Peer {

    constructor(socket, request) {
        this.socket = socket;
        this._setIP(request);
        this._setPeerId(request);
        this._setRoomKey(request);
        this.rtcSupported = request.url.indexOf('webrtc') > -1;
        this._setName(request);
        this.timerId = 0;
        this.lastBeat = Date.now();
    }

    _setRoomKey(request) {
        const url = new URL(request.url, 'http://localhost');
        const roomCode = url.searchParams.get('room');
        if (roomCode) {
            this.roomKey = 'room:' + roomCode.toUpperCase();
        } else {
            // Fallback to IP subnet (/24 for IPv4)
            if (this.ip.includes('.')) {
                this.roomKey = this.ip.split('.').slice(0, 3).join('.');
            } else {
                this.roomKey = this.ip; // keep as is for IPv6 or others
            }
        }
    }

    _setIP(request) {
        if (request.headers['x-forwarded-for']) {
            // Railway passes real client IP in x-forwarded-for
            // Take the FIRST entry — that's the real client IP
            this.ip = request.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        } else {
            this.ip = request.connection.remoteAddress;
        }
        // IPv4 and IPv6 localhost normalisation
        if (this.ip == '::1' || this.ip == '::ffff:127.0.0.1') {
            this.ip = '127.0.0.1';
        }
    }

    _setPeerId(request) {
        if (request.peerId) {
            this.id = request.peerId;
        } else {
            try {
                this.id = request.headers.cookie.replace('peerid=', '');
            } catch(e) {
                this.id = Peer.uuid();
            }
        }
    }

    toString() {
        return `<Peer id=${this.id} ip=${this.ip} rtcSupported=${this.rtcSupported}>`
    }

    _setName(req) {
        let ua = parser(req.headers['user-agent']);

        let deviceName = '';

        if (ua.os && ua.os.name) {
            deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
        }

        if (ua.device.model) {
            deviceName += ua.device.model;
        } else {
            deviceName += ua.browser.name;
        }

        if (!deviceName)
            deviceName = 'Unknown Device';

        const displayName = uniqueNamesGenerator({
            length: 2,
            separator: ' ',
            dictionaries: [colors, animals],
            style: 'capital',
            seed: this.id.hashCode()
        });

        this.name = {
            model: ua.device.model,
            os: ua.os.name,
            browser: ua.browser.name,
            type: ua.device.type,
            deviceName,
            displayName
        };
    }

    getInfo() {
        return {
            id: this.id,
            name: this.name,
            rtcSupported: this.rtcSupported
        }
    }

    static uuid() {
        let uuid = '', ii;
        for (ii = 0; ii < 32; ii += 1) {
            switch (ii) {
                case 8:
                case 20:
                    uuid += '-';
                    uuid += (Math.random() * 16 | 0).toString(16);
                    break;
                case 12:
                    uuid += '-';
                    uuid += '4';
                    break;
                case 16:
                    uuid += '-';
                    uuid += (Math.random() * 4 | 8).toString(16);
                    break;
                default:
                    uuid += (Math.random() * 16 | 0).toString(16);
            }
        }
        return uuid;
    }
}

Object.defineProperty(String.prototype, 'hashCode', {
  value: function() {
    var hash = 0, i, chr;
    for (i = 0; i < this.length; i++) {
      chr  = this.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash;
  }
});

const server = new SnapdropServer(process.env.PORT || 3000);