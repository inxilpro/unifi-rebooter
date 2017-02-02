#!/usr/bin/env node

const unifi = require('node-unifi');
const Listr = require('listr');

const argv = require('yargs')
    .usage('Usage: $0 -u <username> -p <password> [-h <host>] [-P <port>] [-s <site>]')
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
        title: 'Log in',
        task: (ctx, task) => new Promise((resolve, reject) => {
        	task.title = 'Logging in';
        	controller.login(username, password, err => {
        		if (err) {
        			return reject(err);
        		}
        		task.title = 'Logged in';
        		resolve();
        	});
        })
    }, {
        title: 'Load access points',
        task: (ctx, task) => new Promise((resolve, reject) => {
        	task.title = 'Loading access points';
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
        title: 'Reboot access points',
        task: (ctx, task) => {
        	task.title = 'Rebooting access points';

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
        					task.title = `${name} (It really doesn't help to stare...)`;
        				} else if (checks > 2) {
        					task.title = `${name} (This may take 1-2 minutes...)`;
        				}
        			}, 15000);
        		});
        	});

        	const tasks = ctx.accessPoints.map(ap => ({
        		title: ap.name,
        		task: (ctx, task) => reboot(ap.mac, ap.name, task)
        	}));

        	tasks.push({
        		title: '[Post-reboot clean up]',
        		task: () => {
        			task.title = `Rebooted ${ctx.accessPoints.length} access points`;
        		}
        	});

        	// FIXME:
        	const shortTasks = [tasks[0], tasks[tasks.length - 1]];
        	return new Listr(shortTasks);

        	return new Listr(tasks);
        }
    }
]);

// Run
tasks.run().catch(e => {
	console.error('Error:');
	console.error(e);
	process.exit(1);
});
