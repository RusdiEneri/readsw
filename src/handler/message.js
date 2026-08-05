'use strict';

import { isJidGroup } from 'baileys';
import { exec } from 'child_process';
import util from 'util';
import { Jimp } from 'jimp';

import { msToTime } from '../helper/utils.js';


/**
 * @param {import('baileys').BaileysEventMap['messages.upsert'] & { message: import('baileys').WAMessage }} message
 * @param {import('../../index').WASocketExtra} hisoka
 */
export default async function ({ message, type: messagesType }, hisoka) {
	try {
		const { injectMessage } = await import('../helper/inject.js?v=' + Date.now());

		/**
		 * @type {import('../../index').WAMessageExtra}
		 */
		const m = await injectMessage(hisoka, message);

		// Check if the message is empty or malformed
		if (!m || !m.message) {
			console.warn('\x1b[33mReceived an empty message. Skipping...\x1b[39m\n', m);
			return;
		}

		/** Listen Event */
		const { default: listenEvent } = await import('./event.js?v=' + Date.now());
		await listenEvent(m, hisoka);
		/** End Listen Event */

		const quoted = m.isMedia ? m : m.isQuoted ? m.quoted : m;

		const text = m.text;
		const query = m.query || quoted.query;

		if (!m.message) return;
		if (!m.key) return;
		if (m.isBot) return;

		/* Command Handling */
		if (messagesType === 'append') return;
		if (m.age > 60 * 10) return;
		if (!m.isOwner) return;

		switch (m.command) {
			case 'setppbot': {
				// Hanya owner yang bisa pakai command ini
				if (!m.isOwner && !m.key.fromMe) {
					await m.reply('❌ Command ini hanya untuk owner!');
					return;
				}

				// Tentukan sumber media: bisa dari message langsung (kirim gambar + caption)
				// atau dari quoted message (reply gambar)
				const mediaSource = m.isMedia ? m : m.isQuoted ? m.quoted : null;

				// Validasi: harus ada media
				if (!mediaSource || !mediaSource.isMedia) {
					await m.reply(`📸 Kirim atau reply image dengan caption *${m.prefix}${m.command}*`);
					return;
				}

				// Ambil mimetype dari content message
				const mime = mediaSource.content?.mimetype || '';

				// Validasi: harus image
				if (!/image/.test(mime)) {
					await m.reply(`📸 Kirim/reply image dengan caption *${m.prefix}${m.command}*`);
					return;
				}

				// Validasi: webp (sticker) tidak didukung
				if (/webp/.test(mime)) {
					await m.reply('❌ Sticker tidak didukung, gunakan format JPG/PNG');
					return;
				}

				await m.reply('⏳ Mengubah profile picture...');

				try {
					// Download media
					const botNumber = hisoka.user?.id || hisoka.user?.jid;
					const buffer = await mediaSource.downloadMedia();

					// Resize width ke 640px, keep aspect ratio (PP panjang tanpa crop square)
					// Compress JPEG quality 50 sesuai standar WhatsApp
					// const image = await Jimp.read(buffer);
					// const resized = image.resize({ w: 640 });
					// const img = await resized.getBuffer('image/jpeg', { quality: 50 });

					// Pakai raw query supaya PP tidak di-crop ke square
					// PENTING: to harus '@s.whatsapp.net', bukan botNumber
					// await hisoka.query({
					// 	tag: 'iq',
					// 	attrs: {
					// 		to: '@s.whatsapp.net',
					// 		type: 'set',
					// 		xmlns: 'w:profile:picture',
					// 	},
					// 	content: [
					// 		{
					// 			tag: 'picture',
					// 			attrs: { type: 'image' },
					// 			content: img,
					// 		},
					// 	],
					// });
					await hisoka.updateProfilePicture(botNumber, buffer)
					await m.reply('✅ Profile picture berhasil diubah!');
				} catch (error) {
					console.error('Error setting profile picture:', error);
					await m.reply(`❌ Gagal mengubah profile picture: ${error.message}`);
				}
				break;
			}

			case 'hidetag':
			case 'ht':
			case 'everyone':
			case 'all':
				{
					if (!m.isGroup) {
						await m.reply('Command ini hanya bisa dipakai di group!');
						return;
					}

					const group = hisoka.groups.read(m.from);
					const participants = group.participants
						.map(v => v.phoneNumber || v.id)
						.filter(v => v && typeof v === 'string');

					const msg = await hisoka.messageModify(m.from, /text|conversation/i.test(m.type) && query ? m : quoted, {
						quoted: undefined,
						text: `@${m.from}\n\n${query || ''}`.trim(),
						mentions: participants,
					});

					await hisoka.relayMessage(m.from, msg.message);
				}
				break;

			case 'q':
			case 'quoted':
				{
					if (!m.isQuoted) {
						await m.reply('No quoted message found.');
						return;
					}

					const cachedMsg = hisoka.cacheMsg.get(m.quoted.key.id);
					if (!cachedMsg) {
						await m.reply('Quoted message not found in cache.');
						return;
					}

					await m.reply({ forward: m.quoted });
				}
				break;

			case 'p':
			case 'ping':
				{
					const msg = await m.reply('Pong!');
					const latency = Math.abs(Date.now() - m.messageTimestamp * 1000);
					const uptime = process.uptime();
					await m.reply({
						edit: msg.key,
						text: `Pong! Latency: ${latency}ms\nUptime: ${msToTime(uptime * 1000)}`,
					});
				}
				break;

			case '>':
			case 'eval':
				{
					let result;
					try {
						const code = query || text;
						result = /await/i.test(code) 
							? await eval('(async() => { ' + code + ' })()') 
							: await eval(code);
					} catch (error) {
						result = `Error: ${error.message}`;
					}

					const output = util.format(result);
					if (output.length > 4000) {
						await m.reply(output.substring(0, 4000) + '\n\n... (output truncated)');
					} else {
						await m.reply(output);
					}
				}
				break;

			case '$':
			case 'exec':
			case 'bash':
				{
					if (!query) {
						await m.reply('Usage: $ <command>\nExample: $ ls -la');
						return;
					}

					const startTime = Date.now();
					exec(query, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
						const duration = Date.now() - startTime;
						
						if (error) {
							if (error.killed) {
								return m.reply('⏱️ Command timeout (30s limit)');
							}
							return m.reply(`Error: ${error.message}`);
						}
						
						if (stderr) {
							return m.reply(`⚠️ Stderr:\n${stderr.substring(0, 3000)}`);
						}
						
						if (stdout) {
							const output = stdout.length > 3500 
								? stdout.substring(0, 3500) + '\n\n... (output truncated)' 
								: stdout;
							return m.reply(`✅ Executed in ${duration}ms\n\n${output}`);
						}
						
						return m.reply(`✅ Command executed successfully in ${duration}ms (no output)`);
					});
				}
				break;

			case 'groups':
			case 'group':
			case 'listgroups':
			case 'listgroup':
				{
					const groups = Object.values(await hisoka.groupFetchAllParticipating());
					
					groups.forEach(g => hisoka.groups.write(g.id, g));

					let text = `*Total ${groups.length} groups*\n`;
					
					const totalParticipants = groups.reduce(
						(a, b) => a + b.participants.length,
						0
					);
					text += `\n*Total Participants in all groups:* ${totalParticipants}\n\n`;
					
					groups
						.filter(group => isJidGroup(group.id))
						.forEach((group, i) => {
							text += `${i + 1}. *${group.subject}* - ${group.participants.length} participants\n`;
						});

					await m.reply(text.trim());
				}
				break;

			case 'contacts':
			case 'contact':
			case 'listcontacts':
			case 'listcontact':
				{
					const contactsArray = hisoka.contacts instanceof Map 
						? Array.from(hisoka.contacts.values())
						: Object.values(hisoka.contacts);
					
					const contacts = contactsArray.filter(c => c && c.id);
					
					let text = '*Total:*\n\n';
					text += `- All Contacts: ${contacts.length}\n`;
					text += `- Saved Contacts: ${contacts.filter(v => v.isContact).length}\n`;
					text += `- Not Saved Contacts: ${contacts.filter(v => !v.isContact).length}\n`;
					await m.reply(text.trim());
				}
				break;

			default:
			// Handle other commands or messages
		}
	} catch (error) {
		console.error(`\x1b[31mError in message handler:\x1b[39m\n`, error);
	}
}