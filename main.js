'use strict';

/*
 * Created with @iobroker/create-adapter v1.20.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");
const vbus = require('resol-vbus');
const _ = require('lodash');

//var i18n = new vbus.I18N('en');
const spec = vbus.Specification.getDefaultSpecification();

var ctx = {
    headerSet: null,
    hsc: null,
    connection: null,
};



class MyVbus extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'myvbus',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        const self = this;

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        this.log.info('Connection Type: ' + this.config.connectionType);
        this.log.info('Connection Identifier: ' + this.config.connectionIdentifier);
        this.log.info('VBus Password: ' + this.config.vbusPassword);
        this.log.info('VBus Interval: ' + this.config.vbusInterval);
        this.log.info('Force ReInit: ' + this.config.forceReInit);

        // in this vbus adapter all states changes inside the adapters namespace are subscribed
        this.subscribeStates('*');

           
    function initResol() {

        ctx.headerSet = new vbus.HeaderSet();
        var forceReInit = self.config.forceReInit;
        ctx.hsc = new vbus.HeaderSetConsolidator({
            interval: self.config.vbusInterval * 1000,
            timeToLive: (self.config.vbusInterval * 1000) + 1000,
        });
        if (self.config.connectionType == 'TCP') {
            const ipformat = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
            if (self.config.connectionIdentifier.match(ipformat)) {
                var ConnectionClass = vbus['TcpConnection'];
                ctx.connection = new ConnectionClass({
                   host: self.config.connectionIdentifier,
                   password: self.config.vbusPassword
                });
            } else { 
                self.log.warn('IP-address not valid. Should be xxx.xxx.xxx.xxx.');
            }
            
        } else if ( self.config.connectionType == 'Serial' ) {
            const serialformat = self.config.connectionIdentifier;
            if (self.config.connectionIdentifier.match(serialformat)) {
                var ConnectionClass = vbus['SerialConnection'];
                ctx.connection = new ConnectionClass({
                   path: self.config.connectionIdentifier,
                   //password: self.config.vbusPassword
                });
            } else { 
                self.log.warn('Serial port ID not valid. Should be like /dev/tty.usbserial or COM9');
            }
        }

        ctx.connection.on('packet', function (packet) {
            ctx.headerSet.removeAllHeaders();
            ctx.headerSet.addHeader(packet);
            ctx.hsc.addHeader(packet);

            if (forceReInit) {
                ctx.hsc.emit('headerSet', ctx.hsc);
            }
        });

        ctx.hsc.on('headerSet', function (headerSet) {
            var packetFields = spec.getPacketFieldsForHeaders(ctx.headerSet.getSortedHeaders());
            var data = _.map(packetFields, function (pf) {
                return {
                    id: pf.id,
                    name: pf.name,
                    value: pf.rawValue,
                    deviceName: pf.packetSpec.sourceDevice.fullName,
                    deviceId: pf.packetSpec.sourceDevice.deviceId,
                    addressId: pf.packetSpec.sourceDevice.selfAddress,
                    unit: pf.packetFieldSpec.type.unit.unitId,
                    typeId: pf.packetFieldSpec.type.typeId,
                    rootTypeId: pf.packetFieldSpec.type.rootTypeId
                };
            });

            _.each(data, function (item) {
                var deviceId = item.deviceId.replace(/_/g, '');
                var channelId = deviceId + '.' + item.addressId;
                var objectId = channelId + '.' + item.id.replace(/_/g, '');

                if (forceReInit) {
                    initDevice(deviceId, channelId, objectId, item);
                }
                self.setState(objectId, item.value, true);
            });

            if (forceReInit) {
                self.extendForeignObject('system.adapter.' + self.namespace, {
                    native: {
                        forceReInit: false
                    }
                });
                forceReInit = false;
            }
        });

        ctx.connection.connect();
        ctx.hsc.startTimer();
    }

    function initDevice(deviceId, channelId, objectId, item) {
        self.setObjectNotExists(deviceId, {
            type: 'device',
            common: {
                name: item.deviceName
            },
            native: {}
        });
        self.setObjectNotExists(channelId, {
            type: 'channel',
            common: {
                name: channelId
            },
            native: {}
        });

        var common = {
            name: item.name,
            type: 'number',
            write: false
        };
        switch (item.unit) {
            case 'DegreesCelsius':
                var name = 'Unknown';
                switch (item.name) {
                    case 'Temperature S1':
                        name = 'Kollektor';
                        break;
                    case 'Temperature S2':
                        name = 'Boiler';
                        break;
                    case 'Temperature S3':
                        name = 'Puffer';
                        break;
                };
                common.name = name;
                common.min = -100;
                common.max = +300;
                common.role = 'value.temperature';
                break;
            case 'Percent':
                common.min = 0;
                common.max = 100;
                common.role = 'value.volume';
                break;
            case 'Hours':
                break;
            case 'WattHours':
                break;
            case 'None':
                break;
            default:
                break;
        }

        self.setObjectNotExists(objectId, {
            type: 'state',
            common: common,
            native: {}
        });
    }
    initResol();
}

        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
        */
       /*
        await this.setObjectAsync('testVariable', {
            type: 'state',
            common: {
                name: 'testVariable',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: true,
            },
            native: {},
        });
        */
        // in this template all states changes inside the adapters namespace are subscribed
        

        /*
        setState examples
        you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        */
        // the variable testVariable is set to true as command (ack=false)
        await this.setStateAsync('testVariable', true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        await this.setStateAsync('testVariable', { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        await this.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });


    }

    /* *
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            ctx.connection.disconnect();
            this.log.info('cleaned everything up...');
            callback();
        } catch (e) {
            callback();
        }
    }

    /* *
     * Is called if a subscribed object changes
     * @param {string} id
     * @param {ioBroker.Object | null | undefined} obj
     */
    /*
     onObjectChange(id, obj) {
        if (obj) {
            // The object was changed
            this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            this.log.info(`object ${id} deleted`);
        }
    }
    */
    /* *
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    /*
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }
     */
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.message" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    // onMessage(obj) {
    // 	if (typeof obj === 'object' && obj.message) {
    // 		if (obj.command === 'send') {
    // 			// e.g. send email or pushover or whatever
    // 			this.log.info('send command');

    // 			// Send response in callback if required
    // 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
    // 		}
    // 	}
    // }

}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new MyVbus(options);
} else {
    // otherwise start the instance directly
    new MyVbus();
}