import { toCapitalize } from './text.js';

/**
 * @param {string} chatId
 * @param {Buffer | string} media
 * @param {Object} options
 * @param {string} options.parse_mode
 * @param {string} options.caption
 * @param {'text' | 'photo' | 'video' | 'audio' | 'document' | 'sticker' | 'voice'} options.type
 * @returns {Promise<Response>}
 */
export async function send(chatId, media = '', options = {}) {
	const type = options.type.replace('image', 'photo').replace('audio', 'voice');

	const DEFAULT_EXTENSIONS = {
		audio: ['audio/mp3', 'mp3'],
		photo: ['image/jpeg', 'jpg'],
		sticker: ['image/webp', 'webp'],
		video: ['video/mp4', 'mp4'],
		document: ['application/pdf', 'pdf'],
		voice: ['audio/ogg', 'ogg'],
		text: ['text/plain', 'txt'],
	};

	const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/send${
		type === 'text' ? 'Message' : toCapitalize(type)
	}`;
	const form = new FormData();

	form.append('chat_id', chatId);
	if (options.parse_mode) form.append('parse_mode', options.parse_mode);
	
	if (type === 'text') {
		form.append(type, media || options.caption);
	} else {
		if (Buffer.isBuffer(media)) {
			form.append(type, new Blob([media], { type: DEFAULT_EXTENSIONS[type][0] }), `file.${DEFAULT_EXTENSIONS[type][1]}`);
		} else {
			throw new Error('Invalid media input: must be a Buffer or a valid file path');
		}

		if (options.caption) form.append('caption', options.caption);
	}

	// ✅ FIX: Tambah timeout & hapus Content-Type manual
	const res = await fetch(url, {
		method: 'POST',
		body: form,
		headers: {
			Accept: 'application/json',
			// JANGAN set Content-Type, biarkan fetch() handle otomatis dengan boundary
		},
		signal: AbortSignal.timeout(30000), // 30 detik timeout (default 10s terlalu singkat)
	});

	if (!res.ok) {
		const errorText = await res.text();
		throw new Error(`Telegram API error: ${res.status} - ${errorText}`);
	}

	const data = await res.json();
	return data;
}