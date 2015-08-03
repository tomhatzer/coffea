/*jslint node: true*/
"use strict";

var debug = require('debug')('core');
var debugR = require('debug')('router');

var EventEmitter = require('eventemitter3');
var net = require('net');
var tls = require('tls');
var fs = require('fs');
var replies = require('irc-replies');
var StreamReadable = require('stream').Readable;
var StreamWritable = require('stream').Writable;
var utils = require('./lib/utils');
var util = require('util');
var debugStream = require('debug')('stream');
var debugPlugin = require('debug')('plugin');
var read = require('fs-readdir-recursive');
require('harmony-reflect'); // Proxy polyfill
var methodMissing = require('./methodMissing');

/**
 * Client constructor
 *
 * Initializes the client object, sets max listeners,
 * initializes stream buffer and other variables.
 * Then loads plugins and parses the network info passed.
 * Check Client.add for more information about the network info.
 *
 * @class
 * @param {object} info network configuration object
 * @param {bool} throttling enable/disable throttling
 * @property {string} version coffea version
 * @property {object} me client irc user
 */
function Client(info, throttling) {
    if (!(this instanceof Client)) { return new Client(info, throttling); }

    try {
        var pkg = require('./package.json');
        this.version = pkg.version;
    } catch (err) { }

    debug("init coffea" + (this.version ? " v" + this.version : ""));

    this.streams = {};
    this.protocols = {};

    this.utils = utils;

    this.networked_me = {};
    this.capabilities = [];

    this.loadPlugin(__dirname + '/lib/irc/index.js');
    debug("irc plugins loaded");

    if (typeof info === 'boolean') {
        throttling = info;
        info = null;
    }

    if (throttling !== undefined) {
        this.throttling = throttling;
    }

    if (info) {
        // compatibility
        this.add(info);
    }

    return methodMissing(this);
}

// expose client
module.exports = Client;

// inherit from Emitter.prototype to make Client and EventEmitter
utils.inherit(Client, EventEmitter);

Client.prototype._execProtocol = function (protocol, cmd, arg1, arg2, arg3, arg4, arg5) {
    return this.protocols[protocol][cmd](arg1, arg2, arg3, arg4, arg5); // TODO: use `args...` in ES6
};

Client.prototype._parseConfig = function (config) {
    if (config instanceof Array) {
        config = config.map(this._parseConfig, this);
    } else {
        var p;
        if (typeof config === 'string') {
            p = config;
            config = {};
        } else if (config.host) {
            p = config.host;
        }
        p = p.split('://');

        var protocol = p.length > 1 ? p[0] : undefined;
        var shortConfig = p[1];
        if (protocol) {
            config = this._execProtocol(protocol, 'parse', config, shortConfig);
            console.log(config);
        }
        config.protocol = protocol ? protocol : 'irc';
    }

    return config;
};

Client.prototype._runConfig = function (config) {
    if (config instanceof Array) {
        config = config.map(this._runConfig, this);
    } else {
        var protocol = config.protocol;
        if (!this.protocols.hasOwnProperty(protocol)) {
            var errmsg = "invalid protocol '" + protocol + "'";
            debug("error: %s", errmsg);
            throw new Error(errmsg);
        }
        debug("using protocol '%s' for '%s'", protocol, JSON.stringify(config));
        var stream = this._execProtocol(protocol, 'setup', config);
        var id = this._useStream(stream, config);
        this.connect(id);
        return id;
    }

    return config;
};

/**
 * Internal function that loads a stream into the client
 * Returns specified network name or generated stream id
 *
 * @params {Object} stream      Must be an instanceof StreamReadable and StreamWritable
 * @params {string} network     Specify a network name/stream id
 * @return {string} stream_id
 * @api private
 */
Client.prototype._useStream = function (stream, info) {
    if (!info) info = {};

    var network = info.name;

    if (network) { stream.coffea_id = network; } // user-defined stream id
    else { stream.coffea_id = Object.keys(this.streams).length.toString(); } // assign unique id to stream

    // set protocol info
    stream.protocol = info.protocol === undefined ? 'irc' : info.protocol;

    // set stream config/info
    stream.info = info;

    // add stream to client
    this.streams[stream.coffea_id] = stream;

    // return stream id
    return stream.coffea_id;
};

/* Depreciated. This is here for compatibility. */
Client.prototype.useStream = function (stream, network) {
    console.warn("DEPRECIATED: direct use of useStream is depreciated, please use add() instead");
    this._useStream(stream, network);
};

/**
 * Add a network to the client, the argument can be a stream, network config object
 * or an array of network config objects (see README.md and wiki for more information)
 * Returns specified network name or generated stream id
 *
 * @params {Object} info
 * @return {string} stream_id
 * @api public
 */
