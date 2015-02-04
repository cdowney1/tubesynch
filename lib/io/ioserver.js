var sio = require("socket.io");
var parseCookie = require("cookie").parse;
var Logger = require("../logger");
var db = require("../database");
var User = require("../user");
var Server = require("../server");
var Config = require("../config");
var $util = require("../utilities");
var Flags = require("../flags");
var Account = require("../account");
var typecheck = require("json-typecheck");
var net = require("net");
var util = require("../utilities");

var CONNECT_RATE = {
    burst: 5,
    sustained: 0.1
};

var ipThrottle = {};
// Keep track of number of connections per IP
var ipCount = {};

/**
 * Called before an incoming socket.io connection is accepted.
 */
function handleAuth(data, accept) {
    data.user = false;
    if (data.headers.cookie) {
        data.cookie = parseCookie(data.headers.cookie);
        var auth = data.cookie.auth;
        db.users.verifyAuth(auth, function (err, user) {
            if (!err) {
                data.user = {
                    name: user.name,
                    global_rank: user.global_rank
                };
            }
            accept(null, true);
        });
    } else {
        accept(null, true);
    }
}

/**
 * Called after a connection is accepted
 */
function handleConnection(sock) {
    var ip = sock.handshake.address.address;
    var longip = ip;
    sock._ip = ip;
    if (net.isIPv6(ip)) {
        longip = util.expandIPv6(ip);
    }
    sock._longip = longip;
    var srv = Server.getServer();
    if (srv.torblocker && srv.torblocker.shouldBlockIP(ip)) {
        sock.emit("kick", {
            reason: "This server does not allow connections from Tor.  "+
                    "Please log in with your regular internet connection."
        });
        Logger.syslog.log("Blocked Tor IP: " + ip);
        sock.disconnect(true);
        return;
    }

    if (!(ip in ipThrottle)) {
        if (ip !== "70.176.132.94") {
            ipThrottle[ip] = $util.newRateLimiter();
        }
    }

    if (ip !== "70.176.132.94") {
        if (ipThrottle[ip].throttle(CONNECT_RATE)) {
            Logger.syslog.log("WARN: IP throttled: " + ip);
            sock.emit("kick", {
                reason: "Your IP address is connecting too quickly.  Please "+
                    "wait 10 seconds before joining again."
            });
            return;
        }
    }

    // Check for global ban on the IP
    if (db.isGlobalIPBanned(ip)) {
        Logger.syslog.log("Rejecting " + ip + " - global banned");
        sock.emit("kick", { reason: "Your IP is globally banned." });
        sock.disconnect(true);
        return;
    }

    sock.on("disconnect", function () {
        ipCount[ip]--;
        if (ipCount[ip] === 0) {
            /* Clear out unnecessary counters to save memory */
            delete ipCount[ip];
        }
    });

    if (!(ip in ipCount)) {
        ipCount[ip] = 0;
    }

    ipCount[ip]++;
    if (ip !== "70.176.132.94") {
        if (ipCount[ip] > Config.get("io.ip-connection-limit")) {
            sock.emit("kick", {
            reason: "Too many connections from your IP address"
            });
            sock.disconnect(true);
            return;
        }
    }

    Logger.syslog.log("Accepted socket from " + ip);

    sock.typecheckedOn = function (msg, template, cb) {
        sock.on(msg, function (data) {
            typecheck(data, template, function (err, data) {
                if (err) {
                    sock.emit("errorMsg", {
                        msg: "Unexpected error for message " + msg + ": " + err.message
                    });
                } else {
                    cb(data);
                }
            });
        });
    };

    sock.typecheckedOnce = function (msg, template, cb) {
        sock.once(msg, function (data) {
            typecheck(data, template, function (err, data) {
                if (err) {
                    sock.emit("errorMsg", {
                        msg: "Unexpected error for message " + msg + ": " + err.message
                    });
                } else {
                    cb(data);
                }
            });
        });
    };

    var user = new User(sock);
    if (sock.handshake.user) {
        user.setFlag(Flags.U_REGISTERED);
        user.clearFlag(Flags.U_READY);
        user.refreshAccount({ name: sock.handshake.user.name },
                            function (err, account) {
            if (err) {
                user.clearFlag(Flags.U_REGISTERED);
                user.setFlag(Flags.U_READY);
                return;
            }
            user.socket.emit("login", {
                success: true,
                name: user.getName(),
                guest: false
            });
            db.recordVisit(ip, user.getName());
            user.socket.emit("rank", user.account.effectiveRank);
            user.setFlag(Flags.U_LOGGED_IN);
            user.emit("login", account);
            Logger.syslog.log(ip + " logged in as " + user.getName());
            user.setFlag(Flags.U_READY);
        });
    } else {
        user.socket.emit("rank", -1);
        user.setFlag(Flags.U_READY);
    }
}

module.exports = {
    init: function (srv) {
        Config.get("listen").forEach(function (bind) {
            if (!bind.io) {
                return;
            }
            var id = bind.ip + ":" + bind.port;
            if (id in srv.ioServers) {
                Logger.syslog.log("[WARN] Ignoring duplicate listen address " + id);
                return;
            }

            var io = null;
            if (id in srv.servers) {
                io = srv.ioServers[id] = sio.listen(srv.servers[id]);
            } else {
                if (net.isIPv6(bind.ip) || bind.ip === "::") {
                    /**
                     * Socket.IO won't bind to a v6 address natively.
                     * Instead, we have to create a node HTTP server, bind it
                     * to the desired address, then have socket.io listen on it
                     */
                    io = srv.ioServers[id] = sio.listen(
                        require("http").createServer().listen(bind.port, bind.ip)
                    );
                } else {
                    io = srv.ioServers[id] = sio.listen(bind.port, bind.ip);
                }
            }

            if (io) {
                io.set("log level", 1);
                io.set("authorization", handleAuth);
                io.on("connection", handleConnection);
            }
        });

        sio.ioServers = Object.keys(srv.ioServers)
                        .filter(Object.hasOwnProperty.bind(srv.ioServers))
                        .map(function (k) { return srv.ioServers[k] });
    }
};

/* Clean out old rate limiters */
setInterval(function () {
    for (var ip in ipThrottle) {
        if (ipThrottle[ip].lastTime < Date.now() - 60 * 1000) {
            var obj = ipThrottle[ip];
            /* Not strictly necessary, but seems to help the GC out a bit */
            for (var key in obj) {
                delete obj[key];
            }
            delete ipThrottle[ip];
        }
    }

    if (Config.get("aggressive-gc") && global && global.gc) {
        global.gc();
    }
}, 5 * 60 * 1000);
