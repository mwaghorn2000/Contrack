"use client";

import Image from "next/image";
import { useState } from "react";

export default function MemberAvatar({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return image && image !== failedImage ? (
    <Image
      src={image}
      alt={`${name}'s profile`}
      width={36}
      height={36}
      unoptimized
      referrerPolicy="no-referrer"
      onError={() => setFailedImage(image)}
      className="size-9 shrink-0 rounded-full object-cover"
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-700"
    >
      {initials || "?"}
    </span>
  );
}
