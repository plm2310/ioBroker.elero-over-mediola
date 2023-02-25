// @ts-nocheck
const MediolaApiManager = (axios, MAX_CONCURRENT = 10) => {
	if (MAX_CONCURRENT < 1)
		throw 'Mediola API Manager Error: minimun concurrent requests is 1';
	const instance = {
		queue: [],
		prioqueue: [],
		running: [],
		shiftInitial: () => {
			setTimeout(() => {
				if (instance.running.length < MAX_CONCURRENT) {
					instance.shift();
				}
			}, 0);
		},
		push: reqHandler => {
			instance.queue.push(reqHandler);
			instance.shiftInitial();
		},
		priopush: reqHandler => {
			instance.prioqueue.push(reqHandler);
			instance.shiftInitial();
		},
		shift: () => {
			if (instance.queue.length || instance.prioqueue.length) {
				let queued = null;
				if (instance.prioqueue.length){
					queued = instance.prioqueue.shift();
				}else{
					queued = instance.queue.shift();
				}
				queued.resolver(queued.request);
				instance.running.push(queued);
			}
		},
		// Use as interceptor. Queue outgoing requests
		requestHandler: req => {
			return new Promise(resolve => {
				if (req.url.indexOf('sendSC') >=0 ){
					instance.priopush({ request: req, resolver: resolve });
				}else{
					instance.push({ request: req, resolver: resolve });
				}
			});
		},
		// Use as interceptor. Execute queued request upon receiving a response
		responseHandler: res => {
			instance.running.shift();
			instance.shift();
			return res;
		},
		responseErrorHandler: res => {
			return Promise.reject(instance.responseHandler(res));
		},
		interceptors: {
			request: null,
			response: null
		},
		detach: () => {
			axios.interceptors.request.eject(instance.interceptors.request);
			axios.interceptors.response.eject(instance.interceptors.response);
		}
	};
	// queue concurrent requests
	instance.interceptors.request = axios.interceptors.request.use(
		instance.requestHandler
	);
	instance.interceptors.response = axios.interceptors.response.use(
		instance.responseHandler,
		instance.responseErrorHandler,
	);
	return instance;
};

module.exports.MediolaApiManager = {
	MediolaApiManager
};