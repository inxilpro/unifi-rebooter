#!/usr/bin/env node

const unifi = require('node-unifi');
const Listr = require('listr');

const argv = require('yargs')
    .usage('Usage: $0 -h [host] -u [username] -p [password]')
    .alias('h', 'host')
    .default('h', '127.0.0.1')
    .alias('u', 'username')
    .alias('p', 'password')
    .alias('P', 'port')
    .default('P', 8443)
    .alias('s', 'site')
    .default('s', 'default')
    .demandOption(['u','p'])
    .argv;

const host = argv.host;
const port = argv.port;
const username = argv.username;
const password = argv.password;
const site = argv.site;

const log = [];
const controller = new unifi.Controller(host, port);
const tasks = new Listr([
	{
        title: 'Logging in',
        task: (ctx, task) => new Promise((resolve, reject) => {
        	controller.login(username, password, err => {
        		if (err) {
        			return reject(err);
        		}
        		task.title = 'Logged in';
        		resolve();
        	});
        })
    }, {
        title: 'Loading access points',
        task: (ctx, task) => new Promise((resolve, reject) => {
        	controller.getAccessDevices(site, (err, devices) => {
        		if (err) {
        			return reject(err);
        		}
        		ctx.accessPoints = devices[0];
        		task.title = `${devices[0].length} access point(s) discovered`;
        		resolve();
        	});
        })
    }, {
        title: 'Rebooting access points',
        task: (ctx, task) => {
        	const getStatus = () => new Promise(resolve => {
        		controller.getAccessDevices(site, (err, devices) => {
	        		if (err) {
	        			return reject(err);
	        		}
	        		
	        		resolve(devices[0].reduce((list, device) => {
	        			list[device.mac] = device;
	        			return list;
	        		}, {}));
	        	});
        	});

        	const reboot = (mac, name, task) => new Promise((resolve, reject) => {
        		controller.rebootAccessPoint(site, mac, (err) => {
        			if (err) {
        				return reject(err);
        			}

        			let checks = 0;
        			const waiting = setInterval(() => {
        				getStatus().then(status => {
        					if (status[mac] && 1 === parseInt(status[mac].state)) {
        						clearInterval(waiting);
        						task.title = name;
        						resolve();
        					}
        				});

        				checks++;
        				if (checks > 4) {
        					task.title = 'It really does\'t help to stare...';
        				} else if (checks > 2) {
        					task.title = 'This may take 1-2 minutes...';
        				}
        			}, 15000);
        		});
        	});

        	return new Listr(ctx.accessPoints.map(ap => ({
        		title: ap.name,
        		task: (ctx, task) => reboot(ap.mac, ap.name, task)
        	})));
        }
    }
]);

// Run
tasks.run().then(() => {
	console.log('Done');
	process.exit(0);
}).catch(e => {
	console.error(e);
	process.exit(1);
});