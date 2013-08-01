// WhiskChat Server! :D

var express = require('express');
var app = express();
var InputsIO = require('inputs.io');
var inputs = new InputsIO({
    APIKey: process.env.INPUTSAPIKEY,
    pin: process.env.INPUTSPIN
});
var iottp = require('http').createServer(app);
var io = require('socket.io').listen(iottp);
var hash = require('node_hash');
var crypto = require('crypto');
var redis = require('redis');
var sockets = [];
var online = 0;
var random = require("random");
var bbcode = require('bbcode');
var admins = ['whiskers75', 'admin'];
var mods = ['whiskers75', 'admin', 'peapodamus', 'TradeFortress', 'devinthedev'];
var lastSendOnline = new Date(); //throttle online requests
var versionString = "WhiskChat Server beta v0.4.1";
var alphanumeric = /^[a-z0-9]+$/i;
var muted = [];

iottp.listen(process.env.PORT);

io.configure(function () { 
    io.set("transports", ["xhr-polling"]); 
    io.set("polling duration", 10);
    io.set('log level', 1);
});
console.log('info - WhiskChat Server starting');
console.log('info - Starting DB');
if (process.env.REDISTOGO_URL) {
    var rtg   = require("url").parse(process.env.REDISTOGO_URL);
    var db = redis.createClient(rtg.port, rtg.hostname);
    
    db.auth(rtg.auth.split(":")[1]);
} else {
    var db = redis.createClient();
}
db.on('error', function(err) {
    console.log('error - DB error: ' + err);
});

// Inputs.io code
function getClientIp(req) {
    var ipAddress;
    // Amazon EC2 / Heroku workaround to get real client IP
    var forwardedIpsStr = req.header('x-forwarded-for'); 
    if (forwardedIpsStr) {
        // 'x-forwarded-for' header may return multiple IP addresses in
        // the format: "client IP, proxy 1 IP, proxy 2 IP" so take the
        // the first one
        var forwardedIps = forwardedIpsStr.split(',');
        ipAddress = forwardedIps[0];
    }
    if (!ipAddress) {
        // Ensure getting client IP address still works in
        // development environment
        ipAddress = req.connection.remoteAddress;
    }
    return ipAddress;
}
app.get('/inputs', function(req, res) {
    console.log('info - Got Inputs request');
    if (getClientIp(req) !== "50.116.37.202") {
        console.log('info - request was fake (' + getClientIp(req) +')');
	res.writeHead(401);
	res.end('Y U TRY TO FAKE INPUTS CALLBACK');
	return;
    }
    console.log('info - request is authentic');
    db.get('users/' + req.query.note, function(err, user) {
	if (err) {
	    handle(err); // Wait for next callback
	    return;
	}
	if (!user) {
	    console.log('info - returning money');
	    inputs.transactions.send(req.query.from, req.query.amount, 'This user does not exist', function(err, tx) {
		if (err) {
		    handle(err); // Inputs will callback again
		    return;
		}
		console.log('tx sent: ' + tx);
	    });
	    res.writeHead(200);
	    res.end('*OK*');
	    return;
	}
	else {
            db.get('users/' + req.query.note + '/balance', function(err, reply) {
                db.set('users/' + req.query.note + '/balance', Number(reply) + Number(req.query.amount), function(err, res) {
                    sockets.forEach(function(so) {
                        so.emit('chat', {room: 'main', message: '<strong>' + req.query.note + ' deposited ' + req.query.amount + ' BTC using Inputs.io!</strong>', user: '<strong>Server</strong>', timestamp: Date.now()});
			if (so.user == req.query.note) {
                            so.emit('balance', {balance: Number(reply) + Number(req.query.amount)});
                            so.emit('chat', {room: 'main', message: 'You deposited ' + req.query.amount + ' BTC!', user: '<strong>Server</strong>', timestamp: Date.now()});
			}
		    });
                });
            });
        }
    });
});


    