Client.prototype.add = function (info) {
    var streams = [];

    if ((info instanceof StreamReadable) || (info instanceof StreamWritable)) {
        debug("add(Stream)");
        debug("stream passed, using it directly");
        var stream_id = this._useStream(info, null, info.throttling);
        streams.push(stream_id);
    } else {
        debug("add(%s)", JSON.stringify(info));

        var config = this._parseConfig(info);
        debug("parseConfig -> %s", JSON.stringify(config));

        streams = this._runConfig(config);
        debug("runConfig -> %s", JSON.stringify(streams));
    }

    if (streams.length === 1) {
        return streams.pop();
    } else {
        return streams;
    }
};

Client.prototype._getProtocolData = function (protocol, define) {
    var p = this.protocols[protocol];
    if (!p) {
        if (define) p = this.protocols[protocol] = {};
        else throw new Error("Invalid protocol '" + protocol + "'");
    }
    return p;
};

Client.prototype.define = function define(protocol, name, f) {
    var p = this._getProtocolData(protocol, true);
    if (!p.functions) p.functions = {};
    p.functions[name] = f.bind(this);
};

Client.prototype.buildFunction = function (protocol, name) {
    var p = this._getProtocolData(protocol);
    if (!p.functions) p.functions = {};

    var f = p.functions[name];
    if (!f) throw new Error("Function '" + name + "' not available in protocol '" + protocol + "'");

    return f.bind(this);
};

Client.prototype.getProtocol = function (stream_id) {
    var stream = this.streams[stream_id];
    return stream ? stream.protocol : 'irc';
};

Client.prototype.__noSuchMethod__ = function (methodName, args) {
    try {
        debugR('%s(%s)', methodName, args.map(util.inspect).join(', '));
    } catch (err) {
        debugR('%s(%s)', methodName, args.join(', '));
    }
    // TODO: deal with calls that don't specify a stream_id
    var originalArgs = args.slice(0);
    var cb = args.pop();
    var stream_id;
    if ((!cb) || (typeof cb === "function")) {
        stream_id = args.pop();
    } else {
        stream_id = cb;
    }
    var protocol = this.getProtocol(stream_id);
    debugR('extracted stream_id: %s -> protocol: %s', stream_id, protocol);
    var f = this.buildFunction(protocol, methodName);
    return f.apply(this, originalArgs);
};

Client.prototype.reconnect = function (stream_id, cb) {
    return this.disconnect(stream_id, function disconnectedGoingToReconnect() {
        this.connect(stream_id, cb);
    });
};

/**
 * Load a plugin into the client
 *
 * @params {Function} fn
 * @return {Object} this
 * @api public
 */
Client.prototype.use = function (fn) {
    var coffea = methodMissing(this);
    fn.call(coffea, coffea);
    return this;
};

/**
 * Load a plugin by specifying the full path to the file
 *
 * @params {string} path
 * @api public
 */
Client.prototype.loadPlugin = function (path, cb) {
    debugPlugin("loading plugin '%s'", path.split('/').pop());
    this.use(require(path)(cb));
};

/**
 * Function that loads all plugins from a folder
 *
 * @params {string}     path    path to load plugins from
 * @params {function}   cb      callback executed when plugins are loaded
 * @api public
 */
Client.prototype.loadPlugins = function (path) {
    var _this = this;
    debugPlugin("loading plugins from path: %s", path);
    var plugins = read(path, function (x) {
        return x[0] !== '.' && x.split('.').pop() === 'js';
    });
    plugins.forEach(function (plugin) {
        _this.loadPlugin(path + '/' + plugin);
    }); // TODO: use async to wait for all plugins to load here
};

/**
 * Internal function to handle incoming messages from the streams
 *
 * @params {string} msg
 * @api private
 */
Client.prototype.onmessage = function (msg, network) {
    msg.command = replies[msg.command] || msg.command;
    utils.emit(this, network, 'data', msg);
};

/**
 * fallback for `function(event)` callbacks
 *
 * @api private
 */
Client.prototype._fallbackCallback = function _fallbackCallback(extend, event, fn, context) {
    var params = utils.getParamNames(fn);
    var func = fn;
    var coffea = methodMissing(this);
    if (params.length === 1) {
        func = function (err, event) {
            fn.call(coffea, event, err);
        };
    }
    extend.call(coffea, event, func, context);
};

/**
 * apply fallback to `client.on()` events
 *
 * @api private
 */
Client.prototype.on = function on(event, fn, context) {
    this._fallbackCallback(this.parent.on, event, fn, context);
};

/**
 * apply fallback to `client.once()` events
 *
 * @api private
 */
Client.prototype.once = function once(event, fn, context) {
    this._fallbackCallback(this.parent.once, event, fn, context);
};
