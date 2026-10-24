"use client";

import Image from "next/image";
import { useTheme } from "./theme-provider";

export function BrandMark({
  size,
  preload = false,
}: {
  size: number;
  preload?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Image
      src={theme === "dark" ? "/opulya-mark-dark.png" : "/opulya-mark.png"}
      alt=""
      width={size}
      height={size}
      preload={preload}
    />
  );
}
