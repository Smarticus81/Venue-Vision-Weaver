import React, { useEffect, useRef, useState } from "react";
import { playReel, shouldAutoplayReel, type ReelPlaybackResult } from "../../lib/reelPlayback";

export function MotionReel({ src, poster, venueName }: { src: string; poster: string; venueName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ReelPlaybackResult>("paused");
  const [preload, setPreload] = useState<"none" | "metadata">("none");
  const requestId = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    let active = true;
    const mayAutoplay = shouldAutoplayReel({ reducedMotion: motion.matches, saveData: !!connection?.saveData });
    setPreload(mayAutoplay ? "metadata" : "none");
    // Set the property before play(): iOS checks the live muted state.
    video.muted = true;
    if (mayAutoplay && !document.hidden) {
      const id = ++requestId.current;
      void playReel(video).then((result) => {
        if (active && id === requestId.current) setStatus(result);
      });
    }
    const pause = () => {
      ++requestId.current;
      video.pause();
    };
    const onVisibility = () => { if (document.hidden) pause(); };
    const onMotion = () => { if (motion.matches) pause(); };
    document.addEventListener("visibilitychange", onVisibility);
    motion.addEventListener("change", onMotion);
    return () => {
      active = false;
      pause();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
    };
  }, [src]);

  const start = () => {
    const video = videoRef.current;
    if (!video) return;
    const id = ++requestId.current;
    if (status === "error") video.load();
    // Keep play() in the tap handler so the browser retains user activation.
    void playReel(video).then((result) => {
      if (id === requestId.current) setStatus(result);
    });
  };

  return (
    <div className="gs-reel">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        width={1280}
        height={720}
        muted
        loop
        playsInline
        controls
        preload={preload}
        onPlaying={() => setStatus("playing")}
        onPause={() => setStatus((current) => current === "error" ? current : "paused")}
        onError={() => { ++requestId.current; setStatus("error"); }}
        aria-label={`Your reel at ${venueName}, generated preview`}
        data-testid="gallery-reel"
      />
      <div className="gs-reel__actions">
        <span role="status">
          {status === "error" ? "The reel couldn't load. Your photos are still available below." :
            status === "playing" ? "Your motion reel · use the controls to pause or seek" : "Your motion reel · tap to play"}
        </span>
        {status !== "playing" && <button type="button" onClick={start}>{status === "error" ? "Retry reel" : "Play reel"}</button>}
        {status === "error" && <a href={src} target="_blank" rel="noopener noreferrer">Open video</a>}
      </div>
    </div>
  );
}
