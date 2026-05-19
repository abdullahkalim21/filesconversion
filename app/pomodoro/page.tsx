"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/* ─── types ─── */
type Track = { id: string; url: string; label: string };

/* ─── helpers ─── */
function extractVideoId(url: string): string | null {
	const m = url.match(
		/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
	);
	return m ? m[1] : null;
}

function fmt(sec: number) {
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ─── SVG icons (inline, no deps) ─── */
const PlayIcon = () => (
	<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
		<path d="M8 5v14l11-7z" />
	</svg>
);
const PauseIcon = () => (
	<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
		<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
	</svg>
);
const NextIcon = () => (
	<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
		<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
	</svg>
);
const VolumeIcon = () => (
	<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
		<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
	</svg>
);
const GearIcon = () => (
	<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
		<circle cx="12" cy="12" r="3" />
		<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
	</svg>
);
const XIcon = () => (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
		<line x1="18" y1="6" x2="6" y2="18" />
		<line x1="6" y1="6" x2="18" y2="18" />
	</svg>
);

/* ═══════════════════════════════════════════ */
export default function PomodoroPage() {
	/* ── timer state ── */
	const [workMin, setWorkMin] = useState(25);
	const [breakMin, setBreakMin] = useState(5);
	const [timeLeft, setTimeLeft] = useState(25 * 60);
	const [running, setRunning] = useState(false);
	const [phase, setPhase] = useState<"work" | "break">("work");
	const [sessions, setSessions] = useState(0);
	const [tracksLoaded, setTracksLoaded] = useState(false);

	/* ── music state ── */
	const [tracks, setTracks] = useState<Track[]>([]);
	const [urlInput, setUrlInput] = useState("");
	const [curIdx, setCurIdx] = useState(0);
	const [volume, setVolume] = useState(50);
	const [musicOn, setMusicOn] = useState(false);
	const [ytReady, setYtReady] = useState(false);

	/* ── ui state ── */
	const [settingsOpen, setSettingsOpen] = useState(false);

	/* ── refs (avoid stale closures) ── */
	const playerRef = useRef<any>(null);
	const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const phaseR = useRef(phase);
	const tracksR = useRef(tracks);
	const curIdxR = useRef(curIdx);
	const musicOnR = useRef(musicOn);

	useEffect(() => { phaseR.current = phase; }, [phase]);
	useEffect(() => { tracksR.current = tracks; }, [tracks]);
	useEffect(() => { curIdxR.current = curIdx; }, [curIdx]);
	useEffect(() => { musicOnR.current = musicOn; }, [musicOn]);

	/* ── sync running state ── */
	useEffect(() => {
		window.dispatchEvent(new CustomEvent("pomo-running", { detail: running }));
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (running) {
				e.preventDefault();
				e.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
			window.dispatchEvent(new CustomEvent("pomo-running", { detail: false }));
		};
	}, [running]);

	/* ── local storage ── */
	useEffect(() => {
		const savedTracks = localStorage.getItem("pomo_tracks");
		if (savedTracks) {
			try { setTracks(JSON.parse(savedTracks)); } catch (e) { }
		}

		const savedState = localStorage.getItem("pomo_state");
		if (savedState) {
			try {
				const s = JSON.parse(savedState);
				if (s.timeLeft !== undefined) setTimeLeft(s.timeLeft);
				if (s.phase) setPhase(s.phase);
				if (s.workMin) setWorkMin(s.workMin);
				if (s.breakMin) setBreakMin(s.breakMin);
				if (s.sessions !== undefined) setSessions(s.sessions);
			} catch (e) { }
		}

		setTracksLoaded(true);
	}, []);

	useEffect(() => {
		if (tracksLoaded) {
			localStorage.setItem("pomo_tracks", JSON.stringify(tracks));
		}
	}, [tracks, tracksLoaded]);

	useEffect(() => {
		if (tracksLoaded && !running) {
			localStorage.setItem("pomo_state", JSON.stringify({
				timeLeft, phase, workMin, breakMin, sessions
			}));
		}
	}, [running, timeLeft, phase, workMin, breakMin, sessions, tracksLoaded]);

	/* ── load YT IFrame API ── */
	useEffect(() => {
		if ((window as any).YT?.Player) { setYtReady(true); return; }
		if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
			const s = document.createElement("script");
			s.src = "https://www.youtube.com/iframe_api";
			document.head.appendChild(s);
		}
		(window as any).onYouTubeIframeAPIReady = () => setYtReady(true);
	}, []);

	/* ── create / load player ── */
	const loadVideo = useCallback((videoId: string) => {
		if (playerRef.current) {
			playerRef.current.loadVideoById(videoId);
			playerRef.current.pauseVideo();
			return;
		}
		if (!(window as any).YT?.Player) return;
		playerRef.current = new (window as any).YT.Player("yt-host", {
			height: "1", width: "1",
			videoId,
			playerVars: { autoplay: 0, controls: 0 },
			events: {
				onReady: (e: any) => e.target.setVolume(volume),
				onStateChange: (e: any) => {
					if (e.data === 0) { // ENDED
						const nxt = (curIdxR.current + 1) % tracksR.current.length;
						setCurIdx(nxt);
						playerRef.current?.loadVideoById(tracksR.current[nxt].id);
					}
				},
			},
		});
	}, [volume]);

	/* ── load first track if available ── */
	useEffect(() => {
		if (ytReady && tracksLoaded && tracks.length > 0 && !playerRef.current) {
			loadVideo(tracks[curIdx].id);
		}
	}, [ytReady, tracks, curIdx, loadVideo, tracksLoaded]);

	/* ── timer tick ── */
	useEffect(() => {
		if (!running) { if (tickRef.current) clearInterval(tickRef.current); return; }
		tickRef.current = setInterval(() => {
			setTimeLeft((t) => {
				if (t <= 1) {
					if (phaseR.current === "work") {
						setPhase("break");
						setSessions((s) => s + 1);
						playerRef.current?.pauseVideo();
						setMusicOn(false);
						return breakMin * 60;
					}
					setPhase("work");
					if (tracksR.current.length > 0) {
						playerRef.current?.playVideo();
						setMusicOn(true);
					}
					return workMin * 60;
				}
				return t - 1;
			});
		}, 1000);
		return () => { if (tickRef.current) clearInterval(tickRef.current); };
	}, [running, workMin, breakMin]);

	/* ── actions ── */
	const toggle = () => {
		if (!running && phase === "work" && tracks.length > 0 && !musicOn) {
			playerRef.current?.playVideo();
			setMusicOn(true);
		}
		setRunning((r) => !r);
	};

	const reset = () => {
		setRunning(false);
		setPhase("work");
		setTimeLeft(workMin * 60);
		playerRef.current?.pauseVideo();
		setMusicOn(false);
	};

	const addTrack = async () => {
		const id = extractVideoId(urlInput.trim());
		if (!id) return;

		let title = `Track ${tracks.length + 1}`;
		try {
			const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
			if (res.ok) {
				const data = await res.json();
				if (data.title) {
					title = data.title;
				}
			}
		} catch (e) {
			console.error("Failed to fetch YouTube title", e);
		}

		const t: Track = { id, url: urlInput.trim(), label: title };
		const next = [...tracks, t];
		setTracks(next);
		setUrlInput("");
		if (next.length === 1 && ytReady) loadVideo(id);
	};

	const removeTrack = (i: number) => {
		const next = tracks.filter((_, j) => j !== i);
		setTracks(next);
		if (next.length === 0) { playerRef.current?.stopVideo(); setMusicOn(false); setCurIdx(0); return; }
		if (i === curIdx) { const ni = Math.min(curIdx, next.length - 1); setCurIdx(ni); playerRef.current?.loadVideoById(next[ni].id); }
		else if (i < curIdx) setCurIdx((c) => c - 1);
	};

	const playNext = () => {
		if (!tracks.length) return;
		const nxt = (curIdx + 1) % tracks.length;
		setCurIdx(nxt);
		playerRef.current?.loadVideoById(tracks[nxt].id);
	};

	const toggleMusic = () => {
		if (!playerRef.current || !tracks.length) return;
		if (musicOn) { playerRef.current.pauseVideo(); setMusicOn(false); }
		else { playerRef.current.playVideo(); setMusicOn(true); }
	};

	const onVolume = (v: number) => { setVolume(v); playerRef.current?.setVolume(v); };

	const skipBreak = () => {
		setPhase("work");
		setTimeLeft(workMin * 60);
		if (tracks.length > 0) { playerRef.current?.playVideo(); setMusicOn(true); }
	};

	const applySettings = (w: number, b: number) => {
		setWorkMin(w); setBreakMin(b);
		if (!running) { setTimeLeft(phase === "work" ? w * 60 : b * 60); }
	};

	/* ── computed ── */
	const total = phase === "work" ? workMin * 60 : breakMin * 60;
	const progress = total > 0 ? (total - timeLeft) / total : 0;
	const R = 120;
	const C = 2 * Math.PI * R;
	const offset = C * (1 - progress);

	/* ═══════════════════ RENDER ═══════════════════ */
	return (
		<div className="pomodoro-page">
			{/* Hidden YouTube player */}
			<div style={{ position: "fixed", top: -10, left: -10, width: 1, height: 1, overflow: "hidden", pointerEvents: "none" }}>
				<div id="yt-host" />
			</div>

			{/* ── Break Overlay ── */}
			{phase === "break" && running && (
				<div className="pomo-break-overlay">
					<div className="pomo-break-card">
						<span style={{ fontSize: 48 }}>☕</span>
						<h2 style={{ fontSize: 28, fontWeight: 700, margin: "12px 0 4px" }}>Take a Break!</h2>
						<p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>Rest your eyes. Stretch. Breathe.</p>
						<p style={{ fontSize: 48, fontWeight: 700, fontVariantNumeric: "tabular-nums", margin: "20px 0" }}>{fmt(timeLeft)}</p>
						<button onClick={skipBreak} className="pomo-btn-outline" type="button">Skip Break →</button>
					</div>
				</div>
			)}

			{/* ── Main content ── */}
			<div className="pomo-container">
				{/* Timer */}
				<div className="pomo-timer-section">
					<p className="pomo-phase-label" data-phase={phase}>
						{phase === "work" ? "FOCUS" : "BREAK"}
					</p>

					<div className={`pomo-svg-wrapper ${running ? "running" : ""}`}>
						<svg width="272" height="272" style={{ transform: "rotate(-90deg)" }}>
							<circle cx="136" cy="136" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
							<circle
								cx="136" cy="136" r={R} fill="none"
								stroke={phase === "work" ? "#f59e0b" : "#34d399"}
								strokeWidth="6" strokeLinecap="round"
								strokeDasharray={C} strokeDashoffset={offset}
								style={{ transition: "stroke-dashoffset 0.4s linear" }}
							/>
						</svg>
						<div className="pomo-time-display">{fmt(timeLeft)}</div>
					</div>

					<p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 12 }}>
						Session #{sessions + 1} {sessions > 0 && `· ${sessions} completed`}
					</p>

					<div className="pomo-timer-controls">
						<button onClick={toggle} className="pomo-btn-primary" type="button">
							{running ? "Pause" : "Start"}
						</button>
						<button onClick={reset} className="pomo-btn-outline" type="button">Reset</button>
						<button
							onClick={() => setSettingsOpen((o) => !o)}
							className="pomo-btn-icon"
							title="Settings"
							type="button"
						>
							<GearIcon />
						</button>
					</div>

					{/* Settings */}
					{settingsOpen && (
						<div className="pomo-settings-card">
							<label>
								<span>Work: {workMin} min</span>
								<input type="range" min={5} max={60} step={5} value={workMin}
									onChange={(e) => applySettings(Number(e.target.value), breakMin)} />
							</label>
							<label>
								<span>Break: {breakMin} min</span>
								<input type="range" min={1} max={30} step={1} value={breakMin}
									onChange={(e) => applySettings(workMin, Number(e.target.value))} />
							</label>
						</div>
					)}
				</div>

				{/* Music section */}
				<div className="pomo-music-section">
					<h3 className="pomo-section-title">🎵 Music Queue</h3>

					{/* URL input */}
					<div className="pomo-url-row">
						<input
							type="text"
							placeholder="Paste YouTube link…"
							value={urlInput}
							onChange={(e) => setUrlInput(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && addTrack()}
							className="pomo-url-input"
						/>
						<button onClick={addTrack} className="pomo-btn-add" type="button">Add</button>
					</div>

					{/* Playlist */}
					{tracks.length > 0 && (
						<ul className="pomo-playlist">
							{tracks.map((t, i) => (
								<li key={t.id + i} className={`pomo-track ${i === curIdx ? "pomo-track-active" : ""}`}>
									<span className="pomo-track-num">{i + 1}</span>
									<span className="pomo-track-label">{t.label}</span>
									{i === curIdx && musicOn && <span className="pomo-track-playing">♪</span>}
									<button onClick={() => removeTrack(i)} className="pomo-track-remove" type="button"><XIcon /></button>
								</li>
							))}
						</ul>
					)}

					{/* Controls */}
					{tracks.length > 0 && (
						<div className="pomo-audio-controls">
							<button onClick={toggleMusic} className="pomo-btn-icon" type="button" title={musicOn ? "Pause" : "Play"}>
								{musicOn ? <PauseIcon /> : <PlayIcon />}
							</button>
							<div className="pomo-volume">
								<VolumeIcon />
								<input type="range" min={0} max={100} value={volume}
									onChange={(e) => onVolume(Number(e.target.value))} />
							</div>
							<button onClick={playNext} className="pomo-btn-icon" type="button" title="Next track">
								<NextIcon />
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
