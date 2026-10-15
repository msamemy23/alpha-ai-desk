import Icon from '@/components/Icon'
import { sentimentOf } from './types'

/** A small marker that always carries a word: icon plus label, coloured by mood. 14px so it stays readable in the sun. */
export default function SentimentMark({ sentiment, className = '' }: { sentiment?: string | null; className?: string }) {
  const s = sentimentOf({ sentiment })
  return (
    <span className={`tag ${s.tag} !px-2.5 !py-0.5 !text-[0.875rem] ${className}`}>
      <Icon name={s.icon} className="h-4 w-4" strokeWidth={2.2} />
      {s.label}
    </span>
  )
}
