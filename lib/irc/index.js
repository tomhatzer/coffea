/*jslint node: true*/
"use strict";

var debug = require('debug')('irc');
var debugStream = require('debug')('stream');

var net = require('net');
var tls = require('tls');

var RateLimiter = require('limiter').RateLimiter;

// TODO: refactor this
module.exports = function (cb) {
    return function (coffea) {
        var utils = coffea.utils;

        debug('loading protocol');

        /**
         * Internal function that does a sanity check
         * on the network information, adding defaults
         *
         * @params {Object} network
         * @return {Object} network
         * @api private
         */
        function _check(network) {
            var ret = {};
            var randnick = "coffea"+Math.floor(Math.random() * 100000);

            if (typeof network === 'string') {
                ret.host = network; // super lazy config - a host was passed as a string
            } else {
                ret.host = network.host === undefined ? null : network.host; // Required.
            }

            ret.name = network.name;

            ret.nick = network.nick === undefined ? randnick : network.nick;
            var port = network.ssl === true ? 6697 : 6667;
            ret.port = network.port === undefined ? port : network.port;
            ret.ssl = network.ssl === undefined ? false : network.ssl;
            ret.ssl_allow_invalid = network.ssl_allow_invalid === undefined ? false : network.ssl_allow_invalid;
            ret.username = network.username === undefined ? ret.nick : network.username;
            ret.realname = network.realname === undefined ? ret.nick : network.realname;
            ret.pass = network.pass;

            ret.throttling = network.throttling;

            ret.sasl = network.sasl === undefined? null : network.sasl;
            ret.nickserv = network.nickserv === undefined? null : network.nickserv;

            return ret;
        }

        coffea.protocols.irc = {

            parse: function parseIrc(config, shortConfig) {
                if (shortConfig) config.host = shortConfig; // TODO: parse port too
                return _check(config);
            },

            setup: function setupIrc(network) {
                debug('setting up stream');
                var stream, stream_id;
                network = _check(network);

                if (network.ssl) {
                    stream = tls.connect({
                        host: network.host,
                        port: network.port,
                        rejectUnauthorized: !network.ssl_allow_invalid
                    }, function() {
                        utils.emit(coffea, stream_id, 'ssl-error', new utils.SSLError(stream.authorizationError));
                    });
                } else {
                    stream = net.connect({host: network.host, port: network.port});
                }

                stream.info = network;

                stream.setEncoding('utf8'); // set stream encoding

                // rate limiting/throttling
                var throttling = network.throttling;
                throttling = ((throttling === undefined) ? this.throttling : throttling);
                stream.limiter = new RateLimiter(1, (typeof throttling === 'number') ? throttling : 250, (throttling === false));

                // set up stream debug
                stream.on('data', function (line) {
                    debugStream('received message (%s): %s', stream.coffea_id, line);
                });

                // set up parser
                var Parser = require('./parser');
                var parser = new Parser();
                parser.on('message', function (msg) {
                    coffea.onmessage(msg, stream.coffea_id);
                });
                parser.on('end', function() {
                    utils.emit(coffea, stream.coffea_id, 'disconnect', {});
                });
                stream.pipe(parser);

                debug('setup stream');

                return stream;
            }
        };

        coffea._setupSASL = function (stream_id, info) {
            coffea.on('cap_ack', function (err, event) {
                if (event.capability === 'sasl') {
                    coffea.sasl.mechanism('PLAIN', stream_id);
                    if (info.sasl && info.sasl.account && info.sasl.password) {
                        coffea.sasl.login(info.sasl.account, info.sasl.password, stream_id);
                    } else if (info.sasl && info.sasl.password) {
                        coffea.sasl.login(info.username, info.sasl.password, stream_id);
                    } else {
                        coffea.sasl.login(null, null, stream_id);
                    }
                }
            });
        };

        /**
         * Write data to a specific network (stream)
         *
         * @params {string} str
         * @params {string} network
         * @params {Function} fn
         * @api public
         */
        coffea.define('irc', 'write', function (str, network, fn) {
            // if network is the callback, then it wasn't defined either
            if (typeof(network) === 'function') {
                fn = network;
                network = undefined;
            }

            // somebody passed the stream, not the id, get id from stream
            if (network !== null && typeof network === 'object') {
                network = network.coffea_id;
            }

            if (network && coffea.streams.hasOwnProperty(network)) {
                // send to specified network
                // coffea.streams[network].limiter.removeTokens(1, function() {
                    coffea.streams[network].write(str + '\r\n', fn);
                // });
            } else {
                // send to all networks
                for (var id in coffea.streams) {
                    if (coffea.streams.hasOwnProperty(id)) {
                        coffea.write(str, id);
                    }
                }
                if (fn) {
                    fn();
                }
            }

        });

        function _connect(coffea, stream_id, info) {
            coffea._setupSASL(stream_id, info);
            if (info.pass) { coffea.pass(info.pass); }
            coffea.capReq(['account-notify', 'away-notify', 'extended-join', 'sasl'], stream_id);
            coffea.capEnd(stream_id);
            coffea.nick(info.nick, stream_id);
            coffea.user(info.username, info.realname, stream_id);
            if (info.nickserv && info.nickserv.username && info.nickserv.password) {
                coffea.identify(info.nickserv.username, info.nickserv.password);
            } else if (info.nickserv && info.nickserv.password) {
                coffea.identify(info.nickserv.password);
            }
        }

        /**
         * Reconnects the socket that is assigned to the current stream_id.
         *
         * @params {string} stream_id
         */
        coffea.define('irc', 'connect', function connectIrc(stream_id) {
            debug('connecting to irc');
            var network = coffea.streams[stream_id].info;
            var stream = network.ssl ? tls.connect({host: network.host, port: network.port}) : net.connect({host: network.host, port: network.port});
            coffea._useStream(stream, stream_id, network.throttling);
            _connect(coffea, stream_id, network);
        });

        coffea.loadPlugins(__dirname + '/plugins/');

        debug('protocol initialized');
        if (cb) cb();
    };
};