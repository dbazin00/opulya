"use client";

import { Fragment, useId } from "react";
import { useTranslations } from "next-intl";
import logo from "../../public/opulya-spinner.webp";
import largeLogo from "../../public/opulya-spinner-large.webp";
import { spinnerBars } from "./opulya-spinner-masks";
import styles from "./opulya-spinner.module.css";

const sizes = { sm: 32, md: 64, lg: 112 } as const;

export function OpulyaSpinner({
  size = "md",
  label,
  decorative = false,
  animated = true,
  className = "",
}: {
  size?: keyof typeof sizes | number;
  label?: string;
  decorative?: boolean;
  animated?: boolean;
  className?: string;
}) {
  const id = `opulya-spinner-${useId()}`;
  const t = useTranslations();
  const name = label ?? t("common.loading");
  const dimension = typeof size === "number" ? size : sizes[size];
  const source = dimension <= 128 ? logo : largeLogo;
  return (
    <span
      className={`${styles.spinner} ${className}`}
      style={{ width: dimension }}
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      <svg viewBox="0 0 512 512" aria-hidden="true" focusable="false">
        <defs>
          <image
            id={`${id}-source`}
            href={source.src}
            width="512"
            height="512"
          />
          <filter id={`${id}-green`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0.028 0 0 0 0  0.36 0 0 0 0  0.286 0 0 0 0  0 0 0 1 0"
            />
          </filter>
          {animated &&
            spinnerBars.map((bar, index) => (
              <Fragment key={index}>
                <clipPath id={`${id}-bar-${index}`}>
                  <path d={bar.path} />
                </clipPath>
                <clipPath id={`${id}-fill-${index}`}>
                  <rect
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                    className={styles.cover}
                    data-bar={index + 1}
                  />
                </clipPath>
              </Fragment>
            ))}
        </defs>
        <use href={`#${id}-source`} />
        {animated &&
          spinnerBars.map((_, index) => (
            <g
              key={index}
              className={styles.restingBar}
              clipPath={`url(#${id}-bar-${index})`}
            >
              <use
                href={`#${id}-source`}
                filter={`url(#${id}-green)`}
                clipPath={`url(#${id}-fill-${index})`}
              />
            </g>
          ))}
      </svg>
      {!decorative && <span className="sr-only">{name}</span>}
    </span>
  );
}
