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
const { MediolaApiManager } = require('./mediola/mediolaapimanager.js').MediolaApiManager;


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
		this._apiManager = MediolaApiManager(this._api, 1); //Max Paralell request in API

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
				if (this.config.refreshER) {
					await this._api.get('/command?XC_FNC=RefreshER');
				}
				await this.updateStates();
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
	 * set GetStates to API and update ioBrokerstates
	 */
	async updateStates(){
		if(this._api != null){
			const res = await this._api.get('/command?XC_FNC=getStates', );
			this.log.debug (`API GetStates Call Status: ${res.status}`);
			if (res.status == 200){
				//Api Call sucessful parse result:
				const api_res = await this.parseResponse (res.data);
				//receive array of all device and states => set states
				this.updateDeviceStates(api_res);
			}else{
				this.log.warn(`unexpected API Returncode getStates: ${res.status} ${res.statusText}`);
			}
		}
	}

	/**
	 * Handle Elero Command
	 * @param {*} id StateID
	 * @param {*} adr DeviceAdress
	 * @param {*} command Command
	 */
	async handleEleroCommand(id,adr,command){
		this.log.debug(`Handle Event "${command}"for Elero ${id}`);
		//Set CommandCode for Action
		let commandCode = '##';
		switch (command) {
			case 'up':
				commandCode = '01';
				break;
			case 'down':
				commandCode = '00';
				break;
			case 'stop':
				commandCode = '02';
				break;
			default:
				this.log.warn (`cannot determin command code: ${id}`);
				break;
		}
		if (commandCode != '##' && this._api != null) {
			//Send ApiCall
			const api_command = `/command?XC_FNC=sendSC&type=ER&data=${adr}${commandCode}`;
			this.log.debug(`SendCommand: ${api_command}`);
			const res = await this._api.get(api_command);
			this.log.debug (`API SendCommand Call Status: ${res.status}`);
			if (res.status == 200){
				//UpdateStatus for this device:
				this.updateStates();
				//Api Call sucessful parse result:
				//const api_res = await this.parseResponse (res.data);
				//receive array of all device and states => set states
				//this.updateDeviceStates(api_res);
			}else{
				this.log.warn(`unexpected API Returncode getStates: ${res.status} ${res.statusText}`);
			}
		}
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
						ru: '??????',
						pt: 'Tipo',
						nl: 'Type',
						fr: 'Type',
						it: 'Tipo',
						es: 'Tipo',
						pl: 'Typ',
						uk: '??????',
						'zh-cn': '??????'
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
						ru: '??????????',
						pt: 'Endere??o',
						nl: 'Adres',
						fr: 'Adress',
						it: 'Indirizzo',
						es: 'Direcci??n',
						pl: 'Address',
						uk: '??????????',
						'zh-cn': '??????'
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
						ru: '????????????',
						pt: 'status',
						nl: 'status',
						fr: '??tat',
						it: 'stato',
						es: 'situaci??n',
						pl: 'status',
						uk: '????????????',
						'zh-cn': '??????'
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
				this.setObjectNotExistsAsync(`${device.type}.${device.adr}.button`, {
					type: 'channel',
					common: {
						name: {
							en: 'control',
							de: 'Steuerung',
							ru: '????????????????',
							pt: 'controles',
							nl: 'control',
							fr: 'commandes',
							it: 'controlli',
							es: 'controles',
							pl: 'kontrola',
							uk: '????????????????',
							'zh-cn': '??????'
						},
						role:  'blind'
					},
					native: {},
				});
				//Create Buttons for Elero Blind Control (UP):
				this.setObjectNotExistsAsync(`${device.type}.${device.adr}.button.up`, {
					type: 'state',
					common: {
						name: {
							en: 'open',
							de: 'ge??ffnet',
							ru: '??????????????',
							pt: 'aberto',
							nl: 'open',
							fr: 'ouvert',
							it: 'aperto',
							es: 'abierto',
							pl: 'otwarty',
							uk: '????????????',
							'zh-cn': '??????'
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
							ru: '????????????????',
							pt: 'perto',
							nl: 'close',
							fr: 'fen??tre de cl??ture',
							it: 'finestra di chiusura',
							es: 'ventana',
							pl: 'okulary',
							uk: '?????????????? ??????????',
							'zh-cn': '??????'
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
							ru: '????????????????????????',
							pt: 'pare',
							nl: 'stop',
							fr: 'stop',
							it: 'fermati',
							es: 'para',
							pl: 'przystanek',
							uk: '????????????',
							'zh-cn': '??????'
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
							ru: '????????????????',
							pt: 'refrescar',
							nl: 'verfrissing',
							fr: 'rafra??chissant',
							it: 'rinfrescare',
							es: 'refresco',
							pl: 'repackage',
							uk: '??????????????',
							'zh-cn': '???: 1'
						},
						type: 'boolean',
						role: 'button',
						read: false,
						write: true,
					},
					native: {},
				});

				if (this.config.createHomekitStates) {
					//Create HomekistStates for Device
					//Channel Homekist Control:
					this.setObjectNotExistsAsync(`${device.type}.${device.adr}.homekit`, {
						type: 'channel',
						common: {
							name: {
								en: 'homekit controls',
								de: 'homekit control',
								ru: 'homekit ????????????????????',
								pt: 'controles do homekit',
								nl: 'hemeltje controleert',
								fr: 'commandes homekit',
								it: 'homekit controlli',
								es: 'controles de casetas',
								pl: 'kontrola homeki',
								uk: '???????????????????? ????????????????',
								'zh-cn': '????????????'
							},
							role:  'blind'
						},
						native: {},
					});

					/* The corresponding value is an integer percentage. A value of 0 indicates a door or window should be fully closed, or that awnings or shades should permit the least possible light. A value of 100 indicates the opposite. */
					// TARGET Position
					this.setObjectNotExistsAsync(`${device.type}.${device.adr}.homekit.target_position`, {
						type: 'state',
						common: {
							name: {
								en: 'target position',
								de: 'zielposition',
								ru: '?????????????? ??????????????',
								pt: 'posi????o do alvo',
								nl: 'doelwit',
								fr: 'position cible',
								it: 'posizione target',
								es: 'de destino',
								pl: 'pozycja docelowa',
								uk: '?????????????? ??????????????',
								'zh-cn': '??????'
							},
							type: 'number',
							min: 0,
							max: 100,
							unit:  '%',
							step:100,
							desc: {
								en: '0 = closed, 100 = open',
								de: '0 = geschlossen, 100 = offen',
								ru: '0 = ??????????????, 100 = ??????????????',
								pt: '0 = fechado, 100 = aberto',
								nl: 'quality over quantity (qoq) releases vertaling:',
								fr: '0 = ferm??, 100 = ouvert',
								it: '0 = chiuso, 100 = aperto',
								es: '0 = cerrado, 100 = abierto',
								pl: '0 = zamkni??te, 100 = otwarte',
								uk: '0 = ????????????????, 100 = ????????????????',
								'zh-cn': '???:1'
							},
							role:  'level.blind',
							read: true,
							write: true,
						},
						native: {},
					});
					//CURRENT_POSITION
					/* The corresponding value is an integer percentage. A value of 0 indicates a door or window should be fully closed, or that awnings or shades should permit the least possible light. A value of 100 indicates the opposite. */
					this.setObjectNotExistsAsync(`${device.type}.${device.adr}.homekit.current_position`, {
						type: 'state',
						common: {
							name: {
								en: 'current position',
								de: 'aktuelle position',
								ru: '?????????????? ??????????????????',
								pt: 'posi????o atual',
								nl: 'huidige positie',
								fr: 'position actuelle',
								it: 'posizione corrente',
								es: 'posici??n actual',
								pl: 'pozycja',
								uk: '?????????????? ??????????????',
								'zh-cn': '????????????'
							},
							type: 'number',
							min: 0,
							max: 100,
							unit:  '%',
							desc: {
								en: '0 = closed, 100 = open',
								de: '0 = geschlossen, 100 = offen',
								ru: '0 = ??????????????, 100 = ??????????????',
								pt: '0 = fechado, 100 = aberto',
								nl: 'quality over quantity (qoq) releases vertaling:',
								fr: '0 = ferm??, 100 = ouvert',
								it: '0 = chiuso, 100 = aperto',
								es: '0 = cerrado, 100 = abierto',
								pl: '0 = zamkni??te, 100 = otwarte',
								uk: '0 = ????????????????, 100 = ????????????????',
								'zh-cn': '???:1'
							},
							role:  'level.blind',
							read: true,
							write: false,
						},
						native: {},
					});
					//POSITION STATE
					//CURRENT_POSITION
					/* closing = 0, opening = 1 stopped = 2*/
					this.setObjectNotExistsAsync(`${device.type}.${device.adr}.homekit.position_state`, {
						type: 'state',
						common: {
							name: {
								en: 'moving state',
								de: 'bewegungszustand',
								ru: '???????????????? ??????????????????????',
								pt: 'estado em movimento',
								nl: 'bewegende staat',
								fr: '??tat mobile',
								it: 'stato in movimento',
								es: 'estado en movimiento',
								pl: 'stan transportu',
								uk: '?????????????? ????????',
								'zh-cn': '???'
							},
							type: 'number',
							min: 0,
							max: 2,
							states: {
								0: 'closing',
								1: 'opening',
								2:'stopped'
							},
							role:  'value.window',
							read: true,
							write: false,
						},
						native: {},
					});
				}
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