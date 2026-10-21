import Image from "next/image";

export default function ChannelIcon({
  name,
  imageUrl,
  size = "md",
}: {
  name: string;
  imageUrl: string | null;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-6 text-xs" : "size-9 text-sm";
  return imageUrl ? (
    <Image
      src={imageUrl}
      alt=""
      width={size === "sm" ? 24 : 36}
      height={size === "sm" ? 24 : 36}
      unoptimized
      className={`${box} shrink-0 rounded-md object-cover`}
    />
  ) : (
    <span
      aria-hidden="true"
      title={name}
      className={`${box} flex shrink-0 items-center justify-center rounded-md bg-gray-200 font-semibold text-gray-600`}
    >
      #
    </span>
  );
}
