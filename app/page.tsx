"use client";

import JSZip from "jszip";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

type ConversionItem = {
	name: string;
	status: "ready" | "working" | "done" | "error";
	detail?: string;
};

const ACCEPTED_TYPES = [
	"image/png",
	"image/jpeg",
	"image/jpg",
	"image/svg+xml",
];

const DEFAULT_SVG_SIZE = 256;

const isAcceptedFile = (file: File) => {
	if (ACCEPTED_TYPES.includes(file.type)) {
		return true;
	}
	const extension = file.name.toLowerCase().split(".").pop() || "";
	return ["png", "jpg", "jpeg", "svg"].includes(extension);
};

const parseSvgSize = (svgText: string) => {
	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(svgText, "image/svg+xml");
		const svg = doc.querySelector("svg");
		if (!svg) {
			return { width: DEFAULT_SVG_SIZE, height: DEFAULT_SVG_SIZE };
		}

		const widthAttr = svg.getAttribute("width") || "";
		const heightAttr = svg.getAttribute("height") || "";
		const width = parseFloat(widthAttr);
		const height = parseFloat(heightAttr);

		if (Number.isFinite(width) && Number.isFinite(height)) {
			return { width, height };
		}

		const viewBox = svg.getAttribute("viewBox");
		if (viewBox) {
			const parts = viewBox.split(/\s+/).map((value) => parseFloat(value));
			if (
				parts.length === 4 &&
				parts.every((value) => Number.isFinite(value))
			) {
				return { width: parts[2], height: parts[3] };
			}
		}

		return { width: DEFAULT_SVG_SIZE, height: DEFAULT_SVG_SIZE };
	} catch {
		return { width: DEFAULT_SVG_SIZE, height: DEFAULT_SVG_SIZE };
	}
};

const canvasToBlob = (
	canvas: HTMLCanvasElement,
	type: string,
	quality?: number,
) =>
	new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) {
					resolve(blob);
				} else {
					reject(new Error("Canvas export failed"));
				}
			},
			type,
			quality,
		);
	});

const buildIcoBlob = (pngData: ArrayBuffer, size: number) => {
	const headerSize = 6 + 16;
	const totalSize = headerSize + pngData.byteLength;
	const buffer = new ArrayBuffer(totalSize);
	const view = new DataView(buffer);
	let offset = 0;

	view.setUint16(offset, 0, true);
	offset += 2;
	view.setUint16(offset, 1, true);
	offset += 2;
	view.setUint16(offset, 1, true);
	offset += 2;

	const iconSize = size >= 256 ? 0 : size;
	view.setUint8(offset, iconSize);
	offset += 1;
	view.setUint8(offset, iconSize);
	offset += 1;
	view.setUint8(offset, 0);
	offset += 1;
	view.setUint8(offset, 0);
	offset += 1;
	view.setUint16(offset, 1, true);
	offset += 2;
	view.setUint16(offset, 32, true);
	offset += 2;
	view.setUint32(offset, pngData.byteLength, true);
	offset += 4;
	view.setUint32(offset, headerSize, true);

	new Uint8Array(buffer, headerSize).set(new Uint8Array(pngData));
	return new Blob([buffer], { type: "image/x-icon" });
};

const downloadBlob = (blob: Blob, filename: string) => {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
};

const getBaseName = (filename: string) => {
	const parts = filename.split(".");
	if (parts.length === 1) {
		return filename;
	}
	parts.pop();
	return parts.join(".");
};

const loadImageFromFile = async (file: File) => {
	const isSvg =
		file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
	let svgSize = { width: 0, height: 0 };
	let objectUrl = URL.createObjectURL(file);

	if (isSvg) {
		const svgText = await file.text();
		svgSize = parseSvgSize(svgText);
		const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
		objectUrl = URL.createObjectURL(svgBlob);
	}

	const img = new Image();
	img.decoding = "async";
	img.src = objectUrl;

	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error("Image load failed"));
	});

	const width = svgSize.width || img.naturalWidth || DEFAULT_SVG_SIZE;
	const height = svgSize.height || img.naturalHeight || DEFAULT_SVG_SIZE;

	return {
		img,
		width,
		height,
		revoke: () => URL.revokeObjectURL(objectUrl),
	};
};

