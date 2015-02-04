/*
The MIT License (MIT)
Copyright (c) 2013 Calvin Montgomery

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

var Server = require("./lib/server");
var Config = require("./lib/config");
var Logger = require("./lib/logger");

Config.load("config.yaml");
var sv = Server.init();
if (!Config.get("debug")) {
    process.on("uncaughtException", function (err) {
        Logger.errlog.log("[SEVERE] Uncaught Exception: " + err);
        Logger.errlog.log(err.stack);
    });

    process.on("SIGINT", function () {
        sv.shutdown();
    });
}

var stdinbuf = "";
process.stdin.on("data", function (data) {
    stdinbuf += data;
    if (stdinbuf.indexOf("\n") !== -1) {
        var line = stdinbuf.substring(0, stdinbuf.indexOf("\n"));
        stdinbuf = stdinbuf.substring(stdinbuf.indexOf("\n") + 1);
        handleLine(line);
    }
});

function handleLine(line) {
    if (line === "/reload") {
        Logger.syslog.log("Reloading config");
        Config.load("config.yaml");
    } else if (line === "/gc") {
        if (global && global.gc) {
            Logger.syslog.log("Running GC");
            global.gc();
        } else {
            Logger.syslog.log("Failed to invoke GC: node started without --expose-gc");
        }
    } else if (line === "/delete_old_tables") {
        require("./lib/database/update").deleteOldChannelTables(function (err) {
            if (!err) {
                Logger.syslog.log("Deleted old channel tables");
            }
        });
    }
}
