"use client";

/** Agent avatar: emoji in the mock, uploaded image (data:/http) otherwise. */
export default function Face({ image, className = "" }: { image?: string; className?: string }) {
  if (!image) return null;
  if (/^(data:|https?:|\/)/.test(image)) return <img src={image} alt="" className={`inline-block h-[1.1em] w-[1.1em] object-cover align-middle pixelated ${className}`} />;
  return <span className={className}>{image}</span>;
}
