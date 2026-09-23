import type { CSSProperties } from "react";

import styles from "./workspace-animation.module.css";

type IconName = "pin" | "clock" | "check" | "people";

function SceneIcon({ name }: { name: IconName }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "pin" && (
        <>
          <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
          <circle cx="12" cy="10" r="2.3" />
        </>
      )}
      {name === "clock" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {name === "check" && <path d="m6 12 4 4 8-8" />}
      {name === "people" && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" />
        </>
      )}
    </svg>
  );
}

function Avatars() {
  return (
    <div className={styles.avatars}>
      {["JL", "AM", "TK", "SR"].map((initials) => (
        <span key={initials} className={styles.avatar}>
          {initials}
        </span>
      ))}
    </div>
  );
}

export default function WorkspaceAnimation({
  paused = false,
}: {
  paused?: boolean;
}) {
  return (
    <div aria-hidden="true" className={styles.wrapper} data-paused={paused}>
      <div className={styles.scene}>
        <div className={styles.grid} />
        <div className={styles.orbit} />
        <div className={styles.innerOrbit} />

        <svg className={styles.connections} viewBox="0 0 560 480" fill="none">
          <g className={styles.connectionLines}>
            <path d="M145 129V178Q145 190 157 190H224Q238 190 238 206" />
            <path d="M445 183V220Q445 237 428 237H365" />
            <path d="M155 347V313Q155 296 172 296H224Q238 296 238 280" />
            <path d="M337 275V337Q337 354 354 354H403" />
          </g>
          <g className={styles.connectionFlow}>
            <path
              pathLength="1"
              d="M145 129V178Q145 190 157 190H224Q238 190 238 206"
            />
            <path pathLength="1" d="M445 183V220Q445 237 428 237H365" />
            <path
              pathLength="1"
              d="M155 347V313Q155 296 172 296H224Q238 296 238 280"
            />
            <path pathLength="1" d="M337 275V337Q337 354 354 354H403" />
          </g>
          <g className={styles.junctions}>
            <circle cx="145" cy="157" r="3" />
            <circle cx="395" cy="237" r="3" />
            <circle cx="194" cy="296" r="3" />
            <circle cx="337" cy="312" r="3" />
          </g>
        </svg>

        <div className={`${styles.card} ${styles.jobCard}`}>
          <div className={styles.cardEyebrow}>
            <span className={styles.hash}>#</span>
            <span>A job taking shape</span>
          </div>
          <div className={styles.jobName}>Riverside fit-out</div>
          <div className={styles.location}>
            <SceneIcon name="pin" />
            <span>Richmond, VIC</span>
            <span className={styles.statusDot} />
          </div>
        </div>

        <div className={`${styles.card} ${styles.hoursCard}`}>
          <span className={styles.clockIcon}>
            <SceneIcon name="clock" />
          </span>
          <div className={styles.hoursValue}>
            32.5<span>hrs</span>
          </div>
          <span className={styles.secondaryText}>Time well spent</span>
          <div className={styles.bars}>
            {[35, 58, 45, 78, 62, 92, 76].map((height, index) => (
              <span
                key={index}
                style={
                  {
                    "--bar-height": `${height}%`,
                    "--bar-index": index,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </div>

        <div className={`${styles.card} ${styles.hub}`}>
          <div className={styles.workspaceMark}>
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.hubTitle}>Your workspace</div>
          <div className={styles.hubSubtitle}>
            <span className={styles.liveDot} />
            Everything, connected
          </div>
        </div>

        <div className={`${styles.card} ${styles.crewCard}`}>
          <div className={styles.cardEyebrow}>
            <SceneIcon name="people" />
            <span>A crew in sync</span>
          </div>
          <Avatars />
          <div className={styles.crewFooter}>
            <span className={styles.statusDot} />
            <span>4 people on site</span>
          </div>
        </div>

        <div className={`${styles.card} ${styles.checkIn}`}>
          <span className={styles.checkIcon}>
            <SceneIcon name="check" />
          </span>
          <div>
            <div className={styles.checkTitle}>All set for today</div>
            <div className={styles.secondaryText}>Let&apos;s get to work.</div>
          </div>
        </div>

        <span className={`${styles.spark} ${styles.sparkOne}`} />
        <span className={`${styles.spark} ${styles.sparkTwo}`} />
        <span className={`${styles.spark} ${styles.sparkThree}`} />
      </div>
    </div>
  );
}
