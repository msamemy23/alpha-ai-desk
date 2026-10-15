/* eslint-disable @next/next/no-img-element */

/**
 * A shop's logo on a small white tile. The tile stays white in dark mode on purpose: logos are drawn for
 * paper and white backgrounds, and a white tile shows them as the owner intended.
 */
export default function ShopLogoTile({ src, size = 36, alt = '', className = '' }: { src: string; size?: number; alt?: string; className?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`shrink-0 rounded-lg border border-border bg-white object-contain p-0.5 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
