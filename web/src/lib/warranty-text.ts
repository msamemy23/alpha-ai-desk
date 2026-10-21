// Puts the shop's own details into warranty wording.
//
// The current presets name no shop: {shop} is where the shop's name goes. Wording saved before that
// change may still name the original shop ("Alpha International Auto Center", "Alpha's", "Alpha"), its
// street address or its phone, and those are swapped for this shop's details too.
//
// Everything is replaced in ONE pass over the original text. A replacement is never searched again, so a
// shop called "Alpha International Auto Center" (or any name that contains "Alpha") is written exactly once.

export interface WarrantyShop { name?: string | null; address?: string | null; phone?: string | null }

/** The original shop's details as older saved wording spells them. Only used to find and replace them. */
export const LEGACY = {
  name: 'Alpha International Auto Center',
  address: '10710 S. Main St, Houston, TX 77025',
  phone: '(713) 663-6979',
} as const

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// {shop} first or last does not matter here: it is one pass, and the longer phrases come before the single word "Alpha".
const MARKERS = new RegExp(['\\{shop\\}', escape(LEGACY.name), "Alpha's", '\\bAlpha\\b', escape(LEGACY.address), escape(LEGACY.phone)].join('|'), 'g')

export function fillWarrantyText(value: unknown, shop: WarrantyShop): string {
  const name = String(shop.name || '').trim() || 'our shop'
  const address = String(shop.address || '').trim() || 'our shop'
  const phone = String(shop.phone || '').trim() || 'our shop phone'
  // A function (not a string) so a "$" in a shop name is never read as a replacement pattern.
  return String(value || '').replace(MARKERS, (match) => {
    if (match === "Alpha's") return `${name}'s`
    if (match === LEGACY.address) return address
    if (match === LEGACY.phone) return phone
    return name
  })
}
