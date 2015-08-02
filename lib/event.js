/*jslint node: true*/
"use strict";

var debug = require('debug')('event');

function Event(coffea, network) {
    this.coffea = coffea;
    this.network = network;
}

module.exports = Event;

Event.prototype.getMessage = function getMessage() {
    return this._message;
};

Event.prototype.reply = function reply(message) {
    debug('reply(%s)', message);
	return this._reply("send", message);
};

Event.prototype.replyAction = function reply(message) {
	return this._reply("action", message);
};

Event.prototype.replyNotice = function reply(message) {
	return this._reply("notice", message);
};

Event.prototype._reply = function _reply(action, message) {
    debug('-> _reply(%s, %s)', action, message);
    var protocol = this.coffea.getProtocol(this.network);
    debug('protocol is "%s"', protocol);
    debug('user is "%s"', this.user);
    debug('channel is "%s"', this.channel);
    if (this.channel || this.user) {
        var fn = this.coffea.buildFunction(protocol, action);
        if (typeof fn === 'function') {
            debug('replying in "%s"', this.channel ? this.channel : this.user);
            fn = fn.bind(this.coffea);
            return fn(this.channel ? this.channel : this.user, message, this.network);
        }
    }
};
