(function () {
    var root, crypto, net = false;

    if (typeof window === "undefined") {
        root = module.exports;
    } else {
        root = window.utils = {};
    }

    if (typeof require === "function") {
        crypto = require("crypto");
        net = require("net");
    }

    var Set = function (items) {
        this._items = {};
        var self = this;
        if (items instanceof Array)
            items.forEach(function (it) { self.add(it); });
    };

    Set.prototype.contains = function (what) {
        return (what in this._items);
    };

    Set.prototype.add = function (what) {
        this._items[what] = true;
    };

    Set.prototype.remove = function (what) {
        if (what in this._items)
            delete this._items[what];
    };

    Set.prototype.clear = function () {
        this._items = {};
    };

    Set.prototype.forEach = function (fn) {
        for (var k in this._items) {
            fn(k);
        }
    };

    root.Set = Set;

    root.isValidChannelName = function (name) {
        return name.match(/^[\w-]{1,30}$/);
    },

    root.isValidUserName = function (name) {
        return name.match(/^[\w-]{1,20}$/);
    },

    root.isValidEmail = function (email) {
        if (email.length > 255) {
            return false;
        }

        if (!email.match(/^[^@]+?@[^@]+$/)) {
            return false;
        }

        if (email.match(/^[^@]+?@(localhost|127\.0\.0\.1)$/)) {
            return false;
        }

        return true;
    },

    root.randomSalt = function (length) {
        var chars = "abcdefgihjklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
                  + "0123456789!@#$%^&*_+=~";
        var salt = [];
        for(var i = 0; i < length; i++) {
            salt.push(chars[parseInt(Math.random()*chars.length)]);
        }
        return salt.join('');
    },

    root.maskIP = function (ip) {
        if (net.isIPv4(ip)) {
            /* Full /32 IPv4 address */
            return ip.replace(/^(\d+\.\d+\.\d+)\.\d+/, "$1.x");
        } else if (net.isIPv4(ip + ".0")) {
            /* /24 IPv4 range */
            return ip + ".0/24";
        } else if (net.isIPv4(ip + ".0.0")) {
            /* /16 IPv4 widerange */
            return ip + ".0.0/16";
        } else if (net.isIPv6(ip)) {
            /* /128 IPv6 address */
            return ip.replace(/^((?:[0-9a-f]+:){3}[0-9a-f]+):(?:[0-9a-f]+:){3}[0-9a-f]+$/,
                              "$1:x:x:x:x");
        } else if (net.isIPv6(ip + ":0:0:0:0")) {
            /* /64 IPv6 range */
            return ip + "::0/64";
        } else if (net.isIPv6(ip + ":0:0:0:0:0")) {
            /* /48 IPv6 widerange */
            return ip + "::0/48";
        } else {
            return ip;
        }
    },

    root.getIPRange = function (ip) {
        if (net.isIPv6(ip)) {
            return root.expandIPv6(ip)
                   .replace(/((?:[0-9a-f]{4}:){3}[0-9a-f]{4}):(?:[0-9a-f]{4}:){3}[0-9a-f]{4}/, "$1");
        } else {
            return ip.replace(/((?:[0-9]+\.){2}[0-9]+)\.[0-9]+/, "$1");
        }
    },

    root.getWideIPRange = function (ip) {
        if (net.isIPv6(ip)) {
            return root.expandIPv6(ip)
                   .replace(/((?:[0-9a-f]{4}:){2}[0-9a-f]{4}):(?:[0-9a-f]{4}:){4}[0-9a-f]{4}/, "$1");
        } else {
            return ip.replace(/([0-9]+\.[0-9]+)\.[0-9]+\.[0-9]+/, "$1");
        }
    },

    root.expandIPv6 = function (ip) {
        var result = "0000:0000:0000:0000:0000:0000:0000:0000".split(":");
        var parts = ip.split("::");
        var left = parts[0].split(":");
        var i = 0;
        left.forEach(function (block) {
            while (block.length < 4) {
                block = "0" + block;
            }
            result[i++] = block;
        });

        if (parts.length > 1) {
            var right = parts[1].split(":");
            i = 7;
            right.forEach(function (block) {
                while (block.length < 4) {
                    block = "0" + block;
                }
                result[i--] = block;
            });
        }

        return result.join(":"); 
    },

    root.formatTime = function (sec) {
        if(sec === "--:--")
            return sec;

        sec = Math.floor(+sec);
        var h = "", m = "", s = "";

        if(sec >= 3600) {
            h = "" + Math.floor(sec / 3600);
            if(h.length < 2)
                h = "0" + h;
            sec %= 3600;
        }

        m = "" + Math.floor(sec / 60);
        if(m.length < 2)
            m = "0" + m;

        s = "" + (sec % 60);
        if(s.length < 2)
            s = "0" + s;

        if(h === "")
            return [m, s].join(":");

        return [h, m, s].join(":");
    },

    root.parseTime = function (time) {
        var parts = time.split(":").reverse();
        var seconds = 0;
        switch (parts.length) {
            case 3:
                seconds += parseInt(parts[2]) * 3600;
            case 2:
                seconds += parseInt(parts[1]) * 60;
            case 1:
                seconds += parseInt(parts[0]);
                break;
            default:
                break;
        }
        return seconds;
    },

    root.newRateLimiter = function () {
        return {
            count: 0,
            lastTime: 0,
            throttle: function (opts) {
                if (typeof opts === "undefined")
                    opts = {};

                var burst = +opts.burst,
                    sustained = +opts.sustained,
                    cooldown = +opts.cooldown;

                if (isNaN(burst))
                    burst = 10;

                if (isNaN(sustained))
                    sustained = 2;

                if (isNaN(cooldown))
                    cooldown = burst / sustained;

                // Cooled down, allow and clear buffer
                if (this.lastTime < Date.now() - cooldown*1000) {
                    this.count = 1;
                    this.lastTime = Date.now();
                    return false;
                }

                // Haven't reached burst cap yet, allow
                if (this.count < burst) {
                    this.count++;
                    this.lastTime = Date.now();
                    return false;
                }

                var diff = Date.now() - this.lastTime;
                if (diff < 1000/sustained)
                    return true;

                this.lastTime = Date.now();
                return false;
            }
        };
    },

    root.formatLink = function (id, type) {
        switch (type) {
            case "yt":
                return "http://youtu.be/" + id;
            case "vi":
                return "http://vimeo.com/" + id;
            case "dm":
                return "http://dailymotion.com/video/" + id;
            case "sc":
                return id;
            case "li":
                return "http://livestream.com/" + id;
            case "tw":
                return "http://twitch.tv/" + id;
            case "jt":
                return "http://vaughnlive.tv/" + id;
            case "su":
                return "https://streamup.com/" + id;
            case "hb":
                return "http://hitbox.tv/" + id;
            case "rt":
                return id;
            case "jw":
                return id;
            case "im":
                return "http://imgur.com/a/" + id;
            case "us":
                return "http://ustream.tv/" + id;
            case "gd":
                return "https://docs.google.com/file/d/" + id;
            case "fi":
                return id;
            default:
                return "";
        }
    },

    root.isLive = function (type) {
        switch (type) {
            case "li":
            case "tw":
            case "jt":
            case "su":
            case "hb":
            case "us":
            case "rt":
            case "cu":
            case "im":
            case "jw":
                return true;
            default:
                return false;
        }
    },

    root.sha1 = function (data) {
        if (!crypto) {
            return "";
        }
        var shasum = crypto.createHash("sha1");
        shasum.update(data);
        return shasum.digest("hex");
    }
})();