function stripHTML(html) { // Prevent XSS
    return html.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>?/gi, '');
}
function chatemit(sock, message, room, winbtc) {
    if (admins.indexOf(sock.user) !== -1) {
        return sock.emit('chat', {room: room, message: message, user: sock.user, timestamp: Date.now(), userShow: '<strong><span style="color: #e00" title="Administrator">' +  sock.user + '</span></strong> [<strong><span style="color: #e00" title="Administrator">A</span></strong>]', winbtc: winbtc});
    }
    if (mods.indexOf(sock.user) !== -1) {
        return sock.emit('chat', {room: room, message: message, user: sock.user, timestamp: Date.now(), userShow: sock.user + ' [<strong><span style="color: #090" title="Moderator">M</span></strong>]', winbtc: winbtc});
    }
    sock.emit('chat', {room: 'main', message: 'The latest source code is <a href="https://github.com/WhiskTech/whiskchat-server/">here</a>.', user: '<strong>MOTD</strong>', timestamp: Date.now(), winbtc: winbtc});
}
function urlify(text) {
    if (text.indexOf('<') !== -1) {
        // The BBCode parser has made HTML from this, so we don't touch it
        return text;
    }
    var urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, function(url) {
        return '<a href="' + url + '">' + url + '</a>';
    });
}
function login(username, usersocket) {
    online++;
    usersocket.emit('loggedin', {username: username});
    usersocket.authed = true;
    usersocket.emit('chat', {room: 'main', message: 'Signed in as ' + username + '!', user: '<strong>Server</strong>', timestamp: Date.now()});
    db.get('motd', function(err, reply) {
	if (reply) {
	    var motd = reply.split('|');
	    motd.forEach(function(line) {
                usersocket.emit('chat', {room: 'main', message: line, user: '<strong>MOTD</strong>', timestamp: Date.now()});
	    });
	}
    });
    usersocket.user = username;
    usersocket.emit('chat', {room: 'main', message: 'The latest source code is <a href="https://github.com/WhiskTech/whiskchat-server/">here</a>.', user: '<strong>MOTD</strong>', timestamp: Date.now()});
    usersocket.emit('chat', {room: 'main', message: '<iframe id="ohhai" style="" width="560" height="315" src="//www.youtube.com/embed/QvxdDDHElZo" frameborder="0" allowfullscreen=""></iframe>', user: '<strong>MOTD</strong>', timestamp: Date.now()});
    usersocket.emit('joinroom', {room: 'whiskchat'});
    usersocket.emit('joinroom', {room: 'botgames'});
    
    usersocket.emit('whitelist', {whitelisted: 1});
    db.get('users/' + username + '/balance', function(err, reply) {
	usersocket.emit('balance', {balance: reply});
        usersocket.emit('chat', {room: 'main', message: 'Your balance is <strong>' + Number(reply).toFixed(2) + ' mWC</strong>.', user: '<strong>MOTD</strong>', timestamp: Date.now()});
    });
    console.log('user ' + username + ' just logged in! :D');
}
function handle(err) {
    console.log('error - ' + err);
    try {
        sockets.forEach(function(socket) {
	    socket.emit({room: 'main', message: 'Server error: ' + err, user: '<strong>Server</strong>', timestamp: Date.now()});
	});
    }
    catch(e) {
	console.log('error - couldn\'t notify sockets: ' + e);
    }
}
function randomerr(type,code,string){
    console.log("RANDOM.ORG Error: Type: "+type+", Status Code: "+code+", Response Data: "+string);
}
function calculateEarns(user, msg, callback) {
    callback(null);
}
db.on('ready', function() {
    console.log('info - DB connected');
});
io.sockets.on('connection', function(socket) {
    sockets.push(socket);
    
    if(lastSendOnline.getTime() < new Date().getTime() - 2.5 * 1000){
	io.sockets.volatile.emit("online", {people: online});
	lastSendOnline = new Date();
    } else {
	socket.emit("online", {people: online});
    }
    socket.on('disconnect', function() {
	sockets.splice(sockets.indexOf(socket), 1);
	if (socket.authed) {
	    online--;
	}
    });
    socket.emit('joinroom', {room: 'main'});
    socket.emit('chat', {room: 'main', message: '<strong>Welcome to WhiskChat Server!</strong> (beta)', user: '<strong>Server</strong>', timestamp: Date.now()});
    socket.emit('chat', {room: 'main', message: 'WhiskChat uses code from <a href="http://coinchat.org">coinchat.org</a>, © 2013 admin@glados.cc', user: '<strong>Server</strong>', timestamp: Date.now()});
    socket.emit('chat', {room: 'main', message: 'The version here is <strong>' + versionString + '</strong>. ' + online + ' users connected.', user: '<strong>Server</strong>', timestamp: Date.now()});
    socket.authed = false;
    socket.on('accounts', function(data) {
	if(data && data.action){
	    if(data.action == "register"){
		if(data.username && data.password && data.password2 && data.email){
		    if(data.username.length < 3 || data.username.length > 16 || data.username == "<strong>Server</strong>"){
			return socket.emit("message", {type: "alert-error", message: "Username must be between 3 and 16 characters"});
		    }
		    if(data.username.indexOf('<') !== -1 || data.username.indexOf('>') !== -1)
		    {
			return socket.emit("message", {type: "alert-error", message: "HTML Usernames are not permitted"});
		    }
		    db.get("users/" + data.username, function(err, reply){
			if(!reply){
			    if(data.password.length < 6){
				return socket.emit("message", {type: "alert-error", message: "Password must be at least 6 characters!"});
			    }
			    if(data.email.indexOf("@") == -1 || data.email.indexOf(".") == -1){
				//simple email check
				return socket.emit("message", {type: "alert-error", message: "Please enter a valid email."});
			    }
			    if(data.password != data.password2){
				return socket.emit("message", {type: "alert-error", message: "Passwords must match!"});
			    }
			    // Generate seed for password
			    crypto.randomBytes(12, function(ex, buf){
				var salt = buf.toString('hex');
				
				var hashed = hash.sha256(data.password, salt);
				
				db.set("users/" + data.username, true);
				db.set("users/" + data.username + "/password", hashed);
				db.set("users/" + data.username + "/salt", salt);
				db.set("users/" + data.username + "/email", data.email);
				
				socket.emit("message", {type: "alert-success", message: "Thanks for registering, " + data.username + "!"});
				login(data.username, socket);
			    });
			} else {
			    return socket.emit("message", {type: "alert-error", message: "The username is already taken!"});
			}
		    });
		} else {
		    socket.emit("message", {type: "alert-error", message: "Please fill in all the fields."});
		}
	    }
	    if (data.action == "login") {
		db.get("users/" + data.username + "/password", function(err, reply) {
		    if (err) {
			handle(err);
		    }
		    
		    else {
			db.get('users/' + data.username + '/salt', function(err, salt) {
                            var hashed = hash.sha256(data.password, salt);
			    if (reply == hashed) {
                                socket.emit("message", {type: "alert-success", message: "Welcome back, " + data.username + "!"});
				login(data.username, socket);
			    }
			    else {
				if (reply == null) {
				    socket.emit("message", {type: "alert-error", message: "User does not exist."});
				}
				else {
                                    socket.emit("message", {type: "alert-error", message: "Incorrect password."});
				}
			    }
			});
		    }
		});
	    }
	}
    });
    socket.on('ping', function() {
	socket.emit('ping');
    });
    socket.on('mute', function(mute) {
	if (mods.indexOf(socket.user) == -1) {
            socket.emit("message", {type: "alert-error", message: "You are not a moderator!"});
	}
	else {
	    if (muted.indexOf(mute.target) == -1) {
		muted.push(mute.target);
	    }
	    sockets.forEach(function(cs) {
		cs.emit('chat', {room: 'main', message: '<span class="label label-important">' + stripHTML(mute.target) + ' has been muted by ' + stripHTML(socket.user) + ' for ' + stripHTML(mute.mute) + ' seconds! Reason: ' + stripHTML(mute.reason) + '</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
	    });
	    setTimeout(function() {
		if (muted.indexOf(mute.target) !== -1) {
		    muted.splice(muted.indexOf(mute.target), 1);
		    sockets.forEach(function(cs) {
			cs.emit('chat', {room: 'main', message: '<span class="label label-success">' + mute.target + '\'s mute expired!</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
		    });
		}
	    }, mute.mute * 1000);
	}
    });
    socket.on('chat', function(chat) {
	if (!socket.authed) {
            socket.emit('chat', {room: 'main', message: 'Please log in or register to chat!', user: '<strong>Server</strong>', timestamp: Date.now()});
	}
	else {
            sockets.forEach(function(cs) {
		if (muted.indexOf(socket.user) !== -1) {
                    socket.volatile.emit("message", {type: "alert-error", message: "You have been muted!"});
		    return;
                }
		if (chat.message.length < 2) {
		    return;
		}
		if (chat.message.substr(0, 1) == "\\") {
                    return chatemit(socket, '<span style="text-shadow: 2px 2px 0 rgba(64,64,64,0.4),-2px -2px 0px rgba(64,64,64,0.2); font-size: 1.1em;">' + stripHTML(chat.message.substr(1, chat.message.length)) + '</span>', chat.room);
		}
                if (chat.message.substr(0, 1) == "|") {
                    return chatemit(socket, '<span class="rainbow">' + stripHTML(chat.message.substr(1, chat.message.length)) + '</span>', chat.room);
                }
                if (chat.message.substr(0, 3) == "/me") {
                    return chatemit(socket, ' <i>' + stripHTML(chat.message.substr(4, chat.message.length)) + '</i>', chat.room);
                }
		if (chat.message.substr(0, 4) == "/spt") {
                    return chatemit(socket, '<iframe src="https://embed.spotify.com/?uri=' + stripHTML(chat.message.substr(5, chat.message.length)) + '" width="450" height="80" frameborder="0" allowtransparency="true"></iframe>', chat.room); 
		}
		if (chat.message.substr(0, 4) == "!moo") {
                    return;
		}
                if (chat.message.substr(0, 4) == "/btc") {
                    if (stripHTML(chat.message.substr(5, chat.message.length))) {
			return chatemit(socket, '<strong>BTC conversion of ' + stripHTML(chat.message.substr(5, chat.message.length)) + '</strong>: <img src="http://btcticker.appspot.com/mtgox/' + stripHTML(chat.message.substr(5, chat.message.length)) + '.png"></img>', chat.room);
		    }
                    return chatemit(socket, '<strong>BTC conversion of 1 BTC to USD: </strong>: <img src="http://btcticker.appspot.com/mtgox/1btc.png"></img>', chat.room);
                }
                if (chat.message.substr(0, 3) == "/sc") {
                    return chatemit(socket, '<iframe width="100%" height="166" scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?url=http%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F' + stripHTML(chat.message.substr(4, chat.message.length)) + '"></iframe>', chat.room); 
                }
                if (chat.message.substr(0, 3) == "/yt") {
                    return chatemit(socket, '<span style="display: inline;" id="y' + stripHTML(chat.message.substr(4, chat.message.length)) + '">YouTube Video</span> (ID: ' + stripHTML(chat.message.substr(4, chat.message.length)) + ') <button onclick="$(\'#vid' + stripHTML(chat.message.substr(4, chat.message.length)) +'\').hide()" class="btn btn-small btn-danger">Hide</button> <button onclick="$(\'#vid' + stripHTML(chat.message.substr(4, chat.message.length)) + '\').show()" class="btn btn-small btn-success">Show</button><iframe id="vid' + stripHTML(chat.message.substr(4, chat.message.length)) + '" style="display: none;" width="560" height="315" src="//www.youtube.com/embed/' + stripHTML(chat.message.substr(4, chat.message.length)) + '" frameborder="0" allowfullscreen></iframe> <script>function ytcallback' + stripHTML(chat.message.substr(4, chat.message.length)) +'() {$(\'#yt' + stripHTML(chat.message.substr(4, chat.message.length)) +'\').html(data.entry["title"].$t)}</script><script type="text/javascript" src="http://gdata.youtube.com/feeds/api/videos/' + stripHTML(chat.message.substr(4, chat.message.length)) +'?v=2&alt=json-in-script&callback=ytcallback' + stripHTML(chat.message.substr(4, chat.message.length)) +'"></script>', chat.room); // Good luck trying to decode that :P -whiskers75
                }
                if (chat.message.substr(0,3) == "/ma") {
                    if (mods.indexOf(socket.user) == -1) {
                        socket.emit("message", {type: "alert-error", message: "You are not a moderator!"});
		    }
                    else {
                        return chatemit(socket, '<span style="text-shadow: 2px 2px 0 rgba(64,64,64,0.4),-2px -2px 0px rgba(64,64,64,0.2); font-size: 2em; color: red;">' + stripHTML(chat.message.substr(3, chat.message.length)) + '</span>', chat.room);
		    }
                }
		bbcode.parse(stripHTML(chat.message), function(parsedcode) {
		    /* link links */
                    parsedcode = urlify(parsedcode);
		    calculateEarns(socket.user, parsedcode, function(earnt) {
			if (earnt) {
                            chatemit(socket, parsedcode, chat.room, earnt);
			    db.get('users/' + socket.user + '/balance', function(err, reply) {
				db.set('users/' + socket.user + '/balance', Number(reply) + earnt, function(err, res) {
				    socket.emit('balance', {balance: Number(reply) + earnt});
				});
			    });
			}
			else {
                            chatemit(socket, parsedcode, chat.room, earnt); 
			}
		    });
		});
	    });
	}
    });
    socket.on('tip', function(tip) {
	db.get('users/' + socket.user + '/balance', function(err, bal1) {
	    db.get('users/' + tip.user + '/balance', function(err, bal2) {
		if (Number(tip.tip) < bal1 && Number(tip.tip) > 0 && tip.user != socket.user && muted.indexOf(socket.user) == -1) {
		    db.set('users/' + socket.user + '/balance', Number(bal1) - Number(tip.tip), redis.print);
                    db.set('users/' + tip.user + '/balance', Number(bal2) + Number(tip.tip), redis.print);
                    sockets.forEach(function(cs) {
                        cs.emit('tip', {room: tip.room, target: stripHTML(tip.user), amount: Number(tip.tip), message: tip.message, user: socket.user, timestamp: Date.now()});
			if (cs.user == socket.user) {
			    cs.emit('balance', {balance: Number(bal1) - Number(tip.tip)});
			}
			if (cs.user == tip.user) {
			    cs.emit('balance', {balance: Number(bal2) + Number(tip.tip)});
			}
                    });
                }
		else {
                    socket.emit('message', {type: "alert-error", message: "Your current balance is " + bal1 + " mBTC. Tip: " + tip.tip + "mBTC. Tip failed - you might not have enough, you may be muted or you are tipping yourself."});
		}
	    });
	});
    });
    socket.on('getbalance', function() {
	db.get('users/' + socket.user + '/balance', function(err, balance) {
	    socket.emit('balance', {balance: balance});
	});
    });
    socket.on('joinroom', function(join) {
	// Get the current room owner, and make it the user if it's null.
	// Then join it! :)
	socket.join(join.room); // We can use socket.io rooms! :D
    });
});

console.log('info - listening');
process.on('SIGTERM', function() {
    sockets.forEach(function(cs) {
        cs.emit('chat', {room: 'main', message: '<span class="label label-important">Server stopping! (most likely just rebooting)</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
    });
    setTimeout(function() {
	process.exit(0);
    }, 1500);
});
process.on('uncaughtException', function(err) {
    sockets.forEach(function(cs) {
	cs.emit('chat', {room: 'main', message: '<span class="label label-important">Server error: ' + err + '!</span>', user: '<strong>Server</strong>', timestamp: Date.now()});
    });
    console.log('error - ' + err + err.stack);
});