export default function Home() {
	const [items, setItems] = useState<ConversionItem[]>([]);
	const [files, setFiles] = useState<File[]>([]);
	const [busy, setBusy] = useState(false);
	const [dragActive, setDragActive] = useState(false);
	const [quality, setQuality] = useState(0.82);
	const [iconSize, setIconSize] = useState(256);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const summary = useMemo(() => {
		const total = items.length;
		const done = items.filter((item) => item.status === "done").length;
		const errors = items.filter((item) => item.status === "error").length;
		return { total, done, errors };
	}, [items]);

	const syncItems = (nextFiles: File[]) => {
		setItems(
			nextFiles.map((file) => ({
				name: file.name,
				status: "ready",
			})),
		);
	};

	const handleFiles = useCallback((incoming: File[]) => {
		const filtered = incoming.filter((file) => isAcceptedFile(file));
		setFiles(filtered);
		syncItems(filtered);
	}, []);

	const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
		const selected = Array.from(event.target.files ?? []);
		handleFiles(selected);
	};

	const onDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		setDragActive(false);
		const dropped = Array.from(event.dataTransfer.files || []);
		handleFiles(dropped);
	};

	const updateItem = (name: string, patch: Partial<ConversionItem>) => {
		setItems((prev) =>
			prev.map((item) => (item.name === name ? { ...item, ...patch } : item)),
		);
	};

	const convertAll = async (mode: "webp" | "ico") => {
		if (!files.length || busy) {
			return;
		}

		setBusy(true);
		const zip = new JSZip();

		try {
			const isSingle = files.length === 1;

			for (const file of files) {
				updateItem(file.name, { status: "working", detail: undefined });
				let revoke = () => {};
				try {
					const loaded = await loadImageFromFile(file);
					revoke = loaded.revoke;
					const { img, width, height } = loaded;
					const canvas = document.createElement("canvas");
					const ctx = canvas.getContext("2d");
					if (!ctx) {
						throw new Error("Canvas unavailable");
					}

					const baseName = getBaseName(file.name);

					if (mode === "webp") {
						canvas.width = width;
						canvas.height = height;
						ctx.clearRect(0, 0, width, height);
						ctx.drawImage(img, 0, 0, width, height);
						const webpBlob = await canvasToBlob(canvas, "image/webp", quality);
						if (isSingle) {
							downloadBlob(webpBlob, `${baseName}.webp`);
						} else {
							zip.file(`${baseName}.webp`, webpBlob);
						}
					} else {
						canvas.width = iconSize;
						canvas.height = iconSize;
						ctx.clearRect(0, 0, iconSize, iconSize);
						ctx.drawImage(img, 0, 0, iconSize, iconSize);
						const pngBlob = await canvasToBlob(canvas, "image/png");
						const pngBuffer = await pngBlob.arrayBuffer();
						const icoBlob = buildIcoBlob(pngBuffer, iconSize);
						if (isSingle) {
							downloadBlob(icoBlob, `${baseName}.ico`);
						} else {
							zip.file(`${baseName}.ico`, icoBlob);
						}
					}

					updateItem(file.name, { status: "done" });
				} catch (error) {
					const message = error instanceof Error ? error.message : "Failed";
					updateItem(file.name, { status: "error", detail: message });
				} finally {
					revoke();
				}
			}

			if (files.length > 1) {
				const zipBlob = await zip.generateAsync({ type: "blob" });
				const zipName =
					mode === "webp" ? "webp-conversions.zip" : "ico-icons.zip";
				downloadBlob(zipBlob, zipName);
			}
		} finally {
			setBusy(false);
		}
	};

	const clearAll = () => {
		setFiles([]);
		setItems([]);
		if (inputRef.current) {
			inputRef.current.value = "";
		}
	};

	return (
		<main className='mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-16 text-slate-900'>
			<header className='space-y-3'>
				<p className='text-sm uppercase tracking-[0.3em] text-slate-500'>
					The Canvas Bridge
				</p>
				<h1 className='text-4xl font-semibold tracking-tight'>
					Convert images to WebP or ICO in one drop.
				</h1>
				<p className='max-w-2xl text-base text-slate-600'>
					Drag multiple PNG, JPG, or SVG files, choose your output, and download
					a single ZIP. Everything runs in your browser.
				</p>
			</header>

			<section
				onDragOver={(event) => {
					event.preventDefault();
					setDragActive(true);
				}}
				onDragLeave={() => setDragActive(false)}
				onDrop={onDrop}
				className={`mt-10 rounded-3xl border border-dashed p-10 transition-colors ${
					dragActive
						? "border-slate-900 bg-white"
						: "border-slate-300 bg-white/70"
				}`}
			>
				<div className='flex flex-col items-center gap-4 text-center'>
					<p className='text-lg font-medium'>
						Drop files here or browse from your device.
					</p>
					<p className='text-sm text-slate-500'>
						Supported: PNG, JPG, JPEG, SVG.
					</p>
					<div className='flex flex-wrap items-center justify-center gap-3'>
						<button
							type='button'
							className='rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-700'
							onClick={() => inputRef.current?.click()}
						>
							Select files
						</button>
						<button
							type='button'
							className='rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400'
							onClick={clearAll}
							disabled={!files.length}
						>
							Clear
						</button>
						<input
							ref={inputRef}
							type='file'
							accept={ACCEPTED_TYPES.join(",")}
							multiple
							className='hidden'
							onChange={onInputChange}
						/>
					</div>
				</div>
			</section>

			<section className='mt-10 grid gap-6 lg:grid-cols-[1fr_auto]'>
				<div className='rounded-2xl border border-slate-200 bg-white/80 p-6'>
					<h2 className='text-lg font-semibold'>Output settings</h2>
					<div className='mt-5 space-y-5'>
						<div>
							<label className='text-sm font-medium text-slate-600'>
								WebP quality: {Math.round(quality * 100)}
							</label>
							<input
								type='range'
								min={0.5}
								max={1}
								step={0.01}
								value={quality}
								onChange={(event) => setQuality(Number(event.target.value))}
								className='mt-2 w-full'
							/>
						</div>
						<div>
							<label className='text-sm font-medium text-slate-600'>
								ICO size
							</label>
							<p className='mt-1 text-xs text-slate-500'>
								256x256 is the default for modern web apps. Choose another size
								if you need it.
							</p>
							<div className='mt-3 flex flex-wrap gap-2'>
								{[32, 64, 128, 256].map((size) => (
									<button
										key={size}
										type='button'
										className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
											iconSize === size
												? "bg-slate-900 text-white"
												: "border border-slate-300 text-slate-700 hover:border-slate-400"
										}`}
										onClick={() => setIconSize(size)}
									>
										{size}x{size}
									</button>
								))}
							</div>
						</div>
					</div>
				</div>

				<div className='flex flex-col gap-3'>
					<button
						type='button'
						onClick={() => convertAll("webp")}
						disabled={!files.length || busy}
						className='rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400'
					>
						Convert to WebP
					</button>
					<button
						type='button'
						onClick={() => convertAll("ico")}
						disabled={!files.length || busy}
						className='rounded-2xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60'
					>
						Convert to ICO
					</button>
				</div>
			</section>

			{items.length > 0 && (
				<section className='mt-10 rounded-2xl border border-slate-200 bg-white/80 p-6'>
					<div className='flex flex-wrap items-center justify-between gap-3'>
						<h2 className='text-lg font-semibold'>Queue</h2>
						<p className='text-sm text-slate-500'>
							{summary.done} / {summary.total} done
							{summary.errors ? `, ${summary.errors} failed` : ""}
						</p>
					</div>
					<ul className='mt-4 grid gap-2'>
						{items.map((item) => (
							<li
								key={item.name}
								className='flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm'
							>
								<span className='truncate text-slate-700'>{item.name}</span>
								<span
									className={`text-xs font-semibold uppercase tracking-wide ${
										item.status === "done"
											? "text-emerald-600"
											: item.status === "error"
												? "text-rose-600"
												: item.status === "working"
													? "text-slate-500"
													: "text-slate-400"
									}`}
								>
									{item.status}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			<footer className='mt-10 text-xs text-slate-400'>
				Everything stays on your device. No uploads, no tracking.
			</footer>
		</main>
	);
}
