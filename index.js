#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const unifi = require('node-unifi');
const Listr = require('listr');

const argv = require('yargs')
	.usage('Usage: $0 -u [username] -p [password]')
	.epilogue("You can set UNIFI_* environmental variables if you\'d like (e.g. UNIFI_USER will set the -u option) and a .env file is supported.")
	.env('UNIFI')
	.alias('h', 'host')
	.describe('h', 'Unifi controller hostname')
	.default('h', '127.0.0.1')
	.alias('u', 'username')
	.describe('u', 'Username with admin access to site')
	.alias('p', 'password')
	.describe('p', 'Password for admin user')
	.alias('P', 'port')
	.describe('P', 'Unifi controller port')
	.default('P', 8443)
	.alias('s', 'site')
	.default('s', 'default')
	.describe('s', 'Unifi site to load (if controller manages multiple sites)')
	.boolean('dry-run')
	.describe('dry-run', 'Don\'t actually reboot anything—just show what would be rebooted')
	.alias('t', 'types')
	.default('t', 'uap') // uap = access point, ugw = security gateway, usw = switch
	.array('types')
	.describe('t', 'List of device types to reboot')
	.boolean('access-points')
	.describe('access-points', 'Reboot APs')
	.boolean('security-gateways')
	.describe('security-gateways', 'Reboot security gateways')
	.boolean('switches')
	.describe('switches', 'Reboot switches')
	.demandOption(['u', 'p'])
	.argv;

const {host, port, username, password, site, dryRun, log} = argv;
let { types, accessPoints, securityGateways, switches } = argv;

// Handle device type configuration
if (1 === types.length && -1 !== types[0].indexOf(' ')) {
	types = types[0].split(' ');
}

if (accessPoints) {
	types.push('uap');
}
if (securityGateways) {
	types.push('ugw');
}
if (switches) {
	types.push('usw');
}

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
		title: 'Load device list',
		task: (ctx, task) => new Promise((resolve, reject) => {
			task.title = 'Loading device list';
			controller.getAccessDevices(site, (err, devices) => {
				if (err) {
					return reject(err);
				}

				ctx.devices = devices[0].filter(device => -1 !== types.indexOf(device.type));
				task.title = `${ctx.devices.length} device${1 === ctx.devices.length ? '' : 's'} discovered`;
				resolve();
			});
		})
	}, {
		title: 'Reboot devices',
		task: (ctx, task) => {
			task.title = 'Rebooting devices';

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
				if (dryRun) {
					task.title = `Simulating a reboot of "${name}" (dry run mode)`;
					setTimeout(resolve, 1000);
					return;
				}

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
							task.title = `Rebooting "${name}" (It really doesn't help to stare…)`;
						} else if (checks > 2) {
							task.title = `Rebooting "${name}" (This may take 1-2 minutes…)`;
						}
					}, 15000);
				});
			});

			const tasks = ctx.devices.map(ap => ({
				title: `Reboot "${ap.name}"`,
				task: (ctx, task) => reboot(ap.mac, ap.name, task)
			}));

			tasks.push({
				title: 'Post-reboot clean up…',
				task: () => {
					task.title = `Rebooted ${ctx.devices.length} device${1 === ctx.devices.length ? '' : 's'}`;
				}
			});

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
