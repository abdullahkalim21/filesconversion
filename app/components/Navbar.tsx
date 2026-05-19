"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function Navbar() {
	const pathname = usePathname();
	const [timerRunning, setTimerRunning] = useState(false);

	useEffect(() => {
		const handleState = (e: any) => setTimerRunning(e.detail);
		window.addEventListener("pomo-running", handleState);
		return () => window.removeEventListener("pomo-running", handleState);
	}, []);

	const handleNav = (e: React.MouseEvent) => {
		if (timerRunning) {
			e.preventDefault();
			alert("OOGA! Stop timer before leave cave!");
		}
	};

	return (
		<div className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
			<nav className="flex items-center gap-2 px-2 py-2 backdrop-blur-xl transition-colors bg-[#0d0d14]/80 text-white rounded-full border border-white/10 shadow-xl">
				<Link 
					href="/" 
					onClick={handleNav}
					className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
						pathname === "/"
							? "bg-white text-black"
							: "hover:bg-white/10"
					}`}
				>
					📁 Converter
				</Link>
				<Link
					href="/pomodoro"
					onClick={handleNav}
					className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
						pathname === "/pomodoro"
							? "bg-amber-500 text-black"
							: "hover:bg-white/10"
					}`}
				>
					🍅 Pomodoro
				</Link>
			</nav>
		</div>
	);
}
