'use strict';

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const axios = require('axios').default;
const http  = require ('http');
const https = require ('https');
const { ConcurrencyManager } = require('axios-concurrency').default;

// Load your modules here, e.g.:
// const fs = require("fs");

class EleroOverMediola extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'elero-over-mediola',
		});

		this._pollTimeout = null;
		this._api = null;
		this._apiManager = null;


		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		// this.on('objectChange', this.onObjectChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {

		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		// this.config:
		this.log.info('gateway-IP: ' + this.config.hostIp);
		this.log.info('pollIntervall: ' + this.config.pollIntervall);

		//Initialize API Connection:
		const httpAgent = new http.Agent({ keepAlive: true });
		const httpsAgent = new https.Agent({ keepAlive: true });
		this._api = axios.create({
			baseURL: `http://${this.config.hostIp}`,
			httpAgent,
			httpsAgent,
		});
		this._apiManager = ConcurrencyManager(this._api, 1); //Max Paralell request in API

		//Create Poll-Timeout to request status of all devices regularly:
		this.statusPoll();

		// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
		this.subscribeStates('*.button.*');
		// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
		// this.subscribeStates('lights.*');
		// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
		// this.subscribeStates('*');

	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			if (this._pollTimeout) {
				this.clearTimeout(this._pollTimeout);
				this._pollTimeout = null;
			}

			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);

			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		const idNoNamespace = this.removeNamespace(id);
		if (state) {
			// The state was changed
			this.log.debug(`state ${idNoNamespace} changed: ${state.val} (ack = ${state.ack})`);
		} else {
			// The state was deleted
			this.log.debug(`state ${idNoNamespace} deleted`);
		}

		// No ack = changed by user
		if (id && state && !state.ack) {
			//determin Type and Button
			//state ER.01.button.up changed: true (ack = false)';
			const idArray = idNoNamespace.split('.');
			if (idArray.length == 4){
				switch (idArray[0]) {
					case 'ER':
						//"ELERO"
						this.handleEleroCommand(idNoNamespace,idArray[1],idArray[3]);
						break;
					default:
						this.log.error(`Unknown DeviveType onStateChanged ${idArray[0]}`);
						break;
				}
			}
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
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

	/**
	 * send Status Poll Message to Gateway and update all device States
	 * Register new Timeout for next poll Intervall
	 * Sets the connection states
	 */
	async statusPoll(){
		this.log.debug ('PollTimer Started');

		if (this._pollTimeout) {
			this.clearTimeout(this._pollTimeout);
			this._pollTimeout = null;
		}

		try {
			// request new Status from Gateway
			if(this._api != null){
				await this._api.get('/command?XC_FNC=RefreshSC');
				const res = await this._api.get('/command?XC_FNC=getStates');
				this.log.debug (`API Call Status: ${res.status}`);
				if (res.status == 200){
					//Api Call sucessful parse result:
					const api_res = await this.parseResponse (res.data);
					//receive array of all device and states => set states
					this.updateDeviceStates(api_res);
				}
				this.setState('info.connection',true,true);
			}
		} catch (error) {
			// Handle errors
			this.log.error(`Error in API-Call: ${error}`);
			this.setState('info.connection', false, true);
		}

		this._pollTimeout = this.setTimeout(() => {
			this.pollTimeout = null;
			this.statusPoll();
		}, this.config.pollIntervall * 1000); // Restart pollIntervall
	}
	/**
	 * Handle Elero Command
	 * @param {*} id StateID
	 * @param {*} adr DeviceAdress
	 * @param {*} command Command
	 */
	handleEleroCommand(id,adr,command){
		this.log.debug(`Handle Event "${command}"for Elero ${id}`);
		//SetCommandstate to false, acknowledged
		this.setStateAsync(id, { val: false, ack: true });
	}

	/**
	 * parse API response and read OKI code and the databody of the response
	 * @param {*} response Rest Response Message
	 * @returns Array[Object] with requested deive objects
	 */
	async parseResponse (response) {
		const statusRegExp = /({[A-Z,_]*})(.*)/;
		const [, status, message] = response.match(statusRegExp) || [];

		if (status === '{XC_SUC}') {
			if (message === '') {
				return null;
			}

			try {
				return JSON.parse(message);
			} catch (e) {
				throw new Error(`can't parse response message: "${message}"`);
			}
		}

		if (status === '{XC_ERR}') {
			throw new Error(message);
		}

		throw new Error(`can't handle response: "${response}"`);
	}

	/**
	 * Updates and creates IObroker States from a API Call return
	 * @param {*} deviceObjects DeviceObjects returned by API
	 */
	async updateDeviceStates(deviceObjects){
		this.log.debug(`update ${deviceObjects.length} devices`);
		deviceObjects.forEach(device => {
			this.log.debug(`processing device type:${device.type}, adress:${device.adr}, states:${device.state}`);
			//Create Type Folder
			let deviceName = '';

			switch (device.type) {
				case 'ER':
					deviceName = 'Elero';
					break;
				case 'EVENT':
					deviceName = 'Gateway Events';
					break;
				default:
					deviceName = `Mediola DeviceType: ${device.type}`;
					break;
			}

			this.setObjectNotExistsAsync(`${device.type}`, {
				type: 'folder',
				common: {
					name: device.type,
					desc: deviceName
				},
				native: {},
			});

			//Create device for each Adress
			this.setObjectNotExistsAsync(`${device.type}.${device.adr}`, {
				type: 'device',
				common: {
					name: device.adr
				},
				native: {},
			});

			//Create and set states for device type
			this.setObjectNotExistsAsync(`${device.type}.${device.adr}.type`, {
				type: 'state',
				common: {
					name: {
						en: 'Type',
						de: 'Art',
						ru: 'Тип',
						pt: 'Tipo',
						nl: 'Type',
						fr: 'Type',
						it: 'Tipo',
						es: 'Tipo',
						pl: 'Typ',
						uk: 'Тип',
						'zh-cn': '类型'
					},
					type: 'string',
					role: 'text',
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`${device.type}.${device.adr}.type`, { val: device.type , ack: true });

			//Create and set states for device status
			this.setObjectNotExistsAsync(`${device.type}.${device.adr}.adr`, {
				type: 'state',
				common: {
					name: {
						en: 'Adress',
						de: 'Device Adresse',
						ru: 'Адрес',
						pt: 'Endereço',
						nl: 'Adres',
						fr: 'Adress',
						it: 'Indirizzo',
						es: 'Dirección',
						pl: 'Address',
						uk: 'Кошик',
						'zh-cn': '处理'
					},
					type: 'string',
					role: 'text',
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`${device.type}.${device.adr}.adr`, { val: device.adr , ack: true });

			//Create and set states for device status
			this.setObjectNotExistsAsync(`${device.type}.${device.adr}.status`, {
				type: 'state',
				common: {
					name: {
						en: 'Status',
						de: 'Status',
						ru: 'статус',
						pt: 'status',
						nl: 'status',
						fr: 'état',
						it: 'stato',
						es: 'situación',
						pl: 'status',
						uk: 'статус',
						'zh-cn': '现状'
					},
					type: 'string',
					role: 'text',
					read: true,
					write: false,
				},
				native: {},
			});
			this.setStateAsync(`${device.type}.${device.adr}.status`, { val: device.state , ack: true });

			if (device.type == 'ER'){
				//Create Buttons for Elero Blind Control (UP):
				this.setObjectNotExistsAsync(`${device.type}.${device.adr}.button.up`, {
					type: 'state',
					common: {
						name: {
							en: 'open',
							de: 'geöffnet',
							ru: 'открыть',
							pt: 'aberto',
							nl: 'open',
							fr: 'ouvert',
							it: 'aperto',
							es: 'abierto',
							pl: 'otwarty',
							uk: 'увійти',
							'zh-cn': '开放'
						},
						type: 'boolean',
						role: 'button',
						read: false,
						write: true,
					},
					native: {},
				});
				//Create Buttons for Elero Blind Control (DOWN):
				this.setObjectNotExistsAsync(`${device.type}.${device.adr}.button.down`, {
					type: 'state',
					common: {
						name: {
							en: 'close',
							de: 'schliessen',
							ru: 'озакрыть',
							pt: 'perto',
							nl: 'close',
							fr: 'fenêtre de clôture',
							it: 'finestra di chiusura',
							es: 'ventana',
							pl: 'okulary',
							uk: 'закрите вікно',
							'zh-cn': '开放'
						},
						type: 'boolean',
						role: 'button',
						read: false,
						write: true,
					},
					native: {},
				});

				//Create Buttons for Elero Blind Control(STOP):
				this.setObjectNotExistsAsync(`${device.type}.${device.adr}.button.stop`, {
					type: 'state',
					common: {
						name: {
							en: 'stop',
							de: 'stopp',
							ru: 'остановиться',
							pt: 'pare',
							nl: 'stop',
							fr: 'stop',
							it: 'fermati',
							es: 'para',
							pl: 'przystanek',
							uk: 'увійти',
							'zh-cn': '停止'
						},
						type: 'boolean',
						role: 'button',
						read: false,
						write: true,
					},
					native: {},
				});

				//Create Buttons for Elero Blind Control(REFRESH):
				this.setObjectNotExistsAsync(`${device.type}.${device.adr}.button.refresh`, {
					type: 'state',
					common: {
						name: {
							en: 'refresh',
							de: 'frisch',
							ru: 'обновить',
							pt: 'refrescar',
							nl: 'verfrissing',
							fr: 'rafraîchissant',
							it: 'rinfrescare',
							es: 'refresco',
							pl: 'repackage',
							uk: 'головна',
							'zh-cn': '页: 1'
						},
						type: 'boolean',
						role: 'button',
						read: false,
						write: true,
					},
					native: {},
				});
			}
		});
	}

	/**
	 * Remove the Adadpter Namespace form an state_id
	 * @param {string} id
	 * @returns id without namespace
	 */
	removeNamespace(id) {
		const re = new RegExp(this.namespace + '*\\.', 'g');
		return id.replace(re, '');
	}

}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new EleroOverMediola(options);
} else {
	// otherwise start the instance directly
	new EleroOverMediola();
}