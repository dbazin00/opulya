"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import { Pause, Play, RotateCcw } from "lucide-react";
import { BrandLink } from "./brand-link";
import { IconButton, Loading, Stat } from "./ui";
import { OpulyaSpinner } from "./opulya-spinner";
import styles from "./opulya-spinner-preview.module.css";

const cycle = 2400;

export function OpulyaSpinnerPreview() {
  const preview = useRef<HTMLDivElement>(null);
  const sliderId = useId();
  const [playing, setPlaying] = useState(true);
  const [position, setPosition] = useState(0);
  const animations = () =>
    preview.current?.getAnimations({ subtree: true }) ?? [];
  const seek = (time: number) => {
    for (const animation of animations()) {
      animation.pause();
      animation.currentTime = time;
    }
    setPlaying(false);
    setPosition(time);
  };
  const toggle = () => {
    const active = animations();
    if (playing) {
      const time = Number(active[0]?.currentTime ?? 0) % cycle;
      for (const animation of active) {
        animation.pause();
        animation.currentTime = time;
      }
      setPosition(time);
    } else {
      for (const animation of active) animation.play();
    }
    setPlaying(!playing);
  };
  return (
    <div ref={preview} className={styles.page}>
      <header className={styles.header}>
        <BrandLink href="/" />
        <span>Development preview</span>
      </header>
      <main className={styles.main}>
        <h1>Logo spinner</h1>
        <section className="section" aria-label="Loading backdrop preview">
          <div className="section-heading">
            <h2>Overview</h2>
          </div>
          <div className="stats-row">
            <Stat label="Net worth" value="24580.40" currency="EUR" />
            <Stat label="Investment value" value="8350" currency="EUR" />
          </div>
          <Loading />
        </section>
        <div className={styles.playback}>
          <IconButton
            label={playing ? "Pause animation" : "Play animation"}
            onClick={toggle}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </IconButton>
          <IconButton
            label="Restart animation"
            onClick={() => {
              for (const animation of animations()) {
                animation.currentTime = 0;
                animation.play();
              }
              setPosition(0);
              setPlaying(true);
            }}
          >
            <RotateCcw size={18} />
          </IconButton>
          <div className={styles.scrubber}>
            <label htmlFor={sliderId}>Cycle position</label>
            <input
              id={sliderId}
              type="range"
              min="0"
              max={cycle}
              step="1"
              value={position}
              aria-valuetext={`${(position / 1000).toFixed(2)} seconds`}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </div>
          <output className={styles.position}>
            {playing ? "Playing" : `${(position / 1000).toFixed(2)} s`}
          </output>
        </div>
        <section
          className={styles.comparison}
          aria-label="Original logo comparison"
        >
          <figure data-preview="animated">
            <OpulyaSpinner size={240} />
            <figcaption>Animated · 2.4 s</figcaption>
          </figure>
          <figure data-preview="original">
            <Image
              src="/opulya-mark.png"
              alt="Original Opulya logo"
              width={240}
              height={240}
              unoptimized
            />
            <figcaption>Original PNG</figcaption>
          </figure>
        </section>
        {(["light", "dark"] as const).map((surface) => (
          <section
            key={surface}
            className={`${styles.surface} ${surface === "light" ? styles.light : styles.dark}`}
            aria-label={`${surface === "light" ? "Light" : "Dark"} surface`}
          >
            <div className={styles.sizes}>
              {(["sm", "md", "lg", 64] as const).map((size) => (
                <figure key={size}>
                  <OpulyaSpinner size={size} />
                  <figcaption>
                    {typeof size === "number" ? `${size} px` : size}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}
        <section className={styles.staticStates} aria-label="Static states">
          <figure data-preview="complete">
            <OpulyaSpinner size={112} animated={false} decorative />
            <figcaption>Completed</figcaption>
          </figure>
          <figure data-preview="reduced">
            <OpulyaSpinner size={112} animated={false} decorative />
            <figcaption>Reduced motion</figcaption>
          </figure>
        </section>
      </main>
    </div>
  );
}
